$ErrorActionPreference = "Stop"

$ProjectDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$LocalApp = [System.IO.Path]::Combine($env:LOCALAPPDATA, "Deadcord")
$TorDir = [System.IO.Path]::Combine($LocalApp, "tor")

if (-not (Test-Path $TorDir)) {
    New-Item -ItemType Directory -Path $TorDir -Force | Out-Null
}

$TorExe = [System.IO.Path]::Combine($TorDir, "tor.exe")
if (-not (Test-Path $TorExe)) {
    try {
        $TorZip = [System.IO.Path]::Combine($env:TEMP, "tor-win64.zip")
        $TorUrl = "https://archive.torproject.org/tor-package-archive/torbrowser/14.0.1/tor-expert-bundle-windows-x86_64-14.0.1.tar.gz"
        Invoke-WebRequest -Uri $TorUrl -OutFile $TorZip -UseBasicParsing
        tar -xzf $TorZip -C $TorDir
        Remove-Item -Path $TorZip -Force -ErrorAction SilentlyContinue
    } catch {}
}

$WshShell = New-Object -ComObject WScript.Shell
$DesktopPath = [System.Environment]::GetFolderPath("Desktop")
$Shortcut = $WshShell.CreateShortcut([System.IO.Path]::Combine($DesktopPath, "Deadcord.lnk"))
$Shortcut.TargetPath = "electron.exe"
$Shortcut.Arguments = "`"$ProjectDir`""
$Shortcut.WorkingDirectory = $ProjectDir
$Shortcut.Save()

$setupPlugins = Read-Host "Activer automatiquement le pack des extensions Vencord recommandees (NoTrack, ClearURLs, Translate, VoiceMessages...) ? [O/n]"
if ([string]::IsNullOrWhiteSpace($setupPlugins) -or $setupPlugins -match "^[oOyY]") {
    $vencordDir = [System.IO.Path]::Combine($env:APPDATA, "Deadcord", "vencordData", "settings")
    if (-not (Test-Path $vencordDir)) {
        New-Item -ItemType Directory -Path $vencordDir -Force | Out-Null
    }
    $settingsJson = @"
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
"@
    [System.IO.File]::WriteAllText([System.IO.Path]::Combine($vencordDir, "settings.json"), $settingsJson, [System.Text.Encoding]::UTF8)
}
