"use strict";

const net = require("net");
const fs = require("fs");
const path = require("path");
const EventEmitter = require("events");
const { execFile } = require("child_process");

const MAX_IPC_FRAME_BYTES = 1024 * 1024;
const MAX_IPC_CLIENTS = 32;
const IPC_OP_HANDSHAKE = 0;
const IPC_OP_FRAME = 1;
const IPC_OP_CLOSE = 2;
const IPC_OP_PING = 3;
const IPC_OP_PONG = 4;

const BUILTIN_GAMES = [
    { id: "1402418696126992445", name: "Minecraft", executables: ["minecraft-launcher", "prismlauncher", "multimc", "atlauncher", "gdlauncher", "modrinth-app", "lunarclient", "badlion"], javaKeywords: ["net.minecraft.client.main.main", "net.fabricmc.loader", "cpw.mods.bootstraplauncher", "net.minecraftforge", "optifine", "lunarclient", "badlion"] },
    { id: "356875570916753438", name: "Counter-Strike 2", executables: ["cs2", "cs2.exe", "csgo_linux64", "csgo.exe"], steamAppIds: ["730"] },
    { id: "700136079562375258", name: "VALORANT", executables: ["valorant-win64-shipping.exe", "valorant.exe"] },
    { id: "401518684763586560", name: "League of Legends", executables: ["league of legends.exe", "leagueclientux.exe"] },
    { id: "432980957394370572", name: "Fortnite", executables: ["fortniteclient-win64-shipping.exe"] },
    { id: "356875221078245376", name: "Grand Theft Auto V", executables: ["gta5.exe", "gta5_enhanced.exe", "playgtav.exe"], steamAppIds: ["271590", "3240220"] },
    { id: "623969135147745280", name: "Cyberpunk 2077", executables: ["cyberpunk2077.exe"], steamAppIds: ["1091500"] },
    { id: "945420389094461510", name: "ELDEN RING", executables: ["eldenring.exe"], steamAppIds: ["1245620"] },
    { id: "356869127241072640", name: "Terraria", executables: ["terraria.bin.x86_64", "terraria.exe"], steamAppIds: ["105600"] },
    { id: "438122941302046720", name: "Hollow Knight", executables: ["hollow_knight.x86_64", "hollow knight.exe"], steamAppIds: ["367520"] },
    { id: "356876176465199104", name: "Stardew Valley", executables: ["stardewvalley", "stardew valley.exe", "stardewmoddingapi"], steamAppIds: ["413150"] },
    { id: "379286085710381999", name: "Rocket League", executables: ["rocketleague.exe"], steamAppIds: ["252950"] },
    { id: "541160257953857536", name: "Apex Legends", executables: ["r5apex.exe", "r5apex_dx12.exe"], steamAppIds: ["1172470"] },
    { id: "356875570916753439", name: "Overwatch 2", executables: ["overwatch.exe"], steamAppIds: ["2357570"] },
    { id: "356874957361250304", name: "Rust", executables: ["rustclient.exe", "rust"], steamAppIds: ["252490"] },
    { id: "762434991303950386", name: "Genshin Impact", executables: ["genshinimpact.exe", "yuanshen.exe"] },
    { id: "367827983903490050", name: "osu!", executables: ["osu!", "osu!.exe", "osu.desktop"] },
    { id: "363409280197328897", name: "Factorio", executables: ["factorio", "factorio.exe"], steamAppIds: ["427520"] },
    { id: "438122575013478400", name: "Celeste", executables: ["celeste.bin.x86_64", "celeste", "celeste.exe"], steamAppIds: ["504230"] },
    { id: "1206645491112738847", name: "Balatro", executables: ["balatro.exe"], steamAppIds: ["2379780"] },
    { id: "1168674775148154951", name: "Lethal Company", executables: ["lethal company.exe"], steamAppIds: ["1966720"] },
    { id: "757654238820237322", name: "Phasmophobia", executables: ["phasmophobia.exe"], steamAppIds: ["739630"] },
    { id: "356947119066906624", name: "Geometry Dash", executables: ["geometrydash.exe"], steamAppIds: ["322170"] },
    { id: "356876114418728960", name: "Warframe", executables: ["warframe.x64.exe"], steamAppIds: ["230410"] },
    { id: "356875570916753437", name: "Dota 2", executables: ["dota2", "dota2.exe"], steamAppIds: ["570"] },
    { id: "356875570916753440", name: "Team Fortress 2", executables: ["tf_linux64", "hl2_linux", "tf_win64.exe"], steamAppIds: ["440"] },
    { id: "356875570916753441", name: "Garry's Mod", executables: ["gmod", "hl2_linux", "gmod.exe"], steamAppIds: ["4000"] },
    { id: "363413627098497024", name: "RimWorld", executables: ["rimworldlinux", "rimworldwin64.exe"], steamAppIds: ["294100"] },
    { id: "558059753030647808", name: "Satisfactory", executables: ["factorygame-win64-shipping.exe", "factorygamesteam-win64-shipping.exe"], steamAppIds: ["526870"] },
    { id: "1197906035409051748", name: "Palworld", executables: ["palworld-win64-shipping.exe"], steamAppIds: ["1623730"] },
    { id: "1205197914450001920", name: "HELLDIVERS 2", executables: ["helldivers2.exe"], steamAppIds: ["553850"] },
    { id: "356877880938070016", name: "Dead by Daylight", executables: ["deadbydaylight-win64-shipping.exe"], steamAppIds: ["381210"] },
    { id: "363445589247131668", name: "Rainbow Six Siege", executables: ["rainbowsix.exe", "rainbowsix_vulkan.exe", "rainbowsix_dx11.exe"], steamAppIds: ["359550"] },
    { id: "363445589247131648", name: "Roblox", executables: ["robloxplayerbeta.exe", "sober"] },
    { id: "356875570916753442", name: "The Witcher 3: Wild Hunt", executables: ["witcher3.exe"], steamAppIds: ["292030"] },
    { id: "356875570916753443", name: "Skyrim Special Edition", executables: ["skyrimse.exe"], steamAppIds: ["489830"] },
    { id: "1136726273452580864", name: "Baldur's Gate 3", executables: ["bg3.exe", "bg3_dx11.exe"], steamAppIds: ["1086940"] },
    { id: "356875570916753444", name: "Subnautica", executables: ["subnautica.exe"], steamAppIds: ["264710"] },
    { id: "438122941302046721", name: "Among Us", executables: ["among us.exe"], steamAppIds: ["945360"] },
    { id: "356875570916753445", name: "BeamNG.drive", executables: ["beamng.drive.x64.exe", "beamng.drive.x64"], steamAppIds: ["284160"] },
    { id: "356875570916753446", name: "Assetto Corsa", executables: ["acs.exe"], steamAppIds: ["244210"] },
    { id: "356875570916753447", name: "Euro Truck Simulator 2", executables: ["eurotrucks2", "eurotrucks2.exe"], steamAppIds: ["227300"] },
    { id: "356875570916753448", name: "Deep Rock Galactic", executables: ["fsd-win64-shipping.exe"], steamAppIds: ["548430"] },
    { id: "356875570916753449", name: "Hades", executables: ["hades.exe"], steamAppIds: ["1145360"] },
    { id: "1237146118054510652", name: "Hades II", executables: ["hades2.exe"], steamAppIds: ["1145350"] },
    { id: "356875570916753450", name: "DOOM Eternal", executables: ["doometernalx64vk.exe"], steamAppIds: ["782330"] },
    { id: "356875570916753451", name: "Red Dead Redemption 2", executables: ["rdr2.exe"], steamAppIds: ["1174180"] },
    { id: "356875570916753452", name: "No Man's Sky", executables: ["nms.exe"], steamAppIds: ["275850"] },
    { id: "356875570916753453", name: "Valheim", executables: ["valheim.x86_64", "valheim.exe"], steamAppIds: ["892970"] },
    { id: "356875570916753454", name: "Project Zomboid", executables: ["projectzomboid64", "projectzomboid64.exe"], steamAppIds: ["108600"] },
    { id: "356875570916753455", name: "ULTRAKILL", executables: ["ultrakill.exe"], steamAppIds: ["1229490"] },
    { id: "356875570916753456", name: "Risk of Rain 2", executables: ["risk of rain 2.exe"], steamAppIds: ["632360"] },
    { id: "356875570916753457", name: "Sea of Thieves", executables: ["sotgame.exe"], steamAppIds: ["1172620"] },
    { id: "356875570916753458", name: "World of Warcraft", executables: ["wow.exe", "wowclassic.exe"] },
    { id: "356875570916753459", name: "Final Fantasy XIV", executables: ["ffxiv_dx11.exe"], steamAppIds: ["39210"] },
    { id: "356875570916753460", name: "Path of Exile", executables: ["pathofexile.exe", "pathofexilesteam.exe", "pathofexile_x64.exe"], steamAppIds: ["238960"] },
    { id: "356875570916753461", name: "Path of Exile 2", executables: ["pathofexile2.exe", "pathofexile2steam.exe"], steamAppIds: ["2694490"] },
    { id: "356875570916753462", name: "War Thunder", executables: ["aces", "aces.exe"], steamAppIds: ["236390"] },
    { id: "356875570916753463", name: "Escape from Tarkov", executables: ["escapefromtarkov.exe"] },
    { id: "356875570916753464", name: "Deadlock", executables: ["project8.exe"], steamAppIds: ["1422450"] },
    { id: "356875570916753465", name: "Marvel Rivals", executables: ["marvel-win64-shipping.exe"], steamAppIds: ["2767030"] },
    { id: "383226320970055681", name: "Visual Studio Code", executables: ["code", "code.exe", "codium", "code-oss"] },
    { id: "356875570916753466", name: "Blender", executables: ["blender", "blender.exe"], steamAppIds: ["365670"] },
    { id: "438122941302046722", name: "RetroArch", executables: ["retroarch", "retroarch.exe"], steamAppIds: ["1118310"] },
    { id: "438122941302046723", name: "Dolphin Emulator", executables: ["dolphin-emu", "dolphin.exe"] },
    { id: "438122941302046724", name: "RPCS3", executables: ["rpcs3", "rpcs3.exe"] },
    { id: "438122941302046725", name: "PCSX2", executables: ["pcsx2-qt", "pcsx2", "pcsx2-qt.exe"] },
    { id: "438122941302046726", name: "Ryujinx", executables: ["ryujinx", "ryujinx.exe"] }
];

const IGNORED_PROCESSES = new Set([
    "systemd", "dbus-daemon", "pipewire", "wireplumber", "hyprland", "sway", "waybar",
    "electron", "electron43", "deadcord", "tor", "bash", "zsh", "fish", "sh", "node",
    "python", "python3", "grep", "awk", "sed", "cat", "ssh", "gpg-agent", "steam",
    "steamwebhelper", "wineserver", "services.exe", "winedevice.exe", "plugplay.exe",
    "svchost.exe", "explorer.exe", "rpcss.exe", "tabtip.exe", "conhost.exe", "start.exe",
    "wineboot.exe", "pressure-vessel", "srt-bwrap", "reaper", "fossilize_replay"
]);

function encodeIpcFrame(op, payload) {
    const jsonBuf = Buffer.from(JSON.stringify(payload), "utf-8");
    const header = Buffer.alloc(8);
    header.writeUInt32LE(op, 0);
    header.writeUInt32LE(jsonBuf.length, 4);
    return Buffer.concat([header, jsonBuf]);
}

function normalizeExeName(raw) {
    if (!raw) return "";
    return String(raw).replace(/\\/g, "/").split("/").pop().trim().toLowerCase();
}

function extractWineExe(cmdline) {
    if (!cmdline) return null;
    const matches = cmdline.match(/[A-Za-z]:[\\/][^"\0\n]+?\.exe/gi);
    if (matches && matches.length > 0) {
        for (const m of matches) {
            const base = normalizeExeName(m);
            if (base && !IGNORED_PROCESSES.has(base)) {
                return { full: m.replace(/\\/g, "/").toLowerCase(), base };
            }
        }
    }
    const bareMatch = cmdline.match(/(?:^|\s|["'])([^\s"']+\.exe)(?=$|\s|["'])/i);
    if (bareMatch && bareMatch[1]) {
        const base = normalizeExeName(bareMatch[1]);
        if (base && !IGNORED_PROCESSES.has(base)) {
            return { full: bareMatch[1].replace(/\\/g, "/").toLowerCase(), base };
        }
    }
    return null;
}

class GameActivityManager extends EventEmitter {
    constructor(userDataDir) {
        super();
        this.userDataDir = userDataDir;
        this.cachePath = path.join(userDataDir, "detectable_games_cache.json");

        this.gameDetectionEnabled = true;
        this.rpcServerEnabled = true;
        this.customGames = [];

        this.ipcServer = null;
        this.ipcSocketPath = null;
        this.flatpakSymlinkPath = null;
        this.ipcClients = new Map();
        this.nextClientId = 1;

        this.scanTimer = null;
        this.scanning = false;
        this.currentProcessGame = null;
        this.currentUser = {
            id: "0",
            username: "deadcord",
            discriminator: "0",
            global_name: "Deadcord User",
            avatar: null,
            bot: false,
            flags: 0,
            premium_type: 0
        };

        this.exeMap = new Map();
        this.steamAppMap = new Map();
        this.javaGames = [];
        this.detectableGames = [];
        this.detectableLastUpdated = 0;

        this._loadDetectableCache();
        this._rebuildIndex();
    }

    _loadDetectableCache() {
        try {
            if (fs.existsSync(this.cachePath)) {
                const parsed = JSON.parse(fs.readFileSync(this.cachePath, "utf-8"));
                if (Array.isArray(parsed.games)) {
                    this.detectableGames = parsed.games;
                    this.detectableLastUpdated = Number(parsed.updatedAt) || 0;
                }
            }
        } catch (_) {}
    }

    needsDetectableRefresh() {
        const SEVEN_DAYS = 7 * 24 * 60 * 60 * 1000;
        return this.detectableGames.length === 0 || (Date.now() - this.detectableLastUpdated) > SEVEN_DAYS;
    }

    updateDetectableGames(rawGames) {
        if (!Array.isArray(rawGames) || rawGames.length === 0) return false;
        try {
            const compact = [];
            for (const g of rawGames) {
                if (!g || !g.id || !g.name || !Array.isArray(g.executables) || g.executables.length === 0) continue;
                const exes = [];
                for (const ex of g.executables) {
                    if (ex && ex.name && !ex.is_launcher) {
                        exes.push(String(ex.name).replace(/\\/g, "/").toLowerCase());
                    }
                }
                if (exes.length > 0) {
                    compact.push({
                        id: String(g.id),
                        name: String(g.name),
                        executables: exes
                    });
                }
            }
            if (compact.length === 0) return false;

            this.detectableGames = compact;
            this.detectableLastUpdated = Date.now();
            this._rebuildIndex();

            const dir = path.dirname(this.cachePath);
            if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
            fs.writeFileSync(
                this.cachePath,
                JSON.stringify({ updatedAt: this.detectableLastUpdated, games: compact }),
                { encoding: "utf-8", mode: 0o600 }
            );
            return true;
        } catch (_) {
            return false;
        }
    }

    setCustomGames(list) {
        if (!Array.isArray(list)) {
            this.customGames = [];
        } else {
            this.customGames = list
                .slice(0, 100)
                .filter(g => g && typeof g.executable === "string" && g.executable.trim() && typeof g.name === "string" && g.name.trim())
                .map(g => ({
                    executable: g.executable.trim().slice(0, 128).toLowerCase(),
                    name: g.name.trim().slice(0, 128),
                    id: g.id ? String(g.id).trim().slice(0, 32) : null
                }));
        }
        this._rebuildIndex();
    }

    _rebuildIndex() {
        this.exeMap.clear();
        this.steamAppMap.clear();
        this.javaGames = [];

        const register = (entry, priority) => {
            if (Array.isArray(entry.executables)) {
                for (const rawExe of entry.executables) {
                    const norm = String(rawExe).replace(/\\/g, "/").toLowerCase().trim();
                    if (!norm) continue;
                    const base = normalizeExeName(norm);
                    const record = { ...entry, matchPath: norm, priority };
                    const existingFull = this.exeMap.get(norm);
                    if (!existingFull || priority >= existingFull.priority) {
                        this.exeMap.set(norm, record);
                    }
                    if (base && !IGNORED_PROCESSES.has(base)) {
                        const existingBase = this.exeMap.get(base);
                        if (!existingBase || priority >= existingBase.priority) {
                            this.exeMap.set(base, record);
                        }
                    }
                }
            }
            if (Array.isArray(entry.steamAppIds)) {
                for (const sid of entry.steamAppIds) {
                    this.steamAppMap.set(String(sid), entry);
                }
            }
            if (Array.isArray(entry.javaKeywords) && entry.javaKeywords.length > 0) {
                this.javaGames.push(entry);
            }
        };

        for (const g of this.detectableGames) register(g, 1);
        for (const g of BUILTIN_GAMES) register(g, 2);
        for (const c of this.customGames) {
            register({ id: c.id || null, name: c.name, executables: [c.executable], isCustom: true }, 3);
        }
    }

    setUser(user) {
        if (user && typeof user === "object" && user.id) {
            this.currentUser = {
                id: String(user.id),
                username: String(user.username || "deadcord"),
                discriminator: String(user.discriminator || "0"),
                global_name: user.globalName || user.global_name || user.username || "Deadcord",
                avatar: user.avatar || null,
                bot: false,
                flags: Number(user.flags) || 0,
                premium_type: Number(user.premiumType || user.premium_type) || 0
            };
        }
    }

    configure({ gameDetectionEnabled, rpcServerEnabled, customGames } = {}) {
        if (customGames !== undefined) {
            this.setCustomGames(customGames);
        }
        if (typeof gameDetectionEnabled === "boolean") {
            this.gameDetectionEnabled = gameDetectionEnabled;
            if (this.gameDetectionEnabled) {
                this._startProcessScanner();
            } else {
                this._stopProcessScanner();
            }
        }
        if (typeof rpcServerEnabled === "boolean") {
            this.rpcServerEnabled = rpcServerEnabled;
            if (this.rpcServerEnabled) {
                this._startIpcServer();
            } else {
                this._stopIpcServer();
            }
        }
    }

    start() {
        if (this.rpcServerEnabled) this._startIpcServer();
        if (this.gameDetectionEnabled) this._startProcessScanner();
    }

    stop() {
        this._stopProcessScanner();
        this._stopIpcServer();
    }

    _getIpcSocketCandidates() {
        if (process.platform === "win32") {
            return Array.from({ length: 10 }, (_, i) => `\\\\.\\pipe\\discord-ipc-${i}`);
        }
        const runtimeDir = process.env.XDG_RUNTIME_DIR || process.env.TMPDIR || process.env.TMP || "/tmp";
        return Array.from({ length: 10 }, (_, i) => path.join(runtimeDir, `discord-ipc-${i}`));
    }

    _probeSocketInUse(socketPath) {
        return new Promise((resolve) => {
            const probe = net.createConnection(socketPath);
            let done = false;
            const finish = (inUse) => {
                if (done) return;
                done = true;
                try { probe.destroy(); } catch (_) {}
                resolve(inUse);
            };
            probe.setTimeout(300, () => finish(false));
            probe.on("connect", () => finish(true));
            probe.on("error", () => finish(false));
        });
    }

    async _startIpcServer() {
        if (this.ipcServer) return;
        const candidates = this._getIpcSocketCandidates();

        for (const candidate of candidates) {
            if (process.platform !== "win32" && fs.existsSync(candidate)) {
                const inUse = await this._probeSocketInUse(candidate);
                if (inUse) continue;
                try { fs.unlinkSync(candidate); } catch (_) { continue; }
            }

            const bound = await new Promise((resolve) => {
                const server = net.createServer((socket) => this._handleIpcConnection(socket));
                server.once("error", () => {
                    try { server.close(); } catch (_) {}
                    resolve(null);
                });
                server.listen(candidate, () => {
                    if (process.platform !== "win32") {
                        try { fs.chmodSync(candidate, 0o600); } catch (_) {}
                    }
                    resolve(server);
                });
            });

            if (bound) {
                this.ipcServer = bound;
                this.ipcSocketPath = candidate;
                this._setupFlatpakSymlink(candidate);
                break;
            }
        }
    }

    _setupFlatpakSymlink(targetSocket) {
        if (process.platform !== "linux" || !process.env.XDG_RUNTIME_DIR) return;
        try {
            const flatpakDir = path.join(process.env.XDG_RUNTIME_DIR, "app", "com.discordapp.Discord");
            if (fs.existsSync(flatpakDir)) {
                const linkPath = path.join(flatpakDir, path.basename(targetSocket));
                if (!fs.existsSync(linkPath)) {
                    fs.symlinkSync(targetSocket, linkPath);
                    this.flatpakSymlinkPath = linkPath;
                }
            }
        } catch (_) {}
    }

    _stopIpcServer() {
        for (const [clientId, info] of this.ipcClients.entries()) {
            try { info.socket.destroy(); } catch (_) {}
            if (info.activity) {
                this.emit("activity-update", {
                    socketId: `deadcord-ipc-${clientId}`,
                    activity: null,
                    source: "rpc"
                });
            }
        }
        this.ipcClients.clear();

        if (this.ipcServer) {
            try { this.ipcServer.close(); } catch (_) {}
            this.ipcServer = null;
        }
        if (this.ipcSocketPath && process.platform !== "win32") {
            try {
                if (fs.existsSync(this.ipcSocketPath)) fs.unlinkSync(this.ipcSocketPath);
            } catch (_) {}
        }
        if (this.flatpakSymlinkPath) {
            try {
                if (fs.lstatSync(this.flatpakSymlinkPath).isSymbolicLink()) {
                    fs.unlinkSync(this.flatpakSymlinkPath);
                }
            } catch (_) {}
            this.flatpakSymlinkPath = null;
        }
        this.ipcSocketPath = null;
    }

    _handleIpcConnection(socket) {
        if (this.ipcClients.size >= MAX_IPC_CLIENTS) {
            socket.destroy();
            return;
        }
        const clientId = this.nextClientId++;
        const clientInfo = {
            id: clientId,
            socket,
            appId: null,
            activity: null,
            buffer: Buffer.alloc(0)
        };
        this.ipcClients.set(clientId, clientInfo);

        socket.on("data", (chunk) => {
            clientInfo.buffer = Buffer.concat([clientInfo.buffer, chunk]);
            if (clientInfo.buffer.length > MAX_IPC_FRAME_BYTES * 2) {
                socket.destroy();
                return;
            }

            while (clientInfo.buffer.length >= 8) {
                const op = clientInfo.buffer.readUInt32LE(0);
                const len = clientInfo.buffer.readUInt32LE(4);
                if (len > MAX_IPC_FRAME_BYTES) {
                    socket.destroy();
                    return;
                }
                if (clientInfo.buffer.length < 8 + len) break;

                const bodyStr = clientInfo.buffer.subarray(8, 8 + len).toString("utf-8");
                clientInfo.buffer = clientInfo.buffer.subarray(8 + len);

                let payload = null;
                try {
                    payload = JSON.parse(bodyStr);
                } catch (_) {
                    continue;
                }
                this._handleIpcFrame(clientInfo, op, payload);
            }
        });

        const cleanup = () => {
            const existed = this.ipcClients.delete(clientId);
            if (existed && clientInfo.activity) {
                this.emit("activity-update", {
                    socketId: `deadcord-ipc-${clientId}`,
                    activity: null,
                    source: "rpc"
                });
            }
        };

        socket.on("close", cleanup);
        socket.on("error", cleanup);
    }

    _handleIpcFrame(clientInfo, op, payload) {
        if (!payload || typeof payload !== "object") return;

        if (op === IPC_OP_HANDSHAKE) {
            clientInfo.appId = String(payload.client_id || "").slice(0, 32);
            const ready = {
                cmd: "DISPATCH",
                data: {
                    v: 1,
                    config: {
                        cdn_host: "cdn.discordapp.com",
                        api_endpoint: "//discord.com/api",
                        environment: "production"
                    },
                    user: this.currentUser
                },
                evt: "READY",
                nonce: null
            };
            try {
                clientInfo.socket.write(encodeIpcFrame(IPC_OP_FRAME, ready));
            } catch (_) {}
            return;
        }

        if (op === IPC_OP_PING) {
            try {
                clientInfo.socket.write(encodeIpcFrame(IPC_OP_PONG, payload));
            } catch (_) {}
            return;
        }

        if (op === IPC_OP_CLOSE) {
            clientInfo.socket.end();
            return;
        }

        if (op === IPC_OP_FRAME) {
            const cmd = payload.cmd;
            const args = payload.args || {};
            const nonce = payload.nonce ?? null;

            if (cmd === "SET_ACTIVITY") {
                const rawAct = args.activity;
                let normalized = null;
                if (rawAct && typeof rawAct === "object") {
                    normalized = {
                        application_id: clientInfo.appId,
                        type: typeof rawAct.type === "number" ? rawAct.type : 0,
                        name: rawAct.name || undefined,
                        details: rawAct.details || undefined,
                        state: rawAct.state || undefined,
                        timestamps: rawAct.timestamps || undefined,
                        assets: rawAct.assets || undefined,
                        party: rawAct.party || undefined,
                        secrets: rawAct.secrets || undefined,
                        instance: Boolean(rawAct.instance),
                        flags: rawAct.flags || 0
                    };
                    if (Array.isArray(rawAct.buttons) && rawAct.buttons.length > 0) {
                        normalized.buttons = rawAct.buttons.slice(0, 2).map(b => (typeof b === "string" ? b : b.label)).filter(Boolean);
                        normalized.metadata = {
                            button_urls: rawAct.buttons.slice(0, 2).map(b => (typeof b === "object" ? b.url : "")).filter(Boolean)
                        };
                    }
                }

                clientInfo.activity = normalized;
                this.emit("activity-update", {
                    socketId: `deadcord-ipc-${clientInfo.id}`,
                    activity: normalized,
                    pid: args.pid || null,
                    source: "rpc"
                });

                try {
                    clientInfo.socket.write(encodeIpcFrame(IPC_OP_FRAME, {
                        cmd: "SET_ACTIVITY",
                        data: normalized,
                        evt: null,
                        nonce
                    }));
                } catch (_) {}
                return;
            }

            try {
                clientInfo.socket.write(encodeIpcFrame(IPC_OP_FRAME, {
                    cmd: cmd || "DISPATCH",
                    data: null,
                    evt: null,
                    nonce
                }));
            } catch (_) {}
        }
    }

    _startProcessScanner() {
        if (this.scanTimer) return;
        this._scanOnce();
        this.scanTimer = setInterval(() => this._scanOnce(), 4000);
    }

    _stopProcessScanner() {
        if (this.scanTimer) {
            clearInterval(this.scanTimer);
            this.scanTimer = null;
        }
        if (this.currentProcessGame) {
            this.currentProcessGame = null;
            this.emit("activity-update", {
                socketId: "deadcord-process",
                activity: null,
                source: "process"
            });
        }
    }

    async _scanOnce() {
        if (this.scanning || !this.gameDetectionEnabled) return;
        this.scanning = true;
        try {
            const procs = await this.listRunningProcesses();
            const matched = this._matchGameFromProcesses(procs);

            if (matched) {
                const gameKey = `${matched.id || ""}:${matched.name}`;
                const rpcAlreadyActive = Array.from(this.ipcClients.values()).some(
                    c => c.activity && ((matched.id && c.appId === matched.id) || c.activity.name === matched.name)
                );

                if (rpcAlreadyActive) {
                    if (this.currentProcessGame) {
                        this.currentProcessGame = null;
                        this.emit("activity-update", {
                            socketId: "deadcord-process",
                            activity: null,
                            source: "process"
                        });
                    }
                    return;
                }

                if (!this.currentProcessGame || this.currentProcessGame.key !== gameKey) {
                    const startedAt = Date.now();
                    this.currentProcessGame = {
                        key: gameKey,
                        id: matched.id || null,
                        name: matched.name,
                        pid: matched.pid,
                        executable: matched.executable,
                        startedAt
                    };
                    this._emitProcessActivity();
                }
            } else if (this.currentProcessGame) {
                this.currentProcessGame = null;
                this.emit("activity-update", {
                    socketId: "deadcord-process",
                    activity: null,
                    source: "process"
                });
            }
        } catch (_) {
        } finally {
            this.scanning = false;
        }
    }

    _emitProcessActivity() {
        if (!this.currentProcessGame) return;
        const g = this.currentProcessGame;
        const activity = {
            name: g.name,
            type: 0,
            timestamps: { start: g.startedAt }
        };
        if (g.id) {
            activity.application_id = g.id;
        }
        this.emit("activity-update", {
            socketId: "deadcord-process",
            activity,
            pid: g.pid,
            source: "process"
        });
    }

    reemitActiveActivities() {
        for (const [clientId, info] of this.ipcClients.entries()) {
            if (info.activity) {
                this.emit("activity-update", {
                    socketId: `deadcord-ipc-${clientId}`,
                    activity: info.activity,
                    source: "rpc"
                });
            }
        }
        if (this.currentProcessGame) {
            this._emitProcessActivity();
        }
    }

    _matchGameFromProcesses(procs) {
        let bestMatch = null;
        let bestPriority = -1;

        for (const p of procs) {
            const cmdLower = (p.cmdline || "").toLowerCase();
            const exeLower = (p.exe || "").replace(/\\/g, "/").toLowerCase();
            const commLower = (p.name || "").toLowerCase();

            const wineExe = extractWineExe(p.cmdline);
            if (wineExe) {
                const candidate = this.exeMap.get(wineExe.base);
                if (candidate && candidate.priority > bestPriority) {
                    bestMatch = { ...candidate, pid: p.pid, executable: wineExe.base };
                    bestPriority = candidate.priority;
                }
            }

            if (p.steamAppId && this.steamAppMap.has(p.steamAppId)) {
                const candidate = this.steamAppMap.get(p.steamAppId);
                if ((candidate.priority || 2) > bestPriority) {
                    bestMatch = { ...candidate, pid: p.pid, executable: wineExe?.base || p.name };
                    bestPriority = candidate.priority || 2;
                }
            }

            if (commLower === "java" || commLower === "javaw.exe" || exeLower.endsWith("/java")) {
                for (const jg of this.javaGames) {
                    if (jg.javaKeywords.some(kw => cmdLower.includes(kw))) {
                        if (2 > bestPriority) {
                            bestMatch = { ...jg, pid: p.pid, executable: "java (Minecraft)" };
                            bestPriority = 2;
                        }
                    }
                }
            }

            const candidatesToCheck = [
                normalizeExeName(exeLower),
                commLower
            ].filter(Boolean);

            for (const cName of candidatesToCheck) {
                if (IGNORED_PROCESSES.has(cName)) continue;
                const found = this.exeMap.get(cName);
                if (found && found.priority > bestPriority) {
                    if (found.matchPath && found.matchPath.includes("/")) {
                        if (!exeLower.endsWith(found.matchPath) && !cmdLower.includes(found.matchPath)) {
                            continue;
                        }
                    }
                    bestMatch = { ...found, pid: p.pid, executable: cName };
                    bestPriority = found.priority;
                }
            }
        }

        return bestMatch;
    }

    async listRunningProcesses() {
        const procs = [];
        if (process.platform === "linux") {
            let entries;
            try {
                entries = fs.readdirSync("/proc");
            } catch (_) {
                return procs;
            }
            const myUid = typeof process.getuid === "function" ? process.getuid() : -1;

            for (const name of entries) {
                if (!/^\d+$/.test(name)) continue;
                const pid = parseInt(name, 10);
                if (pid === process.pid) continue;
                const procDir = `/proc/${pid}`;
                try {
                    if (myUid >= 0) {
                        const st = fs.statSync(procDir);
                        if (st.uid !== myUid) continue;
                    }
                    const comm = fs.readFileSync(`${procDir}/comm`, "utf-8").trim();
                    const cmdline = fs.readFileSync(`${procDir}/cmdline`, "utf-8").replace(/\0/g, " ").trim();
                    if (!cmdline) continue;

                    let exe = "";
                    try { exe = fs.readlinkSync(`${procDir}/exe`); } catch (_) {}

                    let steamAppId = null;
                    if (cmdline.includes("steamapps") || cmdline.includes("proton") || cmdline.includes("wine") || comm.includes("reaper")) {
                        try {
                            const envBuf = fs.readFileSync(`${procDir}/environ`, "utf-8");
                            const m = envBuf.match(/(?:^|\0)(?:SteamAppId|STEAM_COMPAT_APP_ID)=(\d+)(?:\0|$)/);
                            if (m && m[1] && m[1] !== "0") {
                                steamAppId = m[1];
                            }
                        } catch (_) {}
                    }

                    procs.push({ pid, name: comm, cmdline, exe, steamAppId });
                } catch (_) {}
            }
            return procs;
        }

        if (process.platform === "win32") {
            return new Promise((resolve) => {
                execFile(
                    "powershell.exe",
                    ["-NoProfile", "-Command", "Get-CimInstance Win32_Process | Select-Object ProcessId,Name,CommandLine,ExecutablePath | ConvertTo-Json -Compress"],
                    { timeout: 3000, maxBuffer: 4 * 1024 * 1024 },
                    (err, stdout) => {
                        if (err || !stdout) return resolve([]);
                        try {
                            const parsed = JSON.parse(stdout);
                            const arr = Array.isArray(parsed) ? parsed : [parsed];
                            resolve(arr.filter(Boolean).map(p => ({
                                pid: Number(p.ProcessId) || 0,
                                name: String(p.Name || ""),
                                cmdline: String(p.CommandLine || p.Name || ""),
                                exe: String(p.ExecutablePath || p.Name || ""),
                                steamAppId: null
                            })));
                        } catch (_) {
                            resolve([]);
                        }
                    }
                );
            });
        }

        return procs;
    }

    getStatus() {
        const rpcActivities = [];
        for (const [id, info] of this.ipcClients.entries()) {
            if (info.activity) {
                rpcActivities.push({
                    socketId: `deadcord-ipc-${id}`,
                    appId: info.appId,
                    name: info.activity.name || info.activity.details || `App ${info.appId}`,
                    details: info.activity.details || "",
                    state: info.activity.state || ""
                });
            }
        }
        return {
            gameDetectionEnabled: this.gameDetectionEnabled,
            rpcServerEnabled: this.rpcServerEnabled,
            ipcSocketPath: this.ipcSocketPath,
            ipcClientsCount: this.ipcClients.size,
            detectableGamesCount: this.detectableGames.length,
            builtinGamesCount: BUILTIN_GAMES.length,
            customGamesCount: this.customGames.length,
            activeProcessGame: this.currentProcessGame
                ? {
                    name: this.currentProcessGame.name,
                    id: this.currentProcessGame.id,
                    executable: this.currentProcessGame.executable,
                    startedAt: this.currentProcessGame.startedAt
                }
                : null,
            activeRpcActivities: rpcActivities
        };
    }
}

module.exports = {
    GameActivityManager,
    BUILTIN_GAMES
};
