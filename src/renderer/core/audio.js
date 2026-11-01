// Sound effects are synthesized with WebAudio at runtime: no sample files to ship.
// The palette is cinematic rather than "game": filtered noise, detuned saw pads,
// FM bells and sub drops, all sent through a shared synthetic reverb.

class AudioFX {
    constructor() {
        this.ctx = null;
        this.master = null;
        this.enabled = true;
        this.feedback = true;
        this.volume = 0.4;
        this.last = {};
        this.noiseBuf = null;
    }

    configure({ audio, audioVolume, feedbackAudio }) {
        this.enabled = audio !== false;
        this.feedback = feedbackAudio !== false;
        this.volume = Math.max(0, Math.min(1, Number(audioVolume ?? 0.4)));
        if (this.master) this.master.gain.value = this.volume;
    }

    _ensure() {
        if (!this.ctx) {
            const ctx = this.ctx = new AudioContext({ latencyHint: "interactive" });
            this.master = ctx.createGain();
            this.master.gain.value = this.volume;
            const comp = ctx.createDynamicsCompressor();
            comp.threshold.value = -18;
            comp.ratio.value = 4;
            this.master.connect(comp).connect(ctx.destination);

            const len = ctx.sampleRate * 2;
            this.noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
            const d = this.noiseBuf.getChannelData(0);
            for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;

            // Synthetic hall: exponentially decaying stereo noise impulse.
            this.reverb = ctx.createConvolver();
            const irLen = Math.floor(ctx.sampleRate * 2.8);
            const ir = ctx.createBuffer(2, irLen, ctx.sampleRate);
            for (let ch = 0; ch < 2; ch++) {
                const data = ir.getChannelData(ch);
                for (let i = 0; i < irLen; i++) data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / irLen, 3.2);
            }
            this.reverb.buffer = ir;
            this.reverbIn = ctx.createGain();
            this.reverbIn.gain.value = 0.5;
            const tone = ctx.createBiquadFilter();
            tone.type = "lowpass";
            tone.frequency.value = 5000;
            this.reverbIn.connect(this.reverb).connect(tone).connect(this.master);

            // Soft saturation for the heavier sounds.
            this.drive = ctx.createWaveShaper();
            const curve = new Float32Array(1024);
            for (let i = 0; i < 1024; i++) { const x = i / 512 - 1; curve[i] = Math.tanh(x * 2.5); }
            this.drive.curve = curve;
            this.drive.connect(this.master);
            this.drive.connect(this.reverbIn);
        }
        if (this.ctx.state === "suspended") this.ctx.resume();
        return this.ctx;
    }

    /** Output stage: dry to master plus a reverb send. */
    _out(node, wet = 0.3, { drive = false } = {}) {
        if (drive) { node.connect(this.drive); return; }
        node.connect(this.master);
        if (wet > 0) {
            const send = this.ctx.createGain();
            send.gain.value = wet;
            node.connect(send).connect(this.reverbIn);
        }
    }

    _env(g, t, { attack = 0.005, peak = 0.3, dur = 0.2, curve = "exp" }) {
        g.gain.setValueAtTime(0.0001, t);
        g.gain.linearRampToValueAtTime(peak, t + attack);
        if (curve === "exp") g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
        else g.gain.linearRampToValueAtTime(0.0001, t + dur);
    }

    /** Oscillator voice, optionally detuned/unison and through a (swept) filter. */
    _voice({ type = "sine", freq = 440, to = null, glide = null, start = 0, dur = 0.2, gain = 0.2, attack = 0.005,
        detune = 0, voices = 1, filter = null, wet = 0.3, drive = false, curve = "exp" }) {
        const ctx = this.ctx, t = ctx.currentTime + start;
        const g = ctx.createGain();
        this._env(g, t, { attack, peak: gain / Math.sqrt(voices), dur, curve });
        let head = g;
        if (filter) {
            const f = ctx.createBiquadFilter();
            f.type = filter.type || "lowpass";
            f.Q.value = filter.q ?? 1;
            f.frequency.setValueAtTime(filter.from, t);
            if (filter.to) f.frequency.exponentialRampToValueAtTime(filter.to, t + (filter.time ?? dur));
            g.connect(f);
            head = f;
        }
        for (let v = 0; v < voices; v++) {
            const osc = ctx.createOscillator();
            osc.type = type;
            osc.frequency.setValueAtTime(freq, t);
            if (to) osc.frequency.exponentialRampToValueAtTime(to, t + (glide ?? dur));
            osc.detune.value = voices > 1 ? (v / (voices - 1) - 0.5) * 2 * detune : detune;
            osc.connect(g);
            osc.start(t);
            osc.stop(t + dur + 0.05);
        }
        this._out(head, wet, { drive });
    }

    _noise({ start = 0, dur = 0.1, gain = 0.2, attack = 0.002, type = "bandpass", from = 2000, to = null, q = 1, wet = 0.2, curve = "exp" }) {
        const ctx = this.ctx, t = ctx.currentTime + start;
        const src = ctx.createBufferSource();
        src.buffer = this.noiseBuf;
        const f = ctx.createBiquadFilter();
        f.type = type;
        f.Q.value = q;
        f.frequency.setValueAtTime(from, t);
        if (to) f.frequency.exponentialRampToValueAtTime(to, t + dur);
        const g = ctx.createGain();
        this._env(g, t, { attack, peak: gain, dur, curve });
        src.connect(f).connect(g);
        this._out(g, wet);
        src.start(t, Math.random() * 1.5);
        src.stop(t + dur + 0.05);
    }

    /** Two-operator FM bell: glassy, holographic pings. */
    _bell({ freq = 1200, ratio = 3.5, index = 3, start = 0, dur = 0.8, gain = 0.15, wet = 0.5 }) {
        const ctx = this.ctx, t = ctx.currentTime + start;
        const car = ctx.createOscillator(), mod = ctx.createOscillator();
        const modGain = ctx.createGain(), g = ctx.createGain();
        car.frequency.value = freq;
        mod.frequency.value = freq * ratio;
        modGain.gain.setValueAtTime(freq * index, t);
        modGain.gain.exponentialRampToValueAtTime(freq * 0.05, t + dur);
        mod.connect(modGain).connect(car.frequency);
        car.connect(g);
        this._env(g, t, { attack: 0.002, peak: gain, dur });
        this._out(g, wet);
        car.start(t); mod.start(t);
        car.stop(t + dur + 0.05); mod.stop(t + dur + 0.05);
    }

    play(name, { throttle = 0 } = {}) {
        if (!this.enabled) return;
        const isFeedback = name === "stdout" || name === "stdin";
        if (isFeedback && !this.feedback) return;
        const now = performance.now();
        if (throttle && now - (this.last[name] || 0) < throttle) return;
        this.last[name] = now;
        const fx = SOUNDS[name];
        if (!fx) return;
        try {
            this._ensure();
            fx(this);
        } catch (e) {
            console.warn("[audio]", e);
        }
    }
}

const rnd = (a, b) => a + Math.random() * (b - a);

const SOUNDS = {
    // Data trickling through: a barely-there airy tick.
    stdout: a => a._noise({ dur: 0.03, gain: 0.035, type: "bandpass", from: rnd(7000, 9500), q: 6, wet: 0.05 }),

    // Key press: soft holographic tap, pitch varies so typing never sounds mechanical-repetitive.
    stdin: a => {
        a._noise({ dur: 0.02, gain: 0.07, type: "highpass", from: 3500, wet: 0.05 });
        a._voice({ type: "sine", freq: rnd(1900, 2500), to: rnd(900, 1200), dur: 0.045, gain: 0.05, wet: 0.12 });
    },

    // Keyboard deploying: cascade of digital relays rising in pitch.
    keyboard: a => {
        for (let i = 0; i < 10; i++) {
            a._noise({ start: i * 0.035, dur: 0.03, gain: 0.05, type: "bandpass", from: 1500 + i * 450, q: 8, wet: 0.2 });
            a._voice({ type: "sine", freq: 800 + i * 160, start: i * 0.035, dur: 0.05, gain: 0.025, wet: 0.3 });
        }
    },

    // Panel materializing: filtered noise swell + shimmering FM.
    panels: a => {
        a._noise({ dur: 0.35, attack: 0.12, gain: 0.07, type: "bandpass", from: 600, to: 6000, q: 3, wet: 0.4 });
        a._bell({ freq: rnd(1400, 1800), ratio: 2.01, index: 1.5, start: 0.1, dur: 0.5, gain: 0.04, wet: 0.6 });
    },

    // Main shell opening: whoosh + sub boom + detuned pad blooming open.
    expand: a => {
        a._noise({ dur: 0.9, attack: 0.35, gain: 0.12, type: "lowpass", from: 150, to: 5000, q: 2, wet: 0.5, curve: "lin" });
        a._voice({ type: "sine", freq: 70, to: 32, start: 0.3, dur: 1.4, gain: 0.45, attack: 0.01, wet: 0.1 });
        a._voice({ type: "sawtooth", freq: 110, voices: 3, detune: 14, start: 0.3, dur: 1.8, gain: 0.09, attack: 0.05,
            filter: { from: 200, to: 2400, time: 0.6, q: 4 }, wet: 0.6 });
    },

    // Folder / tab switch: quick two-tone glass chirp.
    folder: a => {
        a._bell({ freq: 1760, ratio: 1.5, index: 1.2, dur: 0.25, gain: 0.05, wet: 0.35 });
        a._voice({ type: "sine", freq: 1200, to: 2400, glide: 0.06, dur: 0.09, gain: 0.03, wet: 0.3 });
    },

    // Access granted: warm Blade Runner-ish chord opening up, with a glassy top.
    granted: a => {
        [220, 277.2, 329.6, 440].forEach((f, i) => a._voice({ type: "sawtooth", freq: f, voices: 2, detune: 9, start: i * 0.03,
            dur: 1.1, attack: 0.04, gain: 0.06, filter: { from: 400, to: 3200, time: 0.5, q: 2 }, wet: 0.6 }));
        a._bell({ freq: 1760, ratio: 3.01, index: 2, start: 0.12, dur: 1.2, gain: 0.05, wet: 0.7 });
    },

    // Access denied: low detuned buzz, two falling pulses.
    denied: a => {
        [0, 0.22].forEach((s, i) => a._voice({ type: "sawtooth", freq: 98 - i * 12, to: 70 - i * 10, voices: 3, detune: 25, start: s,
            dur: 0.2, gain: 0.14, filter: { from: 900, to: 300, q: 6 }, wet: 0.3 }));
    },

    // Error: saturated glitch burst + sub thump.
    error: a => {
        a._voice({ type: "square", freq: 140, to: 40, dur: 0.35, gain: 0.18, filter: { from: 1800, to: 200, q: 8 }, drive: true });
        for (let i = 0; i < 5; i++) a._noise({ start: i * 0.04 + rnd(0, 0.02), dur: 0.025, gain: 0.12, type: "bandpass", from: rnd(500, 4000), q: 10, wet: 0.2 });
        a._voice({ type: "sine", freq: 55, to: 30, dur: 0.5, gain: 0.35, wet: 0 });
    },

    // Alarm: slow two-tone klaxon, filtered and wide, like a ship's corridor.
    alarm: a => {
        for (let i = 0; i < 2; i++) {
            a._voice({ type: "sawtooth", freq: 440, to: 330, glide: 0.45, voices: 2, detune: 12, start: i * 0.55, dur: 0.5, attack: 0.05,
                gain: 0.08, filter: { from: 1400, q: 3 }, wet: 0.5, curve: "lin" });
        }
    },

    // Notification: crystalline FM ping with a long tail.
    info: a => {
        a._bell({ freq: 1318.5, ratio: 3.5, index: 2.5, dur: 1.2, gain: 0.08, wet: 0.6 });
        a._bell({ freq: 1975.5, ratio: 2.01, index: 1.2, start: 0.09, dur: 1.0, gain: 0.05, wet: 0.7 });
    },

    // Scanner sweep: resonant filter riding up through noise.
    scan: a => {
        a._noise({ dur: 0.9, attack: 0.1, gain: 0.1, type: "bandpass", from: 300, to: 8000, q: 14, wet: 0.5, curve: "lin" });
        a._voice({ type: "sine", freq: 200, to: 3200, dur: 0.9, gain: 0.03, wet: 0.5 });
    },

    // Boot logo: riser, then a cinematic "braam" with sub and long reverb tail.
    theme: a => {
        a._noise({ dur: 0.9, attack: 0.85, gain: 0.08, type: "bandpass", from: 400, to: 7000, q: 2, wet: 0.5, curve: "lin" });
        a._voice({ type: "sine", freq: 300, to: 1200, dur: 0.9, attack: 0.8, gain: 0.03, wet: 0.5, curve: "lin" });
        const hit = 0.9;
        a._voice({ type: "sawtooth", freq: 55, voices: 4, detune: 18, start: hit, dur: 3.2, attack: 0.02, gain: 0.22,
            filter: { from: 1800, to: 180, time: 2.6, q: 3 }, wet: 0.5, drive: true });
        a._voice({ type: "sawtooth", freq: 110, voices: 3, detune: 22, start: hit, dur: 2.8, attack: 0.02, gain: 0.08,
            filter: { from: 2500, to: 250, time: 2.2, q: 2 }, wet: 0.7 });
        a._voice({ type: "sine", freq: 45, to: 30, start: hit, dur: 2.5, attack: 0.01, gain: 0.5, wet: 0 });
        a._noise({ start: hit, dur: 0.6, gain: 0.12, type: "lowpass", from: 3000, to: 200, wet: 0.6 });
    }
};

export const audio = new AudioFX();
