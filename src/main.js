"use strict";

const {
    app,
    BrowserWindow,
    session,
    ipcMain,
    shell,
    dialog,
    nativeImage,
    clipboard,
    desktopCapturer,
    safeStorage
} = require("electron");
const path = require("path");
const fs = require("fs");
const net = require("net");
const { spawn, execSync } = require("child_process");

const { PrivacyShield, isTrustedDiscordOrigin } = require("./privacyShield");
const { getIdentityProfile, IDENTITY_PROFILES } = require("./clientIdentity");
const { stripImageMetadata } = require("./exifCleaner");
const { GameActivityManager } = require("./gameActivity");

const privacyShield = new PrivacyShield();
const configuredDownloadSessions = new WeakSet();

const configPath = path.join(app.getPath("userData"), "config.json");

const DEFAULT_CONFIG = {
    torEnabled: true,
    bridgeMode: "none",
    customBridge: "",
    e2eeKey: "",
    streamFps: 60,
    streamResolution: "1080",
    streamQualityUnlock: true,
    clientIdentity: process.platform === "win32" ? "discord-windows" : "discord-linux",
    gameDetectionEnabled: true,
    rpcServerEnabled: true,
    exifCleanerEnabled: true,
    contentProtectionEnabled: false,
    customGames: []
};

const VALID_BRIDGE_MODES = new Set(["none", "snowflake", "custom"]);
const VALID_RESOLUTIONS = new Set(["720", "1080", "1440", "source"]);

function encryptSecret(plain) {
    if (!plain || typeof plain !== "string") return "";
    try {
        if (safeStorage && safeStorage.isEncryptionAvailable()) {
            return "enc:" + safeStorage.encryptString(plain).toString("base64");
        }
    } catch (_) {}
    return plain;
}

function decryptSecret(stored) {
    if (!stored || typeof stored !== "string") return "";
    if (stored.startsWith("enc:")) {
        try {
            if (safeStorage && safeStorage.isEncryptionAvailable()) {
                return safeStorage.decryptString(Buffer.from(stored.slice(4), "base64"));
            }
        } catch (_) {
            return "";
        }
    }
    return stored;
}

function sanitizeConfigPatch(patch) {
    if (!patch || typeof patch !== "object" || Array.isArray(patch)) return {};
    const out = {};
    if (typeof patch.torEnabled === "boolean") out.torEnabled = patch.torEnabled;
    if (typeof patch.bridgeMode === "string" && VALID_BRIDGE_MODES.has(patch.bridgeMode)) out.bridgeMode = patch.bridgeMode;
    if (typeof patch.customBridge === "string") out.customBridge = patch.customBridge.replace(/[\r\n]/g, "").trim().slice(0, 512);
    if (typeof patch.e2eeKey === "string") out.e2eeKey = patch.e2eeKey.slice(0, 512);
    if (typeof patch.streamFps === "number" && (patch.streamFps === 30 || patch.streamFps === 60)) out.streamFps = patch.streamFps;
    if (typeof patch.streamResolution === "string" && VALID_RESOLUTIONS.has(patch.streamResolution)) out.streamResolution = patch.streamResolution;
    if (typeof patch.streamQualityUnlock === "boolean") out.streamQualityUnlock = patch.streamQualityUnlock;
    if (typeof patch.clientIdentity === "string" && Object.prototype.hasOwnProperty.call(IDENTITY_PROFILES, patch.clientIdentity)) {
        out.clientIdentity = patch.clientIdentity;
    }
    if (typeof patch.gameDetectionEnabled === "boolean") out.gameDetectionEnabled = patch.gameDetectionEnabled;
    if (typeof patch.rpcServerEnabled === "boolean") out.rpcServerEnabled = patch.rpcServerEnabled;
    if (typeof patch.exifCleanerEnabled === "boolean") out.exifCleanerEnabled = patch.exifCleanerEnabled;
    if (typeof patch.contentProtectionEnabled === "boolean") out.contentProtectionEnabled = patch.contentProtectionEnabled;
    if (Array.isArray(patch.customGames)) {
        out.customGames = patch.customGames
            .slice(0, 100)
            .filter(g => g && typeof g.executable === "string" && g.executable.trim() && typeof g.name === "string" && g.name.trim())
            .map(g => ({
                executable: g.executable.trim().slice(0, 128),
                name: g.name.trim().slice(0, 128)
            }));
    }
    return out;
}

function loadConfig() {
    try {
        if (fs.existsSync(configPath)) {
            const raw = JSON.parse(fs.readFileSync(configPath, "utf-8"));
            const safePatch = sanitizeConfigPatch(raw);
            const merged = { ...DEFAULT_CONFIG, ...safePatch };
            if (typeof raw.e2eeKeyEncrypted === "string") {
                merged.e2eeKey = decryptSecret(raw.e2eeKeyEncrypted);
            }
            return merged;
        }
    } catch (_) {}
    return { ...DEFAULT_CONFIG };
}

function saveConfig(cfg) {
    try {
        const current = loadConfig();
        const updated = { ...current, ...sanitizeConfigPatch(cfg) };

        const dir = path.dirname(configPath);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
        }

        const diskPayload = { ...updated };
        if (diskPayload.e2eeKey) {
            const enc = encryptSecret(diskPayload.e2eeKey);
            if (enc.startsWith("enc:")) {
                diskPayload.e2eeKeyEncrypted = enc;
                delete diskPayload.e2eeKey;
            }
        } else {
            delete diskPayload.e2eeKeyEncrypted;
        }

        fs.writeFileSync(configPath, JSON.stringify(diskPayload, null, 2), {
            encoding: "utf-8",
            mode: 0o600
        });
        try {
            if (process.platform !== "win32") fs.chmodSync(configPath, 0o600);
        } catch (_) {}
        return updated;
    } catch (_) {
        return loadConfig();
    }
}

let userConfig = loadConfig();
if (process.argv.includes("--no-tor")) {
    userConfig.torEnabled = false;
} else if (process.argv.includes("--tor")) {
    userConfig.torEnabled = true;
}

const gotInstanceLock = app.requestSingleInstanceLock();
if (!gotInstanceLock) {
    app.quit();
}

app.commandLine.appendSwitch(
    "enable-features",
    "UseOzonePlatform,WebRTCPipeWireCapturer,AcceleratedVideoDecoder,AcceleratedVideoDecodeLinuxGL,AcceleratedVideoDecodeLinuxZeroCopyGL,VaapiVideoDecoder,VaapiVideoDecodeLinuxGL"
);
app.commandLine.appendSwitch(
    "disable-features",
    "WaylandWpColorManagerV1,HardwareMediaKeyHandling,MediaSessionService,Vulkan"
);
if (process.platform === "linux" && (process.env.XDG_SESSION_TYPE === "wayland" || process.env.WAYLAND_DISPLAY)) {
    app.commandLine.appendSwitch("ozone-platform", "wayland");
}
app.commandLine.appendSwitch("ignore-gpu-blocklist");
app.commandLine.appendSwitch("enable-gpu-rasterization");
app.commandLine.appendSwitch("enable-zero-copy");
app.commandLine.appendSwitch("disable-breakpad");
app.commandLine.appendSwitch("disable-component-update");
app.commandLine.appendSwitch("disable-background-networking");
app.commandLine.appendSwitch("disable-sync");

if (userConfig.torEnabled) {
    app.commandLine.appendSwitch("host-resolver-rules", "MAP * ~NOTFOUND , EXCLUDE 127.0.0.1");
}

if (process.platform === "win32") {
    app.setAppUserModelId("org.deadcow.deadcord");
}

app.on("web-contents-created", (_, contents) => {
    contents.on("will-attach-webview", (event) => {
        event.preventDefault();
    });
});

app.on("certificate-error", (event, webContents, url, error, certificate, callback) => {
    event.preventDefault();
    callback(false);
});

let torProcess = null;
let torReady = false;
let activeTorPort = 9052;
let consecutiveTorFailures = 0;
let torMonitorTimer = null;

const DANGEROUS_EXTENSIONS = [
    ".exe", ".bat", ".cmd", ".sh", ".vbs", ".ps1", ".scr", ".jar",
    ".apk", ".com", ".pif", ".msi", ".elf", ".bin", ".desktop",
    ".appimage", ".lnk", ".hta", ".reg", ".dll", ".so", ".dylib",
    ".wsf", ".iso", ".dmg", ".run", ".deb", ".rpm"
];

const BLOCKED_UPLOAD_SEGMENTS = [
    "/.ssh/",
    "/.gnupg/",
    "/.aws/",
    "/.kube/",
    "/.config/deadcord/",
    "/.config/discord/",
    "/.config/google-chrome/",
    "/.config/chromium/",
    "/.mozilla/",
    "/etc/shadow",
    "/etc/gshadow",
    "/etc/passwd",
    "/proc/",
    "/sys/",
    "/dev/"
];

const BLOCKED_UPLOAD_FILENAMES = new Set([
    "id_rsa", "id_ed25519", "id_ecdsa", "id_dsa", "authorized_keys",
    "known_hosts", ".env", ".netrc", ".npmrc", ".pypirc", "credentials",
    "config.json", "cookies", "login data", "key4.db", "logins.json"
]);

const SUSPICIOUS_PHISHING_PATTERNS = [
    /^xn--/i,
    /\.xn--/i,
    /disc[0o]r[dc]l?[-.](?:gift|nitro|app|claim|airdrop|promo)/i,
    /dlscord\./i,
    /discorcl\./i,
    /steamcommun[il]ty\./i,
    /steamcommunity[-.]/i
];

function isPrivateOrLoopbackHost(hostname) {
    const h = String(hostname || "").toLowerCase().replace(/^\[|\]$/g, "");
    if (!h) return true;
    if (h === "localhost" || h === "::1" || h.endsWith(".local") || h.endsWith(".internal")) return true;
    if (/^127\./.test(h) || /^10\./.test(h) || /^192\.168\./.test(h) || /^169\.254\./.test(h) || /^0\./.test(h)) return true;
    if (/^172\.(1[6-9]|2\d|3[0-1])\./.test(h)) return true;
    if (/^(fc|fd|fe80)/i.test(h)) return true;
    return false;
}

function openExternalSafely(rawUrl) {
    try {
        const parsed = new URL(rawUrl);
        if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
            return;
        }
        if (isPrivateOrLoopbackHost(parsed.hostname)) {
            return;
        }

        const isHttp = parsed.protocol === "http:";
        const isSuspicious = SUSPICIOUS_PHISHING_PATTERNS.some(re => re.test(parsed.hostname));

        if (isSuspicious || isHttp) {
            const reason = isSuspicious
                ? "Ce lien ressemble a un domaine suspect ou de phishing (homographe / faux Discord)."
                : "Ce lien utilise HTTP non chiffre (en clair).";
            const choice = dialog.showMessageBoxSync(mainWindow, {
                type: "warning",
                buttons: ["Bloquer (Recommande)", "Ouvrir quand meme"],
                defaultId: 0,
                cancelId: 0,
                title: "Deadcord Anti-Phishing",
                message: `${reason}\n\nDestination : ${parsed.toString()}`
            });
            if (choice !== 1) return;
        }

        shell.openExternal(parsed.toString());
    } catch (_) {}
}

function isPathBlockedForUpload(resolvedPath) {
    const norm = resolvedPath.replace(/\\/g, "/").toLowerCase();
    for (const seg of BLOCKED_UPLOAD_SEGMENTS) {
        if (norm.includes(seg) || norm.startsWith(seg.replace(/\/$/, ""))) {
            return true;
        }
    }
    const base = path.basename(norm);
    if (BLOCKED_UPLOAD_FILENAMES.has(base)) return true;
    if (base.endsWith(".pem") || base.endsWith(".key") || base.endsWith(".p12") || base.endsWith(".pfx") || base.endsWith(".kdbx")) {
        return true;
    }
    return false;
}

function isAllowedIpcSender(event) {
    if (!event || !event.sender) return false;
    if (mainWindow && !mainWindow.isDestroyed() && event.sender !== mainWindow.webContents) {
        return false;
    }
    const frameUrl = (event.senderFrame && event.senderFrame.url) || event.sender.getURL() || "";
    if (!frameUrl || frameUrl === "about:blank") return true;
    return isTrustedDiscordOrigin(frameUrl);
}

function findTorBinary() {
    const home = process.env.HOME || process.env.USERPROFILE || "";
    const candidates = [
        path.join(__dirname, "..", "bin", process.platform === "win32" ? "tor.exe" : "tor"),
        path.join(home, ".local", "bin", "tor"),
        path.join(home, "AppData", "Local", "Deadcord", "tor", "tor.exe"),
        "/usr/bin/tor",
        "/usr/local/bin/tor"
    ];
    for (const c of candidates) {
        if (fs.existsSync(c)) return c;
    }
    try {
        const cmd = process.platform === "win32" ? "where tor" : "which tor";
        const found = execSync(cmd, { encoding: "utf-8", stdio: ["ignore", "pipe", "ignore"] }).split(/\r?\n/)[0].trim();
        if (found && fs.existsSync(found)) return found;
    } catch (_) {}
    return null;
}

function probeTorPort(timeoutMs = 2000) {
    return new Promise((resolve) => {
        const sock = net.createConnection({ port: activeTorPort, host: "127.0.0.1" });
        let settled = false;
        const done = (ok) => {
            if (settled) return;
            settled = true;
            try { sock.destroy(); } catch (_) {}
            resolve(ok);
        };
        sock.setTimeout(timeoutMs, () => done(false));
        sock.on("connect", () => done(true));
        sock.on("error", () => done(false));
    });
}

async function waitForTorReady(maxWaitMs = 15000) {
    const deadline = Date.now() + maxWaitMs;
    while (Date.now() < deadline) {
        if (!userConfig.torEnabled) return false;
        if (!torProcess || torProcess.killed) return false;
        const open = await probeTorPort(800);
        if (open) {
            torReady = true;
            consecutiveTorFailures = 0;
            privacyShield.setKillSwitch(false);
            notifyTorStatus();
            return true;
        }
        await new Promise(r => setTimeout(r, 250));
    }
    return false;
}

function notifyTorStatus() {
    if (mainWindow && !mainWindow.isDestroyed()) {
        try {
            mainWindow.webContents.send("deadcord:tor-status", {
                torEnabled: userConfig.torEnabled,
                torReady,
                killSwitchTripped: privacyShield.isKillSwitchTripped(),
                port: activeTorPort
            });
        } catch (_) {}
    }
}

function startTorDaemon() {
    if (!userConfig.torEnabled) {
        torReady = false;
        privacyShield.setKillSwitch(false);
        return false;
    }

    torReady = false;
    privacyShield.setKillSwitch(true);

    const torBin = findTorBinary();
    if (!torBin) {
        notifyTorStatus();
        return false;
    }

    const torDataDir = path.join(app.getPath("userData"), "tor_runtime");
    if (!fs.existsSync(torDataDir)) {
        fs.mkdirSync(torDataDir, { recursive: true, mode: 0o700 });
    } else if (process.platform !== "win32") {
        try { fs.chmodSync(torDataDir, 0o700); } catch (_) {}
    }

    const torArgs = [
        "--SocksPort", `127.0.0.1:${activeTorPort} IsolateDestAddr IsolateDestPort`,
        "--DataDirectory", torDataDir,
        "--PidFile", path.join(torDataDir, "tor.pid")
    ];

    if (userConfig.bridgeMode === "snowflake") {
        torArgs.push("--UseBridges", "1");
        const snowflakeClient = "/usr/bin/snowflake-client";
        if (fs.existsSync(snowflakeClient)) {
            torArgs.push("--ClientTransportPlugin", `snowflake exec ${snowflakeClient}`);
        }
    } else if (userConfig.bridgeMode === "custom" && userConfig.customBridge) {
        const sanitizedBridge = String(userConfig.customBridge).replace(/[\r\n]/g, "").trim();
        if (sanitizedBridge) {
            torArgs.push("--UseBridges", "1");
            torArgs.push("--Bridge", sanitizedBridge);
        }
    }

    try {
        torProcess = spawn(torBin, torArgs, { stdio: ["ignore", "pipe", "ignore"] });

        if (torProcess.stdout) {
            torProcess.stdout.on("data", (chunk) => {
                const text = chunk.toString("utf-8");
                if (text.includes("Bootstrapped 100%")) {
                    torReady = true;
                    consecutiveTorFailures = 0;
                    privacyShield.setKillSwitch(false);
                    notifyTorStatus();
                }
            });
        }

        torProcess.on("error", () => {
            torProcess = null;
            torReady = false;
            if (userConfig.torEnabled) privacyShield.setKillSwitch(true);
            notifyTorStatus();
        });

        torProcess.on("exit", () => {
            torProcess = null;
            torReady = false;
            if (userConfig.torEnabled) privacyShield.setKillSwitch(true);
            notifyTorStatus();
        });

        consecutiveTorFailures = 0;
        return true;
    } catch (_) {
        torProcess = null;
        torReady = false;
        privacyShield.setKillSwitch(true);
        notifyTorStatus();
        return false;
    }
}

function renewTorCircuit() {
    if (!userConfig.torEnabled || !torProcess || torProcess.killed) return false;
    try {
        if (process.platform !== "win32") {
            torProcess.kill("SIGHUP");
            return true;
        }
        stopTorDaemon();
        return startTorDaemon();
    } catch (_) {
        return false;
    }
}

function stopTorDaemon() {
    torReady = false;
    if (torProcess) {
        const proc = torProcess;
        torProcess = null;
        try { proc.kill("SIGTERM"); } catch (_) {}
        setTimeout(() => {
            try { proc.kill("SIGKILL"); } catch (_) {}
        }, 800);
    }
}

function startTorMonitor() {
    if (torMonitorTimer) return;
    torMonitorTimer = setInterval(async () => {
        if (!userConfig.torEnabled) return;
        if (!torProcess || torProcess.killed) {
            torReady = false;
            privacyShield.setKillSwitch(true);
            notifyTorStatus();
            return;
        }
        const ok = await probeTorPort(2500);
        if (ok) {
            consecutiveTorFailures = 0;
            torReady = true;
            if (privacyShield.isKillSwitchTripped()) {
                privacyShield.setKillSwitch(false);
                notifyTorStatus();
            }
        } else {
            consecutiveTorFailures++;
            if (consecutiveTorFailures >= 2) {
                torReady = false;
                privacyShield.setKillSwitch(true);
                notifyTorStatus();
            }
        }
    }, 4000);
}

const gameActivity = new GameActivityManager(app.getPath("userData"));
gameActivity.configure({
    gameDetectionEnabled: userConfig.gameDetectionEnabled !== false,
    rpcServerEnabled: userConfig.rpcServerEnabled !== false,
    customGames: userConfig.customGames || []
});

gameActivity.on("activity-update", (payload) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
        try {
            mainWindow.webContents.send("deadcord:activity-update", payload);
        } catch (_) {}
    }
});

function wipeIncognitoSession() {
    try {
        const incSess = session.fromPartition(PROFILES.incognito.partition);
        incSess.clearStorageData().catch(() => {});
        incSess.clearCache().catch(() => {});
    } catch (_) {}
}

function cleanupAllDaemons() {
    if (torMonitorTimer) {
        clearInterval(torMonitorTimer);
        torMonitorTimer = null;
    }
    wipeIncognitoSession();
    gameActivity.stop();
    stopTorDaemon();
}

app.on("before-quit", cleanupAllDaemons);
app.on("will-quit", cleanupAllDaemons);
process.on("exit", cleanupAllDaemons);
process.on("SIGINT", () => {
    cleanupAllDaemons();
    process.exit(0);
});
process.on("SIGTERM", () => {
    cleanupAllDaemons();
    process.exit(0);
});

const vencordDir = path.join(__dirname, "..", "vencord");
const vencordUserData = path.join(app.getPath("userData"), "vencordData");
process.env.VENCORD_USER_DATA_DIR = vencordUserData;

const RECOMMENDED_VENCORD_PLUGINS = [
    "Translate",
    "NoTrack",
    "VoiceMessages",
    "BetterFolders",
    "ClearURLs",
    "ValidUser",
    "PermissionsViewer",
    "SilentMessageToggle",
    "CallTimer",
    "VolumeBooster",
    "RelationshipNotifier",
    "BiggerStreamPreview",
    "ImageZoom",
    "TypingTweaks",
    "FixCodeblockGap",
    "FixImagesQuality",
    "FixSpotifyEmbeds",
    "FixYoutubeEmbeds",
    "OpenInApp",
    "WebKeybinds",
    "WebScreenShareFixes",
    "BadgeAPI",
    "CommandsAPI",
    "MessageAccessoriesAPI",
    "UserSettingsAPI",
    "CrashHandler"
];

function ensureVencordPreset(enabled = true) {
    const settingsDir = path.join(vencordUserData, "settings");
    const settingsFile = path.join(settingsDir, "settings.json");
    try {
        if (!fs.existsSync(settingsDir)) {
            fs.mkdirSync(settingsDir, { recursive: true, mode: 0o700 });
        }
        let settings = {};
        if (fs.existsSync(settingsFile)) {
            try {
                settings = JSON.parse(fs.readFileSync(settingsFile, "utf-8"));
            } catch (_) {}
        }
        settings.plugins = settings.plugins || {};
        for (const p of RECOMMENDED_VENCORD_PLUGINS) {
            settings.plugins[p] = { enabled: Boolean(enabled) };
        }
        fs.writeFileSync(settingsFile, JSON.stringify(settings, null, 4), { encoding: "utf-8", mode: 0o600 });
        return true;
    } catch (_) {
        return false;
    }
}

const vencordSettingsFile = path.join(vencordUserData, "settings", "settings.json");
if (!fs.existsSync(vencordSettingsFile)) {
    ensureVencordPreset(true);
}

try {
    const vencordMainPath = path.join(vencordDir, "vencordDesktopMain.js");
    if (fs.existsSync(vencordMainPath)) {
        require(vencordMainPath);
    }
} catch (_) {}

const PROFILES = {
    p1: { id: "p1", name: "Compte 1", partition: "persist:deadcord_profile_1", color: "#5865F2" },
    p2: { id: "p2", name: "Compte 2", partition: "persist:deadcord_profile_2", color: "#3BA55D" },
    p3: { id: "p3", name: "Compte 3", partition: "persist:deadcord_profile_3", color: "#FAA81A" },
    incognito: { id: "incognito", name: "Ephemere", partition: "deadcord_incognito", color: "#ED4245" }
};

let currentProfile = "p1";
let mainWindow = null;

async function applyProxyToSession(sess) {
    if (userConfig.torEnabled) {
        await sess.setProxy({
            proxyRules: `socks5://127.0.0.1:${activeTorPort}`,
            proxyBypassRules: "<-loopback>"
        });
    } else if (process.env.DEADCORD_PROXY) {
        await sess.setProxy({ proxyRules: process.env.DEADCORD_PROXY });
    } else {
        await sess.setProxy({ mode: "direct" });
    }
}

function getSessionForProfile(profileId) {
    const prof = Object.prototype.hasOwnProperty.call(PROFILES, profileId) ? PROFILES[profileId] : PROFILES.p1;
    const sess = session.fromPartition(prof.partition);

    applyProxyToSession(sess).catch(() => {});

    try {
        sess.setDisplayMediaRequestHandler(async (request, callback) => {
            try {
                const isWayland =
                    process.platform === "linux" &&
                    (process.env.XDG_SESSION_TYPE === "wayland" || !!process.env.WAYLAND_DISPLAY);
                let targetWidth = 1920;
                if (userConfig.streamResolution === "720") targetWidth = 1280;
                else if (userConfig.streamResolution === "1440") targetWidth = 2560;
                else if (userConfig.streamResolution === "source") targetWidth = 3840;

                const width = isWayland ? targetWidth : 176;
                const sources = await desktopCapturer.getSources({
                    types: ["screen", "window"],
                    thumbnailSize: {
                        width,
                        height: Math.round(width * (9 / 16))
                    }
                });

                if (!sources || sources.length === 0) {
                    return callback(null);
                }

                const streams = { video: sources[0] };
                if (request.audioRequested) {
                    streams.audio = "loopback";
                }

                callback(streams);
            } catch (_) {
                callback(null);
            }
        });
    } catch (_) {}

    if (!configuredDownloadSessions.has(sess)) {
        configuredDownloadSessions.add(sess);
        sess.on("will-download", (event, item) => {
            const safeName = path.basename(item.getFilename() || "download.bin").replace(/[<>:"/\\|?*\x00-\x1f]/g, "_");
            const lowerName = safeName.toLowerCase();
            const isDangerous = DANGEROUS_EXTENSIONS.some(ext => lowerName.endsWith(ext));
            if (isDangerous) {
                item.pause();
                const choice = dialog.showMessageBoxSync(mainWindow, {
                    type: "warning",
                    buttons: ["Annuler (Securite)", "Telecharger en Quarantaine (Non-executable)"],
                    defaultId: 0,
                    cancelId: 0,
                    title: "Deadcord Sandbox: Fichier Potentiellement Dangereux",
                    message: `Attention : "${safeName}" est un fichier executable ou script.\nSi vous confirmez, il sera isole dans Deadcord_Quarantine sans droits d'execution.`
                });
                if (choice === 0) {
                    item.cancel();
                } else {
                    const quarantineDir = path.join(app.getPath("downloads"), "Deadcord_Quarantine");
                    if (!fs.existsSync(quarantineDir)) {
                        fs.mkdirSync(quarantineDir, { recursive: true, mode: 0o700 });
                    }
                    let savePath = path.join(quarantineDir, safeName);
                    if (fs.existsSync(savePath)) {
                        const parsed = path.parse(safeName);
                        savePath = path.join(quarantineDir, `${parsed.name}_${Date.now()}${parsed.ext}`);
                    }
                    item.setSavePath(savePath);
                    item.once("done", (_, state) => {
                        if (state === "completed" && process.platform !== "win32") {
                            try { fs.chmodSync(savePath, 0o600); } catch (_) {}
                        }
                    });
                    item.resume();
                }
            }
        });
    }

    privacyShield.applyToSession(sess, prof.name, userConfig.torEnabled, userConfig.clientIdentity);
    return sess;
}

async function panicTrigger() {
    cleanupAllDaemons();
    try { clipboard.clear(); } catch (_) {}
    for (const prof of Object.values(PROFILES)) {
        try {
            const sess = session.fromPartition(prof.partition);
            await sess.clearStorageData();
            await sess.clearCache();
        } catch (_) {}
    }
    app.exit(0);
}

function switchProfile(profileId) {
    if (!Object.prototype.hasOwnProperty.call(PROFILES, profileId)) return;
    if (currentProfile === "incognito" && profileId !== "incognito") {
        wipeIncognitoSession();
    }
    currentProfile = profileId;

    if (mainWindow && !mainWindow.isDestroyed()) {
        const oldWin = mainWindow;
        mainWindow = null;
        oldWin.close();
    }
    createWindow();
}

async function purgeSessionData() {
    const prof = PROFILES[currentProfile];
    const sess = session.fromPartition(prof.partition);

    await sess.clearStorageData({
        storages: ["cookies", "localstorage", "indexdb", "serviceworkers", "cachestorage", "shadercache"]
    });
    await sess.clearCache();

    if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.reloadIgnoringCache();
    }
    return { ok: true };
}

function createWindow() {
    const initialSession = getSessionForProfile(currentProfile);
    const identity = getIdentityProfile(userConfig.clientIdentity);

    mainWindow = new BrowserWindow({
        width: 1280,
        height: 800,
        minWidth: 800,
        minHeight: 500,
        backgroundColor: "#18191c",
        title: "Deadcord",
        autoHideMenuBar: true,
        webPreferences: {
            session: initialSession,
            preload: path.join(__dirname, "preload.js"),
            contextIsolation: true,
            nodeIntegration: false,
            nodeIntegrationInWorker: false,
            nodeIntegrationInSubFrames: false,
            webviewTag: false,
            sandbox: false,
            webSecurity: true,
            allowRunningInsecureContent: false,
            enableRemoteModule: false
        }
    });

    if (userConfig.contentProtectionEnabled) {
        try { mainWindow.setContentProtection(true); } catch (_) {}
    }

    mainWindow.webContents.setWindowOpenHandler(({ url }) => {
        try {
            const parsed = new URL(url);
            if (isTrustedDiscordOrigin(parsed.origin)) {
                return { action: "allow" };
            }
            openExternalSafely(url);
        } catch (_) {}
        return { action: "deny" };
    });

    mainWindow.webContents.on("will-navigate", (event, targetUrl) => {
        try {
            const parsed = new URL(targetUrl);
            if (!isTrustedDiscordOrigin(parsed.origin)) {
                event.preventDefault();
                openExternalSafely(targetUrl);
            }
        } catch (_) {
            event.preventDefault();
        }
    });

    mainWindow.loadURL("https://discord.com/app", {
        userAgent: identity.webUserAgent
    });

    setupKeyboardShortcuts();
}

function setupKeyboardShortcuts() {
    if (!mainWindow) return;

    mainWindow.webContents.on("before-input-event", (event, input) => {
        if (input.type !== "keyDown") return;
        const key = (input.key || "").toLowerCase();

        if (input.control && input.shift && key === "x") {
            event.preventDefault();
            panicTrigger();
        } else if (input.control && input.shift && key === "p") {
            event.preventDefault();
            purgeSessionData();
        } else if (input.control && !input.shift && !input.alt && key === "1") {
            event.preventDefault();
            switchProfile("p1");
        } else if (input.control && !input.shift && !input.alt && key === "2") {
            event.preventDefault();
            switchProfile("p2");
        } else if (input.control && !input.shift && !input.alt && key === "3") {
            event.preventDefault();
            switchProfile("p3");
        } else if (input.control && !input.shift && !input.alt && key === "4") {
            event.preventDefault();
            switchProfile("incognito");
        } else if (input.key === "F11") {
            event.preventDefault();
            mainWindow.setFullScreen(!mainWindow.isFullScreen());
        } else if (input.control && !input.shift && key === "r") {
            event.preventDefault();
            mainWindow.reload();
        } else if ((input.control && input.shift && key === "i") || input.key === "F12") {
            event.preventDefault();
            mainWindow.webContents.toggleDevTools();
        }
    });
}

ipcMain.on("deadcord:get-boot-config", (event) => {
    event.returnValue = {
        torEnabled: Boolean(userConfig.torEnabled),
        clientIdentity: userConfig.clientIdentity,
        exifCleanerEnabled: userConfig.exifCleanerEnabled !== false,
        streamFps: userConfig.streamFps || 60,
        streamResolution: userConfig.streamResolution || "1080",
        streamQualityUnlock: userConfig.streamQualityUnlock !== false
    };
});

ipcMain.handle("deadcord:read-file-for-upload", async (event, filePath) => {
    if (!isAllowedIpcSender(event)) return null;
    try {
        if (!filePath || typeof filePath !== "string") return null;
        if (filePath.startsWith("file://")) {
            filePath = decodeURIComponent(filePath.replace(/^file:\/\//, ""));
        }
        filePath = path.resolve(filePath);
        if (!fs.existsSync(filePath)) return null;

        const realPath = fs.realpathSync(filePath);
        if (isPathBlockedForUpload(realPath)) {
            return null;
        }

        const stat = fs.statSync(realPath);
        if (!stat.isFile()) return null;
        if (stat.size > 500 * 1024 * 1024) return null;

        let buffer = fs.readFileSync(realPath);
        const ext = path.extname(realPath).toLowerCase();
        const mimeMap = {
            ".png": "image/png",
            ".jpg": "image/jpeg",
            ".jpeg": "image/jpeg",
            ".gif": "image/gif",
            ".webp": "image/webp",
            ".svg": "image/svg+xml",
            ".bmp": "image/bmp",
            ".ico": "image/x-icon",
            ".mp4": "video/mp4",
            ".webm": "video/webm",
            ".mov": "video/quicktime",
            ".mp3": "audio/mpeg",
            ".ogg": "audio/ogg",
            ".wav": "audio/wav",
            ".pdf": "application/pdf",
            ".txt": "text/plain",
            ".json": "application/json",
            ".zip": "application/zip"
        };
        const type = mimeMap[ext] || "application/octet-stream";

        if (userConfig.exifCleanerEnabled !== false && type.startsWith("image/") && type !== "image/gif") {
            const cleaned = stripImageMetadata(buffer, ext);
            if (cleaned.stripped) {
                buffer = cleaned.buffer;
                privacyShield.incrementExifCleaned();
            }
        }

        return {
            name: path.basename(realPath),
            type,
            data: buffer
        };
    } catch (_) {
        return null;
    }
});

ipcMain.handle("deadcord:get-clipboard-image", async (event) => {
    if (!isAllowedIpcSender(event)) return null;
    try {
        const img = clipboard.readImage();
        if (!img.isEmpty()) {
            let pngBuffer = img.toPNG();
            if (pngBuffer && pngBuffer.length > 0) {
                if (userConfig.exifCleanerEnabled !== false) {
                    const cleaned = stripImageMetadata(pngBuffer, ".png");
                    if (cleaned.stripped) {
                        pngBuffer = cleaned.buffer;
                        privacyShield.incrementExifCleaned();
                    }
                }
                return {
                    name: "clipboard.png",
                    type: "image/png",
                    data: pngBuffer
                };
            }
        }
        if (process.platform === "linux") {
            try {
                let buf = execSync("wl-paste -t image/png", {
                    timeout: 1500,
                    maxBuffer: 50 * 1024 * 1024,
                    stdio: ["ignore", "pipe", "ignore"]
                });
                if (buf && buf.length > 0) {
                    if (userConfig.exifCleanerEnabled !== false) {
                        const cleaned = stripImageMetadata(buf, ".png");
                        if (cleaned.stripped) {
                            buf = cleaned.buffer;
                            privacyShield.incrementExifCleaned();
                        }
                    }
                    return {
                        name: "screenshot.png",
                        type: "image/png",
                        data: buf
                    };
                }
            } catch (_) {}
        }
    } catch (_) {}
    return null;
});

ipcMain.handle("deadcord:get-config", (event) => {
    if (!isAllowedIpcSender(event)) return null;
    return loadConfig();
});

ipcMain.handle("deadcord:save-config", async (event, cfg) => {
    if (!isAllowedIpcSender(event)) return null;
    const prevConfig = { ...userConfig };
    const updated = saveConfig(cfg || {});
    userConfig = updated;

    if (userConfig.torEnabled && !torProcess) {
        startTorDaemon();
        await waitForTorReady(12000);
    } else if (!userConfig.torEnabled && torProcess) {
        stopTorDaemon();
        privacyShield.setKillSwitch(false);
    } else if (
        userConfig.torEnabled &&
        torProcess &&
        (prevConfig.bridgeMode !== userConfig.bridgeMode || prevConfig.customBridge !== userConfig.customBridge)
    ) {
        stopTorDaemon();
        startTorDaemon();
        await waitForTorReady(12000);
    }

    if (mainWindow && !mainWindow.isDestroyed()) {
        try {
            mainWindow.setContentProtection(Boolean(userConfig.contentProtectionEnabled));
        } catch (_) {}
    }

    privacyShield.updateSettings({
        useTor: userConfig.torEnabled,
        clientIdentity: userConfig.clientIdentity
    });
    const sess = getSessionForProfile(currentProfile);
    await applyProxyToSession(sess);
    privacyShield.applyWebRTCPolicy(sess);

    gameActivity.configure({
        gameDetectionEnabled: userConfig.gameDetectionEnabled !== false,
        rpcServerEnabled: userConfig.rpcServerEnabled !== false,
        customGames: userConfig.customGames || []
    });

    notifyTorStatus();
    return updated;
});

ipcMain.handle("deadcord:renew-tor-circuit", (event) => {
    if (!isAllowedIpcSender(event)) return false;
    return renewTorCircuit();
});

ipcMain.handle("deadcord:clear-clipboard", (event) => {
    if (!isAllowedIpcSender(event)) return false;
    try {
        clipboard.clear();
        return true;
    } catch (_) {
        return false;
    }
});

ipcMain.handle("deadcord:copy-image", (event, buffer) => {
    if (!isAllowedIpcSender(event)) return;
    try {
        clipboard.writeImage(nativeImage.createFromBuffer(Buffer.from(buffer)));
    } catch (_) {}
});

ipcMain.handle("deadcord:apply-vencord-preset", (event, enabled) => {
    if (!isAllowedIpcSender(event)) return false;
    return ensureVencordPreset(enabled);
});

ipcMain.handle("deadcord:get-vencord-preset-status", (event) => {
    if (!isAllowedIpcSender(event)) return false;
    try {
        if (fs.existsSync(vencordSettingsFile)) {
            const data = JSON.parse(fs.readFileSync(vencordSettingsFile, "utf-8"));
            return Boolean(data.plugins && data.plugins.NoTrack && data.plugins.NoTrack.enabled);
        }
    } catch (_) {}
    return false;
});

ipcMain.handle("deadcord:get-processes", async (event) => {
    if (!isAllowedIpcSender(event)) return [];
    return await gameActivity.listRunningProcesses();
});

ipcMain.handle("deadcord:get-game-status", (event) => {
    if (!isAllowedIpcSender(event)) return null;
    return gameActivity.getStatus();
});

ipcMain.on("deadcord:sync-user", (event, user) => {
    if (!isAllowedIpcSender(event)) return;
    gameActivity.setUser(user);
});

ipcMain.handle("deadcord:needs-detectable-refresh", (event) => {
    if (!isAllowedIpcSender(event)) return false;
    return gameActivity.needsDetectableRefresh();
});

ipcMain.handle("deadcord:update-detectable-games", (event, games) => {
    if (!isAllowedIpcSender(event)) return false;
    return gameActivity.updateDetectableGames(games);
});

ipcMain.on("deadcord:request-reemit-activities", (event) => {
    if (!isAllowedIpcSender(event)) return;
    gameActivity.reemitActiveActivities();
});

ipcMain.on("deadcord:report-exif-cleaned", (event) => {
    if (!isAllowedIpcSender(event)) return;
    privacyShield.incrementExifCleaned();
});

ipcMain.on("deadcord:switch-profile", (event, profileId) => {
    if (!isAllowedIpcSender(event)) return;
    switchProfile(profileId);
});

ipcMain.handle("deadcord:purge-session", async (event) => {
    if (!isAllowedIpcSender(event)) return { ok: false };
    return await purgeSessionData();
});

ipcMain.handle("deadcord:get-privacy-stats", (event) => {
    if (!isAllowedIpcSender(event)) return null;
    return {
        ...privacyShield.getStats(),
        torReady,
        port: activeTorPort
    };
});

ipcMain.handle("deadcord:get-active-profile", (event) => {
    if (!isAllowedIpcSender(event)) return null;
    return PROFILES[currentProfile];
});

ipcMain.on("deadcord:panic", (event) => {
    if (!isAllowedIpcSender(event)) return;
    panicTrigger();
});

ipcMain.handle("deadcord:relaunch", (event) => {
    if (!isAllowedIpcSender(event)) return;
    cleanupAllDaemons();
    app.relaunch();
    app.exit(0);
});

ipcMain.on("deadcord:reload", (event) => {
    if (!isAllowedIpcSender(event)) return;
    if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.reloadIgnoringCache();
    }
});

ipcMain.on("deadcord:get-version", (event) => {
    event.returnValue = "1.2.0";
});

ipcMain.on("deadcord:minimize", () => mainWindow?.minimize());
ipcMain.on("deadcord:maximize", () => {
    if (mainWindow?.isMaximized()) mainWindow.unmaximize();
    else mainWindow?.maximize();
});
ipcMain.on("deadcord:close", () => mainWindow?.close());

app.on("second-instance", () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
        if (mainWindow.isMinimized()) mainWindow.restore();
        mainWindow.focus();
    }
});

app.whenReady().then(async () => {
    if (userConfig.torEnabled) {
        startTorDaemon();
        await waitForTorReady(12000);
    }
    startTorMonitor();
    gameActivity.start();
    createWindow();

    app.on("activate", () => {
        if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
});

app.on("window-all-closed", () => {
    cleanupAllDaemons();
    if (process.platform !== "darwin") app.quit();
});
