"use strict";
const path = require("path");
const fs = require("fs");
const os = require("os");
const { Readable } = require("stream");
const { app, BrowserWindow, ipcMain, protocol, net, shell, clipboard, utilityProcess, dialog, screen, Notification, session, powerMonitor } = require("electron");
const { Settings } = require("./settings");
const { PtyManager, TOKEN, resolveShell } = require("./pty");
const apps = require("./apps");
const { AppLock } = require("./lock");
const { Assistant } = require("./ai");
const { MediaBridge } = require("./media");

let appLock = null;
let assistant = null;
let media = null;

const WEB_PARTITION = "persist:web";

const argv = process.argv.slice(1);
const flags = {
    nointro: argv.includes("--nointro"),
    windowed: argv.includes("--windowed"),
    devtools: argv.includes("--devtools")
};

app.setName("CLU");
// Tests run against a throwaway profile so they never touch the user's settings, lock or session
// (set before the single-instance lock, which is keyed on the profile).
if (!app.isPackaged && process.env.CLU_USER_DATA) app.setPath("userData", process.env.CLU_USER_DATA);

if (!app.requestSingleInstanceLock()) {
    app.exit(0);
}
app.commandLine.appendSwitch("ignore-gpu-blocklist");
app.commandLine.appendSwitch("enable-gpu-rasterization");
app.commandLine.appendSwitch("enable-zero-copy");

protocol.registerSchemesAsPrivileged([{
    scheme: "clu-file",
    privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, bypassCSP: true }
}]);

const RENDERER_DIR = path.join(__dirname, "..", "..", "dist");

let win = null;
let settings = null;
let ptys = null;
let sysWorker = null;
const sysPending = new Map();
let sysSeq = 0;

function send(channel, ...args) {
    if (win && !win.isDestroyed()) win.webContents.send(channel, ...args);
}

// ---------- systeminformation utility process ----------

function startSysWorker() {
    sysWorker = utilityProcess.fork(path.join(__dirname, "sysinfo-worker.js"), [], { serviceName: "CLU sysinfo" });
    sysWorker.on("message", ({ id, result, error }) => {
        const p = sysPending.get(id);
        if (!p) return;
        sysPending.delete(id);
        error ? p.reject(new Error(error)) : p.resolve(result);
    });
    sysWorker.on("exit", code => {
        for (const p of sysPending.values()) p.reject(new Error("sysinfo worker exited"));
        sysPending.clear();
        sysWorker = null;
        if (!app.isQuitting) {
            console.error(`[sysinfo] worker exited (${code}), restarting`);
            setTimeout(startSysWorker, 1000);
        }
    });
}

function sysCall(fn, args) {
    return new Promise((resolve, reject) => {
        if (!sysWorker) return reject(new Error("sysinfo worker not running"));
        const id = ++sysSeq;
        sysPending.set(id, { resolve, reject });
        sysWorker.postMessage({ id, fn, args });
    });
}

// ---------- clu-file:// protocol (local media for the viewers) ----------

const MIME = {
    ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif", ".webp": "image/webp",
    ".bmp": "image/bmp", ".svg": "image/svg+xml", ".ico": "image/x-icon", ".avif": "image/avif",
    ".mp4": "video/mp4", ".webm": "video/webm", ".mkv": "video/x-matroska", ".mov": "video/quicktime", ".ogv": "video/ogg",
    ".mp3": "audio/mpeg", ".wav": "audio/wav", ".ogg": "audio/ogg", ".flac": "audio/flac", ".m4a": "audio/mp4", ".opus": "audio/opus",
    ".pdf": "application/pdf", ".html": "text/plain", ".htm": "text/plain"
};

function fileFromUrl(url) {
    const u = new URL(url);
    return decodeURIComponent(u.pathname.slice(1));
}

async function handleFileProtocol(request) {
    let file;
    try {
        file = fileFromUrl(request.url);
    } catch (e) {
        return new Response("bad url", { status: 400 });
    }
    let stat;
    try {
        stat = await fs.promises.stat(file);
        if (!stat.isFile()) throw new Error("not a file");
    } catch (e) {
        return new Response("not found", { status: 404 });
    }
    const type = MIME[path.extname(file).toLowerCase()] || "application/octet-stream";
    const range = request.headers.get("range");
    // Range support is what makes seeking work in <video>/<audio>.
    const m = range && /bytes=(\d*)-(\d*)/.exec(range);
    if (m) {
        let start = m[1] ? parseInt(m[1], 10) : 0;
        let end = m[2] ? parseInt(m[2], 10) : stat.size - 1;
        if (!m[1] && m[2]) {
            start = Math.max(0, stat.size - parseInt(m[2], 10));
            end = stat.size - 1;
        }
        end = Math.min(end, stat.size - 1);
        if (start > end) return new Response(null, { status: 416, headers: { "Content-Range": `bytes */${stat.size}` } });
        return new Response(Readable.toWeb(fs.createReadStream(file, { start, end })), {
            status: 206,
            headers: {
                "Content-Type": type,
                "Content-Length": String(end - start + 1),
                "Content-Range": `bytes ${start}-${end}/${stat.size}`,
                "Accept-Ranges": "bytes"
            }
        });
    }
    return new Response(Readable.toWeb(fs.createReadStream(file)), {
        status: 200,
        headers: { "Content-Type": type, "Content-Length": String(stat.size), "Accept-Ranges": "bytes" }
    });
}

// ---------- filesystem helpers ----------

async function listDir(dir) {
    const entries = await fs.promises.readdir(dir, { withFileTypes: true });
    const out = await Promise.all(entries.map(async d => {
        const full = path.join(dir, d.name);
        let type = d.isDirectory() ? "dir" : d.isSymbolicLink() ? "link" : "file";
        let size = 0, mtime = 0;
        try {
            const st = await fs.promises.stat(full);
            size = st.size;
            mtime = st.mtimeMs;
            if (type === "link") type = st.isDirectory() ? "dirlink" : "link";
        } catch (e) {
            type = type === "link" ? "brokenlink" : type;
        }
        return { name: d.name, path: full, type, size, mtime, hidden: d.name.startsWith(".") };
    }));
    if (process.platform === "win32" && out.length < 3000) {
        // Windows "hidden" attribute isn't exposed by fs; dotfiles are good enough elsewhere.
        for (const e of out) if (/^(\$|desktop\.ini$|ntuser\.)/i.test(e.name)) e.hidden = true;
    }
    return out;
}

async function listDrives() {
    if (process.platform !== "win32") return [{ name: "/", path: "/" }];
    const drives = [];
    await Promise.all("CDEFGHIJKLMNOPQRSTUVWXYZ".split("").map(async l => {
        try {
            await fs.promises.access(`${l}:\\`);
            drives.push({ name: `${l}:`, path: `${l}:\\` });
        } catch (e) { /* no drive */ }
    }));
    return drives.sort((a, b) => a.name.localeCompare(b.name));
}

const MAX_TEXT_BYTES = 8 * 1024 * 1024;

async function readText(file) {
    const st = await fs.promises.stat(file);
    if (st.size > MAX_TEXT_BYTES) throw new Error(`File is too large to edit (${(st.size / 1048576).toFixed(1)} MB).`);
    const buf = await fs.promises.readFile(file);
    const sample = buf.subarray(0, Math.min(buf.length, 8000));
    const binary = sample.includes(0);
    return { text: binary ? "" : buf.toString("utf-8"), binary, size: st.size, mtime: st.mtimeMs };
}

// ---------- geo lookup ----------

let geoCache = null;
async function geoLookup() {
    if (!settings.data.geoLookup) return null;
    if (geoCache && Date.now() - geoCache.at < 15 * 60 * 1000) return geoCache.data;
    const res = await net.fetch("https://ipwho.is/", { headers: { "User-Agent": "CLU" } });
    const j = await res.json();
    if (!j.success) throw new Error(j.message || "geo lookup failed");
    const data = { ip: j.ip, lat: j.latitude, lon: j.longitude, city: j.city, region: j.region, country: j.country, countryCode: j.country_code, isp: j.connection && j.connection.isp };
    geoCache = { at: Date.now(), data };
    return data;
}

// ---------- window ----------

function createWindow() {
    const s = settings.data;
    const fullscreen = s.fullscreen && !flags.windowed;
    const display = screen.getPrimaryDisplay();
    const { width, height } = display.workAreaSize;

    win = new BrowserWindow({
        title: "CLU",
        width: fullscreen ? width : Math.min(1600, width),
        height: fullscreen ? height : Math.min(900, height),
        minWidth: 960,
        minHeight: 540,
        show: false,
        fullscreen,
        frame: !fullscreen,
        autoHideMenuBar: true,
        backgroundColor: "#000000",
        icon: path.join(RENDERER_DIR, "icon.png"),
        webPreferences: {
            preload: path.join(__dirname, "..", "preload", "preload.js"),
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: true,
            backgroundThrottling: false,
            spellcheck: false,
            plugins: true,
            webviewTag: true
        }
    });

    // Web tabs (<webview>): force a locked-down configuration whatever the page asks for.
    win.webContents.on("will-attach-webview", (e, prefs, params) => {
        delete prefs.preload;
        prefs.nodeIntegration = false;
        prefs.nodeIntegrationInSubFrames = false;
        prefs.contextIsolation = true;
        prefs.sandbox = true;
        prefs.webSecurity = true;
        params.partition = WEB_PARTITION;
        if (!/^(https?:|about:blank)/i.test(params.src || "")) e.preventDefault();
    });
    win.webContents.on("did-attach-webview", (e, wc) => {
        // Popups / target=_blank become new CLU web tabs.
        wc.setWindowOpenHandler(({ url }) => {
            if (/^https?:/i.test(url)) send("web:open", url);
            return { action: "deny" };
        });
        // Keys typed inside a web page never reach the CLU window, so app-level combos
        // (Ctrl+Shift+..., Ctrl+Alt+..., Ctrl+Tab, Alt+digit, F11) are forwarded instead.
        wc.on("before-input-event", (e, input) => {
            if (input.type !== "keyDown") return;
            const appCombo = (input.control && (input.shift || input.alt)) || (input.control && input.code === "Tab")
                || (input.alt && !input.control && /^Digit[1-9]$/.test(input.code)) || input.code === "F11";
            if (!appCombo) return;
            e.preventDefault();
            send("web:key", { code: input.code, ctrlKey: input.control, shiftKey: input.shift, altKey: input.alt, metaKey: input.meta });
        });
    });
    win.setMenu(null);
    win.loadFile(path.join(RENDERER_DIR, "index.html"));
    win.once("ready-to-show", () => {
        win.show();
        if (flags.devtools) win.webContents.openDevTools({ mode: "detach" });
    });

    // Dev aids: mirror renderer console to stdout, and capture screenshots on a schedule
    // (CLU_SCREENSHOT=<dir> CLU_SCREENSHOT_AT=3000,8000).
    if (!app.isPackaged) attachDevHooks();

    win.webContents.setWindowOpenHandler(({ url }) => {
        if (/^https?:\/\//.test(url)) shell.openExternal(url);
        return { action: "deny" };
    });
    win.webContents.on("will-navigate", (e, url) => {
        if (url !== win.webContents.getURL()) e.preventDefault();
    });
    win.on("enter-full-screen", () => send("win:fullscreen", true));
    win.on("leave-full-screen", () => send("win:fullscreen", false));
    win.on("close", e => {
        if (settings.data.confirmOnQuit && !app.isQuitting) {
            const choice = dialog.showMessageBoxSync(win, {
                type: "question", buttons: ["Quit", "Cancel"], defaultId: 1, title: "CLU", message: "Quit CLU and close all terminals?"
            });
            if (choice !== 0) e.preventDefault();
        }
    });
    win.on("closed", () => { win = null; });
}

function attachDevHooks() {
    if (process.env.CLU_DEBUG) {
        win.webContents.on("console-message", e => console.log(`[renderer:${e.level}] ${e.message} (${e.sourceId}:${e.lineNumber})`));
    }
    if (process.env.CLU_EVAL) {
        const script = fs.readFileSync(process.env.CLU_EVAL, "utf-8");
        // Re-run on every load so tests can span a reload (they keep state in localStorage).
        win.webContents.on("did-finish-load", () => setTimeout(() => {
            win.webContents.executeJavaScript(script).catch(e => console.log("[eval] failed:", e.message));
        }, Number(process.env.CLU_EVAL_DELAY || 3000)));
    }
    if (process.env.CLU_SCREENSHOT) {
        // console.log("__SNAP__name") from the renderer captures on demand.
        win.webContents.on("console-message", async e => {
            const m = /^__SNAP__(\w+)/.exec(e.message);
            if (!m || !win) return;
            const img = await win.webContents.capturePage();
            fs.writeFileSync(path.join(process.env.CLU_SCREENSHOT, `${m[1]}.png`), img.toPNG());
        });
        const times = (process.env.CLU_SCREENSHOT_AT || "6000").split(",").map(Number);
        times.forEach((ms, i) => setTimeout(async () => {
            if (!win) return;
            const img = await win.webContents.capturePage();
            const file = path.join(process.env.CLU_SCREENSHOT, `shot-${i}.png`);
            fs.writeFileSync(file, img.toPNG());
            console.log(`[screenshot] ${file}`);
        }, ms));
    }
}

// ---------- IPC ----------

// Channels refused while the app lock is engaged.
const GATED = /^(settings:(set|reset)|pty:(create|write|kill)|sys:kill|fs:|shell:|clipboard:|apps:launch|dialog:|session:|ai:)/;

// Tabs, directories and recent terminal output, so CLU reopens where it was closed.
const sessionFile = () => path.join(app.getPath("userData"), "session.json");
function writeSession(data) {
    const json = JSON.stringify(data);
    if (json.length > 20 * 1024 * 1024) return false;
    fs.writeFileSync(sessionFile() + ".tmp", json, { mode: 0o600 });
    fs.renameSync(sessionFile() + ".tmp", sessionFile());
    return true;
}

function registerIpc() {
    const handle = (ch, fn) => ipcMain.handle(ch, (e, ...a) => {
        if (GATED.test(ch) && appLock.locked) throw new Error("CLU is locked");
        return fn(...a);
    });

    handle("session:load", () => {
        try { return JSON.parse(fs.readFileSync(sessionFile(), "utf-8")); } catch (e) { return null; }
    });
    handle("session:save", data => writeSession(data));
    ipcMain.on("session:saveSync", (e, data) => {
        try { e.returnValue = !appLock.locked && writeSession(data); } catch (err) { e.returnValue = false; }
    });

    handle("media:start", () => media.start());
    handle("media:command", cmd => media.command(cmd));

    handle("ai:status", () => assistant.status());
    handle("ai:setKey", key => assistant.setKey(key));
    handle("ai:ask", (id, payload) => assistant.ask(id, payload || {}, send));
    handle("ai:cancel", id => assistant.cancel(id));

    handle("lock:status", () => appLock.status());
    handle("lock:verify", pin => appLock.verify(pin));
    handle("lock:lock", () => appLock.lock());
    handle("lock:change", (current, next) => appLock.change(current, next));
    handle("lock:setEnabled", (current, enabled) => appLock.setEnabled(current, enabled));

    handle("app:info", () => ({
        version: app.getVersion(),
        electron: process.versions.electron,
        chrome: process.versions.chrome,
        node: process.versions.node,
        platform: process.platform,
        arch: process.arch,
        hostname: os.hostname(),
        username: os.userInfo().username,
        homedir: os.homedir(),
        cpus: os.cpus().length,
        cpuModel: (os.cpus()[0] || {}).model || "",
        totalmem: os.totalmem(),
        release: os.release(),
        osVersion: typeof os.version === "function" ? os.version() : os.type(),
        userData: app.getPath("userData"),
        shell: resolveShell(settings.data.shell),
        token: TOKEN,
        flags
    }));

    handle("settings:get", () => settings.data);
    handle("settings:set", partial => settings.set(partial));
    handle("settings:reset", () => settings.reset());
    handle("settings:path", () => settings.file);
    handle("themes:user", () => settings.userThemes());
    handle("themes:dir", () => settings.themesDir);

    handle("pty:create", opts => {
        const s = settings.data;
        const o = opts || {};
        return ptys.create({
            shell: s.shell,
            shellArgs: s.shellArgs,
            cwd: o.cwd || s.cwd,
            cols: o.cols,
            rows: o.rows,
            env: Object.assign({}, s.env, o.env)
        });
    });
    ipcMain.on("pty:write", (e, id, data) => { if (!appLock.locked) ptys.write(id, data); });
    ipcMain.on("pty:resize", (e, id, cols, rows) => ptys.resize(id, cols, rows));
    ipcMain.on("pty:ack", (e, id, bytes) => ptys.ack(id, bytes));
    ipcMain.on("pty:kill", (e, id) => ptys.kill(id));
    handle("pty:process", id => ptys.processName(id));

    handle("sys:call", (fn, args) => sysCall(fn, args));
    handle("sys:geo", () => geoLookup());
    handle("sys:kill", (pid, signal) => {
        process.kill(pid, signal || "SIGTERM");
        return true;
    });

    handle("fs:list", dir => listDir(dir));
    handle("fs:drives", () => listDrives());
    handle("fs:readText", file => readText(file));
    handle("fs:writeText", async (file, text) => {
        await fs.promises.writeFile(file, text, "utf-8");
        return true;
    });
    handle("fs:stat", async file => {
        const st = await fs.promises.stat(file);
        return { size: st.size, mtime: st.mtimeMs, isDir: st.isDirectory(), isFile: st.isFile() };
    });
    handle("fs:exists", async file => {
        try { await fs.promises.access(file); return true; } catch (e) { return false; }
    });
    handle("fs:mkdir", async dir => { await fs.promises.mkdir(dir, { recursive: true }); return true; });
    handle("fs:rename", async (from, to) => { await fs.promises.rename(from, to); return true; });
    handle("fs:trash", async file => { await shell.trashItem(file); return true; });

    handle("shell:openPath", p => shell.openPath(p));
    handle("shell:openExternal", url => {
        if (!/^(https?|mailto):/i.test(url)) throw new Error("Only http(s) and mailto links can be opened.");
        return shell.openExternal(url);
    });
    handle("shell:showItem", p => shell.showItemInFolder(p));

    handle("clipboard:read", () => clipboard.readText());
    handle("clipboard:write", text => clipboard.writeText(String(text)));

    handle("win:toggleFullscreen", () => {
        if (!win) return false;
        win.setFullScreen(!win.isFullScreen());
        return win.isFullScreen();
    });
    handle("win:isFullscreen", () => !!win && win.isFullScreen());
    handle("win:devtools", () => win && win.webContents.toggleDevTools());
    handle("win:minimize", () => win && win.minimize());
    handle("win:notify", (title, body) => {
        if (Notification.isSupported()) new Notification({ title, body, silent: true }).show();
    });
    handle("app:quit", () => { app.isQuitting = true; app.quit(); });
    handle("app:relaunch", () => { app.isQuitting = true; app.relaunch(); app.quit(); });
    handle("apps:list", opts => apps.listApps(opts));
    handle("apps:launch", target => apps.launch(target || {}));
    handle("apps:icon", target => apps.iconFor(target));
    handle("apps:favicon", url => {
        if (!/^https?:\/\//i.test(url)) throw new Error("not a web url");
        return apps.faviconFor(url);
    });

    handle("dialog:openFile", async opts => {
        const r = await dialog.showOpenDialog(win, Object.assign({ properties: ["openFile"] }, opts || {}));
        return r.canceled ? null : r.filePaths[0];
    });
}

// ---------- auto-lock ----------

// Locks when the whole system has been idle for `autoLockMinutes` (0 = off) or when
// Windows itself locks. Uses system idle time, so typing in other apps counts as activity.
function setupAutoLock() {
    const engage = reason => {
        if (!appLock.enabled || appLock.locked) return;
        appLock.lock();
        send("lock:engaged", reason);
    };
    setInterval(() => {
        const minutes = Number(settings.data.autoLockMinutes) || 0;
        const idle = powerMonitor.getSystemIdleTime();
        if (process.env.CLU_DEBUG) console.log(`[autolock] idle=${idle}s threshold=${minutes * 60}s enabled=${appLock.enabled} locked=${appLock.locked}`);
        if (minutes > 0 && idle >= minutes * 60) engage("idle");
    }, 15000);
    powerMonitor.on("lock-screen", () => { if (settings.data.lockWithWindows) engage("windows"); });
}

// ---------- web tabs session ----------

function setupWebSession() {
    const ses = session.fromPartition(WEB_PARTITION);
    // Present as plain Chrome: some sites refuse "Electron" user agents.
    ses.setUserAgent(ses.getUserAgent().replace(/\s(Electron|CLU|clu)\/\S+/g, ""));
    const allowed = new Set(["fullscreen", "clipboard-sanitized-write", "pointerLock", "notifications"]);
    ses.setPermissionRequestHandler((wc, permission, cb) => cb(allowed.has(permission)));
    ses.setPermissionCheckHandler((wc, permission) => allowed.has(permission));
}

// ---------- lifecycle ----------

app.on("second-instance", () => {
    if (!win) return;
    if (win.isMinimized()) win.restore();
    win.focus();
});

app.whenReady().then(() => {
    settings = new Settings();
    appLock = new AppLock(app.getPath("userData"));
    assistant = new Assistant(app.getPath("userData"));
    media = new MediaBridge(send);
    setupAutoLock();
    ptys = new PtyManager(send);
    protocol.handle("clu-file", handleFileProtocol);
    setupWebSession();
    registerIpc();
    startSysWorker();
    createWindow();
});

app.on("before-quit", () => {
    app.isQuitting = true;
    if (ptys) ptys.killAll();
    if (media) media.stop();
    if (sysWorker) sysWorker.kill();
});

app.on("window-all-closed", () => app.quit());

process.on("uncaughtException", e => {
    console.error("[main] uncaught:", e);
    try { dialog.showErrorBox("CLU error", String(e && e.stack || e)); } catch (err) { /* app not ready */ }
});
