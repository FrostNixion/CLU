// Builds the renderer, launches CLU against a throwaway profile, runs tests/smoke.js inside it
// and exits non-zero on any failure. Screenshots of failures land in tests/out/.
import { spawn, execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import electron from "electron";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outDir = path.join(root, "tests", "out");
const profile = fs.mkdtempSync(path.join(os.tmpdir(), "clu-test-"));
fs.rmSync(outDir, { recursive: true, force: true });
fs.mkdirSync(outDir, { recursive: true });

execFileSync(process.execPath, [path.join(root, "build.mjs")], { cwd: root, stdio: "ignore" });

const TIMEOUT_MS = 180000;
const child = spawn(electron, [root, "--windowed", "--nointro"], {
    cwd: root,
    env: {
        ...process.env,
        CLU_USER_DATA: profile,
        CLU_DEBUG: "1",
        CLU_EVAL: path.join(root, "tests", "smoke.js"),
        CLU_EVAL_DELAY: "1500",
        CLU_SCREENSHOT: outDir,
        CLU_SCREENSHOT_AT: "999999999"
    },
    stdio: ["ignore", "pipe", "pipe"]
});

let done = null;
const lines = [];
const onData = buf => {
    for (const line of buf.toString().split(/\r?\n/)) {
        const m = /TEST (PASS|FAIL|DONE) (.*?)(?: \(:\d+\))?$/.exec(line);
        if (!m) {
            if (/Uncaught|\[renderer:error\]/.test(line)) lines.push(`  ! ${line.trim()}`);
            continue;
        }
        if (m[1] === "DONE") done = m[2];
        else console.log(`${m[1] === "PASS" ? "  ✓" : "  ✗"} ${m[2]}`);
        if (m[1] === "FAIL") lines.push(`  ✗ ${m[2]}`);
    }
    if (done) child.kill();
};
child.stdout.on("data", onData);
child.stderr.on("data", () => {});

const timer = setTimeout(() => { done = done || "timeout"; child.kill(); }, TIMEOUT_MS);
child.on("exit", () => {
    clearTimeout(timer);
    try { fs.rmSync(profile, { recursive: true, force: true }); } catch (e) { /* locked files */ }
    const [passed, total] = String(done).split("/").map(Number);
    const ok = total > 0 && passed === total;
    console.log(`\n${ok ? "PASS" : "FAIL"}: ${done}`);
    if (!ok && lines.length) console.log(lines.join("\n"));
    process.exit(ok ? 0 : 1);
});
