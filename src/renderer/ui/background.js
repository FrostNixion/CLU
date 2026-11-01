import { themes } from "../core/theme.js";

// Background designs drawn behind the whole UI. Static ones are SVG/CSS patterns
// tinted with the current accent; "rain" is a low-fps canvas animation.

const svgUrl = svg => `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;

const STATIC = {
    grid: rgb => ({
        backgroundImage: `linear-gradient(rgba(${rgb},.06) 1px, transparent 1px), linear-gradient(90deg, rgba(${rgb},.06) 1px, transparent 1px)`,
        backgroundSize: "4vh 4vh"
    }),
    dots: rgb => ({
        backgroundImage: `radial-gradient(rgba(${rgb},.22) 1px, transparent 1.5px)`,
        backgroundSize: "2.6vh 2.6vh"
    }),
    hex: rgb => ({
        backgroundImage: svgUrl(`<svg xmlns="http://www.w3.org/2000/svg" width="56" height="97" viewBox="0 0 56 97"><path d="M28 0 56 16v32L28 64 0 48V16zM28 64v33" fill="none" stroke="rgb(${rgb})" stroke-opacity=".09" stroke-width="1"/></svg>`),
        backgroundSize: "3.4vh 5.9vh"
    }),
    circuit: rgb => ({
        backgroundImage: svgUrl(`<svg xmlns="http://www.w3.org/2000/svg" width="120" height="120" viewBox="0 0 120 120"><g fill="none" stroke="rgb(${rgb})" stroke-opacity=".1" stroke-width="1"><path d="M0 20h30l10 10v30h40l10-10h30M60 0v20l10 10M20 120V90l10-10h30M120 80H95l-10 10v30M0 70h15"/></g><g fill="rgb(${rgb})" fill-opacity=".18"><circle cx="40" cy="60" r="2"/><circle cx="70" cy="30" r="2"/><circle cx="60" cy="80" r="2"/><circle cx="85" cy="90" r="2"/><circle cx="15" cy="70" r="2"/></g></svg>`),
        backgroundSize: "12vh 12vh"
    }),
    scanlines: rgb => ({
        backgroundImage: `repeating-linear-gradient(0deg, rgba(${rgb},.045) 0 1px, transparent 1px 4px), radial-gradient(ellipse at center, rgba(${rgb},.06), transparent 70%)`,
        backgroundSize: "auto, auto"
    }),
    none: () => ({ backgroundImage: "none" })
};

export const BACKGROUNDS = {
    grid: "Faint square grid (default)",
    dots: "Dot lattice",
    hex: "Hexagon mesh",
    circuit: "Circuit board traces",
    scanlines: "CRT scanlines",
    rain: "Animated digital rain",
    none: "Solid color"
};

class Background {
    constructor() {
        this.el = document.createElement("div");
        this.el.id = "bg";
        document.body.prepend(this.el);
        this.name = "grid";
        this.raf = null;
        themes.on("change", () => this.apply(this.name));
    }

    apply(name) {
        this.name = BACKGROUNDS[name] ? name : "grid";
        this._stopRain();
        this.el.replaceChildren();
        this.el.removeAttribute("style");
        const rgb = themes.current ? themes.current.rgb.join(",") : "170,207,209";
        if (this.name === "rain") return this._startRain(rgb);
        Object.assign(this.el.style, STATIC[this.name](rgb));
    }

    _startRain(rgb) {
        const canvas = document.createElement("canvas");
        this.el.append(canvas);
        const ctx = canvas.getContext("2d");
        const glyphs = "アイウエオカキクケコサシスセソタチツテトナニヌネノ0123456789ABCDEF<>/\\|=+*";
        let cols = [], size = 16, last = 0;
        const resize = () => {
            canvas.width = innerWidth;
            canvas.height = innerHeight;
            size = Math.max(12, Math.round(innerHeight / 60));
            cols = Array.from({ length: Math.ceil(canvas.width / size) }, () => Math.random() * -50);
            ctx.fillStyle = themes.current ? themes.current.colors.black : "#000";
            ctx.fillRect(0, 0, canvas.width, canvas.height);
        };
        resize();
        this._onResize = resize;
        addEventListener("resize", resize);
        const frame = t => {
            this.raf = requestAnimationFrame(frame);
            if (t - last < 66) return; // ~15 fps keeps it a background, not a CPU hog
            last = t;
            const black = themes.current ? themes.current.colors.black : "#000";
            ctx.globalAlpha = 0.12;
            ctx.fillStyle = black;
            ctx.fillRect(0, 0, canvas.width, canvas.height);
            ctx.globalAlpha = 1;
            ctx.font = `${size}px "Fira Code", monospace`;
            ctx.fillStyle = `rgba(${rgb},.35)`;
            for (let i = 0; i < cols.length; i++) {
                const y = cols[i] * size;
                if (y > 0) ctx.fillText(glyphs[(Math.random() * glyphs.length) | 0], i * size, y);
                cols[i] = y > canvas.height && Math.random() > 0.975 ? 0 : cols[i] + 1;
            }
        };
        this.raf = requestAnimationFrame(frame);
    }

    _stopRain() {
        if (this.raf) cancelAnimationFrame(this.raf);
        this.raf = null;
        if (this._onResize) removeEventListener("resize", this._onResize);
        this._onResize = null;
    }
}

export const background = new Background();
