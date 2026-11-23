"use strict";

const IDENTITY_PROFILES = {
    "discord-linux": {
        id: "discord-linux",
        label: "Discord Client (Linux Desktop)",
        isDesktopClient: true,
        os: "Linux",
        os_version: "6.12.0",
        os_arch: "x64",
        app_arch: "x64",
        browser: "Discord Client",
        browser_version: "33.4.0",
        client_version: "0.0.85",
        release_channel: "stable",
        userAgent: "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) discord/0.0.85 Chrome/130.0.6723.191 Electron/33.4.0 Safari/537.36",
        webUserAgent: "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36"
    },
    "discord-windows": {
        id: "discord-windows",
        label: "Discord Client (Windows Desktop)",
        isDesktopClient: true,
        os: "Windows",
        os_version: "10.0.22631",
        os_arch: "x64",
        app_arch: "x64",
        browser: "Discord Client",
        browser_version: "33.4.0",
        client_version: "1.0.9182",
        release_channel: "stable",
        native_build_number: 58326,
        userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) discord/1.0.9182 Chrome/130.0.6723.191 Electron/33.4.0 Safari/537.36",
        webUserAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36"
    },
    "web-chrome": {
        id: "web-chrome",
        label: "Navigateur Web (Chrome)",
        isDesktopClient: false,
        os: "Linux",
        os_version: "",
        browser: "Chrome",
        browser_version: "130.0.0.0",
        release_channel: "stable",
        userAgent: "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
        webUserAgent: "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36"
    }
};

function getIdentityProfile(mode) {
    if (mode && Object.prototype.hasOwnProperty.call(IDENTITY_PROFILES, mode)) {
        return IDENTITY_PROFILES[mode];
    }
    return process.platform === "win32"
        ? IDENTITY_PROFILES["discord-windows"]
        : IDENTITY_PROFILES["discord-linux"];
}

function patchSuperPropertiesObject(props, mode) {
    const profile = getIdentityProfile(mode);
    if (!profile.isDesktopClient || !props || typeof props !== "object") {
        return props;
    }

    const patched = { ...props };
    patched.os = profile.os;
    patched.os_version = profile.os_version;
    patched.os_arch = profile.os_arch;
    patched.app_arch = profile.app_arch;
    patched.browser = profile.browser;
    patched.browser_user_agent = profile.userAgent;
    patched.browser_version = profile.browser_version;
    patched.client_version = profile.client_version;
    patched.release_channel = profile.release_channel;
    if (profile.native_build_number) {
        patched.native_build_number = profile.native_build_number;
    } else {
        delete patched.native_build_number;
    }
    patched.client_event_source = null;

    delete patched.referrer;
    delete patched.referring_domain;
    delete patched.referrer_current;
    delete patched.referring_domain_current;
    delete patched.device;

    return patched;
}

function patchSuperPropertiesHeader(base64Header, mode) {
    const profile = getIdentityProfile(mode);
    if (!profile.isDesktopClient || !base64Header || typeof base64Header !== "string") {
        return base64Header;
    }
    try {
        const decoded = Buffer.from(base64Header, "base64").toString("utf-8");
        const parsed = JSON.parse(decoded);
        const patched = patchSuperPropertiesObject(parsed, mode);
        return Buffer.from(JSON.stringify(patched), "utf-8").toString("base64");
    } catch (_) {
        return base64Header;
    }
}

function getMainWorldIdentityPatchScript(mode) {
    const profile = getIdentityProfile(mode);
    const serializedProfile = JSON.stringify({
        isDesktopClient: profile.isDesktopClient,
        os: profile.os,
        os_version: profile.os_version,
        os_arch: profile.os_arch || "x64",
        app_arch: profile.app_arch || "x64",
        browser: profile.browser,
        browser_version: profile.browser_version,
        client_version: profile.client_version || "",
        release_channel: profile.release_channel || "stable",
        native_build_number: profile.native_build_number || null,
        userAgent: profile.userAgent
    });

    return `
(function() {
    window.__deadcordClientIdentity = ${serializedProfile};
    if (window.__deadcordIdentityPatchInstalled) return;
    window.__deadcordIdentityPatchInstalled = true;

    function applyDesktopProperties(props) {
        const prof = window.__deadcordClientIdentity;
        if (!prof || !prof.isDesktopClient || !props || typeof props !== "object") return props;
        const out = Object.assign({}, props, {
            os: prof.os,
            os_version: prof.os_version,
            os_arch: prof.os_arch,
            app_arch: prof.app_arch,
            browser: prof.browser,
            browser_user_agent: prof.userAgent,
            browser_version: prof.browser_version,
            client_version: prof.client_version,
            release_channel: prof.release_channel,
            client_event_source: null
        });
        if (prof.native_build_number) {
            out.native_build_number = prof.native_build_number;
        } else {
            delete out.native_build_number;
        }
        delete out.referrer;
        delete out.referring_domain;
        delete out.referrer_current;
        delete out.referring_domain_current;
        delete out.device;
        return out;
    }

    const origSend = WebSocket.prototype.send;
    WebSocket.prototype.send = function(data) {
        try {
            const prof = window.__deadcordClientIdentity;
            if (
                prof &&
                prof.isDesktopClient &&
                typeof data === "string" &&
                this.url &&
                this.url.includes("gateway.discord") &&
                data.includes('"op":2')
            ) {
                const payload = JSON.parse(data);
                if (payload && payload.op === 2 && payload.d && payload.d.properties) {
                    payload.d.properties = applyDesktopProperties(payload.d.properties);
                    return origSend.call(this, JSON.stringify(payload));
                }
            }
        } catch (_) {}
        return origSend.apply(this, arguments);
    };

    const origSetHeader = XMLHttpRequest.prototype.setRequestHeader;
    XMLHttpRequest.prototype.setRequestHeader = function(name, value) {
        try {
            const prof = window.__deadcordClientIdentity;
            if (
                prof &&
                prof.isDesktopClient &&
                typeof name === "string" &&
                name.toLowerCase() === "x-super-properties" &&
                typeof value === "string"
            ) {
                const decoded = JSON.parse(atob(value));
                const patched = applyDesktopProperties(decoded);
                return origSetHeader.call(this, name, btoa(JSON.stringify(patched)));
            }
        } catch (_) {}
        return origSetHeader.apply(this, arguments);
    };
})();
`;
}

module.exports = {
    IDENTITY_PROFILES,
    getIdentityProfile,
    patchSuperPropertiesObject,
    patchSuperPropertiesHeader,
    getMainWorldIdentityPatchScript
};
