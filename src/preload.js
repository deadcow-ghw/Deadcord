"use strict";

const path = require("path");
const fs = require("fs");
const { contextBridge, ipcRenderer, webFrame } = require("electron");
const { getMainWorldIdentityPatchScript } = require("./clientIdentity");
const { getMainWorldExifStripperScript } = require("./exifCleaner");

let bootConfig = {
    torEnabled: true,
    clientIdentity: process.platform === "win32" ? "discord-windows" : "discord-linux",
    exifCleanerEnabled: true,
    streamFps: 60,
    streamResolution: "1080",
    streamQualityUnlock: true
};
try {
    const cfg = ipcRenderer.sendSync("deadcord:get-boot-config");
    if (cfg && typeof cfg === "object") {
        bootConfig = { ...bootConfig, ...cfg };
    }
} catch (_) {}

function buildMainWorldShieldScript(cfg) {
    const streamCfgJson = JSON.stringify({
        streamFps: Number(cfg.streamFps) || 60,
        streamResolution: cfg.streamResolution || "1080",
        streamQualityUnlock: cfg.streamQualityUnlock !== false
    });
    const exifEnabled = cfg.exifCleanerEnabled !== false ? "true" : "false";
    const torEnabled = cfg.torEnabled ? "true" : "false";
    const spoofPlatform = cfg.clientIdentity === "discord-windows" ? "Win32" : "Linux x86_64";

    return `
(function() {
    window.__deadcordStreamConfig = ${streamCfgJson};
    window.__deadcordExifEnabled = ${exifEnabled};
    window.__deadcordTorEnabled = ${torEnabled};

    if (window.__deadcordMainShieldInstalled) return;
    window.__deadcordMainShieldInstalled = true;

    try {
        const overrideWebGL = (proto) => {
            if (!proto || !proto.getParameter) return;
            const origGetParam = proto.getParameter;
            proto.getParameter = function(param) {
                if (param === 37445) return "Intel Open Source Technology Center";
                if (param === 37446) return "Mesa DRI Intel(R) HD Graphics (SKL GT2)";
                if (param === 7936) return "WebKit";
                if (param === 7937) return "WebKit WebGL";
                return origGetParam.apply(this, arguments);
            };
        };
        if (typeof WebGLRenderingContext !== "undefined") overrideWebGL(WebGLRenderingContext.prototype);
        if (typeof WebGL2RenderingContext !== "undefined") overrideWebGL(WebGL2RenderingContext.prototype);

        const sessionNoise = (Math.floor(Math.random() * 3) - 1) || 1;
        if (typeof CanvasRenderingContext2D !== "undefined") {
            const origGetImageData = CanvasRenderingContext2D.prototype.getImageData;
            CanvasRenderingContext2D.prototype.getImageData = function() {
                const img = origGetImageData.apply(this, arguments);
                try {
                    if (img && img.data && img.data.length >= 4 && img.width <= 512 && img.height <= 512) {
                        img.data[0] = (img.data[0] + sessionNoise) & 255;
                    }
                } catch (_) {}
                return img;
            };
        }

        const audioDelta = (Math.random() - 0.5) * 1e-7;
        if (typeof AudioBuffer !== "undefined" && AudioBuffer.prototype.getChannelData) {
            const origGetChannelData = AudioBuffer.prototype.getChannelData;
            AudioBuffer.prototype.getChannelData = function() {
                const data = origGetChannelData.apply(this, arguments);
                try {
                    if (data && data.length > 0 && !data.__deadcordNoised) {
                        data[0] = data[0] + audioDelta;
                        data.__deadcordNoised = true;
                    }
                } catch (_) {}
                return data;
            };
        }

        if (typeof navigator.sendBeacon === "function") {
            const origBeacon = navigator.sendBeacon.bind(navigator);
            navigator.sendBeacon = function(url, data) {
                const s = String(url || "").toLowerCase();
                if (
                    s.includes("/science") ||
                    s.includes("/track") ||
                    s.includes("/metrics") ||
                    s.includes("sentry") ||
                    s.includes("analytics")
                ) {
                    return true;
                }
                return origBeacon(url, data);
            };
        }

        if (typeof window.RTCPeerConnection === "function") {
            const OrigRTC = window.RTCPeerConnection;
            window.RTCPeerConnection = function(config, constraints) {
                if (window.__deadcordTorEnabled && config && typeof config === "object") {
                    config = Object.assign({}, config, { iceTransportPolicy: "relay" });
                }
                return new OrigRTC(config, constraints);
            };
            window.RTCPeerConnection.prototype = OrigRTC.prototype;
        }

        const defineProp = (obj, prop, getter) => {
            try { Object.defineProperty(obj, prop, { get: getter, configurable: true }); } catch (_) {}
        };
        defineProp(navigator, "hardwareConcurrency", () => 8);
        defineProp(navigator, "deviceMemory", () => 8);
        defineProp(navigator, "platform", () => ${JSON.stringify(spoofPlatform)});
        defineProp(navigator, "webdriver", () => false);

        const hideApi = (prop) => {
            try {
                Object.defineProperty(navigator, prop, { get: () => undefined, configurable: false });
            } catch (_) {}
        };
        ["getBattery", "connection", "bluetooth", "usb", "serial", "hid"].forEach(hideApi);
        try { navigator.getGamepads = () => []; } catch (_) {}
    } catch (_) {}

    try {
        if (navigator.mediaDevices && navigator.mediaDevices.getDisplayMedia) {
            const origGetDisplayMedia = navigator.mediaDevices.getDisplayMedia.bind(navigator.mediaDevices);
            navigator.mediaDevices.getDisplayMedia = async function(constraints) {
                constraints = constraints || {};
                const sc = window.__deadcordStreamConfig || {};
                if (sc.streamQualityUnlock) {
                    if (!constraints.video || typeof constraints.video !== "object") {
                        constraints.video = {};
                    }
                    const targetFps = Number(sc.streamFps) || 60;
                    const targetRes = sc.streamResolution || "1080";

                    constraints.video.frameRate = { ideal: targetFps, max: targetFps };

                    if (targetRes === "720") {
                        constraints.video.width = { ideal: 1280, max: 1280 };
                        constraints.video.height = { ideal: 720, max: 720 };
                    } else if (targetRes === "1080") {
                        constraints.video.width = { ideal: 1920, max: 1920 };
                        constraints.video.height = { ideal: 1080, max: 1080 };
                    } else if (targetRes === "1440") {
                        constraints.video.width = { ideal: 2560, max: 2560 };
                        constraints.video.height = { ideal: 1440, max: 1440 };
                    } else if (targetRes === "source") {
                        delete constraints.video.width;
                        delete constraints.video.height;
                    }

                    if (constraints.video.mandatory) {
                        constraints.video.mandatory.maxFrameRate = targetFps;
                        if (targetRes === "720") {
                            constraints.video.mandatory.maxWidth = 1280;
                            constraints.video.mandatory.maxHeight = 720;
                        } else if (targetRes === "1080") {
                            constraints.video.mandatory.maxWidth = 1920;
                            constraints.video.mandatory.maxHeight = 1080;
                        } else if (targetRes === "1440") {
                            constraints.video.mandatory.maxWidth = 2560;
                            constraints.video.mandatory.maxHeight = 1440;
                        } else if (targetRes === "source") {
                            delete constraints.video.mandatory.maxWidth;
                            delete constraints.video.mandatory.maxHeight;
                        }
                    }
                }

                const stream = await origGetDisplayMedia(constraints);

                if (sc.streamQualityUnlock && stream && stream.getVideoTracks) {
                    const targetFps = Number(sc.streamFps) || 60;
                    stream.getVideoTracks().forEach(track => {
                        const origApply = track.applyConstraints ? track.applyConstraints.bind(track) : null;
                        if (origApply) {
                            track.applyConstraints = async function(c) {
                                c = c || {};
                                if (c.frameRate) c.frameRate = targetFps;
                                return origApply(c);
                            };
                        }
                    });
                }

                return stream;
            };
        }
    } catch (_) {}
})();
`;
}

try {
    webFrame.executeJavaScript(getMainWorldIdentityPatchScript(bootConfig.clientIdentity));
    webFrame.executeJavaScript(buildMainWorldShieldScript(bootConfig));
    webFrame.executeJavaScript(getMainWorldExifStripperScript());
} catch (_) {}

let e2eeSecretPassphrase = "";
const derivedKeyCache = new Map();
const E2EE_V2_AAD = new TextEncoder().encode("deadcord-e2ee-v2");
const MAX_E2EE_CIPHER_LEN = 16384;

ipcRenderer.invoke("deadcord:get-config").then(cfg => {
    if (cfg && cfg.e2eeKey) {
        e2eeSecretPassphrase = cfg.e2eeKey;
    }
}).catch(() => {});

function bytesToBase64(bytes) {
    let binary = "";
    const chunkSize = 0x8000;
    for (let i = 0; i < bytes.length; i += chunkSize) {
        binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunkSize));
    }
    return btoa(binary);
}

function base64ToBytes(b64) {
    const binary = atob(b64);
    const out = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
        out[i] = binary.charCodeAt(i);
    }
    return out;
}

async function deriveE2EEKey(passphrase, saltBytes, iterations) {
    const saltHex = Array.from(saltBytes).map(b => b.toString(16).padStart(2, "0")).join("");
    const cacheKey = `${passphrase.length}:${iterations}:${saltHex}`;
    if (derivedKeyCache.has(cacheKey)) {
        return derivedKeyCache.get(cacheKey);
    }

    const enc = new TextEncoder();
    const keyMaterial = await crypto.subtle.importKey(
        "raw",
        enc.encode(passphrase),
        { name: "PBKDF2" },
        false,
        ["deriveKey"]
    );
    const key = await crypto.subtle.deriveKey(
        {
            name: "PBKDF2",
            salt: saltBytes,
            iterations,
            hash: "SHA-256"
        },
        keyMaterial,
        { name: "AES-GCM", length: 256 },
        false,
        ["encrypt", "decrypt"]
    );

    if (derivedKeyCache.size > 128) {
        derivedKeyCache.clear();
    }
    derivedKeyCache.set(cacheKey, key);
    return key;
}

async function encryptE2EEMessage(text, passphrase) {
    if (!passphrase) return text;
    try {
        const salt = crypto.getRandomValues(new Uint8Array(16));
        const iv = crypto.getRandomValues(new Uint8Array(12));
        const key = await deriveE2EEKey(passphrase, salt, 210000);
        const encoded = new TextEncoder().encode(text);
        const ciphertext = new Uint8Array(
            await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: E2EE_V2_AAD }, key, encoded)
        );
        const combined = new Uint8Array(salt.length + iv.length + ciphertext.length);
        combined.set(salt, 0);
        combined.set(iv, salt.length);
        combined.set(ciphertext, salt.length + iv.length);
        return `[DEAD-E2EE2:${bytesToBase64(combined)}]`;
    } catch (_) {
        return text;
    }
}

async function decryptE2EEMessage(cipherText, passphrase) {
    if (!passphrase || !cipherText || cipherText.length > MAX_E2EE_CIPHER_LEN) return null;
    try {
        const v2Match = cipherText.match(/\[DEAD-E2EE2:([A-Za-z0-9+/=]+)\]/);
        if (v2Match) {
            const raw = base64ToBytes(v2Match[1]);
            if (raw.length < 29) return null;
            const salt = raw.slice(0, 16);
            const iv = raw.slice(16, 28);
            const data = raw.slice(28);
            const key = await deriveE2EEKey(passphrase, salt, 210000);
            try {
                const decrypted = await crypto.subtle.decrypt(
                    { name: "AES-GCM", iv, additionalData: E2EE_V2_AAD },
                    key,
                    data
                );
                return new TextDecoder().decode(decrypted);
            } catch (_) {
                const fallbackDecrypted = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, data);
                return new TextDecoder().decode(fallbackDecrypted);
            }
        }

        const v1Match = cipherText.match(/\[DEAD-E2EE:([A-Za-z0-9+/=]+)\]/);
        if (v1Match) {
            const raw = base64ToBytes(v1Match[1]);
            if (raw.length < 13) return null;
            const iv = raw.slice(0, 12);
            const data = raw.slice(12);
            const salt = new TextEncoder().encode("deadcord_e2ee_salt");
            const key = await deriveE2EEKey(passphrase, salt, 100000);
            const decrypted = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, data);
            return new TextDecoder().decode(decrypted);
        }

        return null;
    } catch (_) {
        return null;
    }
}

function renderSafeE2EEBadge(el, text, kind) {
    const span = document.createElement("span");
    if (kind === "ok") {
        span.style.cssText = "color:#3BA55D;background:rgba(59,165,93,0.15);border-left:3px solid #3BA55D;padding:2px 8px;border-radius:4px;font-weight:500;white-space:pre-wrap;word-break:break-word;display:inline-block;";
        span.textContent = `[E2EE] ${text}`;
    } else if (kind === "warn") {
        span.style.cssText = "color:#FAA81A;background:rgba(250,168,26,0.15);border-left:3px solid #FAA81A;padding:2px 8px;border-radius:4px;font-family:monospace;font-size:12px;";
        span.textContent = "[Message chiffre E2EE - Cle requise dans Parametres Deadcord]";
    } else {
        span.style.cssText = "color:#ED4245;background:rgba(237,66,69,0.15);border-left:3px solid #ED4245;padding:2px 8px;border-radius:4px;font-family:monospace;font-size:12px;";
        span.textContent = "[E2EE Erreur : Cle invalide ou message corrompu]";
    }
    el.textContent = "";
    el.appendChild(span);
}

function processMessageNode(node) {
    if (!node || node.nodeType !== 1) return;
    const content = node.textContent;
    if (!content || (!content.includes("[DEAD-E2EE:") && !content.includes("[DEAD-E2EE2:"))) return;

    const targets = node.querySelectorAll
        ? node.querySelectorAll("div[id^='message-content-'], span[class*='messageContent']")
        : [];

    for (let i = 0; i < targets.length; i++) {
        const el = targets[i];
        if (el.dataset.deadcordProcessed) continue;
        const text = el.textContent;
        if (text && (text.includes("[DEAD-E2EE:") || text.includes("[DEAD-E2EE2:"))) {
            el.dataset.deadcordProcessed = "true";
            if (!e2eeSecretPassphrase) {
                renderSafeE2EEBadge(el, "", "warn");
            } else {
                decryptE2EEMessage(text, e2eeSecretPassphrase).then((plaintext) => {
                    if (plaintext !== null) {
                        renderSafeE2EEBadge(el, plaintext, "ok");
                    } else {
                        renderSafeE2EEBadge(el, "", "err");
                    }
                }).catch(() => renderSafeE2EEBadge(el, "", "err"));
            }
        }
    }
}

function hookE2EESend() {
    window.addEventListener("keydown", async (e) => {
        if (e.key === "Enter" && !e.shiftKey) {
            const target = e.target;
            if (target && (target.tagName === "TEXTAREA" || target.getAttribute("role") === "textbox")) {
                const val = target.value || target.innerText;
                if (val && val.startsWith("!e ")) {
                    e.preventDefault();
                    e.stopPropagation();
                    const rawMsg = val.slice(3).trim();
                    if (!rawMsg) return;
                    if (!e2eeSecretPassphrase) {
                        alert("Veuillez d'abord configurer votre cle E2EE dans Parametres > Deadcord.");
                        return;
                    }
                    const encrypted = await encryptE2EEMessage(rawMsg, e2eeSecretPassphrase);
                    document.execCommand("selectAll", false, null);
                    document.execCommand("insertText", false, encrypted);
                    const enterEvent = new KeyboardEvent("keydown", {
                        bubbles: true,
                        cancelable: true,
                        key: "Enter",
                        code: "Enter",
                        keyCode: 13
                    });
                    target.dispatchEvent(enterEvent);
                }
            }
        }
    }, true);
}

function hookUniversalFileUpload() {
    function dispatchUploadedFiles(files, targetElement) {
        if (!files || files.length === 0) return;

        try {
            const uploadEvt = new CustomEvent("deadcord:upload-files", {
                detail: { files },
                cancelable: true
            });
            window.dispatchEvent(uploadEvt);
            if (uploadEvt.defaultPrevented || uploadEvt.detail?.handled) {
                return;
            }
        } catch (_) {}

        let dt;
        try {
            dt = new DataTransfer();
            for (const f of files) {
                dt.items.add(f);
            }
        } catch (_) {}

        if (!dt) return;

        const target =
            targetElement ||
            document.activeElement ||
            document.querySelector('[data-slate-editor="true"]') ||
            document.body;
        try {
            const pasteEvt = new ClipboardEvent("paste", {
                bubbles: true,
                cancelable: true,
                clipboardData: dt
            });
            pasteEvt.__deadcordSynthetic = true;
            target.dispatchEvent(pasteEvt);
        } catch (_) {}
    }

    window.addEventListener("dragenter", (e) => {
        if (e.dataTransfer) {
            const types = Array.from(e.dataTransfer.types || []);
            if (types.includes("text/uri-list") || types.includes("Files")) {
                e.dataTransfer.dropEffect = "copy";
                e.preventDefault();
            }
        }
    }, true);

    window.addEventListener("dragover", (e) => {
        if (e.dataTransfer) {
            const types = Array.from(e.dataTransfer.types || []);
            if (types.includes("text/uri-list") || types.includes("Files")) {
                e.dataTransfer.dropEffect = "copy";
                e.preventDefault();
            }
        }
    }, true);

    window.addEventListener("drop", async (e) => {
        if (e.__deadcordSynthetic) return;
        const dt = e.dataTransfer;
        if (!dt) return;

        if (dt.files && dt.files.length > 0) return;

        const uriList = dt.getData("text/uri-list") || dt.getData("text/plain") || "";
        const lines = uriList.split(/[\r\n]+/).map(s => s.trim()).filter(Boolean);
        const fileUris = lines.filter(s => s.startsWith("file://"));

        if (fileUris.length === 0) return;

        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();

        const filesToUpload = [];
        for (const uri of fileUris) {
            try {
                const res = await ipcRenderer.invoke("deadcord:read-file-for-upload", uri);
                if (res && res.data) {
                    filesToUpload.push(new File([res.data], res.name, { type: res.type }));
                }
            } catch (_) {}
        }

        if (filesToUpload.length > 0) {
            dispatchUploadedFiles(filesToUpload, e.target);
        }
    }, true);

    window.addEventListener("paste", async (e) => {
        if (e.__deadcordSynthetic) return;
        const cb = e.clipboardData;

        if (cb) {
            if (cb.files && cb.files.length > 0) return;
            if (cb.items) {
                for (let i = 0; i < cb.items.length; i++) {
                    const item = cb.items[i];
                    if (item.kind === "file" || (item.type && item.type.startsWith("image/"))) {
                        return;
                    }
                }
            }
        }

        let uriList = "";
        let plainText = "";
        if (cb) {
            uriList = cb.getData("text/uri-list") || "";
            plainText = cb.getData("text/plain") || "";
            if (!uriList && plainText.startsWith("file://")) {
                uriList = plainText;
            }
        }

        const lines = uriList ? uriList.split(/[\r\n]+/).map(s => s.trim()).filter(Boolean) : [];
        const fileUris = lines.filter(s => s.startsWith("file://"));

        if (fileUris.length > 0) {
            e.preventDefault();
            e.stopPropagation();
            e.stopImmediatePropagation();

            const filesToUpload = [];
            for (const uri of fileUris) {
                try {
                    const res = await ipcRenderer.invoke("deadcord:read-file-for-upload", uri);
                    if (res && res.data) {
                        filesToUpload.push(new File([res.data], res.name, { type: res.type }));
                    }
                } catch (_) {}
            }

            if (filesToUpload.length > 0) {
                dispatchUploadedFiles(filesToUpload, e.target);
            }
            return;
        }

        if (!plainText || plainText.trim().length === 0) {
            try {
                const imgRes = await ipcRenderer.invoke("deadcord:get-clipboard-image");
                if (imgRes && imgRes.data && imgRes.data.length > 0) {
                    e.preventDefault();
                    e.stopPropagation();
                    e.stopImmediatePropagation();
                    const fileObj = new File([imgRes.data], imgRes.name, { type: imgRes.type });
                    dispatchUploadedFiles([fileObj], e.target);
                }
            } catch (_) {}
        }
    }, true);
}

hookUniversalFileUpload();

document.addEventListener("DOMContentLoaded", () => {
    hookE2EESend();

    const observer = new MutationObserver((mutations) => {
        for (let i = 0; i < mutations.length; i++) {
            const mut = mutations[i];
            for (let j = 0; j < mut.addedNodes.length; j++) {
                processMessageNode(mut.addedNodes[j]);
            }
        }
    });
    if (document.body) {
        observer.observe(document.body, { childList: true, subtree: true });
    }
});

const vesktopNative = {
    app: {
        relaunch: () => ipcRenderer.invoke("deadcord:relaunch"),
        getVersion: () => "1.2.0",
        setBadgeCount: () => {},
        supportsWindowsTransparency: () => false,
        getEnableHardwareAcceleration: () => true,
        isOutdated: () => Promise.resolve(false),
        openUpdater: () => {},
        getRendererCss: () => Promise.resolve(""),
        onRendererCssUpdate: () => {}
    },
    autostart: {
        isEnabled: () => false,
        enable: () => {},
        disable: () => {}
    },
    fileManager: {
        isUsingCustomVencordDir: () => false,
        showCustomVencordDir: () => {},
        selectVencordDir: () => Promise.resolve("ok"),
        chooseUserAsset: () => Promise.resolve("ok")
    },
    settings: {
        get: () => ({}),
        set: () => {}
    },
    spellcheck: {
        getAvailableLanguages: () => [],
        onSpellcheckResult: () => {},
        offSpellcheckResult: () => {},
        replaceMisspelling: () => {},
        addToDictionary: () => {}
    },
    win: {
        focus: () => {},
        close: () => ipcRenderer.send("deadcord:close"),
        minimize: () => ipcRenderer.send("deadcord:minimize"),
        maximize: () => ipcRenderer.send("deadcord:maximize"),
        flashFrame: () => {},
        setDevtoolsCallbacks: () => {}
    },
    capturer: {
        getLargeThumbnail: () => Promise.resolve("")
    },
    virtmic: {
        list: () => Promise.resolve({ ok: false, isGlibCxxOutdated: false }),
        start: () => {},
        startSystem: () => {},
        unmute: () => {},
        stop: () => {}
    },
    clipboard: {
        copyImage: (buf) => ipcRenderer.invoke("deadcord:copy-image", buf)
    },
    debug: {
        launchGpu: () => {},
        launchWebrtcInternals: () => {}
    },
    rpc: {
        ready: () => ipcRenderer.send("deadcord:request-reemit-activities"),
        send: () => {},
        close: () => {}
    },
    commands: {
        onCommand: () => {},
        respond: () => {}
    }
};

contextBridge.exposeInMainWorld("VesktopNative", vesktopNative);

const activityListeners = new Set();
const torStatusListeners = new Set();

ipcRenderer.on("deadcord:activity-update", (_, payload) => {
    for (const cb of activityListeners) {
        try { cb(payload); } catch (_) {}
    }
});

ipcRenderer.on("deadcord:tor-status", (_, status) => {
    for (const cb of torStatusListeners) {
        try { cb(status); } catch (_) {}
    }
});

contextBridge.exposeInMainWorld("DeadcordNative", {
    switchProfile: (profileId) => ipcRenderer.send("deadcord:switch-profile", profileId),
    purgeSession: () => ipcRenderer.invoke("deadcord:purge-session"),
    getPrivacyStats: () => ipcRenderer.invoke("deadcord:get-privacy-stats"),
    getActiveProfile: () => ipcRenderer.invoke("deadcord:get-active-profile"),
    getConfig: () => ipcRenderer.invoke("deadcord:get-config"),
    saveConfig: (cfg) => {
        if (cfg && cfg.e2eeKey !== undefined) {
            e2eeSecretPassphrase = cfg.e2eeKey;
            derivedKeyCache.clear();
        }
        try {
            if (cfg && (cfg.streamFps !== undefined || cfg.streamResolution !== undefined || cfg.streamQualityUnlock !== undefined)) {
                const patch = {};
                if (cfg.streamFps !== undefined) patch.streamFps = Number(cfg.streamFps) || 60;
                if (cfg.streamResolution !== undefined) patch.streamResolution = cfg.streamResolution;
                if (cfg.streamQualityUnlock !== undefined) patch.streamQualityUnlock = Boolean(cfg.streamQualityUnlock);
                webFrame.executeJavaScript(`window.__deadcordStreamConfig = Object.assign(window.__deadcordStreamConfig || {}, ${JSON.stringify(patch)});`);
            }
            if (cfg && cfg.exifCleanerEnabled !== undefined) {
                webFrame.executeJavaScript(`window.__deadcordExifEnabled = ${cfg.exifCleanerEnabled ? "true" : "false"};`);
            }
            if (cfg && cfg.torEnabled !== undefined) {
                webFrame.executeJavaScript(`window.__deadcordTorEnabled = ${cfg.torEnabled ? "true" : "false"};`);
            }
            if (cfg && cfg.clientIdentity !== undefined) {
                webFrame.executeJavaScript(getMainWorldIdentityPatchScript(cfg.clientIdentity));
            }
        } catch (_) {}
        return ipcRenderer.invoke("deadcord:save-config", cfg);
    },
    setE2EEKey: (key) => {
        e2eeSecretPassphrase = key || "";
        derivedKeyCache.clear();
        return ipcRenderer.invoke("deadcord:save-config", { e2eeKey: e2eeSecretPassphrase });
    },
    getE2EEKey: () => e2eeSecretPassphrase,
    renewTorCircuit: () => ipcRenderer.invoke("deadcord:renew-tor-circuit"),
    clearClipboard: () => ipcRenderer.invoke("deadcord:clear-clipboard"),
    applyVencordPreset: (enabled) => ipcRenderer.invoke("deadcord:apply-vencord-preset", enabled),
    getVencordPresetStatus: () => ipcRenderer.invoke("deadcord:get-vencord-preset-status"),
    triggerPanic: () => ipcRenderer.send("deadcord:panic"),
    reload: () => ipcRenderer.send("deadcord:reload"),
    relaunch: () => ipcRenderer.invoke("deadcord:relaunch"),
    minimize: () => ipcRenderer.send("deadcord:minimize"),
    maximize: () => ipcRenderer.send("deadcord:maximize"),
    close: () => ipcRenderer.send("deadcord:close"),
    getGameStatus: () => ipcRenderer.invoke("deadcord:get-game-status"),
    getProcesses: () => ipcRenderer.invoke("deadcord:get-processes"),
    syncUser: (user) => ipcRenderer.send("deadcord:sync-user", user),
    needsDetectableRefresh: () => ipcRenderer.invoke("deadcord:needs-detectable-refresh"),
    updateDetectableGames: (games) => ipcRenderer.invoke("deadcord:update-detectable-games", games),
    requestReemitActivities: () => ipcRenderer.send("deadcord:request-reemit-activities"),
    reportExifCleaned: () => ipcRenderer.send("deadcord:report-exif-cleaned"),
    onActivityUpdate: (cb) => {
        if (typeof cb !== "function") return () => {};
        activityListeners.add(cb);
        return () => activityListeners.delete(cb);
    },
    onTorStatus: (cb) => {
        if (typeof cb !== "function") return () => {};
        torStatusListeners.add(cb);
        return () => torStatusListeners.delete(cb);
    }
});

try {
    const vencordPreloadPath = path.join(__dirname, "..", "vencord", "vencordDesktopPreload.js");
    if (fs.existsSync(vencordPreloadPath)) {
        Function("require", "process", fs.readFileSync(vencordPreloadPath, "utf-8"))(require, process);
    }
} catch (_) {}

try {
    const vencordCssPath = path.join(__dirname, "..", "vencord", "vencordDesktopRenderer.css");
    if (fs.existsSync(vencordCssPath)) {
        webFrame.insertCSS(fs.readFileSync(vencordCssPath, "utf-8"));
    }
} catch (_) {}

try {
    const vencordRendererPath = path.join(__dirname, "..", "vencord", "vencordDesktopRenderer.js");
    if (fs.existsSync(vencordRendererPath)) {
        webFrame.executeJavaScript(fs.readFileSync(vencordRendererPath, "utf-8"));
    }
} catch (_) {}

try {
    const deadcordRendererPath = path.join(__dirname, "deadcordRenderer.js");
    if (fs.existsSync(deadcordRendererPath)) {
        webFrame.executeJavaScript(fs.readFileSync(deadcordRendererPath, "utf-8"));
    }
} catch (_) {}
