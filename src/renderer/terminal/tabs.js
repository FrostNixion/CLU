import { TerminalSession } from "./session.js";
import { WebSession } from "./websession.js";
import { store, bus } from "../core/store.js";
import { themes } from "../core/theme.js";
import { audio } from "../core/audio.js";
import { h, basename, Emitter } from "../lib/util.js";

const MAX_TABS = 12;

export class TabManager extends Emitter {
    constructor(root) {
        super();
        this.root = root;
        this.tabs = [];
        this.active = null;
        this._seq = 0;

        this.tabBar = h("ul.tabs");
        this.addBtn = h("button.tab-add", { title: "New terminal (Ctrl+Shift+T)", onclick: () => this.add() }, "+");
        this.menuBtn = h("button.tab-add.tab-menu", { title: "New web tab, launch or pin apps", onclick: e => this.emit("menu", e.currentTarget) }, "▾");
        // Pinned apps are rendered into this strip by ui/launcher.js.
        this.launcher = h("div.launcher");
        this.inner = h("div.shell-inner");
        this.searchBar = this._buildSearch();
        root.append(
            h("h3.title", h("p", "TERMINAL"), h("p.shell-sub", "MAIN SHELL")),
            h("div.tabbar", this.tabBar, this.addBtn, this.menuBtn, this.launcher),
            this.inner,
            this.searchBar
        );
        this.lastTerm = null;

        window.clu.pty.onData((id, data) => {
            const tab = this.tabs.find(t => t.session.ptyId === id);
            if (tab) tab.session.receive(data);
        });
        window.clu.pty.onExit((id, code) => {
            const tab = this.tabs.find(t => t.session.ptyId === id);
            if (tab) tab.session.handleExit(code);
        });

        themes.on("change", () => this.tabs.forEach(t => t.session.applyTheme()));
        store.on("change", keys => {
            if (keys.some(k => k.startsWith("term") || k.startsWith("cursor") || k === "scrollback")) {
                this.tabs.forEach(t => t.session.applySettings());
            }
        });
    }

    _makeTab(kind, createSession) {
        if (this.tabs.length >= MAX_TABS) {
            bus.emit("toast", { type: "warn", text: `Tab limit reached (${MAX_TABS})` });
            return null;
        }
        const n = ++this._seq;
        const pane = h("div.term-pane");
        this.inner.append(pane);
        const icon = h("img.tab-icon", { alt: "", hidden: true });
        const label = h("span.tab-label", "LOADING...");
        const close = h("span.tab-close", { title: "Close tab" }, "×");
        const li = h(`li.tab-${kind}`, icon, label, close);
        this.tabBar.append(li);
        const tab = { n, kind, li, icon, label, pane, session: null, name: null };
        tab.session = createSession(pane);
        this.tabs.push(tab);

        li.addEventListener("mousedown", e => {
            if (e.button === 1) { e.preventDefault(); this.close(tab); }
        });
        li.addEventListener("click", e => {
            if (e.target === close) this.close(tab);
            else this.activate(tab);
        });
        li.addEventListener("dblclick", () => this.rename(tab));
        return tab;
    }

    /** Open a browser tab inside CLU. */
    addWeb({ url, focus = true } = {}) {
        const tab = this._makeTab("web", pane => new WebSession(pane, { url }));
        if (!tab) return null;
        const s = tab.session;
        s.on("title", () => this._updateLabel(tab));
        s.on("url", () => this._updateLabel(tab));
        s.on("favicon", src => { tab.icon.src = src; tab.icon.hidden = false; });
        tab.icon.addEventListener("error", () => { tab.icon.hidden = true; });
        if (focus || !this.active) this.activate(tab);
        this._updateLabel(tab);
        return tab;
    }

    async add({ cwd, command, banner, focus = true } = {}) {
        // Inherit the current terminal's directory, like most terminals do.
        const startCwd = cwd || (this.session && this.session.cwd) || store.settings.cwd;
        const tab = this._makeTab("term", pane => new TerminalSession(pane, { cwd: startCwd, command }));
        if (!tab) return null;
        const { li, session } = tab;

        session.on("cwd", cwd => {
            this._updateLabel(tab);
            if (tab === this.active) this.emit("cwd", cwd, tab);
        });
        session.on("prompt", cwd => {
            if (tab === this.active) this.emit("prompt", cwd, tab);
        });
        session.on("title", () => this._updateLabel(tab));
        session.on("data-activity", () => {
            if (tab === this.active) audio.play("stdout", { throttle: 60 });
            else li.classList.add("activity");
        });
        session.on("clu", (args, cwd, s) => bus.emit("clu", args, cwd, s));
        session.on("exit", () => {
            li.classList.add("exited");
            setTimeout(() => this.close(tab), 600);
        });

        if (focus || !this.active) this.activate(tab);
        // The banner is printed by the shell itself (see shell integration): writing it into
        // xterm locally would desync ConPTY's screen model and misplace the prompt.
        session.banner = banner;
        try {
            await session.start();
        } catch (e) {
            session.term.write(`\x1b[31mFailed to start shell: ${e.message}\x1b[0m\r\n`);
        }
        this._updateLabel(tab);
        return tab;
    }

    _updateLabel(tab) {
        const s = tab.session;
        if (tab.kind === "web") {
            let host = "";
            try { host = new URL(s.url).hostname.replace(/^www\./, ""); } catch (e) { /* about:blank */ }
            tab.label.textContent = tab.name || s.title || host || "web";
            tab.li.title = s.url;
            if (tab === this.active) this.root.querySelector(".shell-sub").textContent = `WEB · ${host.toUpperCase()}`;
            return;
        }
        let text = tab.name;
        if (!text) {
            const where = s.cwd ? basename(s.cwd) : "";
            const shellName = s.shell ? basename(s.shell).replace(/\.exe$/i, "") : "shell";
            // Window titles set by programs win (vim, ssh, htop...) unless they are just the shell's own path.
            const t = s.title && !/\\|\/|^(Windows )?PowerShell|^pwsh|^Administrator:/i.test(s.title) ? s.title : "";
            text = `#${tab.n} ${t || shellName}${where ? " · " + where : ""}`;
        }
        tab.label.textContent = text;
        tab.li.title = s.cwd || "";
        if (tab === this.active) this.root.querySelector(".shell-sub").textContent = (s.cwd || "MAIN SHELL").toUpperCase();
    }

    activate(tab) {
        if (!tab) return;
        if (this.active !== tab) audio.play("folder");
        this.active = tab;
        for (const t of this.tabs) {
            const on = t === tab;
            t.li.classList.toggle("active", on);
            t.pane.classList.toggle("active", on);
        }
        tab.li.classList.remove("activity");
        tab.li.scrollIntoView({ block: "nearest", inline: "nearest" });
        if (tab.kind === "term") this.lastTerm = tab;
        this.searchBar.hidden = true;
        tab.session.fitNow();
        tab.session.focus();
        this._updateLabel(tab);
        if (tab.kind === "term") this.emit("cwd", tab.session.cwd, tab);
        this.emit("activate", tab);
    }

    close(tab = this.active) {
        const i = this.tabs.indexOf(tab);
        if (i < 0) return;
        tab.session.dispose();
        tab.li.remove();
        tab.pane.remove();
        this.tabs.splice(i, 1);
        if (this.lastTerm === tab) this.lastTerm = [...this.tabs].reverse().find(t => t.kind === "term") || null;
        if (!this.tabs.some(t => t.kind === "term")) {
            // Never leave the user without a shell.
            this.add({ focus: !this.tabs.length || this.active === tab });
            if (this.active !== tab) return;
        }
        if (this.active === tab) this.activate(this.tabs[Math.min(i, this.tabs.length - 1)]);
    }

    next() {
        const i = this.tabs.indexOf(this.active);
        this.activate(this.tabs[(i + 1) % this.tabs.length]);
    }

    prev() {
        const i = this.tabs.indexOf(this.active);
        this.activate(this.tabs[(i - 1 + this.tabs.length) % this.tabs.length]);
    }

    go(index) {
        if (this.tabs[index]) this.activate(this.tabs[index]);
        else if (index === this.tabs.length) this.add();
    }

    rename(tab = this.active) {
        const input = h("input.tab-rename", { value: tab.name || "", placeholder: "tab name" });
        tab.label.replaceChildren(input);
        input.focus();
        const done = commit => {
            if (commit) tab.name = input.value.trim() || null;
            this._updateLabel(tab);
            tab.session.focus();
        };
        input.addEventListener("keydown", e => {
            e.stopPropagation();
            if (e.key === "Enter") done(true);
            if (e.key === "Escape") done(false);
        });
        input.addEventListener("blur", () => done(true), { once: true });
    }

    /** The terminal session commands should target: the active tab, or the last terminal used. */
    get session() {
        if (this.active && this.active.kind === "term") return this.active.session;
        return this.lastTerm && this.lastTerm.session;
    }

    get activeIsTerm() {
        return !!this.active && this.active.kind === "term";
    }

    // ---------- in-terminal search (Ctrl+Shift+F) ----------

    _buildSearch() {
        const input = h("input", { placeholder: "search terminal...", spellcheck: "false" });
        const count = h("span.search-count");
        const bar = h("div.term-search", { hidden: true },
            h("span.search-label", "FIND"), input, count,
            h("button", { title: "Previous (Shift+Enter)", onclick: () => this._find(input.value, true) }, "▲"),
            h("button", { title: "Next (Enter)", onclick: () => this._find(input.value) }, "▼"),
            h("button", { title: "Close (Esc)", onclick: () => this.closeSearch() }, "×")
        );
        input.addEventListener("input", () => this._find(input.value, false, true));
        input.addEventListener("keydown", e => {
            e.stopPropagation();
            if (e.key === "Enter") this._find(input.value, e.shiftKey);
            if (e.key === "Escape") this.closeSearch();
        });
        this._searchInput = input;
        this._searchCount = count;
        return bar;
    }

    _find(q, back = false, incremental = false) {
        const s = this.session;
        if (!s) return;
        const accent = `rgba(${themes.current.rgb.join(",")},`;
        const opts = {
            incremental,
            decorations: {
                matchBackground: "#00000000", matchBorder: accent + "0.6)", matchOverviewRuler: accent + "0.6)",
                activeMatchBackground: accent + "0.45)", activeMatchColorOverviewRuler: accent + "1)"
            }
        };
        if (!this._searchHooked) {
            this._searchHooked = new WeakSet();
        }
        if (!this._searchHooked.has(s.search)) {
            this._searchHooked.add(s.search);
            s.search.onDidChangeResults(r => {
                this._searchCount.textContent = r.resultCount ? `${r.resultIndex + 1}/${r.resultCount}` : (this._searchInput.value ? "0/0" : "");
            });
        }
        if (back) s.search.findPrevious(q, opts);
        else s.search.findNext(q, opts);
    }

    openSearch() {
        if (!this.activeIsTerm) {
            // In a web tab, Ctrl+Shift+F jumps to the address bar instead.
            if (this.active) this.active.session.address.focus();
            return;
        }
        this.searchBar.hidden = false;
        const sel = this.session && this.session.term.getSelection();
        if (sel && !sel.includes("\n")) this._searchInput.value = sel;
        this._searchInput.select();
        this._searchInput.focus();
    }

    closeSearch() {
        this.searchBar.hidden = true;
        if (this.session) {
            this.session.search.clearDecorations();
            this.session.focus();
        }
    }
}
