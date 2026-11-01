// Accent color presets and parsing for `clu accent`.

export const ACCENTS = {
    ice: [170, 207, 209],
    cyan: [64, 214, 255],
    blue: [90, 150, 255],
    green: [0, 255, 102],
    lime: [170, 255, 60],
    amber: [255, 176, 0],
    orange: [255, 140, 50],
    red: [235, 55, 55],
    pink: [255, 85, 200],
    purple: [175, 120, 255],
    gold: [235, 205, 120],
    white: [225, 230, 235]
};

/** "#0f8", "#00ff88", "0,255,136", "rgb(0 255 136)" or a preset name -> [r,g,b] | null */
export function parseColor(input) {
    const s = String(input || "").trim().toLowerCase();
    if (ACCENTS[s]) return ACCENTS[s].slice();
    let m = /^#?([0-9a-f]{3})$/.exec(s);
    if (m) return m[1].split("").map(c => parseInt(c + c, 16));
    m = /^#?([0-9a-f]{6})$/.exec(s);
    if (m) return [0, 2, 4].map(i => parseInt(m[1].slice(i, i + 2), 16));
    m = /^(?:rgb\()?\s*(\d{1,3})[\s,]+(\d{1,3})[\s,]+(\d{1,3})\s*\)?$/.exec(s);
    if (m) {
        const rgb = m.slice(1, 4).map(Number);
        if (rgb.every(v => v <= 255)) return rgb;
    }
    return null;
}

export const toHex = rgb => "#" + rgb.map(v => v.toString(16).padStart(2, "0")).join("");
