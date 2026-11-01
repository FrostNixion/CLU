import { LAYOUTS, SPECIAL_LABELS } from "./layouts.js";
import { h } from "../lib/util.js";
import { audio } from "../core/audio.js";

const MODIFIERS = new Set(["ShiftLeft", "ShiftRight", "ControlLeft", "ControlRight", "AltLeft", "AltRight", "CapsLock"]);
const ARROWS = { ArrowUp: "A", ArrowDown: "B", ArrowRight: "C", ArrowLeft: "D" };
const isLetter = c => c && c.length === 1 && c.toLowerCase() !== c.toUpperCase();

/**
 * On-screen keyboard. Mirrors the physical keyboard (lights up pressed keys) and
 * can be clicked/touched to type into the active terminal.
 */
export class Keyboard {
    constructor(root, { layout, getSession }) {
        this.root = root;
        this.getSession = getSession;
        this.state = { shift: false, ctrl: false, alt: false, altgr: false, caps: false };
        this.physical = new Set();
        this.setLayout(layout);

        this._onDown = e => this._physical(e, true);
        this._onUp = e => this._physical(e, false);
        document.addEventListener("keydown", this._onDown, true);
        document.addEventListener("keyup", this._onUp, true);
        window.addEventListener("blur", () => {
            this.physical.clear();
            this.root.querySelectorAll(".key.pressed").forEach(k => k.classList.remove("pressed"));
            this._syncShiftView();
        });
    }

    setLayout(name) {
        this.layoutName = LAYOUTS[name] ? name : "en-US";
        this.layout = LAYOUTS[this.layoutName];
        this.keys = new Map();
        const rows = this.layout.rows.map(row => h("div.kb-row", ...row.map(def => {
            const [code, w = 1] = Array.isArray(def) ? def : [def];
            const el = this._makeKey(code);
            el.style.flexGrow = w;
            if (!this.keys.has(code)) this.keys.set(code, []);
            this.keys.get(code).push(el);
            return el;
        })));
        this.root.replaceChildren(h("h3.title", h("p", "KEYBOARD"), h("p", this.layout.name.toUpperCase())), h("div.kb", ...rows));
        this._syncShiftView();
    }

    _makeKey(code) {
        const chars = this.layout.chars[code];
        let el;
        if (chars && code !== "Space") {
            const [n, s, ag] = chars;
            // Letters (incl. Turkish ı/İ, ş/Ş...) show a single glyph that follows Shift/Caps.
            el = isLetter(n) && isLetter(s) && n !== s
                ? h("div.key.letter", h("span.k-main", { "data-n": n, "data-s": s }, s), ag ? h("span.k-altgr", ag) : null)
                : h("div.key", h("span.k-shift", s), h("span.k-main", { "data-n": n, "data-s": s }, n), ag ? h("span.k-altgr", ag) : null);
        } else {
            let label = SPECIAL_LABELS[code] ?? code;
            if (code === "AltRight") label = this.layout.altgrLabel;
            el = h(`div.key.special${code === "Space" ? ".space" : ""}`, h("span.k-main", label));
        }
        el.dataset.code = code;
        el.addEventListener("mousedown", e => {
            e.preventDefault(); // keep focus in the terminal
            this._press(code, el);
        });
        return el;
    }

    _physical(e, down) {
        const els = this.keys.get(e.code);
        if (down) this.physical.add(e.code); else this.physical.delete(e.code);
        if (els) els.forEach(el => el.classList.toggle("pressed", down));
        if (e.code === "CapsLock" && e.getModifierState) this.state.caps = e.getModifierState("CapsLock");
        if (MODIFIERS.has(e.code)) this._syncShiftView();
    }

    _syncShiftView() {
        const shift = this.state.shift || this.physical.has("ShiftLeft") || this.physical.has("ShiftRight");
        const upper = shift !== this.state.caps;
        this.root.classList.toggle("shifted", shift);
        this.root.querySelectorAll(".key.letter .k-main").forEach(s => { s.textContent = upper ? s.dataset.s : s.dataset.n; });
        for (const [mod, codes] of [["shift", ["ShiftLeft", "ShiftRight"]], ["ctrl", ["ControlLeft", "ControlRight"]], ["alt", ["AltLeft"]], ["altgr", ["AltRight"]], ["caps", ["CapsLock"]]]) {
            codes.forEach(c => (this.keys.get(c) || []).forEach(el => el.classList.toggle("latched", this.state[mod])));
        }
    }

    _press(code, el) {
        el.classList.add("pressed");
        setTimeout(() => el.classList.remove("pressed"), 120);
        audio.play("stdin");

        const st = this.state;
        switch (code) {
            case "ShiftLeft": case "ShiftRight": st.shift = !st.shift; return this._syncShiftView();
            case "ControlLeft": case "ControlRight": st.ctrl = !st.ctrl; return this._syncShiftView();
            case "AltLeft": st.alt = !st.alt; return this._syncShiftView();
            case "AltRight":
                if (this.layout.altgrLabel === "ALT") st.alt = !st.alt; else st.altgr = !st.altgr;
                return this._syncShiftView();
            case "CapsLock": st.caps = !st.caps; return this._syncShiftView();
        }

        const session = this.getSession();
        if (!session) return;
        const term = session.term;
        let data = null;

        if (ARROWS[code]) {
            data = (term.modes.applicationCursorKeysMode ? "\x1bO" : "\x1b[") + ARROWS[code];
        } else if (code === "Enter") data = "\r";
        else if (code === "Backspace") data = st.ctrl ? "\x08" : "\x7f";
        else if (code === "Tab") data = st.shift ? "\x1b[Z" : "\t";
        else if (code === "Escape") data = "\x1b";
        else {
            const chars = this.layout.chars[code];
            if (!chars) return;
            const [n, s, ag] = chars;
            let ch;
            if (st.altgr && ag) ch = ag;
            else {
                const shift = st.shift !== (st.caps && isLetter(n));
                ch = shift ? s : n;
            }
            if (st.ctrl) {
                const up = ch.toUpperCase();
                const cc = up.charCodeAt(0);
                if (cc >= 64 && cc <= 95) ch = String.fromCharCode(cc - 64);
                else if (ch === " ") ch = "\x00";
                else if (ch === "?") ch = "\x7f";
            }
            data = (st.alt ? "\x1b" : "") + ch;
        }

        // One-shot modifiers release after a key, like a phone keyboard.
        st.shift = st.ctrl = st.alt = st.altgr = false;
        this._syncShiftView();
        term.input(data, true);
        session.focus();
    }

    destroy() {
        document.removeEventListener("keydown", this._onDown, true);
        document.removeEventListener("keyup", this._onUp, true);
    }
}
