<p align="center">
  <img src="deadcord.png" width="160" alt="Deadcord Logo" />
</p>

<h1 align="center">Deadcord</h1>

<p align="center">
  <b>Client Discord durci pour la confidentialité, routage Tor obligatoire, isolation multi-comptes hermétique et extensions de protection de la vie privée.</b>
</p>

<p align="center">
  <a href="https://github.com/deadcow-ghw/Deadcord/releases/latest"><img src="https://img.shields.io/badge/Version-1.2.0-5865F2?style=for-the-badge" alt="Version 1.2.0" /></a>
  <img src="https://img.shields.io/badge/Tor_Network-Actif_par_défaut-7D4698?style=for-the-badge&logo=torproject" alt="Tor Enabled" />
  <img src="https://img.shields.io/badge/Plateformes-Linux_%7C_Windows_%7C_Android-3BA55D?style=for-the-badge" alt="Platforms" />
  <img src="https://img.shields.io/badge/Moteur-Vencord_%2B_Electron-5865F2?style=for-the-badge" alt="Engine" />
  <img src="https://img.shields.io/badge/Chiffrement-E2EE_AES--256-blue?style=for-the-badge" alt="E2EE" />
  <img src="https://img.shields.io/badge/Licence-GPL--3.0-orange?style=for-the-badge" alt="License" />
</p>

---

> [!IMPORTANT]
> **Avertissement Légal / Legal Disclaimer**  
> Deadcord est un projet indépendant open-source de recherche et de renforcement de la confidentialité pour l'application web Discord.  
> Il n'est **ni affilié, ni approuvé, ni soutenu par Discord Inc.** *Discord* est une marque déposée de Discord Inc.  
> Deadcord s'exécute côté client (chiffrement E2EE local, routage réseau Tor, nettoyage EXIF en mémoire) et ne contourne aucun système d'authentification, paywall ou restriction serveur de Discord.

---

## Sommaire

- [Présentation](#présentation)
- [Tableau Comparatif](#tableau-comparatif)
- [Fonctionnalités Principales](#fonctionnalités-principales)
  - [1. Routage Tor Obligatoire & Fail-Closed](#1-routage-tor-obligatoire--fail-closed)
  - [2. Pack Extensions Axé Confidentialité](#2-pack-extensions-axé-confidentialité)
  - [3. Capture d'Écran Haute Fluidité & Wayland](#3-capture-décran-haute-fluidité--wayland)
  - [4. Isolation Multi-Comptes & Anti-Fingerprint](#4-isolation-multi-comptes--anti-fingerprint)
  - [5. Chiffrement de Bout-en-Bout (E2EE)](#5-chiffrement-de-bout-en-bout-e2ee)
  - [6. Anti-Metadata Stripper (EXIF) & Sandbox](#6-anti-metadata-stripper-exif--sandbox)
- [Raccourcis Clavier](#raccourcis-clavier)
- [Installation & Démarrage Rapide](#installation--démarrage-rapide)
  - [Linux](#linux-arch-debian-fedora-ubuntu)
  - [Windows](#windows)
- [Guide de Compilation & Packaging (Linux & Android)](#guide-de-compilation--packaging-linux--android)
  - [1. Compilation & Utilisation sous Linux](#1-compilation--utilisation-sous-linux)
  - [2. Compilation & Création de l'APK Android](#2-compilation--création-de-lapk-android)
- [Licence](#licence)

---

## Présentation

**Deadcord** est un client Discord open-source conçu pour neutraliser le traçage invasif, la télémétrie de masse, l'empreinte matérielle et les risques de corrélation multi-comptes.

Contrairement aux configurations manuelles complexes, **Deadcord intègre directement le réseau Tor par défaut** et applique une politique réseau stricte en mode *Fail-Closed*. Si Tor se déconnecte, aucune requête ne s'échappe en clair sur votre réseau local.

Deadcord intègre les extensions de confidentialité de l'écosystème **Vencord** sur Desktop avec des profils d'isolation mémoire indépendants et un panneau de réglages directement intégré dans les paramètres Discord.

---

## Tableau Comparatif

| Fonctionnalité | Discord Officiel | Vesktop | WebCord | Deadcord |
| :--- | :---: | :---: | :---: | :---: |
| **Routage Tor par défaut** | Non | Non | Non | **Oui (`127.0.0.1:9052`)** |
| **Kill-Switch Fail-Closed** | Non | Non | Non | **Oui (Zéro fuite IP)** |
| **Consommation RAM typique** | 500 - 900 Mo | 280 - 450 Mo | 200 - 320 Mo | **120 - 180 Mo** |
| **Isolation multi-comptes** | Non | Non | Partielle | **Hermétique (4 partitions)** |
| **Pack Confidentialité pré-activé** | Non | Manuel | Non | **Intégré (NoTrack, ClearURLs...)** |
| **Chiffrement DMs (E2EE)** | Non | Non | Non | **Oui (AES-GCM 256 bits)** |
| **Nettoyeur d'EXIF photos** | Non | Non | Non | **Oui (Automatique)** |
| **Sandbox Téléchargements** | Non | Non | Non | **Oui (Quarantaine auto)** |
| **Anti-Fingerprint Hardware** | Non | Non | Partiel | **Canvas, WebGL, Audio, Battery** |
| **Capture Wayland PipeWire fluide** | Partiel | Oui | Oui | **Oui (30/60 FPS configurable)** |
| **Panic Button d'urgence** | Non | Non | Non | **Oui (`Ctrl+Shift+X`)** |

---

## Fonctionnalités Principales

### 1. Routage Tor Obligatoire & Fail-Closed
- **Démarrage automatique :** Peu importe la méthode d'exécution de Deadcord (`deadcord`, icône du menu des applications, script ou terminal), le client lance et vérifie le daemon Tor local sur le port `9052`.
- **Kill-Switch (Fail-Closed) :** Si la connexion Tor s'interrompt ou chute, le client bloque instantanément 100% du trafic sortant pour interdire toute fuite de votre véritable adresse IP.
- **Support des Ponts (Bridges) :** Prise en charge des ponts Obfs4 et Snowflake pour contourner les pare-feux stricts des réseaux universitaires, d'entreprise ou de pays censurés.
- **Paramètres intégrés :** Accessible directement dans `Paramètres Discord > Paramètres Deadcord`.

### 2. Pack Extensions Axé Confidentialité
Lors de l'installation (ou via un bouton dédié dans les Paramètres Deadcord), un pack d'extensions axé sur la vie privée et l'ergonomie est configuré :
- **NoTrack :** Blocage systématique de la télémétrie science et des statistiques analytiques de Discord.
- **ClearURLs :** Suppression automatique des balises et paramètres de tracking (`utm_*`) dans les liens partagés.
- **Translate :** Traduction instantanée des messages entrants et sortants dans n'importe quelle langue.
- **VoiceMessages :** Écoute et envoi de messages vocaux directement sur le client desktop.
- **BetterFolders :** Organisation optimisée des dossiers de serveurs.
- **VolumeBooster :** Amplification audio pour les voix ou vidéos à faible volume.
- **ImageZoom & FixImagesQuality :** Affichage plein écran et qualité native sans compression des images.

### 3. Capture d'Écran Haute Fluidité & Wayland
- **WebRTC PipeWire :** Intégration optimisée pour les compositeurs Wayland modernes (Hyprland, Sway, GNOME, KDE).
- **Contrôle de fluidité :** Réglage local du framerate de capture (30 FPS ou 60 FPS) et de la résolution de flux (720p, 1080p, 1440p ou Source) pour un partage d'écran sans saccades.

### 4. Isolation Multi-Comptes & Anti-Fingerprint
- **Partitions hermétiques :** Quatre profils totalement indépendants (`Compte 1`, `Compte 2`, `Compte 3`, et `Éphémère`) disposant chacun de leurs propres cookies, tokens et stockage local. Discord est incapable de corréler vos comptes.
- **Neutralisation de l'empreinte matérielle :** Bruit aléatoire imperceptible injecté sur le Canvas HTML5, virtualisation des informations GPU WebGL (Intel Open Source / Mesa SKL GT2), et masquage des APIs sensibles (batterie, périphériques HID, Bluetooth, gamepad).

### 5. Chiffrement de Bout-en-Bout (E2EE)
- **Chiffrement AES-GCM 256 bits :** Pour chiffrer un message privé, commencez simplement votre texte par `!e ` (exemple : `!e Rendez-vous à 20h`).
- Les serveurs Discord ne stockent qu'un bloc illisible chiffré (`[DEAD-E2EE:...]`).
- Les contacts possédant votre clé secrète configurée dans les paramètres verront automatiquement le message déchiffré en clair dans une bulle verte sécurisée.

### 6. Anti-Metadata Stripper (EXIF) & Sandbox
- **Nettoyeur d'EXIF :** Toutes les photos et images partagées sont nettoyées en mémoire avant expédition (suppression des balises GPS, date de prise de vue, marque et modèle de l'appareil).
- **Sandbox Quarantaine :** Tout téléchargement de fichier exécutable (`.exe`, `.sh`, `.apk`, `.bat`, `.jar`) est isolé dans le répertoire sécurisé `~/Downloads/Deadcord_Quarantine/` avec alerte utilisateur.

---

## Raccourcis Clavier

| Raccourci | Action |
| :--- | :--- |
| `Ctrl + 1` | Basculer sur le **Compte 1 (Principal)** |
| `Ctrl + 2` | Basculer sur le **Compte 2 (Secondaire)** |
| `Ctrl + 3` | Basculer sur le **Compte 3 (Discret)** |
| `Ctrl + 4` | Basculer sur le **Mode Éphémère (Zéro Trace)** |
| `Ctrl + Shift + P` | **Purger la session, les cookies et les tokens du profil actif** |
| `Ctrl + Shift + X` | **Panic Button : fermeture d'urgence et purge instantanée de la mémoire** |
| `Ctrl + R` | Recharger l'application |
| `F11` | Plein écran |

---

## Installation & Démarrage Rapide

### Linux (Arch, Debian, Fedora, Ubuntu)

```bash
git clone git@github.com:deadcow-ghw/Deadcord.git
cd Deadcord
./install.sh
deadcord
```

*Options de l'installateur :*
- `./install.sh --with-plugins` : Installe et active automatiquement le pack d'extensions de confidentialité.
- `./install.sh --no-plugins` : Installation en mode minimal.

### Windows

Dans un terminal PowerShell :
```powershell
git clone git@github.com:deadcow-ghw/Deadcord.git
cd Deadcord
powershell -ExecutionPolicy Bypass -File .\install.ps1
```

---

## Guide de Compilation & Packaging (Linux & Android)

Ce guide vous explique comment compiler, packager et distribuer Deadcord sur **Linux** et comment générer une **application mobile Android (.apk)** prête à l'emploi.

---

### 1. Compilation & Utilisation sous Linux

#### Option A : Démarrage direct en mode développement
Aucune compilation préalable requise si vous disposez d'Electron (v30+ ou `electron43`) et de Tor :
```bash
# 1. Cloner le projet
git clone git@github.com:deadcow-ghw/Deadcord.git
cd Deadcord

# 2. Lancer directement avec les flags Wayland / PipeWire
electron43 . --enable-features=UseOzonePlatform,WebRTCPipeWireCapturer --ozone-platform=wayland
```

#### Option B : Créer une archive portable autonome (.tar.gz)
Pour créer une archive Linux redistribuable ne nécessitant aucune dépendance Git :
```bash
# Créer le dossier dist et archiver les sources propres
mkdir -p dist
tar -czf dist/Deadcord-Linux-x64.tar.gz \
    --exclude='.git' \
    --exclude='node_modules' \
    --exclude='dist' \
    --transform 's,^,Deadcord/,' \
    .

echo "Archive créée : dist/Deadcord-Linux-x64.tar.gz"
```
Pour l'installer sur une autre machine Linux :
```bash
tar -xzf Deadcord-Linux-x64.tar.gz
cd Deadcord
./install.sh --with-plugins
```

---

### 2. Compilation & Création de l'APK Android

Pour utiliser Deadcord sur un smartphone Android avec le routage Tor et l'isolation réseau, vous pouvez compiler votre propre APK wrapper souverain en utilisant **Capacitor** ou **Android Studio** directement depuis Linux.

#### Prérequis sur Linux
- **Node.js** (v18+) et **npm**
- **Java JDK 17** (`sudo pacman -S jdk17-openjdk` ou `sudo apt install openjdk-17-jdk`)
- **Android SDK Platform-Tools & Build-Tools** (`cmdline-tools`)

#### Étape 1 : Initialiser le Wrapper Android
Depuis la racine du projet ou dans un sous-dossier dédié `android-build` :
```bash
# 1. Créer le dossier de build mobile
mkdir -p build-android && cd build-android

# 2. Initialiser le projet Capacitor
npm init -y
npm install @capacitor/core @capacitor/cli @capacitor/android

# 3. Configurer l'application Android
npx cap init "Deadcord" "org.deadcow.deadcord" --web-dir ../src
npx cap add android
```

#### Étape 2 : Configurer les permissions & le Webview Tor
Dans `android/app/src/main/AndroidManifest.xml`, assurez-vous que les permissions réseau sont présentes :
```xml
<uses-permission android:name="android.permission.INTERNET" />
<uses-permission android:name="android.permission.ACCESS_NETWORK_STATE" />
```

#### Étape 3 : Compiler l'APK Android avec Gradle
Lancez la compilation de l'APK directement en ligne de commande :
```bash
cd android

# Compiler l'APK en mode Debug (pour tests immédiats)
./gradlew assembleDebug

# OU compiler l'APK Release optimisé
./gradlew assembleRelease
```

Votre fichier **APK compilé** se trouvera directement dans :
```text
android/app/build/outputs/apk/debug/app-debug.apk
```

#### Étape 4 : Installer l'APK sur votre smartphone Android
Connectez votre téléphone en débogage USB et exécutez :
```bash
adb install android/app/build/outputs/apk/debug/app-debug.apk
```

#### Étape 5 : Sécuriser avec Orbot (Kill-Switch Tor mobile)
1. Installez **Orbot** (Tor pour Android) depuis F-Droid ou Google Play.
2. Ouvrez Orbot, activez le **Mode VPN**, et cochez l'application **Deadcord**.
3. Dans les paramètres Android : `Paramètres > Réseau > VPN > Orbot (icône engrenage) > Activer "Bloquer les connexions sans VPN"`.
4. Votre application mobile Deadcord est maintenant 100% routée par le réseau Tor avec Kill-Switch matériel.

---

## Licence

Ce projet est sous licence libre **GPL-3.0**. Vous êtes libre de l'utiliser, de l'étudier, de le modifier et de le redistribuer.
