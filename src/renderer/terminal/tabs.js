import { TerminalSession } from "./session.js";
import { WebSession } from "./websession.js";
import { store, bus } from "../core/store.js";
import { themes } from "../core/theme.js";
import { audio } from "../core/audio.js";
import { h, basename, Emitter } from "../lib/util.js";

const MAX_TABS = 12;
const MAX_PANES = 6;
const SNAPSHOT_LINES = 1000;

/*
 * Tabs hold either a web page or a tree of terminal panes:
 *   leaf  = { type: "leaf", el, session }
 *   split = { type: "split", dir: "row" | "col", ratio, el, children: [node, node] }
 * `tab.session` is always the focused pane's session.
 * Emits: cwd, prompt, activate, command-done, menu, changed (anything worth persisting).
 */
export class TabManager extends Emitter {
    constructor(root) {
        super();
        this.root = root;
        this.tabs = [];
        this.active = null;
        this.lastTerm = null;
        this._seq = 0;
        this._byPty = new Map();

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

        window.clu.pty.onData((id, data) => {
            const s = this._byPty.get(id);
            if (s) s.receive(data);
        });
        window.clu.pty.onExit((id, code) => {
            const s = this._byPty.get(id);
            if (s) s.handleExit(code);
        });

        themes.on("change", () => this.allSessions().forEach(s => s.applyTheme()));
        store.on("change", keys => {
            if (keys.some(k => k.startsWith("term") || k.startsWith("cursor") || k === "scrollback")) {
                this.allSessions().forEach(s => s.applySettings());
            }
        });
    }

    // ---------- tree helpers ----------

    _leaves(node) {
        if (!node) return [];
        return node.type === "leaf" ? [node] : node.children.flatMap(c => this._leaves(c));
    }

    _parentOf(node, cur) {
        if (!cur || cur.type === "leaf") return null;
        for (const c of cur.children) {
            if (c === node) return cur;
            const p = this._parentOf(node, c);
            if (p) return p;
        }
        return null;
    }

    allSessions() {
        return this.tabs.flatMap(t => t.kind === "web" ? [t.session] : this._leaves(t.root).map(l => l.session));
    }

    // ---------- tabs ----------

    _makeTab(kind) {
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
        const tab = { n, kind, li, icon, label, pane, session: null, root: null, name: null };
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
    addWeb({ url, name, focus = true } = {}) {
        const tab = this._makeTab("web");
        if (!tab) return null;
        tab.session = new WebSession(tab.pane, { url });
        tab.name = name || null;
        const s = tab.session;
        s.on("title", () => this._updateLabel(tab));
        s.on("url", () => { this._updateLabel(tab); this.emit("changed"); });
        s.on("favicon", src => { tab.icon.src = src; tab.icon.hidden = false; });
        tab.icon.addEventListener("error", () => { tab.icon.hidden = true; });
        if (focus || !this.active) this.activate(tab);
        this._updateLabel(tab);
        this.emit("changed");
        return tab;
    }

    /**
     * Open a terminal tab. `layout` (from a saved session) recreates a split tree:
     *   { cwd, output?, focused? } or { dir, ratio, children: [layout, layout] }
     */
    async add({ cwd, command, banner, focus = true, name, layout } = {}) {
        const tab = this._makeTab("term");
        if (!tab) return null;
        tab.name = name || null;
        // Inherit the current terminal's directory, like most terminals do.
        const startCwd = cwd || (this.session && this.session.cwd) || store.settings.cwd;
        const starts = [];
        let focusLeaf = null;
        const build = (spec, first) => {
            if (spec && spec.children && spec.children.length === 2) {
                const a = build(spec.children[0], first);
                const b = build(spec.children[1], false);
                return this._makeSplit(spec.dir === "col" ? "col" : "row", a, b, spec.ratio);
            }
            const leaf = this._makeLeaf(tab, {
                cwd: (spec && spec.cwd) || startCwd,
                command: first ? command : undefined,
                restore: spec && spec.output,
                banner: first ? banner : undefined
            });
            if ((spec && spec.focused) || !focusLeaf) focusLeaf = leaf;
            starts.push(leaf);
            return leaf;
        };
        tab.root = build(layout || null, true);
        tab.pane.append(tab.root.el);
        this._focusLeaf(tab, focusLeaf, { silent: true });

        if (focus || !this.active) this.activate(tab);
        await Promise.all(starts.map(l => this._start(tab, l)));
        this._updateLabel(tab);
        this.emit("changed");
        return tab;
    }

    _makeLeaf(tab, { cwd, command, restore, banner }) {
        const el = h("div.split-leaf");
        const session = new TerminalSession(el, { cwd, command, restore });
        // The banner is printed by the shell itself (see shell integration): writing it into
        // xterm locally would desync ConPTY's screen model and misplace the prompt.
        session.banner = banner;
        const leaf = { type: "leaf", el, session };
        el.addEventListener("mousedown", () => { if (tab.session !== session) this._focusLeaf(tab, leaf); }, true);

        session.on("cwd", c => {
            if (session !== tab.session) return;
            this._updateLabel(tab);
            if (tab === this.active) this.emit("cwd", c, tab);
            this.emit("changed");
        });
        session.on("prompt", c => {
            if (tab === this.active && session === tab.session) this.emit("prompt", c, tab);
        });
        session.on("title", () => { if (session === tab.session) this._updateLabel(tab); });
        session.on("data-activity", () => {
            if (tab === this.active) audio.play("stdout", { throttle: 60 });
            else tab.li.classList.add("activity");
        });
        session.on("clu", (args, c, s) => bus.emit("clu", args, c, s));
        session.on("command-done", block => this.emit("command-done", block, tab));
        session.on("exit", () => {
            el.classList.add("exited");
            setTimeout(() => this.closePane(tab, leaf), 600);
        });
        return leaf;
    }

    async _start(tab, leaf) {
        try {
            const res = await leaf.session.start();
            this._byPty.set(res.id, leaf.session);
        } catch (e) {
            leaf.session.term.write(`\x1b[31mFailed to start shell: ${e.message}\x1b[0m\r\n`);
        }
        if (leaf.session === tab.session) this._updateLabel(tab);
    }

    _makeSplit(dir, a, b, ratio = 0.5) {
        const divider = h(`div.split-divider.${dir}`);
        const el = h(`div.split.split-${dir}`, a.el, divider, b.el);
        const node = { type: "split", dir, ratio: Math.min(0.85, Math.max(0.15, Number(ratio) || 0.5)), el, children: [a, b], divider };
        this._applyRatio(node);
        divider.addEventListener("mousedown", e => {
            e.preventDefault();
            const rect = el.getBoundingClientRect();
            document.body.classList.add(dir === "row" ? "resizing-col" : "resizing-row");
            const move = ev => {
                const r = dir === "row" ? (ev.clientX - rect.left) / rect.width : (ev.clientY - rect.top) / rect.height;
                node.ratio = Math.min(0.85, Math.max(0.15, r));
                this._applyRatio(node);
            };
            const up = () => {
                removeEventListener("mousemove", move);
                removeEventListener("mouseup", up);
                document.body.classList.remove("resizing-col", "resizing-row");
                this.emit("changed");
            };
            addEventListener("mousemove", move);
            addEventListener("mouseup", up);
        });
        return node;
    }

    _applyRatio(node) {
        node.children[0].el.style.flex = `${node.ratio} 1 0`;
        node.children[1].el.style.flex = `${1 - node.ratio} 1 0`;
    }

    _focusLeaf(tab, leaf, { silent = false } = {}) {
        if (!leaf) return;
        tab.session = leaf.session;
        const leaves = this._leaves(tab.root);
        leaves.forEach(l => l.el.classList.toggle("focused", l === leaf && leaves.length > 1));
        if (silent) return;
        leaf.session.focus();
        this._updateLabel(tab);
        if (tab === this.active) this.emit("cwd", leaf.session.cwd, tab);
    }

    // ---------- panes ----------

    /** Split the focused pane: "row" = side by side, "col" = stacked. */
    async split(dir = "row") {
        const tab = this.active;
        if (!tab || tab.kind !== "term") return null;
        if (this._leaves(tab.root).length >= MAX_PANES) {
            bus.emit("toast", { type: "warn", text: `Pane limit reached (${MAX_PANES})` });
            return null;
        }
        const cur = this._leaves(tab.root).find(l => l.session === tab.session);
        const leaf = this._makeLeaf(tab, { cwd: tab.session.cwd || store.settings.cwd });
        const parent = this._parentOf(cur, tab.root);
        const placeholder = document.createComment("split");
        cur.el.replaceWith(placeholder);
        const node = this._makeSplit(dir, cur, leaf);
        placeholder.replaceWith(node.el);
        if (parent) parent.children[parent.children.indexOf(cur)] = node;
        else tab.root = node;
        audio.play("panels");
        this._focusLeaf(tab, leaf);
        await this._start(tab, leaf);
        this.emit("changed");
        return leaf;
    }

    /** Close one pane; closing the last pane closes the tab. */
    closePane(tab = this.active, leaf = null) {
        if (!tab || tab.kind !== "term") return this.close(tab);
        leaf = leaf || this._leaves(tab.root).find(l => l.session === tab.session);
        if (!leaf || !this.tabs.includes(tab)) return;
        const parent = this._parentOf(leaf, tab.root);
        if (!parent) return this.close(tab);
        this._disposeLeaf(leaf);
        const sibling = parent.children.find(c => c !== leaf);
        const grand = this._parentOf(parent, tab.root);
        parent.el.replaceWith(sibling.el);
        sibling.el.style.flex = parent.el.style.flex;
        if (grand) grand.children[grand.children.indexOf(parent)] = sibling;
        else { tab.root = sibling; sibling.el.style.flex = ""; }
        this._focusLeaf(tab, this._leaves(sibling)[0]);
        this.emit("changed");
    }

    _disposeLeaf(leaf) {
        for (const [id, s] of this._byPty) if (s === leaf.session) this._byPty.delete(id);
        leaf.session.dispose();
        leaf.el.remove();
    }

    /** Move focus to the nearest pane in a direction ("left" | "right" | "up" | "down"). */
    focusDirection(direction) {
        const tab = this.active;
        if (!tab || tab.kind !== "term") return;
        const leaves = this._leaves(tab.root);
        const cur = leaves.find(l => l.session === tab.session);
        if (!cur || leaves.length < 2) return;
        const c = cur.el.getBoundingClientRect();
        const cx = c.left + c.width / 2, cy = c.top + c.height / 2;
        let best = null, bestD = Infinity;
        for (const l of leaves) {
            if (l === cur) continue;
            const r = l.el.getBoundingClientRect();
            const x = r.left + r.width / 2, y = r.top + r.height / 2;
            const ok = { left: x < cx - 5, right: x > cx + 5, up: y < cy - 5, down: y > cy + 5 }[direction];
            if (!ok) continue;
            const d = Math.hypot(x - cx, y - cy);
            if (d < bestD) { best = l; bestD = d; }
        }
        if (best) { audio.play("folder"); this._focusLeaf(tab, best); }
    }

    _updateLabel(tab) {
        const s = tab.session;
        if (!s) return;
        if (tab.kind === "web") {
            let host = "";
            try { host = new URL(s.url).hostname.replace(/^www\./, ""); } catch (e) { /* about:blank */ }
            tab.label.textContent = tab.name || s.title || host || "web";
            tab.li.title = s.url;
            if (tab === this.active) this.root.querySelector(".shell-sub").textContent = `WEB · ${host.toUpperCase()}`;
            return;
        }
        let text = tab.name;
        const panes = this._leaves(tab.root).length;
        if (!text) {
            const where = s.cwd ? basename(s.cwd) : "";
            const shellName = s.shell ? basename(s.shell).replace(/\.exe$/i, "") : "shell";
            // Window titles set by programs win (vim, ssh, htop...) unless they are just the shell's own path.
            const t = s.title && !/\\|\/|^(Windows )?PowerShell|^pwsh|^Administrator:/i.test(s.title) ? s.title : "";
            text = `#${tab.n} ${t || shellName}${where ? " · " + where : ""}`;
        }
        tab.label.textContent = panes > 1 ? `${text} ⊞${panes}` : text;
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
        if (tab.kind === "term") this._leaves(tab.root).forEach(l => l.session.fitNow());
        tab.session.focus();
        this._updateLabel(tab);
        if (tab.kind === "term") this.emit("cwd", tab.session.cwd, tab);
        this.emit("activate", tab);
        this.emit("changed");
    }

    close(tab = this.active) {
        const i = this.tabs.indexOf(tab);
        if (i < 0) return;
        if (tab.kind === "term") this._leaves(tab.root).forEach(l => this._disposeLeaf(l));
        else tab.session.dispose();
        tab.li.remove();
        tab.pane.remove();
        this.tabs.splice(i, 1);
        if (this.lastTerm === tab) this.lastTerm = [...this.tabs].reverse().find(t => t.kind === "term") || null;
        this.emit("changed");
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
            this.emit("changed");
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

    // ---------- session persistence ----------

    /** Plain-data description of every tab (and optionally recent terminal output). */
    serialize({ output = true } = {}) {
        const nodeJSON = (node, tab) => node.type === "leaf"
            ? { cwd: node.session.cwd, focused: node.session === tab.session || undefined, output: output ? node.session.snapshot(SNAPSHOT_LINES) : undefined }
            : { dir: node.dir, ratio: Number(node.ratio.toFixed(3)), children: node.children.map(c => nodeJSON(c, tab)) };
        return {
            version: 1,
            savedAt: Date.now(),
            active: this.tabs.indexOf(this.active),
            tabs: this.tabs.map(t => t.kind === "web"
                ? { kind: "web", url: t.session.url, name: t.name }
                : { kind: "term", name: t.name, layout: nodeJSON(t.root, t) })
        };
    }

    /** Recreate tabs from `serialize()` output. Returns false if there was nothing usable. */
    async restore(data, { banner } = {}) {
        if (!data || !Array.isArray(data.tabs) || !data.tabs.length) return false;
        let first = true;
        for (const t of data.tabs.slice(0, MAX_TABS)) {
            if (t.kind === "web" && t.url) this.addWeb({ url: t.url, name: t.name, focus: false });
            else if (t.kind === "term") {
                await this.add({ layout: t.layout, name: t.name, banner: first ? banner : undefined, focus: false });
                first = false;
            }
        }
        if (!this.tabs.some(t => t.kind === "term")) await this.add({ banner });
        this.activate(this.tabs[data.active] || this.tabs[0]);
        return true;
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
