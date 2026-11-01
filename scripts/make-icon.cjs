// Renders the CLU app icon (build/icon.png, 512x512) with an offscreen Electron window.
// Usage: npm run icon
const { app, BrowserWindow } = require("electron");
const fs = require("fs");
const path = require("path");

const html = `<!DOCTYPE html><html><body style="margin:0;width:512px;height:512px;background:transparent;display:flex;align-items:center;justify-content:center">
<svg width="512" height="512" viewBox="0 0 512 512" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <radialGradient id="glow" cx="50%" cy="50%" r="50%"><stop offset="60%" stop-color="#aacfd1" stop-opacity="0"/><stop offset="100%" stop-color="#aacfd1" stop-opacity=".35"/></radialGradient>
  </defs>
  <path d="M40 24 H420 L488 92 V488 H92 L24 420 V40 Z" fill="#05080d" stroke="#aacfd1" stroke-width="10"/>
  <path d="M40 24 H160 M24 40 V160 M488 368 V488 H368" stroke="#e6fbff" stroke-width="18" fill="none"/>
  <circle cx="256" cy="256" r="190" fill="url(#glow)"/>
  <text x="256" y="300" text-anchor="middle" font-family="Segoe UI, Arial" font-weight="700" font-size="150" letter-spacing="14" fill="#aacfd1">CLU</text>
  <rect x="110" y="330" width="292" height="10" fill="#aacfd1"/>
  <text x="256" y="395" text-anchor="middle" font-family="Consolas, monospace" font-size="38" fill="#aacfd1" opacity=".75">&gt;_</text>
</svg></body></html>`;

app.whenReady().then(async () => {
    const win = new BrowserWindow({ width: 512, height: 512, show: false, transparent: true, frame: false, webPreferences: { offscreen: true } });
    await win.loadURL("data:text/html;charset=utf-8," + encodeURIComponent(html));
    await new Promise(r => setTimeout(r, 300));
    const img = await win.webContents.capturePage();
    const out = path.join(__dirname, "..", "build", "icon.png");
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, img.resize({ width: 512, height: 512 }).toPNG());
    console.log("wrote", out);
    app.quit();
});
