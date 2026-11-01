// Keys are identified by KeyboardEvent.code (physical position), so the on-screen
// keyboard can light up whatever the hardware keyboard presses, whatever the OS layout.
// Character maps: code -> [normal, shift, altgr?]

const letters = "QWERTYUIOPASDFGHJKLZXCVBNM".split("");
const letterMap = Object.fromEntries(letters.map(l => [`Key${l}`, [l.toLowerCase(), l]]));

const ANSI_ROWS = [
    ["Escape", "Backquote", "Digit1", "Digit2", "Digit3", "Digit4", "Digit5", "Digit6", "Digit7", "Digit8", "Digit9", "Digit0", "Minus", "Equal", ["Backspace", 2]],
    [["Tab", 1.5], "KeyQ", "KeyW", "KeyE", "KeyR", "KeyT", "KeyY", "KeyU", "KeyI", "KeyO", "KeyP", "BracketLeft", "BracketRight", ["Backslash", 1.5]],
    [["CapsLock", 1.75], "KeyA", "KeyS", "KeyD", "KeyF", "KeyG", "KeyH", "KeyJ", "KeyK", "KeyL", "Semicolon", "Quote", ["Enter", 2.25]],
    [["ShiftLeft", 2.25], "KeyZ", "KeyX", "KeyC", "KeyV", "KeyB", "KeyN", "KeyM", "Comma", "Period", "Slash", ["ShiftRight", 2.75]],
    [["ControlLeft", 1.5], ["AltLeft", 1.25], ["Space", 6.75], ["AltRight", 1.25], ["ControlRight", 1.5], "ArrowLeft", "ArrowUp", "ArrowDown", "ArrowRight"]
];

const ISO_ROWS = [
    ANSI_ROWS[0],
    [["Tab", 1.5], "KeyQ", "KeyW", "KeyE", "KeyR", "KeyT", "KeyY", "KeyU", "KeyI", "KeyO", "KeyP", "BracketLeft", "BracketRight", ["Enter", 1.5]],
    [["CapsLock", 1.75], "KeyA", "KeyS", "KeyD", "KeyF", "KeyG", "KeyH", "KeyJ", "KeyK", "KeyL", "Semicolon", "Quote", "Backslash", ["Enter", 1.25]],
    [["ShiftLeft", 1.25], "IntlBackslash", "KeyZ", "KeyX", "KeyC", "KeyV", "KeyB", "KeyN", "KeyM", "Comma", "Period", "Slash", ["ShiftRight", 2.75]],
    ANSI_ROWS[4]
];

export const SPECIAL_LABELS = {
    Escape: "ESC", Backspace: "⌫", Tab: "TAB", CapsLock: "CAPS", Enter: "ENTER", ShiftLeft: "SHIFT", ShiftRight: "SHIFT",
    ControlLeft: "CTRL", ControlRight: "CTRL", AltLeft: "ALT", AltRight: "ALT", Space: "",
    ArrowLeft: "◀", ArrowUp: "▲", ArrowDown: "▼", ArrowRight: "▶"
};

export const LAYOUTS = {
    "en-US": {
        name: "English (US)",
        rows: ANSI_ROWS,
        altgrLabel: "ALT",
        chars: {
            ...letterMap,
            Backquote: ["`", "~"], Digit1: ["1", "!"], Digit2: ["2", "@"], Digit3: ["3", "#"], Digit4: ["4", "$"], Digit5: ["5", "%"],
            Digit6: ["6", "^"], Digit7: ["7", "&"], Digit8: ["8", "*"], Digit9: ["9", "("], Digit0: ["0", ")"], Minus: ["-", "_"], Equal: ["=", "+"],
            BracketLeft: ["[", "{"], BracketRight: ["]", "}"], Backslash: ["\\", "|"], Semicolon: [";", ":"], Quote: ["'", "\""],
            Comma: [",", "<"], Period: [".", ">"], Slash: ["/", "?"], Space: [" ", " "]
        }
    },
    "tr-TR-Q": {
        name: "Türkçe Q",
        rows: ISO_ROWS,
        altgrLabel: "ALT GR",
        chars: {
            ...letterMap,
            KeyI: ["ı", "I", "i"], KeyQ: ["q", "Q", "@"], KeyE: ["e", "E", "€"],
            Backquote: ["\"", "é", "<"], Digit1: ["1", "!", ">"], Digit2: ["2", "'", "£"], Digit3: ["3", "^", "#"], Digit4: ["4", "+", "$"],
            Digit5: ["5", "%", "½"], Digit6: ["6", "&"], Digit7: ["7", "/", "{"], Digit8: ["8", "(", "["], Digit9: ["9", ")", "]"],
            Digit0: ["0", "=", "}"], Minus: ["*", "?", "\\"], Equal: ["-", "_", "|"],
            BracketLeft: ["ğ", "Ğ", "¨"], BracketRight: ["ü", "Ü", "~"], Semicolon: ["ş", "Ş", "´"], Quote: ["i", "İ"],
            Backslash: [",", ";", "`"], IntlBackslash: ["<", ">", "|"], Comma: ["ö", "Ö"], Period: ["ç", "Ç"], Slash: [".", ":"],
            Space: [" ", " "]
        }
    }
};
