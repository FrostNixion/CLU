import "@xterm/xterm/css/xterm.css";
import "@fontsource/fira-code/400.css";
import "@fontsource/fira-code/700.css";
import "@fontsource/rajdhani/400.css";
import "@fontsource/rajdhani/500.css";
import "@fontsource/rajdhani/600.css";
import "./styles/main.css";

import { store, bus } from "./core/store.js";
import { themes } from "./core/theme.js";
import { audio } from "./core/audio.js";
import { commands, eventCombo, normalizeCombo } from "./core/commands.js";
import { delay, isAbsolute, joinPath, h } from "./lib/util.js";
import { runBoot } from "./ui/boot.js";
import { Modal, toast } from "./ui/modal.js";
import { openPalette, openPicker, pickerOpen } from "./ui/palette.js";
import { openSettings } from "./ui/settings.js";
import { openProcessManager } from "./ui/processes.js";
import { openFile, editFile } from "./ui/viewer.js";
import { TabManager } from "./terminal/tabs.js";
import { FileBrowser } from "./fs/filesystem.js";
import { Keyboard } from "./keyboard/keyboard.js";
import { LAYOUTS } from "./keyboard/layouts.js";
import { background, BACKGROUNDS } from "./ui/background.js";
import { showLock, lockNow, isLocked } from "./ui/lockscreen.js";
import { formatMs } from "./terminal/blocks.js";
import { initLauncher, openMenu, pickApp, findApp, launchPinned, pin, pinWeb, unpinByName } from "./ui/launcher.js";
import { ACCENTS, parseColor, toHex } from "./core/colors.js";
import { ClockPanel, SysinfoPanel, HardwarePanel, CpuPanel, RamPanel, TopPanel } from "./panels/left.js";
import { NetworkPanel, GlobePanel, TrafficPanel, StoragePanel } from "./panels/right.js";

const $ = id => document.getElementById(id);
let tabs, files, keyboard;
const session = () => tabs && tabs.session;

const recentErrors = new Map();
window.addEventListener("error", e => {
    console.error(e.error || e.message);
    // Surface errors, but never let a per-frame failure flood the screen.
    const last = recentErrors.get(e.message) || 0;
    if (Date.now() - last < 30000) return;
    recentErrors.set(e.message, Date.now());
    if (document.body.classList.contains("ready")) toast(`Error: ${e.message}`, "error", 6000);
});
window.addEventListener("unhandledrejection", e => console.error("[unhandled]", e.reason));

// ---------- layout ----------

function applyLayout() {
    const app = $("app");
    app.classList.toggle("no-keyboard", !store.get("showKeyboard"));
    app.classList.toggle("no-fs", !store.get("showFilesystem"));
    requestAnimationFrame(() => tabs && tabs.tabs.forEach(t => t.session.scheduleFit()));
}

function resolvePath(p, cwd) {
    if (!p) return cwd;
    if (p === "~" || p.startsWith("~/") || p.startsWith("~\\")) p = joinPath(store.info.homedir, p.slice(2));
    return isAbsolute(p) ? p : joinPath(cwd, p);
}

// ---------- themes ----------

function pickTheme() {
    const saved = store.get("theme");
    openPicker({
        placeholder: "Select a theme (arrows preview it live)",
        items: themes.names().map(n => ({
            label: n,
            detail: themes.describe(n),
            hint: n === saved ? "current" : "",
            preview: () => themes.apply(n),
            run: () => store.update({ theme: n })
        })),
        onCancel: () => themes.apply(saved)
    });
}

function pickKeyboard() {
    openPicker({
        placeholder: "Keyboard layout",
        items: Object.entries(LAYOUTS).map(([k, l]) => ({ label: k, detail: l.name, run: () => store.update({ keyboard: k, showKeyboard: true }) }))
    });
}

// ---------- background designs & accent colors ----------

function cycle(list, current, dir) {
    const i = list.indexOf(current);
    return list[(i + dir + list.length) % list.length];
}

function setBackground(name) {
    if (!BACKGROUNDS[name]) return toast(`Unknown background "${name}". Available: ${Object.keys(BACKGROUNDS).join(", ")}`, "warn", 6000);
    store.update({ background: name });
    toast(`Background: ${name}`, "info", 1500);
}

function pickBackground() {
    const saved = store.get("background");
    openPicker({
        placeholder: "Background design (arrows preview it live)",
        items: Object.entries(BACKGROUNDS).map(([name, desc]) => ({
            label: name, detail: desc, hint: name === saved ? "current" : "",
            preview: () => background.apply(name),
            run: () => store.update({ background: name })
        })),
        onCancel: () => background.apply(saved)
    });
}

/** Accepts a preset name, hex or "r,g,b"; "reset"/"theme" restores the theme's own color. */
function setAccent(value) {
    if (!value || /^(reset|theme|default|off)$/i.test(value)) {
        store.update({ accent: "" });
        return toast("Accent: theme default", "info", 1500);
    }
    const rgb = parseColor(value);
    if (!rgb) return toast(`Unknown color "${value}". Use a name (${Object.keys(ACCENTS).join(", ")}), #hex or r,g,b`, "warn", 7000);
    store.update({ accent: toHex(rgb) });
    toast(`Accent: ${value}`, "info", 1500);
}

function pickAccent() {
    const saved = store.get("accent");
    const items = [{ label: "theme default", detail: "use the theme's own color", preview: () => themes.setAccent(null), run: () => setAccent("reset") }];
    for (const [name, rgb] of Object.entries(ACCENTS)) {
        items.push({
            label: name, detail: toHex(rgb), hint: toHex(rgb) === saved ? "current" : "",
            preview: () => themes.setAccent(rgb), run: () => setAccent(name)
        });
    }
    openPicker({
        placeholder: "Accent color (arrows preview it live) — or `clu accent #hex` in the terminal",
        items,
        onCancel: () => themes.setAccent(saved ? parseColor(saved) : null)
    });
}

function nextAccent(dir) {
    const names = ["", ...Object.keys(ACCENTS)];
    const cur = Object.keys(ACCENTS).find(n => toHex(ACCENTS[n]) === store.get("accent")) || "";
    const next = cycle(names, cur, dir);
    setAccent(next || "reset");
}

// ---------- session persistence ----------

function setupSessionPersistence() {
    let timer = null;
    const save = () => {
        clearTimeout(timer);
        timer = null;
        if (!store.get("restoreSession") || isLocked()) return;
        window.clu.session.save(tabs.serialize()).catch(() => {});
    };
    tabs.on("changed", () => {
        if (!timer) timer = setTimeout(save, 2000);
    });
    // Terminal output changes constantly; snapshot it every 30s and on exit.
    setInterval(save, 30000);
    window.addEventListener("beforeunload", () => {
        if (!store.get("restoreSession") || isLocked()) return;
        try { window.clu.session.saveSync(tabs.serialize()); } catch (e) { /* closing anyway */ }
    });
}

// ---------- command blocks ----------

async function copyLastOutput() {
    const s = session();
    const last = s && s.blocks.last;
    if (!last) return toast("No finished command yet", "warn");
    await window.clu.clipboard.write(s.blocks.output(last));
    toast(`Copied output of: ${last.cmd.slice(0, 50)}`, "info", 2000);
}

/** Long-running command finished: sound always, notification when you're looking elsewhere. */
function onCommandDone(block, tab) {
    const threshold = Number(store.get("notifyAfterSeconds")) || 0;
    if (!threshold || !(block.ms >= threshold * 1000)) return;
    audio.play(block.ok ? "granted" : "error");
    const text = `${block.ok ? "✓ Finished" : `✗ Failed (${block.code})`} in ${formatMs(block.ms)}: ${block.cmd.slice(0, 80)}`;
    const away = document.hidden || !document.hasFocus() || tabs.active !== tab;
    toast(text, block.ok ? "info" : "error", 6000);
    if (away) window.clu.win.notify("CLU", text);
    if (tabs.active !== tab) tab.li.classList.add("activity");
}

// ---------- app lock password ----------

/** mode: "change" | "on" | "off" — every mode asks for the current password. */
function openPasswordDialog(mode) {
    const field = (label, id) => {
        const input = h("input.pw-input", { type: "password", id, autocomplete: "off" });
        return { input, row: h("label.settings-row", { for: id }, h("div.settings-label", h("span", label)), h("div.settings-input", input)) };
    };
    const cur = field("Current password", "pw-cur");
    const next = field("New password", "pw-new");
    const again = field("Repeat new password", "pw-again");
    const msg = h("p.pw-msg");
    const rows = mode === "change" ? [cur.row, next.row, again.row] : [cur.row];
    const title = { change: "Change password", on: "Enable app lock", off: "Disable app lock" }[mode];
    const body = h("div.settings-grid", h("p.dim", mode === "change"
        ? "Asked every time CLU starts and on Ctrl+Alt+L. 4-64 characters (digits or text)."
        : mode === "off" ? "CLU will start without asking for a password." : "CLU will ask for the password at startup."), ...rows, msg);
    body.addEventListener("keydown", e => { e.stopPropagation(); if (e.key === "Enter") save(); });
    const fail = text => { msg.textContent = text; msg.className = "pw-msg bad"; audio.play("denied"); };
    const save = async () => {
        if (mode === "change") {
            if (next.input.value !== again.input.value) return fail("New passwords do not match");
            const r = await window.clu.lock.change(cur.input.value, next.input.value);
            if (!r.ok) return fail(r.error);
            toast("Password changed", "info");
        } else {
            const r = await window.clu.lock.setEnabled(cur.input.value, mode === "on");
            if (!r.ok) return fail(r.error);
            toast(mode === "on" ? "App lock enabled" : "App lock disabled", "info");
        }
        audio.play("granted");
        modal.close();
    };
    const modal = new Modal({ title, className: "settings-modal", body, buttons: [{ label: "Save", primary: true, keep: true, action: save }] });
    setTimeout(() => cur.input.focus(), 50);
}

// ---------- user-defined shortcuts (`clu bind`) ----------

/** Split a command line respecting "double" and 'single' quotes. */
function splitArgs(s) {
    const out = [];
    s.replace(/"([^"]*)"|'([^']*)'|(\S+)/g, (m, a, b, c) => { out.push(a ?? b ?? c); return m; });
    return out;
}

const MODS = /^(ctrl|alt|shift|meta)$/;
function validCombo(keys) {
    const parts = normalizeCombo(keys).split("+");
    const key = parts[parts.length - 1];
    const hasMod = parts.slice(0, -1).some(p => MODS.test(p));
    // A bare letter would hijack normal typing; require a modifier (F-keys are fine alone).
    return key && (hasMod || /^f\d{1,2}$/.test(key)) && (!parts.includes("shift") || parts.length > 2 || /^f\d/.test(key));
}

async function bindShortcut(keys, command) {
    if (!keys || !command) return toast("Usage: clu bind <keys> <clu command>   e.g. clu bind Ctrl+Alt+M theme matrix", "warn", 7000);
    if (!validCombo(keys)) return toast(`"${keys}" needs Ctrl/Alt (+Shift) or an F-key`, "warn", 6000);
    const shortcuts = { ...store.get("shortcuts") };
    shortcuts[normalizeCombo(keys)] = command;
    await store.update({ shortcuts });
    toast(`${keys} → clu ${command}`, "info", 3000);
}

async function unbindShortcut(keys) {
    const shortcuts = { ...store.get("shortcuts") };
    if (!keys || !(normalizeCombo(keys) in shortcuts)) return toast(`No custom shortcut "${keys || ""}"`, "warn");
    delete shortcuts[normalizeCombo(keys)];
    await store.update({ shortcuts });
    toast(`Removed ${keys}`, "info", 2000);
}

function setFontSize(size) {
    const s = Math.max(8, Math.min(40, Math.round(size)));
    store.update({ termFontSize: s });
}

// ---------- commands ----------

function registerCommands() {
    const c = (id, title, run, opts = {}) => commands.register({ id, title, run, ...opts });
    const T = "Terminal", V = "View", A = "App", F = "Files";

    c("tab.new", "New terminal tab", () => tabs.add(), { category: T, keys: "Ctrl+Shift+T" });
    c("web.new", "New web tab", () => tabs.addWeb({}).session.address.focus(), { category: T, keys: "Ctrl+Shift+N" });
    c("app.launch", "Launch app...", () => pickApp("launch"), { category: A, keys: "Ctrl+Shift+D" });
    c("app.pin", "Pin app to tab bar...", () => pickApp("pin"), { category: A });
    c("lock", "Lock CLU", () => lockNow().then(ok => ok || toast("The lock is turned off. Enable it: clu password on", "warn", 5000)), { category: A, keys: "Ctrl+Alt+L" });
    c("password", "Change password...", () => openPasswordDialog("change"), { category: A });
    c("app.menu", "Tab bar menu (web / apps)", () => openMenu(tabs.menuBtn), { category: A });
    c("tab.close", "Close pane / tab", () => tabs.closePane(), { category: T, keys: "Ctrl+Shift+W" });
    c("tab.closeAll", "Close tab (all panes)", () => tabs.close(), { category: T });
    c("pane.splitRight", "Split pane right", () => tabs.split("row"), { category: T, keys: "Alt+Shift+=" });
    c("pane.splitDown", "Split pane down", () => tabs.split("col"), { category: T, keys: "Alt+Shift+-" });
    c("pane.focusLeft", "Focus pane left", () => tabs.focusDirection("left"), { category: T, keys: "Ctrl+Alt+Left" });
    c("pane.focusRight", "Focus pane right", () => tabs.focusDirection("right"), { category: T, keys: "Ctrl+Alt+Right" });
    c("pane.focusUp", "Focus pane up", () => tabs.focusDirection("up"), { category: T, keys: "Ctrl+Alt+Up" });
    c("pane.focusDown", "Focus pane down", () => tabs.focusDirection("down"), { category: T, keys: "Ctrl+Alt+Down" });
    c("session.forget", "Forget saved session", () => window.clu.session.save({ tabs: [] }).then(() => toast("Saved session cleared", "info")), { category: A });
    c("tab.next", "Next tab", () => tabs.next(), { category: T, keys: "Ctrl+Tab" });
    c("tab.prev", "Previous tab", () => tabs.prev(), { category: T, keys: "Ctrl+Shift+Tab" });
    c("tab.rename", "Rename tab", () => tabs.rename(), { category: T });
    for (let i = 1; i <= 9; i++) c(`tab.go${i}`, `Go to tab ${i}`, () => tabs.go(i - 1), { hidden: true, keys: `Alt+${i}` });
    c("term.copy", "Copy selection", () => session() && session().copy(), { category: T, keys: "Ctrl+Shift+C" });
    c("term.paste", "Paste", () => session() && session().paste(), { category: T, keys: "Ctrl+Shift+V" });
    c("term.find", "Find in terminal", () => tabs.openSearch(), { category: T, keys: "Ctrl+Shift+F" });
    c("term.clear", "Clear terminal", () => session() && session().term.clear(), { category: T, keys: "Ctrl+Shift+X" });
    c("term.zoomIn", "Increase font size", () => setFontSize(store.get("termFontSize") + 1), { category: T, keys: "Ctrl+=" });
    c("term.zoomOut", "Decrease font size", () => setFontSize(store.get("termFontSize") - 1), { category: T, keys: "Ctrl+-" });
    c("term.zoomReset", "Reset font size", () => setFontSize(15), { category: T, keys: "Ctrl+0" });
    c("term.prevCommand", "Jump to previous command", () => session() && session().blocks.jump(-1), { category: T, keys: "Ctrl+Shift+Up" });
    c("term.nextCommand", "Jump to next command", () => session() && session().blocks.jump(1), { category: T, keys: "Ctrl+Shift+Down" });
    c("term.copyLastOutput", "Copy last command output", () => copyLastOutput(), { category: T, keys: "Ctrl+Alt+C" });
    c("term.selectAll", "Select all", () => session() && session().term.selectAll(), { category: T, keys: "Ctrl+Shift+A" });

    c("palette", "Command palette", () => openPalette(), { category: A, keys: "Ctrl+Shift+P", global: true });
    c("theme.pick", "Change theme...", () => pickTheme(), { category: V, keys: "Ctrl+Shift+Y" });
    c("theme.next", "Next theme", () => store.update({ theme: cycle(themes.names(), store.get("theme"), 1) }), { category: V, keys: "Ctrl+Shift+J" });
    c("bg.pick", "Change background design...", () => pickBackground(), { category: V });
    c("bg.next", "Next background design", () => setBackground(cycle(Object.keys(BACKGROUNDS), store.get("background"), 1)), { category: V, keys: "Ctrl+Shift+G" });
    c("bg.prev", "Previous background design", () => setBackground(cycle(Object.keys(BACKGROUNDS), store.get("background"), -1)), { category: V, keys: "Ctrl+Alt+G" });
    c("accent.pick", "Change accent color...", () => pickAccent(), { category: V });
    c("accent.next", "Next accent color", () => nextAccent(1), { category: V, keys: "Ctrl+Shift+U" });
    c("accent.prev", "Previous accent color", () => nextAccent(-1), { category: V, keys: "Ctrl+Alt+U" });
    c("accent.reset", "Reset accent to theme color", () => setAccent("reset"), { category: V });
    c("settings", "Settings", () => openSettings(), { category: A, keys: "Ctrl+," });
    c("shortcuts", "Keyboard shortcuts", () => showShortcuts(), { category: A, keys: "Ctrl+Shift+K" });
    c("processes", "Process manager", () => openProcessManager(), { category: A, keys: "Ctrl+Shift+M" });
    c("kb.toggle", "Toggle on-screen keyboard", () => store.update({ showKeyboard: !store.get("showKeyboard") }), { category: V, keys: "Ctrl+Shift+B" });
    c("kb.layout", "Keyboard layout...", () => pickKeyboard(), { category: V });
    c("fs.toggle", "Toggle file browser", () => store.update({ showFilesystem: !store.get("showFilesystem") }), { category: V, keys: "Ctrl+Shift+E" });
    c("zen", "Focus mode (hide panels)", () => { $("app").classList.toggle("zen"); applyLayout(); }, { category: V, keys: "Ctrl+Shift+Enter" });
    c("fs.find", "Find file in current folder", () => files.find(), { category: F, keys: "Ctrl+Shift+O" });
    c("fs.dotfiles", "Toggle hidden files", () => store.update({ hideDotfiles: !store.get("hideDotfiles") }), { category: F, keys: "Ctrl+Shift+H" });
    c("fs.listview", "Toggle list / grid view", () => store.update({ fsListView: !store.get("fsListView") }), { category: F, keys: "Ctrl+Shift+L" });
    c("fs.refresh", "Refresh file browser", () => files.refresh(), { category: F });
    c("fs.drives", "Browse drives", () => files.show("::drives", { detached: true }), { category: F });
    c("fs.openFile", "Open file...", async () => {
        const p = await window.clu.dialog.openFile({ defaultPath: session() ? session().cwd : undefined });
        if (p) openFile(p);
    }, { category: F });
    c("fs.explorer", "Open current folder in Explorer", () => session() && window.clu.shell.openPath(session().cwd), { category: F });
    c("sound.toggle", "Toggle sound effects", () => store.update({ audio: !store.get("audio") }), { category: A });
    c("fullscreen", "Toggle fullscreen", () => window.clu.win.toggleFullscreen(), { category: V, keys: "F11", global: true });
    c("minimize", "Minimize window", () => window.clu.win.minimize(), { category: V });
    c("devtools", "Developer tools", () => window.clu.win.devtools(), { category: A, keys: "Ctrl+Shift+I", global: true });
    c("reload", "Reload UI", () => location.reload(), { category: A, keys: "Ctrl+Shift+R", global: true });
    c("restart", "Restart CLU", () => window.clu.app.relaunch(), { category: A });
    c("quit", "Quit CLU", () => window.clu.app.quit(), { category: A, keys: "Ctrl+Shift+Q", global: true });
}

function showShortcuts() {
    const rows = [...commands.list(), commands.get("tab.go1")].filter(c => c.keys).map(c =>
        h("tr", h("td", h("kbd", c.id === "tab.go1" ? "Alt+1…9" : c.keys)), h("td", c.id === "tab.go1" ? "Go to tab 1…9" : c.title), h("td.dim", c.category || "")));
    const extra = [
        ["Ctrl+C", "Copy when text is selected (otherwise sends ^C)"],
        ["Ctrl+V", "Paste"],
        ["Right click", "Copy selection / paste"],
        ["Ctrl+Click", "Open link"],
        ["Middle click (file)", "Insert path into the terminal"],
        ["Right click (file)", "Open with system default app"]
    ].map(([k, d]) => h("tr", h("td", h("kbd", k)), h("td", d), h("td.dim", "Mouse / misc")));
    const custom = Object.entries(store.get("shortcuts") || {}).map(([k, cmd]) =>
        h("tr", h("td", h("kbd", k)), h("td", h("code", `clu ${cmd}`)), h("td.dim", "Custom (clu bind)")));
    new Modal({
        title: "Keyboard shortcuts",
        className: "shortcuts-modal",
        body: h("div", h("table.shortcuts", ...custom, ...rows, ...extra),
            h("p.dim", "Add your own: ", h("code", "clu bind Ctrl+Alt+M theme matrix"), " · remove: ", h("code", "clu unbind Ctrl+Alt+M"), " · all commands: ", h("code", "clu help")))
    });
}

// ---------- keyboard shortcuts ----------

/** Runs the shortcut bound to `combo`, if any. Custom `clu bind` shortcuts win over built-ins. */
function dispatchCombo(combo, inField = false) {
    if (isLocked()) return false;
    const customCmd = !inField && (store.get("shortcuts") || {})[combo];
    if (customCmd) {
        handleClu(splitArgs(customCmd), session() ? session().cwd : store.info.homedir).catch(err => toast(err.message, "error"));
        return true;
    }
    const cmd = shortcutMap.get(combo);
    if (cmd && (!inField || cmd.global)) {
        cmd.run();
        return true;
    }
    return false;
}

const shortcutMap = new Map();

function installShortcuts() {
    for (const cmd of [...commands.list(), ...Array.from({ length: 9 }, (_, i) => commands.get(`tab.go${i + 1}`))]) {
        if (cmd.keys) shortcutMap.set(normalizeCombo(cmd.keys), cmd);
    }
    // Combos pressed inside a web tab arrive from the main process.
    window.clu.apps.onWebKey(k => dispatchCombo(eventCombo(k)));

    window.addEventListener("keydown", e => {
        if (isLocked()) return;
        const t = e.target;
        const inField = t instanceof HTMLElement && t.matches("input, textarea, select") && !t.classList.contains("xterm-helper-textarea");

        if (e.key === "Escape") {
            if (pickerOpen() || (inField && t.tagName === "TEXTAREA")) return;
            if (!tabs.searchBar.hidden && !inField) { tabs.closeSearch(); return; }
            if (Modal.closeTop()) { e.preventDefault(); e.stopPropagation(); }
            return;
        }

        const combo = eventCombo(e);
        if (dispatchCombo(combo, inField)) {
            e.preventDefault();
            e.stopPropagation();
            return;
        }
        if (inField) return;

        // Windows Terminal-style clipboard handling.
        if (!tabs.activeIsTerm) return;
        if (combo === "ctrl+c" && session() && session().term.hasSelection()) {
            e.preventDefault(); e.stopPropagation();
            session().copy();
        } else if (combo === "ctrl+v" && session()) {
            e.preventDefault(); e.stopPropagation();
            session().paste();
        } else if (e.key === "Alt" || (e.altKey && e.code === "Space")) {
            e.preventDefault(); // keep Chromium from activating the (hidden) menu
        }
    }, true);
}

// ---------- `clu` shell command ----------

async function handleClu(args, cwd, from) {
    const [cmd, ...rest] = args;
    const arg = rest.join(" ");
    const need = what => { toast(`clu ${cmd}: missing ${what}`, "warn"); };
    switch ((cmd || "").toLowerCase()) {
        case "bg": case "background":
            if (!arg) return pickBackground();
            if (arg === "next" || arg === "prev") return setBackground(cycle(Object.keys(BACKGROUNDS), store.get("background"), arg === "next" ? 1 : -1));
            if (arg === "list") return toast(`Backgrounds: ${Object.keys(BACKGROUNDS).join(", ")}`, "info", 7000);
            return setBackground(arg.toLowerCase());
        case "accent": case "color": case "colour":
            if (!arg) return pickAccent();
            if (arg === "next" || arg === "prev") return nextAccent(arg === "next" ? 1 : -1);
            if (arg === "list") return toast(`Colors: ${Object.keys(ACCENTS).join(", ")} · or #hex / r,g,b · reset`, "info", 8000);
            return setAccent(arg);
        case "bind":
            return bindShortcut(rest[0], rest.slice(1).join(" "));
        case "unbind":
            return unbindShortcut(rest[0]);
        case "binds": case "bindings":
            return showShortcuts();
        case "run":
            if (!arg) return need("command");
            return session() && session().run(arg);
        case "lock":
            return commands.run("lock");
        case "copy":
            return copyLastOutput();
        case "split":
            if (!tabs.activeIsTerm) return toast("Splits work in terminal tabs", "warn");
            return tabs.split(/^(down|col|v|vertical|alt)$/i.test(arg) ? "col" : "row");
        case "password": case "passwd":
            if (arg === "off" || arg === "disable") return openPasswordDialog("off");
            if (arg === "on" || arg === "enable") return openPasswordDialog("on");
            return openPasswordDialog("change");
        case "web": case "browse": case "www":
            return tabs.addWeb({ url: arg || undefined });
        case "app": case "launch":
            if (!arg) return pickApp("launch");
            {
                const found = await findApp(arg);
                return found ? launchPinned({ kind: "native", ...found }) : toast(`No installed app matches "${arg}"`, "warn");
            }
        case "apps":
            return pickApp("launch");
        case "pin":
            if (!arg) return pickApp("pin");
            if (/^(https?:\/\/|www\.)|\.[a-z]{2,}(\/|$)/i.test(rest[0])) return pinWeb(rest[0], rest.slice(1).join(" ") || undefined);
            {
                const found = await findApp(arg);
                return found ? pin({ kind: "native", name: found.name, id: found.id, link: found.link }) : toast(`No installed app matches "${arg}"`, "warn");
            }
        case "unpin":
            return arg ? unpinByName(arg) : openMenu(tabs.menuBtn);
        case "theme":
            if (arg === "next" || arg === "prev") return store.update({ theme: cycle(themes.names(), store.get("theme"), arg === "next" ? 1 : -1) });
            if (arg === "list") return toast(`Themes: ${themes.names().join(", ")}`, "info", 7000);
            if (!arg) return pickTheme();
            if (!themes.get(arg)) return toast(`Unknown theme "${arg}". Available: ${themes.names().join(", ")}`, "warn", 6000);
            return store.update({ theme: arg });
        case "open": case "view":
            return arg ? openFile(resolvePath(arg, cwd)) : need("file");
        case "edit":
            return arg ? editFile(resolvePath(arg, cwd)) : need("file");
        case "x": case "start": case "external":
            if (!arg) return need("file or url");
            if (/^(https?|mailto):/i.test(arg)) return window.clu.shell.openExternal(arg);
            return window.clu.shell.openPath(resolvePath(arg, cwd)).then(err => err && toast(err, "error"));
        case "fs": case "ls":
            if (!arg) { files.detached = false; return files.show(cwd); }
            return files.show(resolvePath(arg, cwd), { detached: true });
        case "tab":
            return tabs.add({ cwd, command: arg || undefined });
        case "kb": case "keyboard":
            if (!arg || arg === "toggle") return store.update({ showKeyboard: !store.get("showKeyboard") });
            if (arg === "on" || arg === "off") return store.update({ showKeyboard: arg === "on" });
            if (LAYOUTS[arg]) return store.update({ keyboard: arg, showKeyboard: true });
            return toast(`Unknown layout "${arg}". Available: ${Object.keys(LAYOUTS).join(", ")}`, "warn");
        case "top": case "ps": case "processes":
            return openProcessManager();
        case "notify":
            toast(arg || "ping", "info", 5000);
            return window.clu.win.notify("CLU", arg || "ping");
        case "font":
            return Number(arg) ? setFontSize(Number(arg)) : need("size");
        case "sound": case "audio":
            return store.update({ audio: arg ? arg === "on" : !store.get("audio") });
        case "settings": case "config":
            return openSettings();
        case "palette":
            return openPalette();
        case "keys": case "shortcuts":
            return showShortcuts();
        case "fullscreen":
            return window.clu.win.toggleFullscreen();
        case "zen": case "focus":
            return commands.run("zen");
        case "reload":
            return location.reload();
        case "quit": case "exit":
            return window.clu.app.quit();
        default:
            toast(`Unknown command "clu ${cmd}". Try: clu help`, "warn");
    }
}

// ---------- startup ----------

async function revealUI() {
    const app = $("app");
    app.hidden = false;
    applyLayout();
    audio.play("expand");
    app.classList.add("intro");
    await delay(30);
    app.classList.add("intro-1");

    // Terminal first: it is what the user is waiting for.
    tabs = new TabManager($("shell"));
    initLauncher(tabs);
    tabs.on("command-done", onCommandDone);
    tabs.on("cwd", cwd => files && files.follow(cwd));
    let refreshTimer = null;
    tabs.on("prompt", cwd => {
        if (!files || files.detached || files.dir !== cwd) return;
        clearTimeout(refreshTimer);
        refreshTimer = setTimeout(() => files.refresh(), 150);
    });
    const v = store.info;
    const banner = `\x1b[1mCLU v${v.version}\x1b[0m\x1b[2m · Electron ${v.electron} · ${v.shell.split(/[\\/]/).pop()} · type \x1b[0m\x1b[1mclu help\x1b[0m\x1b[2m to drive the UI from here\x1b[0m`;
    let restored = false;
    if (store.get("restoreSession")) {
        try {
            restored = await tabs.restore(await window.clu.session.load(), { banner });
        } catch (e) {
            console.error("[session] restore failed", e);
        }
    }
    if (!restored && !tabs.tabs.length) await tabs.add({ banner });
    setupSessionPersistence();

    files = new FileBrowser($("filesystem"), { getSession: session });
    if (session()) files.follow(session().cwd);
    keyboard = new Keyboard($("keyboard"), { layout: store.get("keyboard"), getSession: () => tabs.activeIsTerm ? session() : null });
    audio.play("keyboard");

    const left = $("col-left"), right = $("col-right");
    left.append(h("h3.title.col-title", h("p", "PANEL"), h("p", "SYSTEM")));
    right.append(h("h3.title.col-title", h("p", "PANEL"), h("p", "NETWORK")));
    const makers = [
        [() => new ClockPanel(left), () => new NetworkPanel(right)],
        [() => new SysinfoPanel(left), () => new GlobePanel(right)],
        [() => new HardwarePanel(left), () => new TrafficPanel(right)],
        [() => new CpuPanel(left), () => new StoragePanel(right)],
        [() => new RamPanel(left)],
        [() => new TopPanel(left, { onOpen: openProcessManager })]
    ];
    for (const row of makers) {
        row.forEach(make => make());
        audio.play("panels");
        await delay(store.get("nointro") ? 0 : 140);
    }
    app.classList.add("intro-2");
    document.body.classList.add("ready");
    await delay(600);
    app.classList.remove("intro", "intro-1", "intro-2");
    tabs.tabs.forEach(t => t.session.scheduleFit());
    session() && session().focus();
}

async function main() {
    await store.init();
    themes.setUserThemes(await window.clu.themes.user().catch(() => []));
    themes.accent = store.get("accent") ? parseColor(store.get("accent")) : null;
    themes.apply(store.get("theme"));
    background.apply(store.get("background"));
    audio.configure(store.settings);
    document.body.classList.remove("booting");

    store.on("change:theme", name => themes.apply(name));
    store.on("change:accent", v => themes.setAccent(v ? parseColor(v) : null));
    store.on("change:background", name => background.apply(name));
    store.on("change:keyboard", name => keyboard && keyboard.setLayout(name));
    store.on("change", keys => {
        if (keys.some(k => k.startsWith("audio") || k === "feedbackAudio")) audio.configure(store.settings);
        if (keys.includes("showKeyboard") || keys.includes("showFilesystem")) applyLayout();
    });
    bus.on("clu", (args, cwd, s) => handleClu(args, cwd, s).catch(e => toast(e.message, "error")));
    bus.on("modals-empty", () => session() && session().focus());
    window.addEventListener("resize", () => tabs && tabs.session && tabs.session.scheduleFit());

    registerCommands();

    const boot = $("boot");
    if (store.get("nointro") || store.info.flags.nointro) boot.remove();
    else await runBoot(boot);

    // Fonts must be ready before xterm measures cell sizes.
    await Promise.all([
        document.fonts.load(`15px "${store.get("termFontFamily")}"`),
        document.fonts.load('15px "Fira Code"'),
        document.fonts.load('600 15px "Rajdhani"')
    ]).catch(() => {});

    // Authorization gate: nothing (shell, files) starts until the main process says unlocked.
    const lockState = await window.clu.lock.status();
    if (lockState.locked) await showLock();

    installShortcuts();
    await revealUI();
    // Handle for devtools / automated smoke tests.
    window.__clu = { tabs, files, keyboard, commands, store, themes, audio };
}

main().catch(e => {
    console.error(e);
    document.body.append(h("pre.fatal", `CLU failed to start:\n${e.stack || e}`));
});
