export const delay = ms => new Promise(r => setTimeout(r, ms));

const ESC = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
export const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ESC[c]);

/** Tiny element factory: h("div.a.b#id", {attrs}, ...children) */
export function h(tag, attrs, ...children) {
    const m = /^([a-z0-9-]+)?((?:[.#][\w-]+)*)$/i.exec(tag);
    const el = document.createElement((m && m[1]) || "div");
    if (m && m[2]) {
        for (const part of m[2].match(/[.#][\w-]+/g)) {
            if (part[0] === ".") el.classList.add(part.slice(1));
            else el.id = part.slice(1);
        }
    }
    if (attrs !== undefined && attrs !== null && (typeof attrs !== "object" || attrs instanceof Node || Array.isArray(attrs))) {
        children.unshift(attrs);
        attrs = null;
    }
    for (const [k, v] of Object.entries(attrs || {})) {
        if (v === undefined || v === null || v === false) continue;
        if (k.startsWith("on") && typeof v === "function") el.addEventListener(k.slice(2), v);
        else if (k === "style" && typeof v === "object") Object.assign(el.style, v);
        else if (k === "html") el.innerHTML = v;
        else if (k === "text") el.textContent = v;
        else el.setAttribute(k, v === true ? "" : v);
    }
    for (const c of children.flat()) {
        if (c === null || c === undefined || c === false) continue;
        el.append(c instanceof Node ? c : document.createTextNode(String(c)));
    }
    return el;
}

export function formatBytes(n, digits = 1) {
    if (!Number.isFinite(n)) return "--";
    const units = ["B", "KB", "MB", "GB", "TB", "PB"];
    let i = 0;
    while (Math.abs(n) >= 1024 && i < units.length - 1) {
        n /= 1024;
        i++;
    }
    return `${n.toFixed(i === 0 ? 0 : digits)} ${units[i]}`;
}

export function formatDuration(sec) {
    sec = Math.floor(sec);
    const d = Math.floor(sec / 86400);
    const hh = String(Math.floor(sec % 86400 / 3600)).padStart(2, "0");
    const mm = String(Math.floor(sec % 3600 / 60)).padStart(2, "0");
    return d > 0 ? `${d}d ${hh}:${mm}` : `${hh}:${mm}:${String(sec % 60).padStart(2, "0")}`;
}

export class Emitter {
    constructor() { this._l = new Map(); }
    on(ev, fn) {
        if (!this._l.has(ev)) this._l.set(ev, new Set());
        this._l.get(ev).add(fn);
        return () => this._l.get(ev).delete(fn);
    }
    emit(ev, ...args) {
        for (const fn of this._l.get(ev) || []) {
            try { fn(...args); } catch (e) { console.error(e); }
        }
    }
}

/**
 * Runs `fn` every `ms` while the window is visible, never overlapping itself
 * (slow sysinfo calls simply stretch the interval instead of piling up).
 */
export function poll(fn, ms, { immediate = true } = {}) {
    let stopped = false, timer = null;
    const tick = async () => {
        timer = null;
        if (stopped) return;
        if (!document.hidden) {
            try { await fn(); } catch (e) { console.warn("[poll]", e.message || e); }
        }
        if (!stopped) timer = setTimeout(tick, ms);
    };
    if (immediate) tick(); else timer = setTimeout(tick, ms);
    return () => { stopped = true; if (timer) clearTimeout(timer); };
}

export function fileUrl(p) {
    return "clu-file://local/" + encodeURIComponent(p);
}

export function basename(p) {
    const parts = String(p).split(/[\\/]+/).filter(Boolean);
    return parts.length ? parts[parts.length - 1] : p;
}

export function dirname(p) {
    const s = String(p).replace(/[\\/]+$/, "");
    const i = Math.max(s.lastIndexOf("/"), s.lastIndexOf("\\"));
    if (i < 0) return s;
    const d = s.slice(0, i);
    return /^[a-z]:$/i.test(d) ? d + "\\" : (d || "/");
}

export function joinPath(base, name) {
    const sep = base.includes("\\") || /^[a-z]:/i.test(base) ? "\\" : "/";
    return base.replace(/[\\/]+$/, "") + sep + name;
}

export function isAbsolute(p) {
    return /^([a-z]:[\\/]|\\\\|\/)/i.test(p);
}

/** Simple subsequence fuzzy matcher; returns score or -1. */
export function fuzzyScore(query, text) {
    if (!query) return 0;
    query = query.toLowerCase();
    const t = text.toLowerCase();
    const direct = t.indexOf(query);
    if (direct >= 0) return 1000 - direct * 2 - (t.length - query.length) * 0.1;
    let score = 0, ti = 0, streak = 0;
    for (const ch of query) {
        const found = t.indexOf(ch, ti);
        if (found < 0) return -1;
        streak = found === ti ? streak + 1 : 0;
        score += 10 + streak * 5 - (found - ti);
        ti = found + 1;
    }
    return score;
}
