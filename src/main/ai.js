"use strict";
// CLU AI assistant: streams Claude's answers to the renderer. The API key is kept
// encrypted with the OS keychain (safeStorage / DPAPI on Windows) and never leaves
// the main process; without a stored key the SDK's own credential resolution
// (ANTHROPIC_API_KEY, `ant auth login` profile, ...) is used.
const fs = require("fs");
const path = require("path");
const { safeStorage } = require("electron");
const AnthropicModule = require("@anthropic-ai/sdk");
const Anthropic = AnthropicModule.default || AnthropicModule;

const MODEL = "claude-opus-5-5";

// Kept byte-stable so it is served from the prompt cache; per-request context goes in the user turn.
const SYSTEM = `You are the assistant built into CLU, a sci-fi terminal desktop environment.
The user is working in a real shell inside CLU and asks you how to get things done.

How to answer:
- Be brief and practical. Lead with the answer; no preamble.
- Write commands for the user's actual shell and OS (given in the context block). On Windows PowerShell, use PowerShell idioms, not bash.
- Put every command the user might run in its own fenced code block tagged with the shell language (powershell, cmd, bash). CLU shows Run / Insert / Copy buttons on those blocks, so keep each block directly runnable: no prompts, no placeholders without saying so, no output mixed in.
- If a command deletes, overwrites, or changes system state, say so in one short line before it.
- When explaining a failed command, say what went wrong in plain words, then give the fix.
- Never invent file paths or outputs you cannot see. If you need more information, ask one short question.
- Reply in the language the user writes in.`;

class Assistant {
    constructor(dir) {
        this.file = path.join(dir, "ai.json");
        this.streams = new Map();
    }

    _read() {
        try { return JSON.parse(fs.readFileSync(this.file, "utf-8")); } catch (e) { return {}; }
    }

    _key() {
        const data = this._read();
        if (!data.key) return null;
        try {
            return data.encrypted ? safeStorage.decryptString(Buffer.from(data.key, "base64")) : Buffer.from(data.key, "base64").toString("utf-8");
        } catch (e) {
            return null;
        }
    }

    status() {
        return { hasStoredKey: !!this._key(), envKey: !!process.env.ANTHROPIC_API_KEY, model: MODEL, encryption: safeStorage.isEncryptionAvailable() };
    }

    setKey(key) {
        key = String(key || "").trim();
        if (!key) {
            try { fs.unlinkSync(this.file); } catch (e) { /* none */ }
            return this.status();
        }
        if (!/^sk-ant-[\w-]{10,}$/.test(key)) throw new Error("That does not look like an Anthropic API key (sk-ant-...)");
        const encrypted = safeStorage.isEncryptionAvailable();
        const blob = encrypted ? safeStorage.encryptString(key) : Buffer.from(key, "utf-8");
        fs.writeFileSync(this.file, JSON.stringify({ encrypted, key: blob.toString("base64") }), { mode: 0o600 });
        return this.status();
    }

    _client() {
        const key = this._key();
        return new Anthropic(key ? { apiKey: key } : {});
    }

    /**
     * Stream an answer. `messages` is the conversation (user/assistant text turns);
     * `context` describes the user's shell and is prepended to the latest user turn.
     */
    async ask(id, { messages, context }, send) {
        const turns = (messages || []).map(m => ({ role: m.role === "assistant" ? "assistant" : "user", content: String(m.content || "") }));
        if (!turns.length || turns[turns.length - 1].role !== "user") throw new Error("nothing to ask");
        if (context) turns[turns.length - 1].content = `<context>\n${context}\n</context>\n\n${turns[turns.length - 1].content}`;

        let stream;
        try {
            stream = this._client().beta.messages.stream({
                model: MODEL,
                max_tokens: 64000,
                // Terminal help is chat-like: low effort keeps answers fast; thinking stays adaptive.
                output_config: { effort: "low" },
                // On a safety decline, the API re-runs the request on a fallback model.
                betas: ["server-side-fallback-2026-07-01"],
                fallbacks: "default",
                cache_control: { type: "ephemeral" },
                system: SYSTEM,
                messages: turns
            });
        } catch (e) {
            throw new Error(friendlyError(e));
        }
        this.streams.set(id, stream);
        stream.on("text", text => send("ai:delta", id, text));
        try {
            const msg = await stream.finalMessage();
            if (msg.stop_reason === "refusal") {
                const why = msg.stop_details && msg.stop_details.explanation;
                return { ok: false, error: `The request was declined${why ? ": " + why : "."}` };
            }
            return { ok: true, stop: msg.stop_reason, model: msg.model, usage: msg.usage && { in: msg.usage.input_tokens, out: msg.usage.output_tokens, cached: msg.usage.cache_read_input_tokens } };
        } catch (e) {
            if (stream.aborted || (e && e.name === "APIUserAbortError")) return { ok: false, aborted: true };
            return { ok: false, error: friendlyError(e) };
        } finally {
            this.streams.delete(id);
        }
    }

    cancel(id) {
        const s = this.streams.get(id);
        if (s) s.abort();
    }
}

function friendlyError(e) {
    if (e instanceof Anthropic.AuthenticationError) return "API key missing or invalid. Set one with: clu ai key";
    if (e instanceof Anthropic.PermissionDeniedError) return "This API key is not allowed to use the model.";
    if (e instanceof Anthropic.RateLimitError) return "Rate limited by the API. Try again in a moment.";
    if (e instanceof Anthropic.APIConnectionError) return "Could not reach the Anthropic API (network).";
    if (e instanceof Anthropic.APIError) return `API error ${e.status ?? ""}: ${e.message}`;
    const msg = String((e && e.message) || e);
    if (/authentication|api key|apiKey|credentials/i.test(msg)) return "No API key found. Set one with: clu ai key";
    return msg;
}

module.exports = { Assistant, MODEL };
