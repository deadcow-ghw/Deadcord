(function () {
    "use strict";

    const activeActivities = new Map();
    const appMetaCache = new Map();
    let gameBridgeInitialized = false;

    async function resolveAssetImage(appId, imageKey) {
        if (!imageKey || typeof imageKey !== "string") return imageKey;
        if (imageKey.startsWith("mp:") || imageKey.startsWith("spotify:")) return imageKey;
        if (/^\d+$/.test(imageKey)) return imageKey;

        try {
            const wp = window.Vencord && window.Vencord.Webpack;
            if (!wp) return imageKey;
            const AssetUtils = wp.Common?.ApplicationAssetUtils || wp.findByProps("fetchAssetIds", "getAssetImage");
            if (AssetUtils && typeof AssetUtils.fetchAssetIds === "function" && appId) {
                const ids = await AssetUtils.fetchAssetIds(appId, [imageKey]);
                if (Array.isArray(ids) && ids[0]) return ids[0];
            }
        } catch (_) {}
        return imageKey;
    }

    async function resolveApplicationName(appId) {
        if (!appId) return null;
        if (appMetaCache.has(appId)) return appMetaCache.get(appId);
        try {
            const wp = window.Vencord && window.Vencord.Webpack;
            const AppStore = wp && (wp.Common?.ApplicationStore || wp.findByProps("getApplication", "getApplicationByName"));
            const existing = AppStore && AppStore.getApplication && AppStore.getApplication(appId);
            if (existing && existing.name) {
                appMetaCache.set(appId, existing.name);
                return existing.name;
            }
            const RestAPI = wp && (wp.Common?.RestAPI || wp.findByProps("get", "post", "patch"));
            if (RestAPI && typeof RestAPI.get === "function") {
                const res = await RestAPI.get({ url: `/applications/public?application_ids=${encodeURIComponent(appId)}` });
                const item = Array.isArray(res?.body) ? res.body[0] : null;
                if (item && item.name) {
                    appMetaCache.set(appId, item.name);
                    return item.name;
                }
            }
        } catch (_) {}
        return null;
    }

    async function dispatchActivityToDiscord(payload) {
        if (!payload || !payload.socketId) return;
        const wp = window.Vencord && window.Vencord.Webpack;
        const FluxDispatcher = wp && (wp.Common?.FluxDispatcher || wp.findByProps("dispatch", "subscribe"));
        if (!FluxDispatcher || typeof FluxDispatcher.dispatch !== "function") return;

        let activity = payload.activity ? JSON.parse(JSON.stringify(payload.activity)) : null;

        if (activity) {
            if (activity.assets && activity.application_id) {
                if (activity.assets.large_image) {
                    activity.assets.large_image = await resolveAssetImage(activity.application_id, activity.assets.large_image);
                }
                if (activity.assets.small_image) {
                    activity.assets.small_image = await resolveAssetImage(activity.application_id, activity.assets.small_image);
                }
            }
            if (!activity.name && activity.application_id) {
                const resolvedName = await resolveApplicationName(activity.application_id);
                if (resolvedName) activity.name = resolvedName;
            }
            if (!activity.name) {
                activity.name = "Jeu";
            }
            activeActivities.set(payload.socketId, activity);
        } else {
            activeActivities.delete(payload.socketId);
        }

        try {
            FluxDispatcher.dispatch({
                type: "LOCAL_ACTIVITY_UPDATE",
                activity,
                pid: payload.pid || 0,
                socketId: payload.socketId
            });
        } catch (_) {}
    }

    function syncLoggedInUser() {
        try {
            const wp = window.Vencord && window.Vencord.Webpack;
            const UserStore = wp && (wp.Common?.UserStore || wp.findByProps("getCurrentUser"));
            const user = UserStore && UserStore.getCurrentUser && UserStore.getCurrentUser();
            if (user && user.id && window.DeadcordNative && window.DeadcordNative.syncUser) {
                window.DeadcordNative.syncUser({
                    id: user.id,
                    username: user.username,
                    discriminator: user.discriminator,
                    globalName: user.globalName,
                    avatar: user.avatar,
                    flags: user.flags,
                    premiumType: user.premiumType
                });
            }
        } catch (_) {}
    }

    async function maybeRefreshDetectableGames() {
        try {
            if (!window.DeadcordNative || !window.DeadcordNative.needsDetectableRefresh) return;
            const needs = await window.DeadcordNative.needsDetectableRefresh();
            if (!needs) return;

            const wp = window.Vencord && window.Vencord.Webpack;
            const RestAPI = wp && (wp.Common?.RestAPI || wp.findByProps("get", "post", "patch"));
            let games = null;

            if (RestAPI && typeof RestAPI.get === "function") {
                const res = await RestAPI.get({ url: "/applications/detectable" });
                if (Array.isArray(res?.body)) games = res.body;
            } else {
                const resp = await fetch("https://discord.com/api/v9/applications/detectable", { credentials: "same-origin" });
                if (resp.ok) {
                    const data = await resp.json();
                    if (Array.isArray(data)) games = data;
                }
            }

            if (games && games.length > 0) {
                await window.DeadcordNative.updateDetectableGames(games);
            }
        } catch (_) {}
    }

    function initGameActivityBridge() {
        if (gameBridgeInitialized) return;
        const wp = window.Vencord && window.Vencord.Webpack;
        const FluxDispatcher = wp && (wp.Common?.FluxDispatcher || wp.findByProps("dispatch", "subscribe"));
        if (!FluxDispatcher || !window.DeadcordNative) {
            setTimeout(initGameActivityBridge, 250);
            return;
        }
        gameBridgeInitialized = true;

        window.DeadcordNative.onActivityUpdate((payload) => {
            dispatchActivityToDiscord(payload);
        });

        const onConnectionOpen = () => {
            syncLoggedInUser();
            setTimeout(() => {
                for (const [socketId, activity] of activeActivities.entries()) {
                    try {
                        FluxDispatcher.dispatch({
                            type: "LOCAL_ACTIVITY_UPDATE",
                            activity,
                            pid: 0,
                            socketId
                        });
                    } catch (_) {}
                }
                if (window.DeadcordNative.requestReemitActivities) {
                    window.DeadcordNative.requestReemitActivities();
                }
            }, 1500);
            setTimeout(maybeRefreshDetectableGames, 4000);
        };

        try {
            FluxDispatcher.subscribe("CONNECTION_OPEN", onConnectionOpen);
        } catch (_) {}

        syncLoggedInUser();
        setTimeout(() => {
            syncLoggedInUser();
            if (window.DeadcordNative.requestReemitActivities) {
                window.DeadcordNative.requestReemitActivities();
            }
        }, 2500);
        setTimeout(maybeRefreshDetectableGames, 6000);
    }

    function initDeadcordSettings() {
        if (!window.Vencord || !window.Vencord.Plugins || !window.Vencord.Plugins.plugins || !window.Vencord.Plugins.plugins.Settings) {
            setTimeout(initDeadcordSettings, 50);
            return;
        }

        const Settings = window.Vencord.Plugins.plugins.Settings;
        if (!Settings.customEntries) Settings.customEntries = [];
        if (Settings.customEntries.some(e => e.key === "deadcord")) return;

        function DeadcordIcon(props) {
            const React = window.Vencord.Webpack.Common.React;
            return React.createElement("svg", {
                viewBox: "0 0 24 24",
                width: 20,
                height: 20,
                fill: "currentColor",
                ...props
            }, React.createElement("path", {
                d: "M12 1L3 5v6c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V5l-9-4zm0 2.18l7 3.12v4.7c0 4.67-3.13 9.03-7 10.15-3.87-1.12-7-5.48-7-10.15V6.3l7-3.12zM12 7c-1.66 0-3 1.34-3 3v2H8v6h8v-6h-1v-2c0-1.66-1.34-3-3-3zm1 5h-2v-2c0-.55.45-1 1-1s1 .45 1 1v2z"
            }));
        }

        function DeadcordSettingsTab() {
            const React = window.Vencord.Webpack.Common.React;
            const [cfg, setCfg] = React.useState({
                torEnabled: true,
                bridgeMode: "none",
                customBridge: "",
                e2eeKey: "",
                activeProfile: "p1",
                streamFps: 60,
                streamResolution: "1080",
                streamQualityUnlock: true,
                clientIdentity: "discord-linux",
                gameDetectionEnabled: true,
                rpcServerEnabled: true,
                exifCleanerEnabled: true,
                contentProtectionEnabled: false,
                customGames: []
            });
            const [statusMsg, setStatusMsg] = React.useState("");
            const [showE2EE, setShowE2EE] = React.useState(false);
            const [presetActive, setPresetActive] = React.useState(false);
            const [privacyStats, setPrivacyStats] = React.useState(null);
            const [gameStatus, setGameStatus] = React.useState(null);
            const [newGameExe, setNewGameExe] = React.useState("");
            const [newGameName, setNewGameName] = React.useState("");
            const [identityChanged, setIdentityChanged] = React.useState(false);

            const refreshLiveStatus = React.useCallback(() => {
                if (window.DeadcordNative?.getPrivacyStats) {
                    window.DeadcordNative.getPrivacyStats().then(s => s && setPrivacyStats(s)).catch(() => {});
                }
                if (window.DeadcordNative?.getGameStatus) {
                    window.DeadcordNative.getGameStatus().then(g => g && setGameStatus(g)).catch(() => {});
                }
            }, []);

            React.useEffect(() => {
                if (window.DeadcordNative?.getConfig) {
                    window.DeadcordNative.getConfig().then(data => {
                        if (data) setCfg(prev => ({ ...prev, ...data }));
                    }).catch(() => {});
                }
                if (window.DeadcordNative?.getActiveProfile) {
                    window.DeadcordNative.getActiveProfile().then(p => {
                        if (p && p.id) setCfg(prev => ({ ...prev, activeProfile: p.id }));
                    }).catch(() => {});
                }
                if (window.DeadcordNative?.getVencordPresetStatus) {
                    window.DeadcordNative.getVencordPresetStatus().then(active => {
                        setPresetActive(Boolean(active));
                    }).catch(() => {});
                }
                refreshLiveStatus();
                const timer = setInterval(refreshLiveStatus, 3000);
                return () => clearInterval(timer);
            }, [refreshLiveStatus]);

            const showNotice = (msg) => {
                setStatusMsg(msg);
                setTimeout(() => setStatusMsg(""), 3500);
            };

            const togglePreset = (enable) => {
                if (window.DeadcordNative?.applyVencordPreset) {
                    window.DeadcordNative.applyVencordPreset(enable).then(() => {
                        setPresetActive(enable);
                        showNotice(enable ? "Pack extensions Vencord active avec succes." : "Pack extensions Vencord desactive.");
                    });
                }
            };

            const updateConfig = (patch) => {
                const next = { ...cfg, ...patch };
                setCfg(next);
                if (window.DeadcordNative?.saveConfig) {
                    window.DeadcordNative.saveConfig(patch).then(() => refreshLiveStatus()).catch(() => {});
                }
                if (patch.e2eeKey !== undefined && window.DeadcordNative?.setE2EEKey) {
                    window.DeadcordNative.setE2EEKey(patch.e2eeKey);
                }
                if (patch.clientIdentity !== undefined) {
                    setIdentityChanged(true);
                    showNotice("Identite client mise a jour. Rechargez Deadcord pour reconnecter le Gateway.");
                } else {
                    showNotice("Modifications enregistrees avec succes.");
                }
            };

            const addCustomGame = () => {
                const exe = newGameExe.trim();
                const name = newGameName.trim();
                if (!exe || !name) return;
                const list = [...(cfg.customGames || []), { executable: exe, name }];
                setNewGameExe("");
                setNewGameName("");
                updateConfig({ customGames: list });
            };

            const removeCustomGame = (idx) => {
                const list = (cfg.customGames || []).filter((_, i) => i !== idx);
                updateConfig({ customGames: list });
            };

            const cardStyle = {
                background: "var(--background-secondary, #2b2d31)",
                borderRadius: "8px",
                padding: "16px",
                marginBottom: "16px",
                border: "1px solid rgba(255, 255, 255, 0.06)"
            };

            const headerStyle = {
                color: "var(--header-primary, #f2f3f5)",
                fontSize: "16px",
                fontWeight: "600",
                marginBottom: "8px",
                display: "flex",
                alignItems: "center",
                gap: "8px"
            };

            const descStyle = {
                color: "var(--text-muted, #949ba4)",
                fontSize: "13px",
                lineHeight: "1.45",
                marginBottom: "12px"
            };

            const inputStyle = {
                width: "100%",
                boxSizing: "border-box",
                background: "var(--background-tertiary, #1e1f22)",
                color: "var(--text-normal, #dbdee1)",
                border: "1px solid rgba(255, 255, 255, 0.1)",
                borderRadius: "6px",
                padding: "8px 12px",
                fontSize: "13px",
                outline: "none"
            };

            const buttonStyle = (variant) => ({
                background: variant === "danger"
                    ? "var(--status-danger, #f23f43)"
                    : variant === "secondary"
                        ? "var(--background-tertiary, #1e1f22)"
                        : "var(--brand-experiment, #5865f2)",
                color: "#ffffff",
                border: variant === "secondary" ? "1px solid rgba(255,255,255,0.1)" : "none",
                borderRadius: "6px",
                padding: "8px 14px",
                fontSize: "13px",
                fontWeight: "500",
                cursor: "pointer",
                marginRight: "8px",
                marginTop: "8px"
            });

            const badgeStyle = (ok, warn = false) => ({
                background: warn
                    ? "rgba(250, 168, 26, 0.15)"
                    : ok ? "rgba(35, 165, 90, 0.15)" : "rgba(242, 63, 67, 0.15)",
                color: warn
                    ? "#FAA81A"
                    : ok ? "var(--status-positive, #23a55a)" : "var(--status-danger, #f23f43)",
                border: `1px solid ${warn ? "rgba(250, 168, 26, 0.35)" : ok ? "rgba(35, 165, 90, 0.3)" : "rgba(242, 63, 67, 0.3)"}`,
                padding: "3px 10px",
                borderRadius: "12px",
                fontSize: "11px",
                fontWeight: "600",
                whiteSpace: "nowrap"
            });

            const isDesktopSpoof = cfg.clientIdentity !== "web-chrome";
            const activeGameLabel =
                gameStatus?.activeRpcActivities?.[0]?.name ||
                gameStatus?.activeProcessGame?.name ||
                null;

            return React.createElement("div", {
                style: {
                    padding: "20px",
                    maxWidth: "780px",
                    color: "var(--text-normal, #dbdee1)",
                    fontFamily: "var(--font-primary, sans-serif)"
                }
            },
                React.createElement("div", {
                    style: { marginBottom: "20px", display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: "10px" }
                },
                    React.createElement("div", null,
                        React.createElement("h2", {
                            style: { color: "var(--header-primary, #f2f3f5)", fontSize: "20px", fontWeight: "700", margin: 0 }
                        }, "Parametres Deadcord v1.2"),
                        React.createElement("p", {
                            style: { color: "var(--text-muted, #949ba4)", fontSize: "13px", marginTop: "4px", marginBottom: 0 }
                        }, "Client Discord durci : Tor Fail-Closed, Identite Desktop, Detection Jeux/RPC & E2EE v2.")
                    ),
                    React.createElement("div", { style: { display: "flex", flexWrap: "wrap", gap: "6px" } },
                        React.createElement("span", {
                            style: badgeStyle(cfg.torEnabled && !privacyStats?.killSwitchTripped, cfg.torEnabled && privacyStats?.killSwitchTripped)
                        }, !cfg.torEnabled
                            ? "TOR DESACTIVE"
                            : privacyStats?.killSwitchTripped
                                ? "KILL-SWITCH ACTIF"
                                : "TOR ACTIF [9052]"),
                        React.createElement("span", {
                            style: badgeStyle(isDesktopSpoof)
                        }, isDesktopSpoof ? "CLIENT DESKTOP" : "CLIENT WEB"),
                        activeGameLabel && React.createElement("span", {
                            style: badgeStyle(true)
                        }, `JEU : ${activeGameLabel}`)
                    )
                ),

                statusMsg && React.createElement("div", {
                    style: {
                        background: "rgba(35, 165, 90, 0.2)",
                        color: "var(--status-positive, #23a55a)",
                        border: "1px solid rgba(35, 165, 90, 0.4)",
                        borderRadius: "6px",
                        padding: "8px 12px",
                        marginBottom: "16px",
                        fontSize: "13px"
                    }
                }, statusMsg),

                React.createElement("div", { style: cardStyle },
                    React.createElement("div", { style: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "8px" } },
                        React.createElement("div", { style: { ...headerStyle, marginBottom: 0 } }, "Identite Client Discord (Visibilite sur les autres clients)"),
                        React.createElement("span", { style: badgeStyle(isDesktopSpoof) },
                            cfg.clientIdentity === "discord-windows"
                                ? "DISCORD WINDOWS"
                                : cfg.clientIdentity === "discord-linux"
                                    ? "DISCORD LINUX"
                                    : "WEB CHROME"
                        )
                    ),
                    React.createElement("div", { style: descStyle },
                        "Fait apparaitre Deadcord sur les autres clients Discord (officiel, mobile, Vesktop, PlatformIndicators) comme un veritable client Discord Desktop (client_status: desktop) au lieu d'un navigateur Web, avec X-Super-Properties et Gateway IDENTIFY 100% coherents."
                    ),
                    React.createElement("div", { style: { display: "flex", flexWrap: "wrap", alignItems: "center", gap: "10px" } },
                        React.createElement("select", {
                            value: cfg.clientIdentity || "discord-linux",
                            onChange: (e) => updateConfig({ clientIdentity: e.target.value }),
                            style: { ...inputStyle, width: "auto", minWidth: "260px", cursor: "pointer" }
                        },
                            React.createElement("option", { value: "discord-linux" }, "Discord Client — Linux Desktop (Recommande)"),
                            React.createElement("option", { value: "discord-windows" }, "Discord Client — Windows Desktop"),
                            React.createElement("option", { value: "web-chrome" }, "Navigateur Web — Chrome (Standard)")
                        ),
                        identityChanged && React.createElement("button", {
                            onClick: () => window.DeadcordNative?.reload?.(),
                            style: { ...buttonStyle("primary"), marginTop: 0 }
                        }, "Recharger maintenant pour appliquer")
                    )
                ),

                React.createElement("div", { style: cardStyle },
                    React.createElement("div", { style: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "8px" } },
                        React.createElement("div", { style: { ...headerStyle, marginBottom: 0 } }, "Detection des Jeux & Rich Presence (Discord RPC)"),
                        React.createElement("span", { style: badgeStyle(Boolean(activeGameLabel), !activeGameLabel && (cfg.gameDetectionEnabled || cfg.rpcServerEnabled)) },
                            activeGameLabel ? `En cours : ${activeGameLabel}` : "En attente d'un jeu"
                        )
                    ),
                    React.createElement("div", { style: descStyle },
                        "Detecte automatiquement vos jeux lances (Linux natif, Steam, Proton/Wine, Minecraft/Java, emulateurs, Windows) et ouvre un serveur Discord IPC local (discord-ipc-0) compatible avec les jeux, mods Minecraft, VS Code et outils Rich Presence."
                    ),
                    React.createElement("label", {
                        style: { display: "flex", alignItems: "center", gap: "10px", cursor: "pointer", fontSize: "14px", fontWeight: "500", marginBottom: "8px" }
                    },
                        React.createElement("input", {
                            type: "checkbox",
                            checked: cfg.gameDetectionEnabled !== false,
                            onChange: (e) => updateConfig({ gameDetectionEnabled: e.target.checked })
                        }),
                        "Activer la detection automatique des jeux (processus / Steam / Proton / Minecraft)"
                    ),
                    React.createElement("label", {
                        style: { display: "flex", alignItems: "center", gap: "10px", cursor: "pointer", fontSize: "14px", fontWeight: "500", marginBottom: "12px" }
                    },
                        React.createElement("input", {
                            type: "checkbox",
                            checked: cfg.rpcServerEnabled !== false,
                            onChange: (e) => updateConfig({ rpcServerEnabled: e.target.checked })
                        }),
                        "Activer le serveur Discord Rich Presence local (socket discord-ipc-0)"
                    ),
                    gameStatus && React.createElement("div", {
                        style: {
                            background: "var(--background-tertiary, #1e1f22)",
                            borderRadius: "6px",
                            padding: "10px 12px",
                            fontSize: "12px",
                            lineHeight: "1.7",
                            marginBottom: "12px",
                            color: "var(--text-muted, #949ba4)"
                        }
                    },
                        React.createElement("div", null,
                            React.createElement("strong", { style: { color: "var(--text-normal, #dbdee1)" } }, "Socket RPC IPC : "),
                            gameStatus.ipcSocketPath || "Inactif"
                        ),
                        React.createElement("div", null,
                            React.createElement("strong", { style: { color: "var(--text-normal, #dbdee1)" } }, "Base de jeux reconnus : "),
                            `${gameStatus.builtinGamesCount} integres + ${gameStatus.detectableGamesCount} officiels Discord + ${gameStatus.customGamesCount} personnalises`
                        ),
                        React.createElement("div", null,
                            React.createElement("strong", { style: { color: "var(--text-normal, #dbdee1)" } }, "Clients RPC connectes : "),
                            String(gameStatus.ipcClientsCount || 0),
                            gameStatus.activeProcessGame ? ` | Processus detecte : ${gameStatus.activeProcessGame.name} (${gameStatus.activeProcessGame.executable})` : ""
                        )
                    ),
                    React.createElement("div", { style: { fontSize: "13px", fontWeight: "600", marginBottom: "6px" } }, "Ajouter un jeu personnalise"),
                    React.createElement("div", { style: { display: "flex", gap: "8px", flexWrap: "wrap", alignItems: "center" } },
                        React.createElement("input", {
                            type: "text",
                            placeholder: "Executable (ex: hollow_knight.x86_64 ou game.exe)",
                            value: newGameExe,
                            onChange: (e) => setNewGameExe(e.target.value),
                            style: { ...inputStyle, flex: "1 1 200px" }
                        }),
                        React.createElement("input", {
                            type: "text",
                            placeholder: "Nom affiche sur Discord",
                            value: newGameName,
                            onChange: (e) => setNewGameName(e.target.value),
                            style: { ...inputStyle, flex: "1 1 180px" }
                        }),
                        React.createElement("button", {
                            onClick: addCustomGame,
                            style: { ...buttonStyle("primary"), marginTop: 0, marginRight: 0 }
                        }, "Ajouter")
                    ),
                    (cfg.customGames && cfg.customGames.length > 0) && React.createElement("div", { style: { marginTop: "10px", display: "flex", flexDirection: "column", gap: "6px" } },
                        cfg.customGames.map((g, idx) => React.createElement("div", {
                            key: `${g.executable}-${idx}`,
                            style: {
                                display: "flex",
                                justifyContent: "space-between",
                                alignItems: "center",
                                background: "var(--background-tertiary, #1e1f22)",
                                padding: "6px 10px",
                                borderRadius: "6px",
                                fontSize: "12px"
                            }
                        },
                            React.createElement("span", null, React.createElement("strong", null, g.name), ` (${g.executable})`),
                            React.createElement("button", {
                                onClick: () => removeCustomGame(idx),
                                style: { ...buttonStyle("danger"), padding: "3px 8px", fontSize: "11px", margin: 0 }
                            }, "Supprimer")
                        ))
                    )
                ),

                React.createElement("div", { style: cardStyle },
                    React.createElement("div", { style: headerStyle }, "Routage Reseau Tor (Fail-Closed + Isolation Circuits + Anti-Fuite)"),
                    React.createElement("div", { style: descStyle },
                        "Kill-switch ferme au demarrage, isolation des circuits par destination (IsolateDestAddr/Port), blocage HTTP en clair, DNS verrouille et WebRTC force en mode relay sous Tor."
                    ),
                    React.createElement("label", {
                        style: { display: "flex", alignItems: "center", gap: "10px", cursor: "pointer", fontSize: "14px", fontWeight: "500" }
                    },
                        React.createElement("input", {
                            type: "checkbox",
                            checked: cfg.torEnabled,
                            onChange: (e) => updateConfig({ torEnabled: e.target.checked })
                        }),
                        "Activer le routage Tor obligatoire (Recommande)"
                    ),
                    React.createElement("div", { style: { marginTop: "14px", display: "flex", flexWrap: "wrap", gap: "12px", alignItems: "flex-end" } },
                        React.createElement("div", null,
                            React.createElement("div", { style: { fontSize: "13px", fontWeight: "600", marginBottom: "6px" } }, "Mode de Ponts Tor (Bridges)"),
                            React.createElement("select", {
                                value: cfg.bridgeMode,
                                onChange: (e) => updateConfig({ bridgeMode: e.target.value }),
                                style: { ...inputStyle, width: "auto", minWidth: "240px", cursor: "pointer" }
                            },
                                React.createElement("option", { value: "none" }, "Direct (Noeuds Tor normaux)"),
                                React.createElement("option", { value: "snowflake" }, "Snowflake (Contournement censure)"),
                                React.createElement("option", { value: "custom" }, "Pont Personnalise (Obfs4 / Manuel)")
                            )
                        ),
                        cfg.bridgeMode === "custom" && React.createElement("div", { style: { flex: "1 1 260px" } },
                            React.createElement("div", { style: { fontSize: "13px", fontWeight: "600", marginBottom: "6px" } }, "Ligne Bridge Obfs4"),
                            React.createElement("input", {
                                type: "text",
                                placeholder: "obfs4 IP:PORT FINGERPRINT cert=... iat-mode=0",
                                value: cfg.customBridge || "",
                                onChange: (e) => updateConfig({ customBridge: e.target.value }),
                                style: inputStyle
                            })
                        ),
                        cfg.torEnabled && React.createElement("button", {
                            onClick: () => {
                                window.DeadcordNative?.renewTorCircuit?.().then((ok) => {
                                    showNotice(ok ? "Nouveau circuit Tor demande avec succes." : "Impossible de renouveler le circuit Tor.");
                                });
                            },
                            style: { ...buttonStyle("secondary"), marginTop: 0 }
                        }, "Renouveler Circuit Tor")
                    )
                ),

                React.createElement("div", { style: cardStyle },
                    React.createElement("div", { style: headerStyle }, "Bouclier Securite, Anti-Phishing, EXIF & Confidentialite"),
                    React.createElement("label", {
                        style: { display: "flex", alignItems: "center", gap: "10px", cursor: "pointer", fontSize: "14px", fontWeight: "500", marginBottom: "8px" }
                    },
                        React.createElement("input", {
                            type: "checkbox",
                            checked: cfg.exifCleanerEnabled !== false,
                            onChange: (e) => updateConfig({ exifCleanerEnabled: e.target.checked })
                        }),
                        "Nettoyer automatiquement les metadonnees EXIF / GPS / XMP des images avant envoi"
                    ),
                    React.createElement("label", {
                        style: { display: "flex", alignItems: "center", gap: "10px", cursor: "pointer", fontSize: "14px", fontWeight: "500", marginBottom: "12px" }
                    },
                        React.createElement("input", {
                            type: "checkbox",
                            checked: Boolean(cfg.contentProtectionEnabled),
                            onChange: (e) => updateConfig({ contentProtectionEnabled: e.target.checked })
                        }),
                        "Mode Anti-Capture (empeche les captures d'ecran tierces de la fenetre Deadcord)"
                    ),
                    privacyStats && React.createElement("div", {
                        style: {
                            display: "grid",
                            gridTemplateColumns: "repeat(auto-fit, minmax(145px, 1fr))",
                            gap: "8px",
                            marginBottom: "12px"
                        }
                    },
                        [
                            { label: "Requetes bloquees", value: privacyStats.totalBlocked || 0 },
                            { label: "HTTP en clair bloques", value: privacyStats.insecureHttpBlocked || 0 },
                            { label: "Images EXIF nettoyees", value: privacyStats.exifCleaned || 0 },
                            { label: "Permissions refusees", value: privacyStats.permissionsDenied || 0 }
                        ].map(item => React.createElement("div", {
                            key: item.label,
                            style: {
                                background: "var(--background-tertiary, #1e1f22)",
                                borderRadius: "6px",
                                padding: "8px 10px"
                            }
                        },
                            React.createElement("div", { style: { fontSize: "11px", color: "var(--text-muted, #949ba4)" } }, item.label),
                            React.createElement("div", { style: { fontSize: "16px", fontWeight: "700", color: "var(--header-primary, #f2f3f5)" } }, String(item.value))
                        ))
                    ),
                    React.createElement("ul", {
                        style: { margin: 0, paddingLeft: "20px", fontSize: "13px", lineHeight: "1.75", color: "var(--text-muted, #949ba4)" }
                    },
                        React.createElement("li", null, React.createElement("strong", { style: { color: "var(--text-normal, #dbdee1)" } }, "Anti-XSS & E2EE v2 : "), "Sel aleatoire 16o, 210k PBKDF2-SHA256, AES-GCM 256 avec AAD, rendu DOM sans innerHTML et stockage safeStorage."),
                        React.createElement("li", null, React.createElement("strong", { style: { color: "var(--text-normal, #dbdee1)" } }, "TLS Strict & Anti-Phishing : "), "Rejet strict des certificats invalides, blocage webview, alerte domaines homographes/faux Discord et blocage SSRF local."),
                        React.createElement("li", null, React.createElement("strong", { style: { color: "var(--text-normal, #dbdee1)" } }, "Sandbox & Quarantaine : "), "Permissions liste blanche, blocage lecture fichiers sensibles (.ssh/.env/etc.) et quarantaine non-executable (chmod 600)."),
                        React.createElement("li", null, React.createElement("strong", { style: { color: "var(--text-normal, #dbdee1)" } }, "Anti-Fingerprint Main-World : "), "Bruit Canvas/Audio, WebGL virtualise, sendBeacon filtre et blocage fuites WebRTC ICE.")
                    ),
                    React.createElement("button", {
                        onClick: () => {
                            window.DeadcordNative?.clearClipboard?.().then(() => showNotice("Presse-papiers efface."));
                        },
                        style: buttonStyle("secondary")
                    }, "Effacer le Presse-Papiers")
                ),

                React.createElement("div", { style: cardStyle },
                    React.createElement("div", { style: headerStyle }, "Chiffrement de Bout-en-Bout (E2EE v2) des DMs"),
                    React.createElement("div", { style: descStyle },
                        "Chiffre vos messages en AES-GCM 256 bits avec sel aleatoire unique et AAD. Commencez votre texte par !e (ex: !e Rendez-vous a 20h). Compatible en lecture avec [DEAD-E2EE:...]."
                    ),
                    React.createElement("div", { style: { display: "flex", gap: "8px", alignItems: "center" } },
                        React.createElement("input", {
                            type: showE2EE ? "text" : "password",
                            placeholder: "Cle secrete partagee pour chiffrer/dechiffrer...",
                            value: cfg.e2eeKey || "",
                            onChange: (e) => updateConfig({ e2eeKey: e.target.value }),
                            style: inputStyle
                        }),
                        React.createElement("button", {
                            onClick: () => setShowE2EE(!showE2EE),
                            style: { ...buttonStyle("secondary"), margin: 0 }
                        }, showE2EE ? "Masquer" : "Afficher")
                    )
                ),

                React.createElement("div", { style: cardStyle },
                    React.createElement("div", { style: headerStyle }, "Gestion Multi-Comptes & Profils Isoles (Ctrl+1 a Ctrl+4)"),
                    React.createElement("div", { style: descStyle },
                        "Chaque profil possede sa propre partition isolee. Le profil Ephemere est automatiquement efface a la fermeture ou au changement de profil."
                    ),
                    React.createElement("div", { style: { display: "flex", flexWrap: "wrap", gap: "8px", marginBottom: "10px" } },
                        [
                            { id: "p1", name: "Compte 1" },
                            { id: "p2", name: "Compte 2" },
                            { id: "p3", name: "Compte 3" },
                            { id: "incognito", name: "Ephemere (Incognito)" }
                        ].map(p => React.createElement("button", {
                            key: p.id,
                            onClick: () => window.DeadcordNative?.switchProfile?.(p.id),
                            style: {
                                ...buttonStyle(p.id === cfg.activeProfile ? "primary" : "secondary"),
                                marginTop: 0,
                                border: p.id === cfg.activeProfile ? "1px solid rgba(255, 255, 255, 0.3)" : "1px solid rgba(255, 255, 255, 0.08)"
                            }
                        }, p.name + (p.id === cfg.activeProfile ? " (Actif)" : "")))
                    ),
                    React.createElement("button", {
                        onClick: () => {
                            if (confirm("Voulez-vous vraiment purger les donnees de session de ce profil ?")) {
                                window.DeadcordNative?.purgeSession?.();
                            }
                        },
                        style: buttonStyle("danger")
                    }, "Purger Session et Cache (Ctrl+Shift+P)")
                ),

                React.createElement("div", { style: cardStyle },
                    React.createElement("div", { style: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "8px" } },
                        React.createElement("div", { style: { ...headerStyle, marginBottom: 0 } }, "Capture d'ecran & Qualite WebRTC"),
                        React.createElement("span", { style: badgeStyle(cfg.streamQualityUnlock !== false) },
                            cfg.streamQualityUnlock !== false ? "FLUIDITE OPTIMALE" : "STANDARD"
                        )
                    ),
                    React.createElement("label", {
                        style: { display: "flex", alignItems: "center", gap: "10px", cursor: "pointer", fontSize: "14px", fontWeight: "500", marginBottom: "12px" }
                    },
                        React.createElement("input", {
                            type: "checkbox",
                            checked: cfg.streamQualityUnlock !== false,
                            onChange: (e) => updateConfig({ streamQualityUnlock: e.target.checked })
                        }),
                        "Activer la capture haute fluidite (60 FPS & Haute Resolution)"
                    ),
                    React.createElement("div", { style: { display: "flex", gap: "16px", flexWrap: "wrap" } },
                        React.createElement("div", null,
                            React.createElement("div", { style: { fontSize: "13px", fontWeight: "600", marginBottom: "6px" } }, "Frequence (FPS)"),
                            React.createElement("select", {
                                value: cfg.streamFps || 60,
                                onChange: (e) => updateConfig({ streamFps: parseInt(e.target.value, 10) }),
                                style: { ...inputStyle, width: "auto", minWidth: "160px", cursor: "pointer" }
                            },
                                React.createElement("option", { value: 30 }, "30 FPS (Standard)"),
                                React.createElement("option", { value: 60 }, "60 FPS (Fluide)")
                            )
                        ),
                        React.createElement("div", null,
                            React.createElement("div", { style: { fontSize: "13px", fontWeight: "600", marginBottom: "6px" } }, "Resolution"),
                            React.createElement("select", {
                                value: cfg.streamResolution || "1080",
                                onChange: (e) => updateConfig({ streamResolution: e.target.value }),
                                style: { ...inputStyle, width: "auto", minWidth: "180px", cursor: "pointer" }
                            },
                                React.createElement("option", { value: "720" }, "720p (HD)"),
                                React.createElement("option", { value: "1080" }, "1080p (Full HD)"),
                                React.createElement("option", { value: "1440" }, "1440p (2K QHD)"),
                                React.createElement("option", { value: "source" }, "Source (Native)")
                            )
                        )
                    )
                ),

                React.createElement("div", { style: cardStyle },
                    React.createElement("div", { style: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "8px" } },
                        React.createElement("div", { style: { ...headerStyle, marginBottom: 0 } }, "Pack Extensions Vencord Recommandees"),
                        React.createElement("span", { style: badgeStyle(presetActive) }, presetActive ? "PACK ACTIF" : "PACK INACTIF")
                    ),
                    React.createElement("div", { style: descStyle },
                        "Active NoTrack, ClearURLs, Translate, VoiceMessages, VolumeBooster, BetterFolders, TypingTweaks, ImageZoom, etc."
                    ),
                    React.createElement("div", { style: { display: "flex", gap: "8px" } },
                        React.createElement("button", {
                            onClick: () => togglePreset(true),
                            style: { ...buttonStyle("primary"), margin: 0 }
                        }, "Activer le Pack Recommande"),
                        React.createElement("button", {
                            onClick: () => togglePreset(false),
                            style: { ...buttonStyle("secondary"), margin: 0 }
                        }, "Mode Minimal (Desactiver)")
                    )
                ),

                React.createElement("div", { style: cardStyle },
                    React.createElement("div", { style: headerStyle }, "Arret d'Urgence (Panic Button — Ctrl+Shift+X)"),
                    React.createElement("div", { style: descStyle },
                        "Ferme immediatement Deadcord, coupe Tor et le serveur RPC, vide le presse-papiers et purge les cookies/tokens de TOUS les profils."
                    ),
                    React.createElement("button", {
                        onClick: () => window.DeadcordNative?.triggerPanic?.(),
                        style: buttonStyle("danger")
                    }, "Declencher le Panic Button Maintenant")
                )
            );
        }

        Settings.customEntries.push({
            key: "deadcord",
            title: "Deadcord",
            panelTitle: "Parametres Deadcord",
            Component: DeadcordSettingsTab,
            Icon: DeadcordIcon
        });
    }

    window.addEventListener("deadcord:upload-files", (e) => {
        try {
            const files = e.detail?.files;
            if (!files || files.length === 0) return;

            if (window.Vencord && window.Vencord.Webpack) {
                const UploadHandler = window.Vencord.Webpack.findByProps("promptToUpload");
                const ChannelStore = window.Vencord.Webpack.Common?.ChannelStore || window.Vencord.Webpack.findByProps("getChannel", "getDMFromUserId");
                const SelectedChannelStore = window.Vencord.Webpack.Common?.SelectedChannelStore || window.Vencord.Webpack.findByProps("getChannelId");
                const DraftType = window.Vencord.Webpack.Common?.DraftType || { ChannelMessage: 0 };

                if (UploadHandler && UploadHandler.promptToUpload && SelectedChannelStore && ChannelStore) {
                    const channelId = SelectedChannelStore.getChannelId();
                    if (channelId) {
                        const channel = ChannelStore.getChannel(channelId);
                        if (channel) {
                            UploadHandler.promptToUpload(files, channel, DraftType.ChannelMessage ?? 0);
                            if (e.detail) e.detail.handled = true;
                            e.preventDefault();
                            return;
                        }
                    }
                }
            }
        } catch (_) {}
    });

    function hookStreamQualityPermissions() {
        if (!window.Vencord || !window.Vencord.Webpack) {
            setTimeout(hookStreamQualityPermissions, 200);
            return;
        }
        try {
            const streamQualityMod = window.Vencord.Webpack.findByProps("canStreamQuality");
            if (streamQualityMod) {
                streamQualityMod.canStreamQuality = () => true;
                if (streamQualityMod.canUseHighVideoUploadQuality) {
                    streamQualityMod.canUseHighVideoUploadQuality = () => true;
                }
            }
        } catch (_) {}
    }

    hookStreamQualityPermissions();
    setInterval(hookStreamQualityPermissions, 5000);
    initGameActivityBridge();
    initDeadcordSettings();
})();
