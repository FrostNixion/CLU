import { h, fuzzyScore } from "../lib/util.js";
import { commands } from "../core/commands.js";
import { audio } from "../core/audio.js";
import { bus } from "../core/store.js";

let current = null;

/**
 * Generic fuzzy picker. `items`: [{label, detail?, hint?, run, preview?}]
 * `onCancel` runs when dismissed without choosing (used to undo live previews).
 */
export function openPicker({ placeholder = "Type a command...", items, onCancel, initial = "" }) {
    if (current) current.close(true);
    const input = h("input.palette-input", { placeholder, spellcheck: "false", value: initial });
    const list = h("ul.palette-list");
    const el = h("div.palette", h("div.palette-box", input, list));
    document.getElementById("layer-modals").append(el);
    audio.play("panels");

    let shown = [], sel = 0, done = false;

    const render = () => {
        const q = input.value.trim();
        shown = items
            .map(it => ({ it, s: Math.max(fuzzyScore(q, it.label), it.detail ? fuzzyScore(q, it.detail) - 50 : -1) }))
            .filter(x => x.s >= 0)
            .sort((a, b) => q ? b.s - a.s : 0)
            .slice(0, 60)
            .map(x => x.it);
        sel = Math.min(sel, Math.max(0, shown.length - 1));
        list.replaceChildren(...shown.map((it, i) => {
            const li = h(`li${i === sel ? ".selected" : ""}`,
                h("span.palette-label", it.label),
                it.detail ? h("span.palette-detail", it.detail) : null,
                it.hint ? h("kbd", it.hint) : null);
            li.addEventListener("mousemove", () => { if (sel !== i) { sel = i; highlight(); } });
            li.addEventListener("click", () => choose(i));
            return li;
        }));
        if (!shown.length) list.append(h("li.empty", "No matches"));
        preview();
    };
    const highlight = () => {
        [...list.children].forEach((li, i) => li.classList.toggle("selected", i === sel));
        const s = list.children[sel];
        if (s) s.scrollIntoView({ block: "nearest" });
        preview();
    };
    const preview = () => {
        const it = shown[sel];
        if (it && it.preview) it.preview();
    };
    const choose = i => {
        const it = shown[i];
        if (!it) return;
        done = true;
        close();
        audio.play("granted");
        Promise.resolve(it.run()).catch(e => bus.emit("toast", { type: "error", text: e.message }));
    };
    const close = (silent) => {
        el.remove();
        current = null;
        if (!done && onCancel) onCancel();
        if (!silent) bus.emit("modals-empty");
    };

    input.addEventListener("input", () => { sel = 0; render(); });
    input.addEventListener("keydown", e => {
        e.stopPropagation();
        if (e.key === "ArrowDown") { e.preventDefault(); sel = Math.min(sel + 1, shown.length - 1); highlight(); }
        else if (e.key === "ArrowUp") { e.preventDefault(); sel = Math.max(sel - 1, 0); highlight(); }
        else if (e.key === "PageDown") { e.preventDefault(); sel = Math.min(sel + 10, shown.length - 1); highlight(); }
        else if (e.key === "PageUp") { e.preventDefault(); sel = Math.max(sel - 10, 0); highlight(); }
        else if (e.key === "Enter") { e.preventDefault(); choose(sel); }
        else if (e.key === "Escape") { e.preventDefault(); close(); }
    });
    el.addEventListener("mousedown", e => { if (e.target === el) close(); });

    current = { close };
    render();
    input.focus();
    return current;
}

export function openPalette() {
    const items = commands.list().map(c => ({
        label: c.title,
        detail: c.category,
        hint: c.keys,
        run: () => commands.run(c.id)
    }));
    return openPicker({ placeholder: "Run a CLU command...", items });
}

export const pickerOpen = () => !!current;
export const closePicker = () => current && current.close();
