import { THEMES, normalizeTheme } from "./themes.js";
import { Emitter } from "../lib/util.js";

const STANDARD_ANSI = {
    black: "#2e3436", red: "#cc0000", green: "#4e9a06", yellow: "#c4a000", blue: "#3465a4", magenta: "#75507b",
    cyan: "#06989a", white: "#d3d7cf", brightBlack: "#555753", brightRed: "#ef2929", brightGreen: "#8ae234",
    brightYellow: "#fce94f", brightBlue: "#729fcf", brightMagenta: "#ad7fa8", brightCyan: "#34e2e2", brightWhite: "#eeeeec"
};

function hexToRgb(hex) {
    const n = parseInt(hex.replace("#", ""), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
const toHex = rgb => "#" + rgb.map(v => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, "0")).join("");

// Desaturate the stock ANSI color a little and pull it towards the theme accent,
// so `ls --color` output still distinguishes colors but feels part of the theme.
function tint(hex, accent, amount = 0.3) {
    const c = hexToRgb(hex);
    const lum = 0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2];
    const desat = c.map(v => v * 0.55 + lum * 0.45);
    return toHex(desat.map((v, i) => v * (1 - amount) + accent[i] * amount));
}

class ThemeManager extends Emitter {
    constructor() {
        super();
        this.user = {};
        this.current = null;
        this.styleEl = document.createElement("style");
        this.styleEl.id = "theme-vars";
        document.head.append(this.styleEl);
    }

    setUserThemes(list) {
        this.user = {};
        for (const t of list || []) if (t && t.name) this.user[t.name] = t;
    }

    names() {
        return [...new Set([...Object.keys(THEMES), ...Object.keys(this.user)])];
    }

    describe(name) {
        const t = this.user[name] || THEMES[name];
        return t ? (t.description || (this.user[name] ? "user theme" : "")) : "";
    }

    get(name) {
        const raw = this.user[name] || THEMES[name];
        return raw ? normalizeTheme(name, raw) : null;
    }

    /** Override the theme's accent color (array [r,g,b]) or clear it with null. */
    setAccent(rgb) {
        this.accent = rgb;
        if (this.current) this.apply(this.current.name);
    }

    apply(name) {
        let theme = this.get(name) || this.get("tron");
        if (this.accent) {
            // Recolor everything derived from the accent, including the terminal text.
            const rgb = this.accent, a = `rgb(${rgb.join(",")})`;
            theme = {
                ...theme, rgb,
                terminal: { ...theme.terminal, foreground: a, cursor: a, selection: `rgba(${rgb.join(",")},0.3)`, ansi: theme.terminal.ansi },
                globe: { ...theme.globe, land: a, marker: a }
            };
        }
        const [r, g, b] = theme.rgb;
        const c = theme.colors;
        this.styleEl.textContent = `
:root {
    --r: ${r}; --g: ${g}; --b: ${b};
    --accent: rgb(${r}, ${g}, ${b});
    --accent-dim: rgba(${r}, ${g}, ${b}, 0.5);
    --accent-faint: rgba(${r}, ${g}, ${b}, 0.15);
    --accent-ghost: rgba(${r}, ${g}, ${b}, 0.06);
    --black: ${c.black};
    --light-black: ${c.light_black};
    --grey: ${c.grey};
    --red: ${c.red};
    --yellow: ${c.yellow};
    --font-main: "${theme.font.main.replace(/"/g, "")}", "Rajdhani", sans-serif;
    --font-mono: "${theme.font.mono.replace(/"/g, "")}", "Fira Code", monospace;
    --term-bg: ${theme.terminal.background};
}
${theme.css.replace(/<\/?style/gi, "")}`;
        this.current = theme;
        this.emit("change", theme);
        return theme;
    }

    xtermTheme(theme = this.current) {
        const t = theme.terminal;
        const ansi = {};
        for (const [k, v] of Object.entries(STANDARD_ANSI)) ansi[k] = (t.ansi && t.ansi[k]) || tint(v, theme.rgb);
        return {
            foreground: t.foreground,
            background: t.background,
            cursor: t.cursor,
            cursorAccent: t.cursorAccent,
            selectionBackground: t.selection,
            scrollbarSliderBackground: `rgba(${theme.rgb.join(",")},0.25)`,
            scrollbarSliderHoverBackground: `rgba(${theme.rgb.join(",")},0.4)`,
            scrollbarSliderActiveBackground: `rgba(${theme.rgb.join(",")},0.55)`,
            ...ansi
        };
    }
}

export const themes = new ThemeManager();
