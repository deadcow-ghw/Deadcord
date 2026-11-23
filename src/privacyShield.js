"use strict";

const { getIdentityProfile, patchSuperPropertiesHeader } = require("./clientIdentity");

const ALLOWED_DISCORD_ORIGINS = new Set([
    "https://discord.com",
    "https://canary.discord.com",
    "https://ptb.discord.com"
]);

const ALLOWED_PERMISSIONS = new Set([
    "media",
    "audioCapture",
    "videoCapture",
    "display-capture",
    "notifications",
    "clipboard-sanitized-write",
    "fullscreen",
    "pointerLock",
    "window-management",
    "mediaKeySystem"
]);

const TRACKING_DOMAINS = [
    "sentry.io",
    "reporting.discord.com",
    "google-analytics.com",
    "googletagmanager.com",
    "crashlytics.com",
    "braintreegateway.com",
    "amplitude.com",
    "statsigapi.net",
    "datadoghq.com",
    "branch.io",
    "braze.com",
    "adjust.com",
    "segment.io",
    "segment.com",
    "mixpanel.com",
    "hotjar.com",
    "cloudflareinsights.com",
    "doubleclick.net",
    "facebook.net"
];

function isTrustedDiscordOrigin(rawUrl) {
    if (!rawUrl || typeof rawUrl !== "string") return false;
    try {
        const u = new URL(rawUrl);
        return ALLOWED_DISCORD_ORIGINS.has(u.origin);
    } catch (_) {
        return false;
    }
}

function getHeaderKeyCaseInsensitive(headers, targetLower) {
    for (const key of Object.keys(headers)) {
        if (key.toLowerCase() === targetLower) return key;
    }
    return null;
}

class PrivacyShield {
    constructor() {
        this.blockedRequestsCount = 0;
        this.killSwitchTripped = false;
        this.useTor = true;
        this.clientIdentity = process.platform === "win32" ? "discord-windows" : "discord-linux";
        this.appliedSessions = new WeakSet();
        this.stats = {
            scienceBlocked: 0,
            sentryBlocked: 0,
            trackingBlocked: 0,
            insecureHttpBlocked: 0,
            headersSanitized: 0,
            exifCleaned: 0,
            permissionsDenied: 0
        };
    }

    setKillSwitch(tripped) {
        this.killSwitchTripped = Boolean(tripped);
    }

    isKillSwitchTripped() {
        return this.killSwitchTripped;
    }

    updateSettings({ useTor, clientIdentity } = {}) {
        if (typeof useTor === "boolean") {
            this.useTor = useTor;
        }
        if (typeof clientIdentity === "string") {
            this.clientIdentity = clientIdentity;
        }
    }

    incrementExifCleaned() {
        this.stats.exifCleaned++;
    }

    applyWebRTCPolicy(sess) {
        try {
            const policy = this.useTor ? "disable_non_proxied_udp" : "default_public_interface_only";
            sess.setWebRTCIPHandlingPolicy(policy);
        } catch (_) {}
    }

    applyToSession(sess, profileName = "default", useTor = this.useTor, clientIdentity = this.clientIdentity) {
        this.useTor = Boolean(useTor);
        if (clientIdentity) this.clientIdentity = clientIdentity;

        this.applyWebRTCPolicy(sess);

        if (this.appliedSessions.has(sess)) {
            return;
        }
        this.appliedSessions.add(sess);

        sess.webRequest.onBeforeRequest({ urls: ["<all_urls>"] }, (details, callback) => {
            const url = details.url || "";
            const lowerUrl = url.toLowerCase();

            const isInternal =
                lowerUrl.startsWith("devtools:") ||
                lowerUrl.startsWith("data:") ||
                lowerUrl.startsWith("blob:") ||
                lowerUrl.startsWith("chrome-extension:");

            if (this.useTor && this.killSwitchTripped && !isInternal) {
                this.blockedRequestsCount++;
                return callback({ cancel: true });
            }

            if (lowerUrl.startsWith("http://") || lowerUrl.startsWith("ws://")) {
                const isLocalLoopback =
                    lowerUrl.startsWith("http://127.0.0.1") ||
                    lowerUrl.startsWith("http://localhost") ||
                    lowerUrl.startsWith("ws://127.0.0.1") ||
                    lowerUrl.startsWith("ws://localhost");
                if (!isLocalLoopback) {
                    this.blockedRequestsCount++;
                    this.stats.insecureHttpBlocked++;
                    return callback({ cancel: true });
                }
            }

            const isDiscordTelemetry =
                (lowerUrl.includes("discord.com/api/v") || lowerUrl.includes("discordapp.com/api/v")) &&
                (
                    lowerUrl.includes("/science") ||
                    lowerUrl.includes("/track") ||
                    lowerUrl.includes("/metrics") ||
                    lowerUrl.includes("/error-reporting")
                );

            const isThirdPartyTracker = TRACKING_DOMAINS.some(d => lowerUrl.includes(d));

            if (isDiscordTelemetry || isThirdPartyTracker) {
                this.blockedRequestsCount++;
                if (lowerUrl.includes("/science")) this.stats.scienceBlocked++;
                else if (lowerUrl.includes("sentry")) this.stats.sentryBlocked++;
                else this.stats.trackingBlocked++;
                return callback({ cancel: true });
            }

            callback({ cancel: false });
        });

        sess.webRequest.onBeforeSendHeaders((details, callback) => {
            if (details.method === "OPTIONS") {
                return callback({ cancel: false });
            }

            const headers = { ...details.requestHeaders };
            const url = details.url || "";
            let modified = false;

            const isDiscordDomain =
                url.startsWith("https://discord.com/") ||
                url.startsWith("https://canary.discord.com/") ||
                url.startsWith("https://ptb.discord.com/") ||
                url.startsWith("https://gateway.discord.gg/");

            if (isDiscordDomain) {
                this.stats.headersSanitized++;

                for (const bad of ["x-debug-options", "x-discord-track", "x-client-data"]) {
                    const key = getHeaderKeyCaseInsensitive(headers, bad);
                    if (key) {
                        delete headers[key];
                        modified = true;
                    }
                }

                const identity = getIdentityProfile(this.clientIdentity);
                if (identity.isDesktopClient) {
                    const superPropKey = getHeaderKeyCaseInsensitive(headers, "x-super-properties");
                    if (superPropKey && headers[superPropKey]) {
                        headers[superPropKey] = patchSuperPropertiesHeader(headers[superPropKey], this.clientIdentity);
                        modified = true;
                    }

                    if (url.includes("/api/") || url.startsWith("https://gateway.discord.gg/")) {
                        const uaKey = getHeaderKeyCaseInsensitive(headers, "user-agent") || "User-Agent";
                        headers[uaKey] = identity.userAgent;
                        for (const ch of ["sec-ch-ua", "sec-ch-ua-mobile", "sec-ch-ua-platform", "sec-ch-ua-full-version-list"]) {
                            const k = getHeaderKeyCaseInsensitive(headers, ch);
                            if (k) delete headers[k];
                        }
                        modified = true;
                    }
                }
            } else {
                const isDiscordCdn =
                    url.startsWith("https://cdn.discordapp.com/") ||
                    url.startsWith("https://media.discordapp.net/") ||
                    url.startsWith("https://images-ext-");
                if (!isDiscordCdn) {
                    const refKey = getHeaderKeyCaseInsensitive(headers, "referer");
                    if (refKey) {
                        delete headers[refKey];
                        modified = true;
                    }
                }
            }

            if (modified) {
                return callback({ requestHeaders: headers });
            }
            callback({});
        });

        sess.webRequest.onHeadersReceived((details, callback) => {
            const responseHeaders = { ...(details.responseHeaders || {}) };
            for (const leak of ["report-to", "nel", "x-client-data"]) {
                const k = getHeaderKeyCaseInsensitive(responseHeaders, leak);
                if (k) delete responseHeaders[k];
            }
            if (!getHeaderKeyCaseInsensitive(responseHeaders, "x-content-type-options")) {
                responseHeaders["X-Content-Type-Options"] = ["nosniff"];
            }
            callback({ responseHeaders });
        });

        sess.setPermissionRequestHandler((webContents, permission, callback, details) => {
            const origin = (details && details.requestingUrl) || (webContents && webContents.getURL()) || "";
            if (isTrustedDiscordOrigin(origin) && ALLOWED_PERMISSIONS.has(permission)) {
                return callback(true);
            }
            this.stats.permissionsDenied++;
            callback(false);
        });

        sess.setPermissionCheckHandler((webContents, permission, requestingOrigin) => {
            const origin = requestingOrigin || (webContents && webContents.getURL()) || "";
            if (isTrustedDiscordOrigin(origin) && ALLOWED_PERMISSIONS.has(permission)) {
                return true;
            }
            return false;
        });
    }

    getStats() {
        return {
            totalBlocked: this.blockedRequestsCount,
            killSwitchTripped: this.killSwitchTripped,
            useTor: this.useTor,
            clientIdentity: this.clientIdentity,
            ...this.stats
        };
    }
}

module.exports = {
    PrivacyShield,
    isTrustedDiscordOrigin
};
