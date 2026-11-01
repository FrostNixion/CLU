// Line icons drawn with currentColor so they follow the theme accent.
const svg = body => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round" stroke-linecap="round">${body}</svg>`;

export const ICONS = {
    dir: svg('<path d="M2.5 6.5v12h19v-10h-10l-2-2.5h-7z"/><path d="M2.5 9h19" opacity=".5"/>'),
    up: svg('<path d="M2.5 6.5v12h19v-10h-10l-2-2.5h-7z"/><path d="M12 17v-6m-3 3 3-3 3 3"/>'),
    file: svg('<path d="M6 2.5h8l4.5 4.5v14.5H6z"/><path d="M14 2.5V7h4.5"/>'),
    text: svg('<path d="M6 2.5h8l4.5 4.5v14.5H6z"/><path d="M14 2.5V7h4.5M9 11h6M9 14h6M9 17h4"/>'),
    code: svg('<path d="M6 2.5h8l4.5 4.5v14.5H6z"/><path d="M14 2.5V7h4.5M10.5 11.5 8.5 14l2 2.5M13.5 11.5l2 2.5-2 2.5"/>'),
    image: svg('<rect x="3" y="4" width="18" height="16" rx="1"/><circle cx="8.5" cy="9" r="1.8"/><path d="m3 17 5-5 4 4 3-3 6 6"/>'),
    video: svg('<rect x="2.5" y="5" width="19" height="14" rx="1"/><path d="m10 9 5 3-5 3z"/>'),
    audio: svg('<path d="M9 18V5l11-2v13"/><circle cx="6.5" cy="18" r="2.5"/><circle cx="17.5" cy="16" r="2.5"/>'),
    archive: svg('<path d="M6 2.5h12v19H6z"/><path d="M12 2.5v2m0 2v2m0 2v2"/><rect x="10.5" y="13" width="3" height="4"/>'),
    pdf: svg('<path d="M6 2.5h8l4.5 4.5v14.5H6z"/><path d="M14 2.5V7h4.5"/><path d="M8.5 17v-4h1.5a1.2 1.2 0 0 1 0 2.4H8.5M13 13v4h1a2 2 0 0 0 0-4zM18 13h-1.8v4m0-2h1.4"/>'),
    exec: svg('<rect x="2.5" y="4" width="19" height="16" rx="1"/><path d="M2.5 8h19M6 12l3 2.5L6 17m5 0h5"/>'),
    link: svg('<path d="M6 2.5h8l4.5 4.5v14.5H6z"/><path d="M10 16l4-4m-3.5-1H14v3.5"/>'),
    data: svg('<ellipse cx="12" cy="5.5" rx="7.5" ry="3"/><path d="M4.5 5.5v13c0 1.7 3.4 3 7.5 3s7.5-1.3 7.5-3v-13M4.5 12c0 1.7 3.4 3 7.5 3s7.5-1.3 7.5-3"/>'),
    drive: svg('<rect x="2.5" y="7" width="19" height="10" rx="1.5"/><path d="M6 12h6"/><circle cx="17" cy="12" r="1"/>'),
    settings: svg('<circle cx="12" cy="12" r="3"/><path d="M12 2.5v3m0 13v3M2.5 12h3m13 0h3M5.3 5.3l2.1 2.1m9.2 9.2 2.1 2.1M5.3 18.7l2.1-2.1m9.2-9.2 2.1-2.1"/>')
};

const EXT = {
    text: "txt md markdown rst log csv tsv ini cfg conf toml yml yaml env gitignore editorconfig license readme",
    code: "js mjs cjs ts tsx jsx json jsonc html htm css scss less py rb go rs c h cpp hpp cc cs java kt swift php sh bash zsh ps1 psm1 bat cmd lua sql vue svelte xml dart r pl ex exs zig asm vim",
    image: "png jpg jpeg gif webp bmp svg ico avif tif tiff heic psd",
    video: "mp4 webm mkv mov avi ogv wmv flv m4v",
    audio: "mp3 wav ogg flac m4a opus aac wma",
    archive: "zip rar 7z tar gz tgz bz2 xz zst iso cab",
    pdf: "pdf",
    exec: "exe msi com scr appx msix dll sys app deb rpm apk",
    data: "db sqlite sqlite3 mdb bak dat bin"
};
const LOOKUP = {};
for (const [k, list] of Object.entries(EXT)) for (const e of list.split(" ")) LOOKUP[e] = k;

export function iconFor(entry) {
    if (entry.type === "dir" || entry.type === "dirlink") return "dir";
    if (entry.type === "brokenlink") return "link";
    const name = entry.name.toLowerCase();
    const ext = name.includes(".") ? name.split(".").pop() : name;
    return LOOKUP[ext] || "file";
}
