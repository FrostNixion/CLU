import { h, fuzzyScore } from "../lib/util.js";
import { store, bus } from "../core/store.js";
import { audio } from "../core/audio.js";
import { openPicker } from "./palette.js";
import { confirmModal, toast } from "./modal.js";
import { normalizeUrl } from "../terminal/websession.js";

// Pinned apps live in settings.pinnedApps:
//   { kind: "native", name, id, link }  -> launched through Windows (opens its own window)
//   { kind: "web", name, url, icon? }   -> opened as a CLU web tab

let tabs = null;
let appsCache = null;

export function initLauncher(tabManager) {
    tabs = tabManager;
    tabs.on("menu", anchor => openMenu(anchor));
    store.on("change:pinnedApps", render);
    window.clu.apps.onWebOpen(url => tabs.addWeb({ url }));
    render();
}

async function installedApps() {
    if (appsCache) return appsCache;
    const slow = setTimeout(() => toast("Scanning installed apps...", "info", 1500), 400);
    appsCache = await window.clu.apps.list();
    clearTimeout(slow);
    return appsCache;
}

export async function findApp(query) {
    const list = await installedApps();
    let best = null, score = -1;
    for (const a of list) {
        const s = fuzzyScore(query, a.name);
        if (s > score) { best = a; score = s; }
    }
    return score >= 0 ? best : null;
}

function render() {
    const pins = store.get("pinnedApps") || [];
    tabs.launcher.replaceChildren(...pins.map((p, i) => {
        const img = h("img", { alt: "", hidden: true });
        const badge = h("span.launch-badge", (p.name || "?").replace(/[^\p{L}\p{N}]/gu, "").slice(0, 2).toUpperCase());
        const btn = h(`button.launch-btn.launch-${p.kind}`, { title: `${p.name}${p.kind === "web" ? "  (web tab)" : ""}\nRight click to unpin` }, img, badge);
        const showIcon = src => { if (src) { img.src = src; img.hidden = false; badge.hidden = true; } };
        if (p.kind === "native") window.clu.apps.icon({ link: p.link, id: p.id }).then(showIcon);
        if (p.kind === "web" && p.icon) showIcon(p.icon);
        img.addEventListener("error", () => { img.hidden = true; badge.hidden = false; });
        btn.addEventListener("click", () => launchPinned(p));
        btn.addEventListener("contextmenu", async e => {
            e.preventDefault();
            if (await confirmModal("Unpin", `Remove ${p.name} from the tab bar?`, { okLabel: "Unpin" })) unpinAt(i);
        });
        return btn;
    }));
}

export async function launchPinned(p) {
    if (p.kind === "web") return tabs.addWeb({ url: p.url });
    try {
        const err = await window.clu.apps.launch({ id: p.id, link: p.link });
        if (err) throw new Error(err);
        audio.play("granted");
        toast(`Launching ${p.name}`, "info", 1800);
    } catch (e) {
        toast(`Could not start ${p.name}: ${e.message.replace(/^.*Error: /, "")}`, "error");
    }
}

// Pin edits are read-modify-write on settings; serialize them so `clu pin a; clu pin b` keeps both.
let pinQueue = Promise.resolve();
const serialized = fn => (pinQueue = pinQueue.then(fn, fn));

export function pin(item) {
    return serialized(async () => {
        const pins = (store.get("pinnedApps") || []).slice();
        const key = x => x.kind === "web" ? x.url : x.id;
        if (pins.some(x => key(x) === key(item))) return toast(`${item.name} is already pinned`, "warn");
        pins.push(item);
        await store.update({ pinnedApps: pins });
        audio.play("granted");
        toast(`Pinned ${item.name}`, "info", 1800);
    });
}

export function unpinAt(i) {
    return serialized(async () => {
        const pins = (store.get("pinnedApps") || []).slice();
        const [removed] = pins.splice(i, 1);
        await store.update({ pinnedApps: pins });
        if (removed) toast(`Unpinned ${removed.name}`, "info", 1500);
    });
}

export async function unpinByName(name) {
    const pins = store.get("pinnedApps") || [];
    const i = pins.findIndex(p => p.name.toLowerCase() === name.toLowerCase() || fuzzyScore(name, p.name) > 500);
    if (i < 0) return toast(`Nothing pinned matches "${name}"`, "warn");
    return unpinAt(i);
}

export async function pinWeb(url, name, icon) {
    const full = normalizeUrl(url);
    let host = full;
    try { host = new URL(full).hostname.replace(/^www\./, ""); } catch (e) { /* keep */ }
    if (!icon || !icon.startsWith("data:")) icon = await window.clu.apps.favicon(full).catch(() => null) || icon;
    return pin({ kind: "web", name: name || host, url: full, icon: icon || null });
}

/** Picker over installed apps; mode "launch" starts it, "pin" adds it to the tab bar. */
export async function pickApp(mode = "launch") {
    const list = await installedApps();
    if (!list.length) return toast("No installed apps found (Windows only)", "warn");
    openPicker({
        placeholder: mode === "pin" ? "Pin an app to the tab bar..." : "Launch an app...",
        items: list.map(a => ({
            label: a.name,
            detail: a.link ? "desktop app" : "Store app",
            run: () => mode === "pin" ? pin({ kind: "native", name: a.name, id: a.id, link: a.link }) : launchPinned({ kind: "native", ...a })
        }))
    });
}

function pickUnpin() {
    const pins = store.get("pinnedApps") || [];
    if (!pins.length) return toast("Nothing is pinned yet", "info");
    openPicker({
        placeholder: "Unpin...",
        items: pins.map((p, i) => ({ label: p.name, detail: p.kind === "web" ? p.url : "desktop app", run: () => unpinAt(i) }))
    });
}

function currentWebTab() {
    return tabs.active && tabs.active.kind === "web" ? tabs.active : null;
}

let menuEl = null;
function closeMenu() {
    if (menuEl) menuEl.remove();
    menuEl = null;
}

export function openMenu(anchor) {
    if (menuEl) return closeMenu();
    const web = currentWebTab();
    const items = [
        ["New terminal", "Ctrl+Shift+T", () => tabs.add()],
        ["New web tab", "Ctrl+Shift+N", () => tabs.addWeb({}).session.address.focus()],
        ["Launch app...", "Ctrl+Shift+D", () => pickApp("launch")],
        ["Pin app to tab bar...", "", () => pickApp("pin")],
        web ? ["Pin this web page", "", () => pinWeb(web.session.url, web.session.title, web.icon.hidden ? null : web.icon.src)] : null,
        ["Unpin...", "", () => pickUnpin()]
    ].filter(Boolean);
    menuEl = h("div.dropdown", ...items.map(([label, keys, fn]) => h("button", {
        onclick: () => { closeMenu(); fn(); }
    }, h("span", label), keys ? h("kbd", keys) : null)));
    const r = anchor.getBoundingClientRect();
    menuEl.style.top = `${r.bottom + 4}px`;
    document.getElementById("layer-modals").append(menuEl);
    // Open to the left if it would spill past the terminal frame.
    const w = menuEl.offsetWidth;
    menuEl.style.left = `${Math.max(8, Math.min(r.left, r.right - w, innerWidth - w - 8))}px`;
    audio.play("panels");
    setTimeout(() => addEventListener("mousedown", function off(e) {
        if (menuEl && !menuEl.contains(e.target)) { closeMenu(); removeEventListener("mousedown", off); }
        else if (!menuEl) removeEventListener("mousedown", off);
    }), 0);
}

bus.on("modal-open", closeMenu);
