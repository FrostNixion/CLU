import { h, delay } from "../lib/util.js";
import { audio } from "../core/audio.js";
import { store } from "../core/store.js";

let active = null;

export const isLocked = () => !!active;

/**
 * Full-screen authorization gate. Resolves once the main process accepts the password.
 * Works with the physical keyboard (any characters) or the on-screen keypad (digits).
 */
export function showLock() {
    if (active) return active.promise;
    let resolveFn;
    const promise = new Promise(r => { resolveFn = r; });

    const input = h("input.lock-input", { type: "password", autocomplete: "off", spellcheck: "false", "aria-label": "Password" });
    const slots = h("div.lock-slots");
    const status = h("div.lock-status", "ENTER PASSWORD");
    const pad = h("div.lock-pad", ...["1", "2", "3", "4", "5", "6", "7", "8", "9", "⌫", "0", "⏎"].map(k =>
        h(`button.lock-key${k === "⏎" ? ".enter" : ""}`, {
            onmousedown: e => { e.preventDefault(); press(k); }
        }, k)));
    const box = h("div.lock-box",
        h("div.lock-ring", h("div.lock-ring-inner"), h("span.lock-logo", "CLU")),
        h("h2.lock-title", "AUTHORIZATION REQUIRED"),
        h("div.lock-user", `${(store.get("username") || store.info.username || "user").toUpperCase()}@${(store.info.hostname || "").toUpperCase()}`),
        slots, status, pad,
        h("div.lock-hint", "type your password and press Enter"),
        input);
    const el = h("section#lock", box);
    document.body.append(el);
    requestAnimationFrame(() => el.classList.add("in"));

    let busy = false, cooldown = null;

    const renderSlots = () => {
        const n = Math.max(4, input.value.length);
        slots.replaceChildren(...Array.from({ length: n }, (_, i) => h(`span.lock-slot${i < input.value.length ? ".filled" : ""}`)));
    };
    const setStatus = (text, cls = "") => {
        status.textContent = text;
        status.className = `lock-status ${cls}`;
    };
    const startCooldown = ms => {
        clearInterval(cooldown);
        const until = Date.now() + ms;
        box.classList.add("cooldown");
        const tick = () => {
            const left = Math.ceil((until - Date.now()) / 1000);
            if (left <= 0) {
                clearInterval(cooldown);
                box.classList.remove("cooldown");
                setStatus("ENTER PASSWORD");
                return;
            }
            setStatus(`LOCKED OUT · RETRY IN ${left}s`, "bad");
        };
        tick();
        cooldown = setInterval(tick, 250);
    };

    const submit = async () => {
        if (busy || box.classList.contains("cooldown") || !input.value) return;
        busy = true;
        setStatus("VERIFYING...", "busy");
        audio.play("scan");
        const r = await window.clu.lock.verify(input.value);
        await delay(350);
        busy = false;
        if (r.ok) {
            setStatus("ACCESS GRANTED", "good");
            box.classList.add("granted");
            audio.play("granted");
            clearInterval(cooldown);
            await delay(700);
            el.classList.add("out");
            await delay(350);
            el.remove();
            active = null;
            resolveFn();
            return;
        }
        input.value = "";
        renderSlots();
        audio.play("denied");
        box.classList.remove("shake");
        void box.offsetWidth;
        box.classList.add("shake");
        if (r.waitMs > 0) startCooldown(r.waitMs);
        else setStatus(`ACCESS DENIED${r.failures ? ` · ${r.failures}/5` : ""}`, "bad");
    };

    const press = k => {
        if (box.classList.contains("cooldown")) return;
        if (k === "⏎") return submit();
        audio.play("stdin");
        if (k === "⌫") input.value = input.value.slice(0, -1);
        else if (input.value.length < 64) input.value += k;
        renderSlots();
        input.focus();
    };

    input.addEventListener("input", () => { audio.play("stdin"); renderSlots(); });
    input.addEventListener("keydown", e => {
        e.stopPropagation();
        if (e.key === "Enter") { e.preventDefault(); submit(); }
        if (e.key === "Escape") { input.value = ""; renderSlots(); }
    });
    // Keep focus in the field no matter where the user clicks.
    el.addEventListener("mousedown", e => { if (e.target !== input) { e.preventDefault(); input.focus(); } });
    window.clu.lock.status().then(s => { if (s.waitMs > 0) startCooldown(s.waitMs); });

    renderSlots();
    setTimeout(() => input.focus(), 50);
    audio.play("alarm");
    active = { promise };
    return promise;
}

/** Lock now (e.g. `clu lock`); resolves when unlocked again. */
export async function lockNow() {
    const s = await window.clu.lock.lock();
    if (!s.enabled) return false;
    await showLock();
    return true;
}
