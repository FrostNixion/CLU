"use strict";
const { contextBridge, ipcRenderer, webFrame } = require("electron");

const invoke = (ch, ...a) => ipcRenderer.invoke(ch, ...a);

function subscribe(channel, cb) {
    const listener = (e, ...args) => cb(...args);
    ipcRenderer.on(channel, listener);
    return () => ipcRenderer.removeListener(channel, listener);
}

webFrame.setVisualZoomLevelLimits(1, 1);

contextBridge.exposeInMainWorld("clu", {
    info: () => invoke("app:info"),
    settings: {
        get: () => invoke("settings:get"),
        set: partial => invoke("settings:set", partial),
        reset: () => invoke("settings:reset"),
        path: () => invoke("settings:path")
    },
    themes: {
        user: () => invoke("themes:user"),
        dir: () => invoke("themes:dir")
    },
    pty: {
        create: opts => invoke("pty:create", opts),
        write: (id, data) => ipcRenderer.send("pty:write", id, data),
        resize: (id, cols, rows) => ipcRenderer.send("pty:resize", id, cols, rows),
        ack: (id, bytes) => ipcRenderer.send("pty:ack", id, bytes),
        kill: id => ipcRenderer.send("pty:kill", id),
        processName: id => invoke("pty:process", id),
        onData: cb => subscribe("pty:data", cb),
        onExit: cb => subscribe("pty:exit", cb)
    },
    sys: {
        call: (fn, ...args) => invoke("sys:call", fn, args),
        geo: () => invoke("sys:geo"),
        kill: (pid, signal) => invoke("sys:kill", pid, signal)
    },
    fs: {
        list: dir => invoke("fs:list", dir),
        drives: () => invoke("fs:drives"),
        readText: file => invoke("fs:readText", file),
        writeText: (file, text) => invoke("fs:writeText", file, text),
        stat: file => invoke("fs:stat", file),
        exists: file => invoke("fs:exists", file),
        mkdir: dir => invoke("fs:mkdir", dir),
        rename: (from, to) => invoke("fs:rename", from, to),
        trash: file => invoke("fs:trash", file)
    },
    shell: {
        openPath: p => invoke("shell:openPath", p),
        openExternal: url => invoke("shell:openExternal", url),
        showItem: p => invoke("shell:showItem", p)
    },
    clipboard: {
        read: () => invoke("clipboard:read"),
        write: text => invoke("clipboard:write", text)
    },
    win: {
        toggleFullscreen: () => invoke("win:toggleFullscreen"),
        isFullscreen: () => invoke("win:isFullscreen"),
        devtools: () => invoke("win:devtools"),
        minimize: () => invoke("win:minimize"),
        notify: (title, body) => invoke("win:notify", title, body),
        onFullscreen: cb => subscribe("win:fullscreen", cb)
    },
    app: {
        quit: () => invoke("app:quit"),
        relaunch: () => invoke("app:relaunch"),
        reload: () => location.reload()
    },
    session: {
        load: () => invoke("session:load"),
        save: data => invoke("session:save", data),
        saveSync: data => ipcRenderer.sendSync("session:saveSync", data)
    },
    media: {
        start: () => invoke("media:start"),
        command: cmd => invoke("media:command", cmd),
        onState: cb => subscribe("media:state", cb)
    },
    ai: {
        status: () => invoke("ai:status"),
        setKey: key => invoke("ai:setKey", key),
        ask: (id, payload) => invoke("ai:ask", id, payload),
        cancel: id => invoke("ai:cancel", id),
        onDelta: cb => subscribe("ai:delta", cb)
    },
    lock: {
        status: () => invoke("lock:status"),
        verify: pin => invoke("lock:verify", pin),
        lock: () => invoke("lock:lock"),
        change: (current, next) => invoke("lock:change", current, next),
        setEnabled: (current, enabled) => invoke("lock:setEnabled", current, enabled)
    },
    apps: {
        list: opts => invoke("apps:list", opts),
        launch: target => invoke("apps:launch", target),
        icon: target => invoke("apps:icon", target),
        favicon: url => invoke("apps:favicon", url),
        onWebOpen: cb => subscribe("web:open", cb),
        onWebKey: cb => subscribe("web:key", cb)
    },
    dialog: {
        openFile: opts => invoke("dialog:openFile", opts)
    }
});
