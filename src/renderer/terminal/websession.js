import { h, Emitter } from "../lib/util.js";
import { store } from "../core/store.js";

/** Turn what the user typed into a URL: full URLs, bare domains, or a search. */
export function normalizeUrl(input) {
    const s = String(input || "").trim();
    if (!s) return store.get("webHome") || "https://duckduckgo.com";
    if (/^https?:\/\//i.test(s)) return s;
    if (/^[\w-]+(\.[\w-]+)+(:\d+)?(\/.*)?$/.test(s) || /^localhost(:\d+)?(\/.*)?$/.test(s)) {
        return (s.startsWith("localhost") ? "http://" : "https://") + s;
    }
    return "https://duckduckgo.com/?q=" + encodeURIComponent(s);
}

/**
 * A browser tab inside CLU (Electron <webview>, locked down by the main process).
 * Exposes the same small surface the tab manager uses for terminal sessions.
 * Events: title, favicon, url
 */
export class WebSession extends Emitter {
    constructor(container, { url } = {}) {
        super();
        this.kind = "web";
        this.cwd = "";
        this.title = "";
        this.url = normalizeUrl(url);

        const btn = (label, title, fn) => h("button.web-btn", { title, onclick: fn }, label);
        this.address = h("input.web-address", { spellcheck: "false", value: this.url });
        this.back = btn("◀", "Back (Alt+Left)", () => this.view.canGoBack() && this.view.goBack());
        this.fwd = btn("▶", "Forward (Alt+Right)", () => this.view.canGoForward() && this.view.goForward());
        this.reloadBtn = btn("⟳", "Reload", () => this.view.reload());
        this.progress = h("div.web-progress");
        const toolbar = h("div.web-toolbar", this.back, this.fwd, this.reloadBtn, this.address,
            btn("⧉", "Open in your default browser", () => window.clu.shell.openExternal(this.url)), this.progress);

        this.view = document.createElement("webview");
        this.view.setAttribute("src", this.url);
        this.view.setAttribute("allowpopups", "");
        this.view.className = "web-view";
        container.classList.add("web-pane");
        container.append(toolbar, this.view);

        this.address.addEventListener("keydown", e => {
            e.stopPropagation();
            if (e.key === "Enter") this.navigate(this.address.value);
            if (e.key === "Escape") { this.address.value = this.url; this.view.focus(); }
        });
        this.address.addEventListener("focus", () => this.address.select());

        const v = this.view;
        v.addEventListener("page-title-updated", e => { this.title = e.title; this.emit("title", e.title); });
        v.addEventListener("page-favicon-updated", e => { if (e.favicons && e.favicons[0]) this.emit("favicon", e.favicons[0]); });
        const onNav = e => {
            this.url = e.url;
            if (document.activeElement !== this.address) this.address.value = e.url;
            this._syncButtons();
            this.emit("url", e.url);
        };
        v.addEventListener("did-navigate", onNav);
        v.addEventListener("did-navigate-in-page", e => { if (e.isMainFrame) onNav(e); });
        v.addEventListener("did-start-loading", () => this.progress.classList.add("loading"));
        v.addEventListener("did-stop-loading", () => { this.progress.classList.remove("loading"); this._syncButtons(); });
        v.addEventListener("did-fail-load", e => {
            if (e.errorCode === -3 || !e.isMainFrame) return; // -3 = aborted (normal on redirects)
            this.title = "Failed to load";
            this.emit("title", `⚠ ${e.errorDescription}`);
        });
    }

    _syncButtons() {
        try {
            this.back.disabled = !this.view.canGoBack();
            this.fwd.disabled = !this.view.canGoForward();
        } catch (e) { /* not attached yet */ }
    }

    navigate(input) {
        this.url = normalizeUrl(input);
        this.address.value = this.url;
        this.view.loadURL(this.url).catch(() => {});
        this.view.focus();
    }

    focus() { this.view.focus(); }
    fitNow() {}
    scheduleFit() {}
    applyTheme() {}
    applySettings() {}
    dispose() { this.view.remove(); }
}
