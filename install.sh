#!/usr/bin/env bash
set -e

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

mkdir -p "$HOME/.local/bin"
mkdir -p "$HOME/.local/share/applications"
mkdir -p "$HOME/.local/share/icons/hicolor/scalable/apps"
mkdir -p "$HOME/.local/share/icons/hicolor/512x512/apps"

if [ -f "$DIR/bin/tor" ]; then
    cp "$DIR/bin/tor" "$HOME/.local/bin/tor"
    chmod +x "$HOME/.local/bin/tor"
elif ! command -v tor >/dev/null 2>&1 && [ ! -f "$HOME/.local/bin/tor" ]; then
    if command -v pacman >/dev/null 2>&1; then
        MIRROR_URL="https://stable-mirror.omarchy.org/extra/os/x86_64/tor-0.4.9.14-1-x86_64.pkg.tar.zst"
        curl -sSL "$MIRROR_URL" -o /tmp/tor.pkg.tar.zst 2>/dev/null || true
        if [ -f /tmp/tor.pkg.tar.zst ]; then
            tar -I zstd -xf /tmp/tor.pkg.tar.zst usr/bin/tor -O > "$HOME/.local/bin/tor" 2>/dev/null || true
            chmod +x "$HOME/.local/bin/tor" 2>/dev/null || true
            rm -f /tmp/tor.pkg.tar.zst
        fi
    fi
fi

chmod +x "$DIR/bin/deadcord"
ln -sf "$DIR/bin/deadcord" "$HOME/.local/bin/deadcord"
cp "$DIR/deadcord.svg" "$HOME/.local/share/icons/hicolor/scalable/apps/deadcord.svg"
if [ -f "$DIR/deadcord.png" ]; then
    cp "$DIR/deadcord.png" "$HOME/.local/share/icons/hicolor/512x512/apps/deadcord.png"
fi
cp "$DIR/deadcord.desktop" "$HOME/.local/share/applications/deadcord.desktop"

command -v gtk-update-icon-cache >/dev/null 2>&1 && gtk-update-icon-cache -f -t "$HOME/.local/share/icons/hicolor" 2>/dev/null || true
command -v update-desktop-database >/dev/null 2>&1 && update-desktop-database "$HOME/.local/share/applications" 2>/dev/null || true

SETUP_PLUGINS="O"
if [ "$1" == "--no-plugins" ]; then
    SETUP_PLUGINS="N"
elif [ "$1" == "--with-plugins" ]; then
    SETUP_PLUGINS="O"
elif [ -t 0 ]; then
    read -r -p "Activer automatiquement le pack des extensions Vencord recommandees (NoTrack, ClearURLs, Translate, VoiceMessages...) ? [O/n] : " USER_CHOICE
    [ -n "$USER_CHOICE" ] && SETUP_PLUGINS="$USER_CHOICE"
fi

if [[ "$SETUP_PLUGINS" =~ ^[oOyY] ]]; then
    mkdir -p "$HOME/.config/deadcord/vencordData/settings"
    cat << 'JSON_EOF' > "$HOME/.config/deadcord/vencordData/settings/settings.json"
{
    "autoUpdate": true,
    "autoUpdateNotification": false,
    "useQuickCss": true,
    "themeLinks": [],
    "enabledThemes": [],
    "plugins": {
        "Translate": { "enabled": true },
        "NoTrack": { "enabled": true },
        "VoiceMessages": { "enabled": true },
        "BetterFolders": { "enabled": true },
        "ClearURLs": { "enabled": true },
        "ValidUser": { "enabled": true },
        "PermissionsViewer": { "enabled": true },
        "SilentMessageToggle": { "enabled": true },
        "CallTimer": { "enabled": true },
        "VolumeBooster": { "enabled": true },
        "RelationshipNotifier": { "enabled": true },
        "BiggerStreamPreview": { "enabled": true },
        "ImageZoom": { "enabled": true },
        "TypingTweaks": { "enabled": true },
        "FixCodeblockGap": { "enabled": true },
        "FixImagesQuality": { "enabled": true },
        "FixSpotifyEmbeds": { "enabled": true },
        "FixYoutubeEmbeds": { "enabled": true },
        "OpenInApp": { "enabled": true },
        "WebKeybinds": { "enabled": true },
        "WebScreenShareFixes": { "enabled": true },
        "BadgeAPI": { "enabled": true },
        "CommandsAPI": { "enabled": true },
        "MessageAccessoriesAPI": { "enabled": true },
        "UserSettingsAPI": { "enabled": true },
        "CrashHandler": { "enabled": true }
    }
}
JSON_EOF
fi
