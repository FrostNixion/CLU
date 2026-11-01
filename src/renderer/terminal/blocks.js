import { h } from "../lib/util.js";
import { themes } from "../core/theme.js";
import { audio } from "../core/audio.js";

const BADGE_CELLS = 13;

export function formatMs(ms) {
    if (!(ms >= 0)) return "";
    if (ms < 1000) return `${ms}ms`;
    if (ms < 60000) return `${(ms / 1000).toFixed(ms < 10000 ? 1 : 0)}s`;
    const m = Math.floor(ms / 60000), s = Math.round(ms % 60000 / 1000);
    return `${m}m${String(s).padStart(2, "0")}s`;
}

/**
 * Command blocks: the shell marks every prompt (see shell integration), so each command's
 * output sits between two markers. Finished commands get a badge (✓/✗, duration) on their
 * prompt line with copy / re-run actions, and a mark in the scrollbar.
 */
export class CommandBlocks {
    constructor(session) {
        this.session = session;
        this.term = session.term;
        this.blocks = [];
        this.pending = null;
    }

    /** Called when a prompt is about to be drawn; `last` describes the command that just ended. */
    onPrompt(last) {
        const prev = this.pending;
        if (prev) {
            if (last && last.cmd) this._finish(prev, last);
            else prev.marker.dispose(); // empty Enter: nothing ran
        }
        const marker = this.term.registerMarker(0);
        if (!marker) return;
        const block = { marker, cmd: null };
        marker.onDispose(() => { this.blocks = this.blocks.filter(b => b !== block); });
        this.pending = block;
        return prev && last && last.cmd ? prev : null;
    }

    _finish(block, last) {
        Object.assign(block, { cmd: last.cmd, ok: !!last.ok, code: last.code, ms: last.ms });
        // The new prompt starts here, so this is where the command's output ends.
        block.endMarker = this.term.registerMarker(0);
        this.blocks.push(block);
        const [r, g, b] = themes.current.rgb;
        const color = block.ok ? `rgb(${r},${g},${b})` : "#ff4d4d";
        const deco = this.term.registerDecoration({
            marker: block.marker,
            x: Math.max(0, this.term.cols - BADGE_CELLS),
            width: BADGE_CELLS,
            layer: "top",
            overviewRulerOptions: { color, position: "right" }
        });
        if (!deco) return;
        block.deco = deco;
        deco.onRender(el => {
            if (el.dataset.ready) return;
            el.dataset.ready = "1";
            el.classList.add("cmd-badge-host");
            const text = block.ok ? `✓ ${formatMs(block.ms)}` : `✗ ${block.code ?? ""}${block.ms >= 0 ? " · " + formatMs(block.ms) : ""}`;
            const badge = h(`span.cmd-badge${block.ok ? "" : ".fail"}`, { title: `${block.cmd}\nclick for actions` }, text.trim());
            badge.addEventListener("mousedown", e => { e.preventDefault(); e.stopPropagation(); this._menu(block, badge); });
            el.append(badge);
        });
    }

    /** Text printed by a finished command (between its prompt and the next one). */
    output(block) {
        const buf = this.term.buffer.active;
        const start = block.marker.line + 1;
        const end = (block.endMarker && block.endMarker.line >= 0 ? block.endMarker.line : buf.length) - 1;
        const lines = [];
        for (let i = start; i <= end; i++) {
            const line = buf.getLine(i);
            if (!line) continue;
            const text = line.translateToString(true);
            if (line.isWrapped && lines.length) lines[lines.length - 1] += text;
            else lines.push(text);
        }
        while (lines.length && !lines[lines.length - 1].trim()) lines.pop();
        return lines.join("\n");
    }

    _menu(block, anchor) {
        document.querySelectorAll(".dropdown.cmd-menu").forEach(m => m.remove());
        const act = (label, fn) => h("button", { onclick: () => { menu.remove(); fn(); } }, h("span", label));
        const menu = h("div.dropdown.cmd-menu",
            h("div.cmd-menu-title", block.cmd.length > 60 ? block.cmd.slice(0, 57) + "..." : block.cmd),
            act("Copy command", () => window.clu.clipboard.write(block.cmd)),
            act("Copy output", () => window.clu.clipboard.write(this.output(block))),
            act("Run again", () => this.session.run(block.cmd)),
            act("Select output", () => {
                const start = block.marker.line + 1;
                const end = (block.endMarker ? block.endMarker.line : start) - 1;
                if (end >= start) this.term.selectLines(start, end);
            }));
        const r = anchor.getBoundingClientRect();
        document.getElementById("layer-modals").append(menu);
        menu.style.top = `${r.bottom + 4}px`;
        menu.style.left = `${Math.max(8, Math.min(r.right - menu.offsetWidth, innerWidth - menu.offsetWidth - 8))}px`;
        audio.play("folder");
        setTimeout(() => addEventListener("mousedown", function off(e) {
            if (!menu.contains(e.target)) { menu.remove(); removeEventListener("mousedown", off); }
        }), 0);
    }

    /** Scroll to the previous (-1) or next (+1) command prompt. */
    jump(dir) {
        const buf = this.term.buffer.active;
        const top = buf.viewportY;
        const lines = this.blocks.map(b => b.marker.line).concat(this.pending ? [this.pending.marker.line] : []).filter(l => l >= 0).sort((a, b) => a - b);
        const target = dir < 0 ? [...lines].reverse().find(l => l < top) : lines.find(l => l > top);
        if (target !== undefined) this.term.scrollToLine(target);
        else if (dir > 0) this.term.scrollToBottom();
    }

    get last() {
        return this.blocks[this.blocks.length - 1] || null;
    }
}
