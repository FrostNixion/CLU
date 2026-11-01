import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebglAddon } from "@xterm/addon-webgl";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { SearchAddon } from "@xterm/addon-search";
import { SerializeAddon } from "@xterm/addon-serialize";
import { Unicode11Addon } from "@xterm/addon-unicode11";
import { store } from "../core/store.js";
import { themes } from "../core/theme.js";
import { audio } from "../core/audio.js";
import { Emitter } from "../lib/util.js";
import { CommandBlocks } from "./blocks.js";

const ACK_CHUNK = 64 * 1024;

function decodeOsc7(data) {
    // file://host/path  (cmd.exe sends a raw Windows path after file:///)
    let p = data.replace(/^file:\/\/[^/]*/, "");
    try { p = decodeURIComponent(p); } catch (e) { /* keep raw */ }
    if (/^\/[a-z]:/i.test(p)) p = p.slice(1);
    if (/^[a-z]:/i.test(p)) p = p.replace(/\//g, "\\");
    return p;
}

function decodeCluPayload(b64) {
    const bin = atob(b64.trim());
    const bytes = Uint8Array.from(bin, c => c.charCodeAt(0));
    return JSON.parse(new TextDecoder().decode(bytes));
}

/**
 * One xterm.js instance bound to one pty in the main process.
 * Events: data-activity, cwd, title, exit, clu (shell -> app command)
 */
export class TerminalSession extends Emitter {
    constructor(container, { cwd, command, restore } = {}) {
        super();
        this.container = container;
        this.ptyId = null;
        this.cwd = cwd || "";
        this.title = "";
        this.exited = false;
        this._pendingAck = 0;
        this._initialCommand = command;
        this._restore = restore;

        const s = store.settings;
        this.term = new Terminal({
            fontFamily: `"${s.termFontFamily}", "Fira Code", monospace`,
            fontSize: s.termFontSize,
            lineHeight: s.termLineHeight,
            cursorBlink: s.cursorBlink,
            cursorStyle: s.cursorStyle,
            scrollback: s.scrollback,
            allowProposedApi: true,
            allowTransparency: false,
            drawBoldTextInBrightColors: true,
            macOptionIsMeta: true,
            rightClickSelectsWord: false,
            smoothScrollDuration: 0,
            fastScrollSensitivity: 5,
            minimumContrastRatio: 1,
            windowsPty: store.info.platform === "win32" ? { backend: "conpty" } : undefined,
            theme: themes.xtermTheme()
        });

        this.fit = new FitAddon();
        this.search = new SearchAddon();
        this.serializer = new SerializeAddon();
        this.term.loadAddon(this.fit);
        this.term.loadAddon(this.search);
        this.term.loadAddon(this.serializer);
        this.term.loadAddon(new Unicode11Addon());
        this.term.unicode.activeVersion = "11";
        this.term.loadAddon(new WebLinksAddon((ev, uri) => {
            if (ev.ctrlKey || ev.metaKey) window.clu.shell.openExternal(uri);
        }));

        this.term.open(container);
        this._enableWebgl();
        this.blocks = new CommandBlocks(this);

        this.term.parser.registerOscHandler(7, data => {
            this._setCwd(decodeOsc7(data));
            return true;
        });
        this.term.parser.registerOscHandler(7777, data => {
            let msg;
            try { msg = decodeCluPayload(data); } catch (e) { return true; }
            if (msg.t === "cwd" && msg.p) this._setCwd(msg.p);
            else if (msg.t === "prompt") {
                const done = this.blocks.onPrompt(msg.last);
                if (msg.p) this._setCwd(msg.p);
                if (done) setTimeout(() => this.emit("command-done", done), 0);
            } else if (msg.t === "cmd") {
                if (msg.token !== store.info.token) {
                    console.warn("[clu] rejected command without a valid token");
                    return true;
                }
                if (msg.cwd) this._setCwd(msg.cwd);
                const args = Array.isArray(msg.args) ? msg.args : [msg.args].filter(Boolean);
                // Defer so the shell's own output for this chunk is rendered first.
                setTimeout(() => this.emit("clu", args, msg.cwd || this.cwd, this), 0);
            }
            return true;
        });
        this.term.onTitleChange(t => {
            this.title = t;
            this.emit("title", t);
        });
        this.term.onBell(() => audio.play("info", { throttle: 500 }));

        this.term.onData(d => {
            if (this.ptyId !== null && !this.exited) window.clu.pty.write(this.ptyId, d);
            audio.play("stdin", { throttle: 25 });
        });
        this.term.onBinary(d => {
            if (this.ptyId !== null) window.clu.pty.write(this.ptyId, d);
        });
        this.term.onResize(({ cols, rows }) => {
            if (this.ptyId !== null) window.clu.pty.resize(this.ptyId, cols, rows);
        });

        this._ro = new ResizeObserver(() => this.scheduleFit());
        this._ro.observe(container);

        this.container.addEventListener("contextmenu", e => {
            e.preventDefault();
            if (this.term.hasSelection()) this.copy();
            else this.paste();
        });
    }

    _enableWebgl() {
        try {
            const webgl = new WebglAddon();
            webgl.onContextLoss(() => {
                webgl.dispose();
                setTimeout(() => this._enableWebgl(), 1000);
            });
            this.term.loadAddon(webgl);
            this.webgl = webgl;
        } catch (e) {
            console.warn("[terminal] WebGL unavailable, using DOM renderer", e);
        }
    }

    async start() {
        this.fitNow();
        if (this._restore) {
            // Put the previous session's output into scrollback, then clear the viewport so the
            // new shell (ConPTY assumes an empty screen) draws from the top without overlap.
            const divider = `\x1b[0m\r\n\x1b[2m──── restored from previous session · ${new Date().toLocaleString()} ────\x1b[0m`;
            this.term.write(this._restore + divider + "\r\n".repeat(this.term.rows) + "\x1b[2J\x1b[H");
            this._restore = null;
        }
        const res = await window.clu.pty.create({
            cwd: this.cwd || undefined, cols: this.term.cols, rows: this.term.rows,
            env: this.banner ? { CLU_BANNER: this.banner } : undefined
        });
        this.ptyId = res.id;
        this.pid = res.pid;
        this.shell = res.shell;
        this.kind = res.kind;
        if (!this.cwd) this._setCwd(res.cwd);
        if (this._initialCommand) setTimeout(() => this.run(this._initialCommand), 400);
        return res;
    }

    /** Called by the tab manager's data router. */
    receive(data) {
        this.term.write(data, () => {
            this._pendingAck += data.length;
            if (this._pendingAck >= ACK_CHUNK) this._flushAck();
            else if (!this._ackTimer) this._ackTimer = setTimeout(() => this._flushAck(), 50);
        });
        this.emit("data-activity");
    }

    _flushAck() {
        clearTimeout(this._ackTimer);
        this._ackTimer = null;
        if (this._pendingAck && this.ptyId !== null) window.clu.pty.ack(this.ptyId, this._pendingAck);
        this._pendingAck = 0;
    }

    _setCwd(p) {
        if (!p) return;
        // Shells report cwd with every prompt, i.e. after every command: a cheap "something may have changed" signal.
        this.emit("prompt", p);
        if (p === this.cwd) return;
        this.cwd = p;
        this.emit("cwd", p);
    }

    handleExit(code) {
        this.exited = true;
        this.term.write(`\r\n\x1b[2m[process exited with code ${code}]\x1b[0m\r\n`);
        this.emit("exit", code);
    }

    scheduleFit() {
        if (this._fitQueued) return;
        this._fitQueued = true;
        requestAnimationFrame(() => {
            this._fitQueued = false;
            this.fitNow();
        });
    }

    fitNow() {
        if (!this.container.offsetParent || this.container.clientWidth < 20) return;
        try { this.fit.fit(); } catch (e) { /* not visible yet */ }
    }

    /** Send text to the shell as if typed. */
    write(text) {
        if (this.ptyId !== null && !this.exited) window.clu.pty.write(this.ptyId, text);
    }

    run(command) {
        this.write(command + "\r");
    }

    cd(dir) {
        const q = this.kind === "cmd" ? `cd /d "${dir}"` : this.kind === "powershell" ? `Set-Location -LiteralPath '${dir.replace(/'/g, "''")}'` : `cd '${dir.replace(/'/g, "'\\''")}'`;
        this.run(q);
    }

    focus() {
        this.term.focus();
    }

    async copy() {
        if (!this.term.hasSelection()) return false;
        await window.clu.clipboard.write(this.term.getSelection());
        this.term.clearSelection();
        return true;
    }

    async paste() {
        const text = await window.clu.clipboard.read();
        if (text) this.term.paste(text);
    }

    applySettings() {
        const s = store.settings;
        Object.assign(this.term.options, {
            fontSize: s.termFontSize,
            fontFamily: `"${s.termFontFamily}", "Fira Code", monospace`,
            lineHeight: s.termLineHeight,
            cursorBlink: s.cursorBlink,
            cursorStyle: s.cursorStyle,
            scrollback: s.scrollback
        });
        this.scheduleFit();
    }

    /** Recent output (with colors) for session restore. */
    snapshot(lines = 1000) {
        try {
            return this.serializer.serialize({ scrollback: lines, excludeAltBuffer: true, excludeModes: true });
        } catch (e) {
            return "";
        }
    }

    applyTheme() {
        this.term.options.theme = themes.xtermTheme();
    }

    dispose() {
        this._ro.disconnect();
        this._flushAck();
        if (this.ptyId !== null && !this.exited) window.clu.pty.kill(this.ptyId);
        this.term.dispose();
    }
}
