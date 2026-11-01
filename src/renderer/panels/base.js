import { h } from "../lib/util.js";
import { themes } from "../core/theme.js";

export class Panel {
    constructor(column, { id, title, sub = "" }) {
        this.subEl = h("p.sub", sub);
        this.body = h("div.panel-body");
        this.el = h(`div.panel#panel-${id}`, h("h3.title", h("p", title), this.subEl), this.body);
        column.append(this.el);
        this._stops = [];
    }

    set sub(text) {
        this.subEl.textContent = text;
    }

    track(stop) {
        this._stops.push(stop);
        return stop;
    }

    destroy() {
        this._stops.forEach(s => s());
        this.el.remove();
    }
}

/** Key/value cell used across panels: small caption over a value. */
export function stat(label, value = "--") {
    const v = h("span.stat-value", value);
    const el = h("div.stat", h("span.stat-label", label), v);
    return { el, set: text => { if (v.textContent !== String(text)) v.textContent = text; } };
}

/**
 * Minimal, allocation-free scrolling line graph on a canvas.
 * Each series is a ring buffer; redraws only when data is pushed.
 */
export class LineGraph {
    constructor(parent, { points = 60, series = 1, max = 100, autoscale = false, fill = true, height = "6vh", styles = [] } = {}) {
        this.canvas = h("canvas.graph");
        this.canvas.style.height = height;
        parent.append(this.canvas);
        this.ctx = this.canvas.getContext("2d");
        this.points = points;
        this.max = max;
        this.autoscale = autoscale;
        this.fill = fill;
        this.styles = styles;
        this.data = Array.from({ length: series }, () => new Float32Array(points));
        this.head = 0;
        this._ro = new ResizeObserver(() => this._resize());
        this._ro.observe(this.canvas);
        this._unsub = themes.on("change", () => this.draw());
    }

    _resize() {
        const dpr = window.devicePixelRatio || 1;
        const w = Math.round(this.canvas.clientWidth * dpr);
        const hgt = Math.round(this.canvas.clientHeight * dpr);
        if (w && hgt && (this.canvas.width !== w || this.canvas.height !== hgt)) {
            this.canvas.width = w;
            this.canvas.height = hgt;
            this.draw();
        }
    }

    push(...values) {
        this.head = (this.head + 1) % this.points;
        values.forEach((v, i) => { if (this.data[i]) this.data[i][this.head] = Number.isFinite(v) ? v : 0; });
        this.draw();
    }

    draw() {
        const { ctx, canvas } = this;
        const W = canvas.width, H = canvas.height;
        if (!W || !H || !themes.current) return;
        const [r, g, b] = themes.current.rgb;
        ctx.clearRect(0, 0, W, H);

        // grid
        ctx.strokeStyle = `rgba(${r},${g},${b},0.08)`;
        ctx.lineWidth = 1;
        ctx.beginPath();
        for (let i = 1; i < 4; i++) {
            const y = Math.round(H * i / 4) + 0.5;
            ctx.moveTo(0, y); ctx.lineTo(W, y);
        }
        for (let i = 1; i < 10; i++) {
            const x = Math.round(W * i / 10) + 0.5;
            ctx.moveTo(x, 0); ctx.lineTo(x, H);
        }
        ctx.stroke();

        let max = this.max;
        if (this.autoscale) {
            max = 1;
            for (const s of this.data) for (const v of s) if (v > max) max = v;
            max *= 1.15;
        }
        const step = W / (this.points - 1);
        const dpr = window.devicePixelRatio || 1;
        this.data.forEach((series, si) => {
            const style = this.styles[si] || {};
            const alpha = style.alpha ?? 1;
            ctx.beginPath();
            for (let i = 0; i < this.points; i++) {
                const v = series[(this.head + 1 + i) % this.points];
                const x = i * step;
                const y = H - (Math.min(v, max) / max) * (H - 2 * dpr) - dpr;
                i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
            }
            ctx.strokeStyle = `rgba(${r},${g},${b},${alpha})`;
            ctx.lineWidth = (style.width || 1.5) * dpr;
            if (style.dash) ctx.setLineDash(style.dash.map(d => d * dpr)); else ctx.setLineDash([]);
            ctx.stroke();
            if (this.fill && style.fill !== false) {
                ctx.lineTo(W, H);
                ctx.lineTo(0, H);
                ctx.closePath();
                ctx.fillStyle = `rgba(${r},${g},${b},${0.12 * alpha})`;
                ctx.fill();
            }
        });
        ctx.setLineDash([]);
    }

    destroy() {
        this._ro.disconnect();
        this._unsub();
    }
}
