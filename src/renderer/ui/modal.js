import { h } from "../lib/util.js";
import { audio } from "../core/audio.js";
import { bus } from "../core/store.js";

const layer = () => document.getElementById("layer-modals");
const stack = [];
let z = 10;

export class Modal {
    /**
     * @param {{title:string, body?:Node|string, buttons?:{label:string, action?:Function, primary?:boolean, keep?:boolean}[],
     *          type?:"info"|"warn"|"error"|"custom", className?:string, width?:string, onClose?:Function, sound?:string}} opts
     */
    constructor({ title, body = "", buttons = [], type = "custom", className = "", width, onClose, sound } = {}) {
        this.onClose = onClose;
        this.content = h("div.modal-content");
        if (typeof body === "string") this.content.innerHTML = body;
        else if (body) this.content.append(body);

        this.footer = h("div.modal-buttons");
        for (const b of buttons) {
            const btn = h(`button${b.primary ? ".primary" : ""}`, b.label);
            btn.addEventListener("click", async () => {
                if (b.action) await b.action(this);
                if (!b.keep) this.close();
            });
            this.footer.append(btn);
        }
        if (!buttons.some(b => b.label === "Close")) {
            this.footer.append(h("button", { onclick: () => this.close() }, "Close"));
        }

        const header = h("header.modal-header", h("h1", title), h("button.modal-x", { title: "Close (Esc)", onclick: () => this.close() }, "×"));
        this.el = h(`section.modal.${type}${className ? "." + className.split(" ").join(".") : ""}`, header, this.content, this.footer);
        if (width) this.el.style.width = width;
        this.el.style.zIndex = ++z;
        this._drag(header);
        this.el.addEventListener("mousedown", () => { this.el.style.zIndex = ++z; });
        layer().append(this.el);
        stack.push(this);
        audio.play(sound || (type === "error" ? "error" : type === "warn" ? "alarm" : "info"));
        bus.emit("modal-open", this);
    }

    _drag(handle) {
        handle.addEventListener("mousedown", e => {
            if (e.target.closest("button")) return;
            const r = this.el.getBoundingClientRect();
            const ox = e.clientX - r.left, oy = e.clientY - r.top;
            const move = ev => {
                this.el.style.left = Math.max(0, Math.min(innerWidth - 60, ev.clientX - ox)) + "px";
                this.el.style.top = Math.max(0, Math.min(innerHeight - 40, ev.clientY - oy)) + "px";
                this.el.style.transform = "none";
            };
            const up = () => {
                removeEventListener("mousemove", move);
                removeEventListener("mouseup", up);
            };
            addEventListener("mousemove", move);
            addEventListener("mouseup", up);
        });
    }

    close() {
        if (this.closed) return;
        if (this.beforeClose && this.beforeClose() === false) return;
        this.closed = true;
        this.el.classList.add("closing");
        setTimeout(() => this.el.remove(), 150);
        stack.splice(stack.indexOf(this), 1);
        if (this.onClose) this.onClose();
        if (!stack.length) bus.emit("modals-empty");
    }

    static top() {
        return stack[stack.length - 1] || null;
    }

    static closeTop() {
        const m = Modal.top();
        if (m) m.close();
        return !!m;
    }

    static get open() {
        return stack.length > 0;
    }
}

export function confirmModal(title, message, { okLabel = "Confirm", type = "warn" } = {}) {
    return new Promise(resolve => {
        let answered = false;
        new Modal({
            title, type,
            body: h("p", message),
            buttons: [
                { label: okLabel, primary: true, action: () => { answered = true; resolve(true); } },
                { label: "Cancel", action: () => { answered = true; resolve(false); } }
            ],
            onClose: () => { if (!answered) resolve(false); }
        });
    });
}

export function toast(text, type = "info", ms = 3500) {
    const el = h(`div.toast.${type}`, text);
    document.getElementById("layer-toasts").append(el);
    if (type === "error") audio.play("error");
    else if (type === "warn") audio.play("denied");
    requestAnimationFrame(() => el.classList.add("in"));
    setTimeout(() => {
        el.classList.remove("in");
        setTimeout(() => el.remove(), 300);
    }, ms);
}

bus.on("toast", ({ text, type, ms }) => toast(text, type, ms));
