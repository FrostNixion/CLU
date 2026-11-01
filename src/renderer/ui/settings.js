import { Modal, toast, confirmModal } from "./modal.js";
import { h } from "../lib/util.js";
import { store } from "../core/store.js";
import { themes } from "../core/theme.js";
import { LAYOUTS } from "../keyboard/layouts.js";
import { BACKGROUNDS } from "./background.js";
import { parseColor, toHex } from "../core/colors.js";

const SCHEMA = [
    { group: "Shell" },
    { key: "shell", label: "Shell", desc: "Program to run (auto = PowerShell 7 if installed, else Windows PowerShell). e.g. cmd.exe, bash.exe, wsl.exe", type: "text" },
    { key: "shellArgs", label: "Shell arguments", desc: "Space separated", type: "list" },
    { key: "cwd", label: "Start directory", type: "text" },
    { group: "Terminal" },
    { key: "termFontSize", label: "Font size", type: "number", min: 8, max: 40 },
    { key: "termFontFamily", label: "Font family", desc: "Any installed monospace font (bundled: Fira Code)", type: "text" },
    { key: "termLineHeight", label: "Line height", type: "number", min: 1, max: 2, step: 0.05 },
    { key: "cursorStyle", label: "Cursor style", type: "select", options: ["block", "bar", "underline"] },
    { key: "cursorBlink", label: "Cursor blink", type: "bool" },
    { key: "scrollback", label: "Scrollback lines", type: "number", min: 500, max: 200000, step: 500 },
    { key: "notifyAfterSeconds", label: "Notify when a command takes longer than (s)", desc: "0 = never", type: "number", min: 0, max: 3600 },
    { group: "Interface" },
    { key: "theme", label: "Theme", type: "select", options: () => themes.names() },
    { key: "background", label: "Background design", type: "select", options: () => Object.keys(BACKGROUNDS) },
    { key: "accent", label: "Accent color override", desc: "Empty = theme color. Name (cyan, amber, pink...), #hex or r,g,b", type: "text" },
    { key: "keyboard", label: "Keyboard layout", type: "select", options: () => Object.keys(LAYOUTS) },
    { key: "showKeyboard", label: "Show on-screen keyboard", type: "bool" },
    { key: "showFilesystem", label: "Show file browser", type: "bool" },
    { key: "clockHours", label: "Clock format", type: "select", options: [24, 12] },
    { key: "username", label: "Display name", desc: "Shown in the welcome message (empty = system user)", type: "text" },
    { key: "hideDotfiles", label: "Hide dotfiles", type: "bool" },
    { key: "fsListView", label: "File browser list view", type: "bool" },
    { key: "excludeThreadsFromToplist", label: "Group processes by name", type: "bool" },
    { key: "nointro", label: "Skip boot animation", type: "bool" },
    { key: "fullscreen", label: "Start in fullscreen", desc: "Applies on next start", type: "bool" },
    { key: "confirmOnQuit", label: "Confirm before quitting", type: "bool" },
    { group: "Audio" },
    { key: "audio", label: "Sound effects", type: "bool" },
    { key: "audioVolume", label: "Volume", type: "range", min: 0, max: 1, step: 0.05 },
    { key: "feedbackAudio", label: "Typing / output feedback sounds", type: "bool" },
    { group: "Network" },
    { key: "pingAddr", label: "Ping address", type: "text" },
    { key: "geoLookup", label: "Public IP & location lookup", desc: "Queries ipwho.is to place you on the globe", type: "bool" }
];

let open = null;

export function openSettings() {
    if (open) return open;
    const s = store.settings;
    const fields = {};
    const table = h("div.settings-grid");

    for (const item of SCHEMA) {
        if (item.group) {
            table.append(h("h4.settings-group", item.group));
            continue;
        }
        let input;
        const v = s[item.key];
        switch (item.type) {
            case "bool":
                input = h("input", { type: "checkbox" });
                input.checked = !!v;
                break;
            case "select": {
                const opts = typeof item.options === "function" ? item.options() : item.options;
                input = h("select", ...opts.map(o => h("option", { value: o }, String(o))));
                input.value = String(v);
                break;
            }
            case "number":
                input = h("input", { type: "number", min: item.min, max: item.max, step: item.step || 1, value: v });
                break;
            case "range": {
                input = h("input", { type: "range", min: item.min, max: item.max, step: item.step, value: v });
                break;
            }
            case "list":
                input = h("input", { type: "text", value: (Array.isArray(v) ? v : []).join(" ") });
                break;
            default:
                input = h("input", { type: "text", value: v ?? "", spellcheck: "false" });
        }
        input.id = `set-${item.key}`;
        fields[item.key] = { input, item };
        table.append(h("label.settings-row", { for: input.id },
            h("div.settings-label", h("span", item.label), item.desc ? h("small", item.desc) : null),
            h("div.settings-input", input)
        ));
    }

    const read = () => {
        const out = {};
        for (const [key, { input, item }] of Object.entries(fields)) {
            switch (item.type) {
                case "bool": out[key] = input.checked; break;
                case "number": case "range": out[key] = Number(input.value); break;
                case "list": out[key] = input.value.split(" ").filter(Boolean); break;
                case "select": out[key] = typeof s[key] === "number" ? Number(input.value) : input.value; break;
                default: out[key] = input.value;
            }
        }
        return out;
    };

    const save = async () => {
        const next = read();
        if (next.accent) {
            const rgb = parseColor(next.accent);
            if (!rgb) return toast(`Accent "${next.accent}" is not a color`, "warn");
            next.accent = toHex(rgb);
        }
        const needsRestart = ["shell", "shellArgs"].some(k => JSON.stringify(next[k]) !== JSON.stringify(store.settings[k]));
        await store.update(next);
        toast(needsRestart ? "Saved. New tabs will use the new shell." : "Settings saved", "info");
    };

    table.addEventListener("keydown", e => e.stopPropagation());

    open = new Modal({
        title: `Settings`,
        className: "settings-modal",
        body: table,
        buttons: [
            { label: "Save", primary: true, keep: true, action: save },
            { label: "Edit settings.json", keep: true, action: async () => window.clu.shell.openPath(await window.clu.settings.path()) },
            { label: "Themes folder", keep: true, action: async () => window.clu.shell.openPath(await window.clu.themes.dir()) },
            {
                label: "Reset defaults", keep: true, action: async () => {
                    if (!(await confirmModal("Reset settings", "Restore every setting to its default value?", { okLabel: "Reset" }))) return;
                    const d = await window.clu.settings.reset();
                    await store.update(d);
                    open && open.close();
                    openSettings();
                }
            }
        ],
        onClose: () => { open = null; }
    });
    return open;
}
