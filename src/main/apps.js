"use strict";
// Installed-application discovery and launching (Windows Start menu, incl. Store apps).
const fs = require("fs");
const path = require("path");
const { execFile, spawn } = require("child_process");
const { app, shell } = require("electron");

const NOISE = /uninstall|kaldır|readme|help|documentation|release notes|website|license|manual|sürüm notları/i;
let cache = null;

function startMenuDirs() {
    return [
        path.join(process.env.ProgramData || "C:\\ProgramData", "Microsoft", "Windows", "Start Menu", "Programs"),
        path.join(process.env.APPDATA || "", "Microsoft", "Windows", "Start Menu", "Programs")
    ];
}

async function scanLinks(dir, out, depth = 0) {
    if (depth > 4) return;
    let entries;
    try { entries = await fs.promises.readdir(dir, { withFileTypes: true }); } catch (e) { return; }
    await Promise.all(entries.map(async e => {
        const full = path.join(dir, e.name);
        if (e.isDirectory()) return scanLinks(full, out, depth + 1);
        if (/\.(lnk|url)$/i.test(e.name)) out.set(e.name.replace(/\.(lnk|url)$/i, "").toLowerCase(), full);
    }));
}

/** Get-StartApps lists everything the Start menu can launch, desktop and Store apps alike. */
function getStartApps() {
    return new Promise(resolve => {
        execFile("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command",
            "[Console]::OutputEncoding=[Text.Encoding]::UTF8; Get-StartApps | Select-Object Name,AppID | ConvertTo-Json -Compress"],
        { windowsHide: true, maxBuffer: 8 * 1024 * 1024, timeout: 15000 }, (err, stdout) => {
            if (err) return resolve([]);
            try {
                const j = JSON.parse(stdout);
                resolve(Array.isArray(j) ? j : [j]);
            } catch (e) { resolve([]); }
        });
    });
}

async function listApps({ refresh = false } = {}) {
    if (process.platform !== "win32") return [];
    if (cache && !refresh && Date.now() - cache.at < 5 * 60 * 1000) return cache.list;
    const links = new Map();
    const [apps] = await Promise.all([getStartApps(), ...startMenuDirs().map(d => scanLinks(d, links))]);
    const seen = new Set();
    const list = [];
    for (const a of apps) {
        if (!a || !a.Name || !a.AppID || NOISE.test(a.Name) || /^https?:/i.test(a.AppID)) continue;
        const key = a.Name.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        list.push({ name: a.Name, id: a.AppID, link: links.get(key) || null });
    }
    list.sort((x, y) => x.name.localeCompare(y.name));
    cache = { at: Date.now(), list };
    return list;
}

function launch({ id, link, path: target }) {
    if (link || target) return shell.openPath(link || target);
    if (!id || /[\r\n"]/.test(id)) throw new Error("invalid app id");
    // Works for both Win32 and packaged (Store) apps.
    spawn("explorer.exe", [`shell:AppsFolder\\${id}`], { detached: true, stdio: "ignore", windowsHide: true }).unref();
    return "";
}

function powershell(script) {
    return new Promise(resolve => {
        execFile("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", "[Console]::OutputEncoding=[Text.Encoding]::UTF8; " + script],
            { windowsHide: true, timeout: 15000 }, (err, stdout) => resolve(err ? "" : stdout.trim()));
    });
}

const MIME = { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".ico": "image/x-icon", ".svg": "image/svg+xml", ".gif": "image/gif", ".webp": "image/webp" };
const toDataUrl = (buf, type) => `data:${type};base64,${buf.toString("base64")}`;

/** Store (packaged) apps: read the logo declared in AppxManifest.xml, picking a ~48px variant. */
async function storeAppIcon(appId) {
    const pfn = appId.split("!")[0];
    if (!/^[\w.-]+_\w+$/.test(pfn)) return null;
    const dir = await powershell(`(Get-AppxPackage | Where-Object PackageFamilyName -eq '${pfn}' | Select-Object -First 1).InstallLocation`);
    if (!dir) return null;
    let manifest;
    try { manifest = await fs.promises.readFile(path.join(dir, "AppxManifest.xml"), "utf-8"); } catch (e) { return null; }
    const m = /Square44x44Logo="([^"]+)"/.exec(manifest) || /Square150x150Logo="([^"]+)"/.exec(manifest) || /<Logo>([^<]+)<\/Logo>/.exec(manifest);
    if (!m) return null;
    const rel = m[1].replace(/\//g, "\\");
    const logoDir = path.join(dir, path.dirname(rel));
    const base = path.basename(rel, path.extname(rel)).toLowerCase();
    let files;
    try { files = (await fs.promises.readdir(logoDir)).filter(f => f.toLowerCase().startsWith(base) && /\.png$/i.test(f)); } catch (e) { return null; }
    const rank = f => {
        const l = f.toLowerCase();
        if (l.includes("targetsize-48") && !l.includes("unplated") && !l.includes("light")) return 0;
        if (l.includes("targetsize-48")) return 1;
        if (l.includes("scale-200")) return 2;
        if (l.includes("targetsize-64") || l.includes("targetsize-32")) return 3;
        if (l.includes("scale-100")) return 4;
        return 5;
    };
    files.sort((a, b) => rank(a) - rank(b));
    if (!files.length) return null;
    return toDataUrl(await fs.promises.readFile(path.join(logoDir, files[0])), "image/png");
}

/** Desktop apps: resolve the .lnk to its icon / target executable for the real app icon. */
async function linkIcon(link) {
    let file = link;
    if (process.platform === "win32" && /\.lnk$/i.test(link)) {
        try {
            const sc = shell.readShortcutLink(link);
            const icon = sc.icon && !/\.(dll)$/i.test(sc.icon) && fs.existsSync(sc.icon) ? sc.icon : null;
            if (icon && /\.(ico|png)$/i.test(icon)) return toDataUrl(await fs.promises.readFile(icon), MIME[path.extname(icon).toLowerCase()]);
            file = icon || (sc.target && fs.existsSync(sc.target) ? sc.target : link);
        } catch (e) { /* unreadable shortcut */ }
    }
    return (await app.getFileIcon(file, { size: "large" })).toDataURL();
}

const iconCache = new Map();
async function iconFor({ link, id } = {}) {
    const key = link || id;
    if (!key) return null;
    if (iconCache.has(key)) return iconCache.get(key);
    let url = null;
    try {
        url = link ? await linkIcon(link) : (id && id.includes("!") ? await storeAppIcon(id) : null);
    } catch (e) { /* no icon */ }
    iconCache.set(key, url);
    return url;
}

/** Favicon for a website pin: <link rel=icon> from the page, falling back to /favicon.ico. */
async function faviconFor(pageUrl) {
    const { net } = require("electron");
    const u = new URL(pageUrl);
    const candidates = [];
    try {
        const res = await net.fetch(u.origin + "/", { headers: { "User-Agent": "Mozilla/5.0" } });
        const html = (await res.text()).slice(0, 200000);
        const links = [...html.matchAll(/<link\b[^>]*>/gi)].map(m => m[0]);
        const pick = re => links.filter(l => re.test(l)).map(l => (/href=["']([^"']+)["']/i.exec(l) || [])[1]).filter(Boolean);
        candidates.push(...pick(/rel=["'][^"']*apple-touch-icon/i), ...pick(/rel=["'][^"']*\bicon\b/i));
    } catch (e) { /* offline or blocked */ }
    candidates.push("/favicon.ico");
    for (const href of candidates) {
        try {
            const res = await net.fetch(new URL(href, u.origin).toString());
            if (!res.ok) continue;
            const type = (res.headers.get("content-type") || "").split(";")[0] || "image/x-icon";
            if (!/^image\//.test(type)) continue;
            const buf = Buffer.from(await res.arrayBuffer());
            if (buf.length > 300 * 1024 || !buf.length) continue;
            return toDataUrl(buf, type);
        } catch (e) { /* try next */ }
    }
    return null;
}

module.exports = { listApps, launch, iconFor, faviconFor };
