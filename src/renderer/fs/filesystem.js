import { ICONS, iconFor } from "./icons.js";
import { h, formatBytes, dirname } from "../lib/util.js";
import { store } from "../core/store.js";
import { audio } from "../core/audio.js";
import { openFile } from "../ui/viewer.js";
import { openPicker } from "../ui/palette.js";

/**
 * File browser that follows the active terminal's working directory.
 * Click a folder to `cd` the shell into it, click a file to open it in CLU,
 * right-click a file to open it with the system.
 */
export class FileBrowser {
    constructor(root, { getSession }) {
        this.root = root;
        this.getSession = getSession;
        this.dir = null;
        this.entries = [];
        this.detached = false;

        this.pathEl = h("p.fs-path", "");
        this.list = h("div.fs-list");
        this.diskFill = h("div.bar-fill");
        this.diskText = h("span.fs-disk-text", "");
        root.append(
            h("h3.title", h("p", "FILESYSTEM"), this.pathEl),
            this.list,
            h("div.fs-footer", h("span.bar-label", "DISK"), h("div.bar", this.diskFill), this.diskText)
        );
        this._applyClasses();
        store.on("change:hideDotfiles", () => this._applyClasses());
        store.on("change:fsListView", () => this._applyClasses());
    }

    _applyClasses() {
        this.root.classList.toggle("hide-dotfiles", !!store.get("hideDotfiles"));
        this.root.classList.toggle("list-view", !!store.get("fsListView"));
    }

    follow(dir) {
        if (!dir || this.detached) return;
        this.show(dir);
    }

    async show(dir, { detached = false } = {}) {
        this.detached = detached;
        if (dir === "::drives") return this.showDrives();
        let entries;
        try {
            entries = await window.clu.fs.list(dir);
        } catch (e) {
            this.list.replaceChildren(h("div.fs-error", `Cannot read ${dir}`, h("small", e.message.replace(/^.*?Error: /, ""))));
            this.pathEl.textContent = dir;
            return;
        }
        this.dir = dir;
        this.entries = entries.sort((a, b) => {
            const ad = a.type.startsWith("dir"), bd = b.type.startsWith("dir");
            if (ad !== bd) return ad ? -1 : 1;
            return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" });
        });
        this.pathEl.textContent = (detached ? "[DETACHED] " : "") + dir;
        this.pathEl.title = detached ? "Click to follow the terminal again" : dir;
        this.pathEl.onclick = detached ? () => { this.detached = false; const s = this.getSession(); if (s) this.show(s.cwd); } : null;
        this.render();
        this.updateDisk();
    }

    async showDrives() {
        const drives = await window.clu.fs.drives();
        this.dir = "::drives";
        this.pathEl.textContent = "THIS PC";
        this.list.replaceChildren(...drives.map(d => this._tile({ name: d.name, path: d.path, type: "dir", icon: "drive" })));
    }

    render() {
        const tiles = [];
        const parent = dirname(this.dir);
        const atRoot = parent === this.dir || /^[a-z]:\\?$/i.test(this.dir);
        tiles.push(this._tile({ name: "..", path: atRoot ? "::drives" : parent, type: "dir", icon: "up", up: true }));
        // Rendering thousands of nodes stalls the UI; the fuzzy finder covers the rest.
        const MAX = 600;
        for (const e of this.entries.slice(0, MAX)) tiles.push(this._tile(e));
        if (this.entries.length > MAX) {
            tiles.push(h("div.fs-more", { onclick: () => this.find() }, `+${this.entries.length - MAX} more · search`));
        }
        this.list.replaceChildren(...tiles);
        this.list.scrollTop = 0;
    }

    _tile(e) {
        const icon = e.icon || iconFor(e);
        const isDir = e.type === "dir" || e.type === "dirlink";
        const el = h(`div.fs-entry${e.hidden ? ".hidden" : ""}${isDir ? ".is-dir" : ""}`, { title: e.up ? "Parent directory" : `${e.name}${isDir ? "" : "\n" + formatBytes(e.size)}` },
            h("i.fs-icon", { html: ICONS[icon] || ICONS.file }),
            h("span.fs-name", e.name),
            !isDir && e.size !== undefined ? h("span.fs-size", formatBytes(e.size)) : h("span.fs-size", ""),
            e.mtime ? h("span.fs-date", new Date(e.mtime).toLocaleDateString()) : h("span.fs-date", "")
        );
        el.addEventListener("click", () => this.activate(e, isDir));
        el.addEventListener("contextmenu", ev => {
            ev.preventDefault();
            if (!e.up) window.clu.shell.openPath(e.path);
        });
        el.addEventListener("auxclick", ev => {
            if (ev.button === 1 && !e.up) {
                // middle click: insert the path into the terminal
                const s = this.getSession();
                if (s) s.write(/\s/.test(e.path) ? `"${e.path}"` : e.path);
            }
        });
        return el;
    }

    activate(e, isDir) {
        const session = this.getSession();
        if (isDir) {
            audio.play("folder");
            if (e.path === "::drives") return this.show("::drives", { detached: true });
            if (session && !this.detached) session.cd(e.path);
            else this.show(e.path, { detached: this.detached });
        } else {
            audio.play("granted");
            openFile(e.path);
        }
    }

    async updateDisk() {
        if (!this.dir || this.dir === "::drives") return;
        try {
            const vols = await window.clu.sys.call("fsSize");
            const lower = this.dir.toLowerCase();
            const vol = vols
                .filter(v => lower.startsWith(String(v.mount).toLowerCase()))
                .sort((a, b) => b.mount.length - a.mount.length)[0];
            if (!vol) return;
            this.diskFill.style.width = `${Math.min(100, vol.use || 0)}%`;
            this.diskText.textContent = `${vol.mount} ${formatBytes(vol.used)} / ${formatBytes(vol.size)}`;
        } catch (e) { /* ignore */ }
    }

    /** Fuzzy search over the current directory (Ctrl+Shift+O). */
    find() {
        if (!this.entries.length) return;
        openPicker({
            placeholder: `Search in ${this.dir}`,
            items: this.entries.map(e => ({
                label: e.name,
                detail: e.type.startsWith("dir") ? "folder" : formatBytes(e.size),
                run: () => this.activate(e, e.type.startsWith("dir"))
            }))
        });
    }

    refresh() {
        if (this.dir) this.show(this.dir, { detached: this.detached });
    }
}
