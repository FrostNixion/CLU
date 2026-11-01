import { Modal, confirmModal, toast } from "./modal.js";
import { h, fileUrl, basename, formatBytes } from "../lib/util.js";

const IMAGE = /\.(png|jpe?g|gif|webp|bmp|svg|ico|avif)$/i;
const VIDEO = /\.(mp4|webm|mkv|mov|ogv)$/i;
const AUDIO = /\.(mp3|wav|ogg|flac|m4a|opus)$/i;
const PDF = /\.pdf$/i;

export function fileKind(name) {
    if (IMAGE.test(name)) return "image";
    if (VIDEO.test(name)) return "video";
    if (AUDIO.test(name)) return "audio";
    if (PDF.test(name)) return "pdf";
    return "text";
}

/** Open a file inside CLU with the most fitting built-in viewer. */
export async function openFile(path) {
    const kind = fileKind(path);
    const name = basename(path);
    if (kind === "text") return editFile(path);

    let body;
    if (kind === "image") {
        const img = h("img.viewer-image", { src: fileUrl(path), alt: name, draggable: "false" });
        const info = h("span.viewer-info");
        img.addEventListener("load", () => { info.textContent = `${img.naturalWidth} × ${img.naturalHeight}`; });
        let zoom = 1;
        img.addEventListener("wheel", e => {
            e.preventDefault();
            zoom = Math.max(0.1, Math.min(10, zoom * (e.deltaY < 0 ? 1.15 : 1 / 1.15)));
            img.style.transform = `scale(${zoom})`;
        });
        body = h("div.viewer.viewer-imagewrap", img, info);
    } else if (kind === "video") {
        body = h("div.viewer", h("video.viewer-media", { src: fileUrl(path), controls: true, autoplay: true }));
    } else if (kind === "audio") {
        body = h("div.viewer.viewer-audio", h("div.audio-name", name), h("audio", { src: fileUrl(path), controls: true, autoplay: true }));
    } else if (kind === "pdf") {
        body = h("div.viewer", h("iframe.viewer-pdf", { src: fileUrl(path) }));
    }
    return new Modal({
        title: name,
        body,
        className: `viewer-modal viewer-${kind}`,
        sound: "folder",
        buttons: [
            { label: "Open externally", action: () => window.clu.shell.openPath(path) },
            { label: "Show in folder", action: () => window.clu.shell.showItem(path), keep: true }
        ]
    });
}

/** Built-in text editor. */
export async function editFile(path) {
    let file;
    try {
        file = await window.clu.fs.readText(path);
    } catch (e) {
        // New file: start empty, it is created on save.
        if (!/ENOENT/.test(e.message)) return toast(e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, ""), "error");
        file = { text: "", binary: false, size: 0, isNew: true };
    }
    const name = basename(path);
    if (file.binary) {
        return new Modal({
            title: name, type: "warn",
            body: h("p", `This looks like a binary file (${formatBytes(file.size)}). It can't be edited as text.`),
            buttons: [{ label: "Open externally", primary: true, action: () => window.clu.shell.openPath(path) }]
        });
    }

    const area = h("textarea.editor-area", { spellcheck: "false", wrap: "off" });
    area.value = file.text;
    const gutter = h("div.editor-gutter");
    const status = h("span.editor-status", file.isNew ? "new file" : `${formatBytes(file.size)}`);
    const pos = h("span.editor-pos", "Ln 1, Col 1");
    let dirty = false;
    let saved = file.text;

    let lineCount = -1;
    const renderGutter = () => {
        let lines = 1;
        for (let i = area.value.indexOf("\n"); i >= 0; i = area.value.indexOf("\n", i + 1)) lines++;
        if (lines !== lineCount) {
            lineCount = lines;
            gutter.textContent = Array.from({ length: lines }, (_, i) => i + 1).join("\n");
        }
    };
    const updatePos = () => {
        const before = area.value.slice(0, area.selectionStart);
        const ln = before.split("\n").length;
        pos.textContent = `Ln ${ln}, Col ${area.selectionStart - before.lastIndexOf("\n")}`;
    };
    const setDirty = d => {
        dirty = d;
        modal.el.classList.toggle("dirty", d);
        status.textContent = d ? "modified" : "saved";
    };
    const save = async () => {
        try {
            await window.clu.fs.writeText(path, area.value);
            saved = area.value;
            setDirty(false);
        } catch (e) {
            toast(`Save failed: ${e.message}`, "error");
        }
    };

    area.addEventListener("input", () => { renderGutter(); setDirty(area.value !== saved); });
    area.addEventListener("scroll", () => { gutter.scrollTop = area.scrollTop; });
    area.addEventListener("click", updatePos);
    area.addEventListener("keyup", updatePos);
    area.addEventListener("keydown", e => {
        e.stopPropagation();
        if ((e.ctrlKey || e.metaKey) && e.code === "KeyS") {
            e.preventDefault();
            save();
        } else if (e.key === "Tab") {
            e.preventDefault();
            area.setRangeText("    ", area.selectionStart, area.selectionEnd, "end");
            area.dispatchEvent(new Event("input"));
        } else if (e.key === "Escape") {
            modal.close();
        }
    });

    const modal = new Modal({
        title: name,
        className: "editor-modal",
        sound: "folder",
        body: h("div.editor", h("div.editor-path", path), h("div.editor-main", gutter, area), h("div.editor-bar", status, pos, h("span.editor-hint", "Ctrl+S save · Esc close"))),
        buttons: [
            { label: "Save", primary: true, keep: true, action: save },
            { label: "Open externally", action: () => window.clu.shell.openPath(path), keep: true }
        ]
    });
    modal.beforeClose = () => {
        if (!dirty) return true;
        confirmModal("Unsaved changes", `Discard changes to ${name}?`, { okLabel: "Discard" }).then(ok => {
            if (ok) { dirty = false; modal.close(); }
        });
        return false;
    };
    renderGutter();
    // Assigning .value leaves the caret at the end; start at the top like an editor should.
    area.setSelectionRange(0, 0);
    setTimeout(() => { area.focus(); area.scrollTop = 0; }, 50);
    return modal;
}
