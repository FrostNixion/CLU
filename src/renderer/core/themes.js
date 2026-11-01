// Built-in themes. User themes (JSON in <userData>/themes) use the same shape and may
// omit anything; missing values fall back to the "tron" theme.
// `rgb` is the accent color every panel, border and graph is drawn with.

const base = {
    font: { main: "Rajdhani", mono: "Fira Code" },
    colors: { black: "#000000", light_black: "#05080d", grey: "#262828", red: "#ff3b3b", yellow: "#ffcc33" }
};

const nordAnsi = {
    black: "#3b4252", red: "#bf616a", green: "#a3be8c", yellow: "#ebcb8b", blue: "#81a1c1", magenta: "#b48ead",
    cyan: "#88c0d0", white: "#e5e9f0", brightBlack: "#4c566a", brightRed: "#bf616a", brightGreen: "#a3be8c",
    brightYellow: "#ebcb8b", brightBlue: "#81a1c1", brightMagenta: "#b48ead", brightCyan: "#8fbcbb", brightWhite: "#eceff4"
};

export const THEMES = {
    tron: {
        description: "The classic grid: ice blue on deep black",
        rgb: [170, 207, 209],
        colors: { light_black: "#05080d", grey: "#262828" },
        terminal: { foreground: "#aacfd1", background: "#05080d" }
    },
    matrix: {
        description: "Wake up, Neo",
        rgb: [0, 255, 102],
        colors: { light_black: "#010a04", grey: "#0f2a16" },
        terminal: { foreground: "#66ff99", background: "#010a04" }
    },
    blade: {
        description: "Off-world amber haze",
        rgb: [255, 140, 50],
        colors: { light_black: "#0d0703", grey: "#2b1d12" },
        terminal: { foreground: "#ffb070", background: "#0d0703" }
    },
    red: {
        description: "Alert condition",
        rgb: [235, 55, 55],
        colors: { light_black: "#0b0303", grey: "#2a1212", red: "#ffffff" },
        terminal: { foreground: "#ff8a8a", background: "#0b0303" }
    },
    apollo: {
        description: "Mission control gold",
        rgb: [235, 205, 120],
        colors: { light_black: "#0a0905", grey: "#2b2717" },
        terminal: { foreground: "#ecd9a0", background: "#0a0905" }
    },
    interstellar: {
        description: "Cold white starlight",
        rgb: [215, 222, 230],
        colors: { light_black: "#07080a", grey: "#25282c" },
        terminal: { foreground: "#dfe5ec", background: "#07080a" }
    },
    cyborg: {
        description: "Electric cyan HUD",
        rgb: [64, 214, 255],
        colors: { light_black: "#010811", grey: "#0f2433" },
        terminal: { foreground: "#8be6ff", background: "#010811" }
    },
    synthwave: {
        description: "Neon magenta night drive",
        rgb: [255, 85, 200],
        colors: { light_black: "#0c0613", grey: "#2a1534" },
        terminal: { foreground: "#ffb3e8", background: "#0c0613", ansi: { cyan: "#36f9f6", brightCyan: "#72f1f8", yellow: "#fede5d", blue: "#6b8cff" } }
    },
    nord: {
        description: "Arctic, north-bluish calm",
        rgb: [136, 192, 208],
        colors: { light_black: "#2e3440", grey: "#3b4252", black: "#242933" },
        terminal: { foreground: "#d8dee9", background: "#2e3440", cursor: "#d8dee9", ansi: nordAnsi }
    }
};

export function normalizeTheme(name, t) {
    const tron = THEMES.tron;
    const rgb = Array.isArray(t.rgb) ? t.rgb : (t.colors && "r" in t.colors ? [t.colors.r, t.colors.g, t.colors.b] : tron.rgb);
    const colors = Object.assign({}, base.colors, t.colors || {});
    const accent = `rgb(${rgb.join(",")})`;
    const term = Object.assign({
        foreground: accent,
        background: colors.light_black,
        cursor: accent,
        cursorAccent: colors.light_black,
        selection: `rgba(${rgb.join(",")},0.3)`
    }, t.terminal || {});
    return {
        name,
        description: t.description || "",
        rgb,
        colors,
        font: Object.assign({}, base.font, t.font || {}),
        terminal: term,
        globe: Object.assign({ land: accent, grid: `rgba(${rgb.join(",")},0.18)`, marker: accent }, t.globe || {}),
        css: typeof t.css === "string" ? t.css : ""
    };
}
