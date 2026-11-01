import { h, esc } from "../lib/util.js";
import { store } from "../core/store.js";
import { audio } from "../core/audio.js";
import { Modal, toast } from "./modal.js";

const OUTPUT_TAIL_LINES = 150;

let panel = null;
let seq = 0;

/** What Claude needs to give commands that actually work here. */
function buildContext(session, block) {
    const info = store.info;
    const lines = [
        `os: ${info.osVersion} (${info.platform} ${info.release})`,
        `shell: ${session ? `${session.kind} (${session.shell})` : "unknown"}`,
        `cwd: ${session ? session.cwd : "unknown"}`
    ];
    if (block) {
        let out = session.blocks.output(block).split("\n");
        const cut = out.length > OUTPUT_TAIL_LINES;
        if (cut) out = out.slice(-OUTPUT_TAIL_LINES);
        lines.push(`last command: ${block.cmd}`, `exit: ${block.ok ? "success" : `failed (code ${block.code})`}`,
            `output${cut ? ` (last ${OUTPUT_TAIL_LINES} lines)` : ""}:\n${out.join("\n")}`);
    }
    return lines.join("\n");
}

/** Small, safe Markdown subset: fenced code (with actions), inline code, bold, lists, paragraphs. */
function renderMarkdown(text, onCode) {
    const root = h("div.ai-md");
    const parts = text.split(/```/);
    parts.forEach((part, i) => {
        if (i % 2 === 1) {
            const nl = part.indexOf("\n");
            const lang = nl >= 0 ? part.slice(0, nl).trim() : "";
            const code = (nl >= 0 ? part.slice(nl + 1) : part).replace(/\n$/, "");
            const done = i < parts.length - 1; // closing fence already streamed
            root.append(onCode(code, lang, done));
            return;
        }
        for (const para of part.split(/\n{2,}/)) {
            if (!para.trim()) continue;
            const html = esc(para)
                .replace(/`([^`\n]+)`/g, "<code>$1</code>")
                .replace(/\*\*([^*\n]+)\*\*/g, "<strong>$1</strong>")
                .replace(/^#{1,6} (.*)$/gm, "<strong>$1</strong>")
                .replace(/^\s*[-*] (.*)$/gm, "• $1")
                .replace(/\n/g, "<br>");
            root.append(h("p", { html }));
        }
    });
    return root;
}

class AssistantPanel {
    constructor(getSession) {
        this.getSession = getSession;
        this.messages = [];
        this.busy = null;
        this.log = h("div.ai-log");
        this.input = h("textarea.ai-input", { rows: 2, placeholder: "Ask anything about your terminal... (Enter to send, Shift+Enter for a new line)", spellcheck: "false" });
        this.sendBtn = h("button.ai-send", { onclick: () => this.submit() }, "SEND");
        this.status = h("span.ai-status", "");
        const body = h("div.ai", this.log, h("div.ai-compose", this.input, this.sendBtn), h("div.ai-foot", this.status,
            h("button.mini", { onclick: () => this.reset() }, "NEW CHAT"),
            h("button.mini", { onclick: () => openKeyDialog() }, "API KEY")));
        this.input.addEventListener("keydown", e => {
            e.stopPropagation();
            if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); this.submit(); }
            if (e.key === "Escape") this.modal.close();
        });
        this.modal = new Modal({
            title: "CLU AI · Claude", className: "ai-modal", body, sound: "scan",
            buttons: [],
            onClose: () => { if (this.busy) window.clu.ai.cancel(this.busy.id); panel = null; }
        });
        this.unsub = window.clu.ai.onDelta((id, text) => {
            if (!this.busy || this.busy.id !== id) return;
            this.busy.text += text;
            this._scheduleRender();
        });
        const prevClose = this.modal.onClose;
        this.modal.onClose = () => { this.unsub(); prevClose(); };
        this._greet();
    }

    async _greet() {
        const st = await window.clu.ai.status().catch(() => null);
        if (st && !st.hasStoredKey && !st.envKey) {
            this.log.append(h("div.ai-note", "No API key yet. Click API KEY (or run ", h("code", "clu ai key"), ") and paste a key from console.anthropic.com."));
        }
        this.status.textContent = st ? st.model : "";
        setTimeout(() => this.input.focus(), 50);
    }

    reset() {
        if (this.busy) window.clu.ai.cancel(this.busy.id);
        this.messages = [];
        this.log.replaceChildren();
        this.input.focus();
    }

    _codeBlock(code, lang, done) {
        const session = this.getSession();
        const runnable = done && session && /^(powershell|pwsh|ps1?|cmd|bat|bash|sh|zsh|shell|console)?$/i.test(lang);
        const send = enter => {
            const s = this.getSession();
            if (!s) return toast("No terminal to run in", "warn");
            if (code.includes("\n")) s.term.paste(code); else s.write(code);
            if (enter) s.write("\r");
            audio.play(enter ? "granted" : "stdin");
            if (enter) this.modal.close();
            else s.focus();
        };
        return h("div.ai-code",
            h("div.ai-code-bar", h("span", lang || "code"),
                runnable ? h("button.mini", { onclick: () => send(true), title: "Run in the active terminal" }, "▶ RUN") : null,
                runnable ? h("button.mini", { onclick: () => send(false), title: "Type into the terminal without running" }, "INSERT") : null,
                done ? h("button.mini", { onclick: () => window.clu.clipboard.write(code).then(() => toast("Copied", "info", 1200)) }, "COPY") : null),
            h("pre", code));
    }

    _scheduleRender() {
        if (this._raf) return;
        this._raf = requestAnimationFrame(() => {
            this._raf = null;
            if (!this.busy) return;
            this.busy.el.replaceChildren(renderMarkdown(this.busy.text, (c, l, d) => this._codeBlock(c, l, d)));
            this.log.scrollTop = this.log.scrollHeight;
        });
    }

    _bubble(role, content) {
        const el = h(`div.ai-msg.${role}`);
        if (role === "user") el.append(h("div.ai-user-text", content));
        else el.append(renderMarkdown(content, (c, l, d) => this._codeBlock(c, l, d)));
        this.log.append(el);
        this.log.scrollTop = this.log.scrollHeight;
        return el;
    }

    async submit(text = this.input.value, { block } = {}) {
        text = String(text || "").trim();
        if (!text || this.busy) return;
        this.input.value = "";
        const session = this.getSession();
        const context = buildContext(session, block || (this.messages.length ? null : session && session.blocks.last));
        this.messages.push({ role: "user", content: text });
        this._bubble("user", block ? `${text}\n› ${block.cmd}` : text);
        const el = this._bubble("assistant", "");
        el.classList.add("streaming");
        const id = ++seq;
        this.busy = { id, el, text: "" };
        this.sendBtn.textContent = "STOP";
        this.sendBtn.onclick = () => window.clu.ai.cancel(id);
        this.status.textContent = "thinking...";
        audio.play("scan");
        let res;
        try {
            res = await window.clu.ai.ask(id, { messages: this.messages, context });
        } catch (e) {
            res = { ok: false, error: e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, "") };
        }
        const answer = this.busy.text;
        this.busy = null;
        el.classList.remove("streaming");
        this.sendBtn.textContent = "SEND";
        this.sendBtn.onclick = () => this.submit();
        if (answer) {
            this.messages.push({ role: "assistant", content: answer });
            el.replaceChildren(renderMarkdown(answer, (c, l, d) => this._codeBlock(c, l, true)));
        }
        if (!res.ok && !res.aborted) {
            el.append(h("div.ai-error", res.error || "Request failed"));
            audio.play("denied");
            if (!answer) this.messages.pop(); // let the user retry the same question
        } else if (res.ok) {
            audio.play("info");
        }
        this.status.textContent = res.usage ? `${res.model} · ${res.usage.in}+${res.usage.cached || 0} cached in / ${res.usage.out} out` : "";
        this.log.scrollTop = this.log.scrollHeight;
        this.input.focus();
    }
}

export function openAssistant(getSession, { prompt, block } = {}) {
    if (!panel) panel = new AssistantPanel(getSession);
    else panel.input.focus();
    if (prompt) panel.submit(prompt, { block });
    return panel;
}

/** Explain a (usually failed) command block. */
export function explainBlock(getSession, block) {
    const text = block.ok ? "Explain what this command did and what its output means." : "This command failed. Explain why, and give me the fix.";
    openAssistant(getSession, { prompt: text, block });
}

export function openKeyDialog() {
    const input = h("input.pw-input", { type: "password", placeholder: "sk-ant-...", autocomplete: "off", spellcheck: "false" });
    const msg = h("p.pw-msg");
    const body = h("div.settings-grid",
        h("p.dim", "Paste an Anthropic API key (console.anthropic.com → API keys). It is stored encrypted with Windows' data protection and only used from CLU's main process."),
        h("label.settings-row", h("div.settings-label", h("span", "API key")), h("div.settings-input", input)), msg);
    const save = async () => {
        try {
            await window.clu.ai.setKey(input.value);
            toast(input.value.trim() ? "API key saved" : "API key removed", "info");
            audio.play("granted");
            modal.close();
        } catch (e) {
            msg.textContent = e.message.replace(/^.*Error: /, "");
            msg.className = "pw-msg bad";
            audio.play("denied");
        }
    };
    body.addEventListener("keydown", e => { e.stopPropagation(); if (e.key === "Enter") save(); });
    const modal = new Modal({
        title: "Claude API key", className: "settings-modal", body,
        buttons: [{ label: "Save", primary: true, keep: true, action: save }, { label: "Remove key", keep: true, action: () => { input.value = ""; save(); } }]
    });
    setTimeout(() => input.focus(), 50);
}
