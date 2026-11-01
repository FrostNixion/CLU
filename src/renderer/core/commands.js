// Every user-facing action lives here once, and is reachable from the keyboard
// shortcut table, the command palette and the `clu` shell command alike.

const registry = new Map();

export const commands = {
    register(cmd) {
        registry.set(cmd.id, cmd);
    },
    get(id) {
        return registry.get(id);
    },
    list() {
        return [...registry.values()].filter(c => !c.hidden);
    },
    async run(id, ...args) {
        const cmd = registry.get(id);
        if (!cmd) throw new Error(`unknown command: ${id}`);
        return cmd.run(...args);
    }
};

/** "Ctrl+Shift+T" -> normalized "ctrl+shift+t" matching a KeyboardEvent. */
export function eventCombo(e) {
    const parts = [];
    if (e.ctrlKey) parts.push("ctrl");
    if (e.altKey) parts.push("alt");
    if (e.shiftKey) parts.push("shift");
    if (e.metaKey) parts.push("meta");
    let key = e.code;
    if (/^Key[A-Z]$/.test(key)) key = key.slice(3);
    else if (/^Digit\d$/.test(key)) key = key.slice(5);
    else if (/^Arrow/.test(key)) key = key.slice(5);
    else if (key === "Equal" || key === "NumpadAdd") key = "=";
    else if (key === "Minus" || key === "NumpadSubtract") key = "-";
    else if (key === "Comma") key = ",";
    else if (key === "Period") key = ".";
    parts.push(key.toLowerCase());
    return parts.join("+");
}

export function normalizeCombo(s) {
    const mods = ["ctrl", "alt", "shift", "meta"];
    const parts = s.toLowerCase().split("+").map(p => p.trim());
    const key = parts.filter(p => !mods.includes(p)).join("+");
    return [...mods.filter(m => parts.includes(m)), key].join("+");
}
