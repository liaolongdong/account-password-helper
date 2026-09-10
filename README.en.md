# Account Password Helper · 账号密码管理助手

[中文](./README.md) | **English**

[![Star on GitHub](https://img.shields.io/badge/%E2%AD%90_Star_on_GitHub-24292f?logo=github&logoColor=white)](https://github.com/liaolongdong/account-password-helper/stargazers)
[![WXT](https://img.shields.io/badge/WXT-v0.20.27-4E88FF)](https://wxt.dev/)
[![Vue](https://img.shields.io/badge/Vue-v3.5.41-42b883)](https://vuejs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-v6.0.3-3178c6)](https://www.typescriptlang.org/)
[![Element Plus](https://img.shields.io/badge/Element%20Plus-v2.14.4-409EFF)](https://element-plus.org/)
[![Manifest V3](https://img.shields.io/badge/Chrome-MV3-4285F4)](https://developer.chrome.com/docs/extensions/mv3/intro/)
[![License](https://img.shields.io/badge/License-GPL--3.0-blue.svg)](#license)
[![Chrome Web Store](https://img.shields.io/chrome-web-store/v/fgimkdodpjfkddmildjieojpfakpanli?label=CWS&logo=googlechrome&logoColor=white&color=4285F4)](https://chromewebstore.google.com/detail/account-password-helper/fgimkdodpjfkddmildjieojpfakpanli)
[![Chrome Web Store Users](https://img.shields.io/chrome-web-store/users/fgimkdodpjfkddmildjieojpfakpanli?label=Users&logo=googlechrome&logoColor=white&color=4285F4)](https://chromewebstore.google.com/detail/account-password-helper/fgimkdodpjfkddmildjieojpfakpanli)
[![Chrome Web Store Rating](https://img.shields.io/chrome-web-store/rating/fgimkdodpjfkddmildjieojpfakpanli?label=Rating&color=4285F4)](https://chromewebstore.google.com/detail/account-password-helper/fgimkdodpjfkddmildjieojpfakpanli)
[![Release](https://img.shields.io/github/v/release/liaolongdong/account-password-helper?label=Release&logo=github&color=24292f)](https://github.com/liaolongdong/account-password-helper/releases/latest)
[![Last Commit](https://img.shields.io/github/last-commit/liaolongdong/account-password-helper?logo=github&logoColor=white&label=Last%20Commit)](https://github.com/liaolongdong/account-password-helper/commits/main)

> **Free open-source local password manager** · One-click login (fill → tick → click) · Local AES-256-GCM, zero cloud · TOTP 2FA · Security audit · Multi-environment isolation · One-click migration from Chrome / Bitwarden / 1Password · Built for developers & QA

A **free, open-source** local Chrome password manager built for developers & QA: **one-click login** (autofill + tick "remember me / I agree" + click login — not just form fill), exact-domain matching to isolate dev/test/staging/prod accounts, built-in **TOTP 2FA**, **security audit** & **password generator**. **PBKDF2 (600,000 iterations) + AES-256-GCM** encryption, an instantly-opening side panel (SLA under 1s; **20–50ms to data** on the cached warm path), and your password data never leaves the machine — no account needed.

> **Security notice**: Account Password Helper is built for development, testing and everyday sign-in scenarios. All data stays in your browser; sensitive fields are encrypted individually with AES-256-GCM and password data never travels over the network. The extension's only outbound behaviour is an anonymous version check every 6 hours (it reads Chrome Web Store reachability and the GitHub Releases version number, carrying no account data) — see [Permissions & Data Flow](#-permissions--data-flow). For the safety of your assets, we recommend not storing highly sensitive credentials (banking, payment, etc.) in any browser extension.
>
> 🌐 **Live demo**: https://liaolongdong.github.io/account-password-helper/
>
> 📊 **Technical highlights**: PBKDF2 600K iterations · AES-256-GCM authenticated encryption · Instant side panel in every state (20–50ms to data on the cached warm path) · 6 themes · Bilingual UI · Core features work fully offline · 632 automated tests

**Contents**: [Screenshots](#-feature-screenshots-password-list--side-panel--totp--security-audit) · [Why Choose It](#-why-choose-it) · [Core Features](#core-features) · [Permissions & Data Flow](#-permissions--data-flow) · [Quick Start](#quick-start) · [User Guide](#user-guide) · [FAQ](#faq) · [License](#license)

<p align="center">
  <img src="./assets/icons/icon.svg" alt="Extension icon" width="120" />
</p>

<p align="center">
  <img src="./docs/demo-login.webp" alt="One-keystroke login demo" width="100%" />
  <br/>
  <sub>Ctrl+Shift+F → autofill → tick "remember me / I agree" → (with "Auto-submit login" on) click login → 2FA live-code handoff → enter code → done in 1 second</sub>
</p>

## 🖥️ Feature Screenshots (Password List / Side Panel / TOTP / Security Audit)

<p align="center">
  <img src="./assets/screenshots/02-password-list.png" alt="Password list & management" width="100%" />
  <br/>
  <sub>Password list — smart search, tags, favorites, one-click dedupe</sub>
</p>

<p align="center">
  <img src="./assets/screenshots/06-sidepanel-fill.png" alt="Side panel quick fill" width="100%" />
  <br/>
  <sub>Side panel — pinyin/initials search with match highlighting, instant response</sub>
</p>

<p align="center">
  <img src="./assets/screenshots/09-totp-code.png" alt="TOTP two-factor authentication" width="100%" />
  <br/>
  <sub>TOTP 2FA — verification codes alongside passwords, no phone authenticator needed</sub>
</p>

<p align="center">
  <img src="./assets/screenshots/10-health-check.png" alt="Security audit dashboard" width="100%" />
  <br/>
  <sub>Security audit — weighted four-dimension scoring, all computed locally</sub>
</p>

<p align="center">
  <img src="./assets/screenshots/11-inline-fill.png" alt="Inline fill mini-panel" width="100%" />
  <br/>
  <sub>Inline fill — key icon in the input field, click to fill</sub>
</p>

<p align="center">
  <img src="./assets/screenshots/12-theme-skin.png" alt="Themes & bilingual UI" width="100%" />
  <br/>
  <sub>6 color themes + bilingual UI (中文 / English), instant switching</sub>
</p>

## ✨ Why Choose It

| Feature                                   | What sets it apart                                                                                                                                                                                                                                      |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ⚡ **One-keystroke login, not just fill** | `Ctrl+Shift+F` runs fill → tick "remember me / I agree" in one press; turn on "Auto-submit login" (or use the side panel's "Fill and sign in") and it clicks the login button too. Other tools fill — **you still click login yourself**                |
| 🎯 **Multi-environment isolation**        | Exact-domain matching separates dev / test / staging / prod credentials — **same site, different environments, zero mix-ups**. A must-have for developers                                                                                               |
| 🔑 **Built-in TOTP + 2FA handoff**        | Verification codes live with your passwords; on GitHub-style two-step logins, the live code capsule auto-anchors beside the input — **no phone authenticator app needed**                                                                               |
| 🔒 **Local AES-256-GCM, zero cloud**      | No cloud, no account, no subscription — **so there is no server for anyone to breach**. Username / password / URL / remark / TOTP secret are encrypted field by field; non-sensitive metadata (tags, timestamps) stays plaintext so the list can render |
| 📊 **Offline security audit**             | One-click 0–100 score, four weighted dimensions: reused 35 / weak 25 / in offline leaked dictionary 20 / stale 20 (missing 2FA is listed but not scored) — **all computed offline**                                                                     |
| 📦 **One-click migration**                | Auto-detects exports from Chrome / LastPass / Bitwarden / 1Password; CSV & JSON — **move in in 30 seconds**                                                                                                                                             |

## Who It's For

- **Developers** — exact-domain matching isolates dev / test / staging / prod accounts for the same site, zero mix-ups
- **QA engineers** — quickly switch test accounts: `Ctrl+Shift+F` fills in one keystroke, and with "Auto-submit login" on it clicks Sign in too — double the cross-environment throughput
- **Privacy-conscious users** — local AES-256-GCM encryption, password data never leaves the machine (one anonymous version check every 6 hours — see [Permissions & Data Flow](#-permissions--data-flow)), no account registration, no cloud sync
- **Everyday users** — stop memorizing passwords, built-in TOTP 2FA, password generator for strong credentials

## How It Compares

| Feature                                   | Account Password Helper |        Bitwarden        |         1Password         |           Chrome Built-in            |
| ----------------------------------------- | :---------------------: | :---------------------: | :-----------------------: | :----------------------------------: |
| Price                                     |     Completely free     | Free / Premium ≈ $10/yr |   $2.99/mo (see vendor)   |                 Free                 |
| Data storage                              |       Pure local        |          Cloud          |           Cloud           | Local + optional Google account sync |
| Account required                          |           No            |           Yes           |            Yes            |                  No                  |
| One-keystroke login (fill + tick + click) |      Yes, no setup      |    Needs extra setup    |     Needs extra setup     |              Fill only               |
| Multi-environment isolation               |           Yes           |           No            |            No             |                  No                  |
| TOTP authenticator                        |   Built in (same ext)   |    Separate free app    | In all subscription tiers |                  No                  |
| Offline security audit (0–100 score)      |           Yes           |           No            |     Hosted Watchtower     | Compromised-password check, no score |
| Open source (GPL-3.0)                     |           Yes           |           Yes           |            No             |                  No                  |

> Competitor pricing and feature boundaries are as of Sep 2026 and change often — check each vendor's site.

## Core Features

### 🔐 Security

- **Native browser encryption**: Built on the Web Crypto API. The master password derives a key through PBKDF2-SHA256 (600,000 iterations); the sensitive fields (username / password / URL / remark / TOTP) are encrypted one field at a time with AES-256-GCM in `Base64(IV ‖ ciphertext ‖ auth tag)` form, using a fresh random IV per encryption. Non-sensitive metadata such as tags and timestamps stays plaintext so the list can render and sort. Password data never travels over the network; the only outbound request is an anonymous version check every 6 hours (see [Permissions & Data Flow](#-permissions--data-flow))
- **Flexible session control**: Validity from 1 hour to 7 days (default 24 hours); auto idle lock and lock-on-browser-restart are both opt-in and off by default; one-click lock in the popup. Remaining time is visible in the manager/sidebar/popup (amber at ≤10 minutes, red at ≤1 minute), and clicking the badge opens the validity dialog where you can renew
- **Offline health check**: One-click 0–100 score across four weighted dimensions (reused 35 / weak 25 / hit in the leaked dictionary 20 / stale 20); accounts without 2FA are listed separately and do not affect the score. The leaked-password dictionary is a built-in, near-1,000-entry offline list — everything computed locally
- **TOTP 2FA**: Local code generation (RFC 6238) with live codes and countdowns in the list/sidebar; add secrets by scanning a webpage QR code or uploading an image; GitHub-style two-step login auto-anchors a live-code capsule for one-click fill

### ⚡ Smart Fill

- **One-keystroke login, not just fill**: `Ctrl+Shift+F` (Mac `Cmd+Shift+F`) fills the best-matching account for the site and ticks consent boxes matched by keywords such as "remember me / I have read and agree / accept terms"; turn on "Auto-submit login" in preferences (or use the "Fill and sign in" icon on a side panel entry) and one press runs the whole chain — fill → tick → click login — while GitHub-style two-step logins are continued by the live TOTP code capsule
- **Quadruple fill strategy**: Inline fill (key icon in the input, the default), side panel one-click fill, right-click fill (right-click an input → "Fill Credentials" → fill username / password / 2FA code, or "Generate & Fill Strong Password" — the latter touches no stored credential, so it works even while the session is locked; right-click blank page → "Account Password Helper" → open side panel / open manager), and the quick-fill shortcut — covering everything from deliberate point-and-choose to a blind keypress. Fill failures are reported through an in-page notice + desktop notification + toolbar badge, and a locked session opens an unlock prompt right on the page
- **Exact domain matching**: Only entries whose host exactly matches the current page are shown, keeping dev/test/staging/prod accounts apart; `localhost` matches everything by default
- **Auto-save credentials**: Chrome-style capture with save confirmation, smart dedup (identical credentials never re-prompt, changed passwords trigger an "Update" confirmation), domain allow/block lists, one-click "Never for this site"; the save prompt also flags weak and reused passwords inline (a heads-up only — it never blocks saving)
- **Side panel quick add**: Click "+" in the side panel header to save credentials in place (an add invitation also appears when the current site has none); the site field is prefilled from the current domain, with "Open Password Manager for all fields" for full fields like TOTP
- **Side panel search scope**: The icon beside the search box toggles between "This site" and "All entries" — by default only entries matching the current domain are listed, while all-entry mode opens up the whole vault (switching to a tab on a different site resets it back to this site). Off-site hits keep copy username/password/2FA code, favorite and edit, and clicking the row opens that site in a new tab. When this site has no match but the vault does, the empty state offers a "Search all entries (N found)" shortcut
- **Broad compatibility**: Dynamically detects login forms (including cross-iframe), compatible with React/Vue and other frameworks; covers username + password, phone + verification code, and more
- **Password visibility toggle**: Injects a show/hide button into page password fields (enable in floating button preferences) — verify filled content with one click, no separate extension needed

### 📦 Data Management

- **Import/export**: CSV / JSON formats (the import dialog accepts `.csv` and `.json` only — re-save Excel as CSV), with auto-detection of Chrome, LastPass, Bitwarden, and 1Password exports and Chinese/English column mapping
- **Multiple backup options**: Encrypted backup (.aph) export/import with decrypt preview; email backup that assembles the content locally and hands it to your own mail client over `mailto:` (plain or encrypted); scheduled reminders that notify you on the desktop to make a backup — nothing is ever sent automatically
- **Powerful organization**: Multi-select tags with filtering, favorites pinned to the top (cap defaults to 10, configurable 1–50, evicted LRU), multi-field smart search (pinyin/initials with match highlighting), one-click dedup, batch delete/tag editing/export selected; each entry also opens a read-only "View details" drawer with the full remark and password history — no need to enter edit mode
- **Mistake-proofing**: 30-day trash bin (soft delete, purged by a daily background alarm), configurable password change history (default 3 encrypted snapshots per entry, 1–10 allowed, restorable), atomic master password change without data loss

### 🎨 Experience

- **Themes & language**: 6 color themes + bilingual UI (中文 / English), instant switching without refresh, synchronized across extension pages and injected in-page UI
- **Site favicons**: Password list, side panel and inline dropdown entries show the matching website icon, read from Chrome's local favicon cache with zero external requests; falls back to the default icon when unavailable
- **Password generator**: Random mode (default 16 characters, configurable 6–50, with charset and ambiguous-character exclusion) and passphrase mode (Diceware-style, built-in 3080-word English list, 3–8 words with optional digits)
- **Caps Lock warning**: Master password fields (setup, unlock, verification dialog, change, backup import) detect Caps Lock state in real time and show a warning, so a case-sensitivity typo is never mistaken for a "wrong password"
- **Instant open**: The side panel opens instantly with no blank frame in every state; with a live session it takes the cached warm path and returns data in 20–50ms

> 🛠 Tech stack, architecture and project structure are covered in the [Contributing Guide](./docs/CONTRIBUTING.md).
>
> 📖 Per-feature implementation details (source paths, strategies, constraints) live in [docs/ARCHITECTURE.en.md — Feature Implementation Details](./docs/ARCHITECTURE.en.md#feature-implementation-details).
>
> 📝 Engineering write-ups — the local-first product story, the sub-second side panel, Web Crypto in practice, and login-flow feature notes — are on the [Tech Blog](https://liaolongdong.github.io/account-password-helper/blog/) (Chinese & English).

## 🧭 Permissions & Data Flow

### Every permission and what it actually does

| Permission       | Real use                                                                                                                                                                                                |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `storage`        | Stores ciphertext entries, settings and session key material. Only `chrome.storage.local` (persistent ciphertext) and `chrome.storage.session` (in-memory key/snapshot) — **never** `sync` or `managed` |
| `activeTab`      | When you act (shortcut, toolbar icon, right-click menu, floating button), reads the current tab's URL and handle so the right form is targeted                                                          |
| `scripting`      | Injects the fill script into the login page (setting input values and dispatching the events frameworks recognise)                                                                                      |
| `sidePanel`      | The side panel quick-fill UI                                                                                                                                                                            |
| `alarms`         | Scheduled work: session expiry checks, trash purge (every 24h), backup reminders (every 12h), version check (every 6h), service-worker keep-alive revival                                               |
| `notifications`  | Desktop notifications: fill failures, backup reminders, new-version notices                                                                                                                             |
| `idle`           | Auto idle lock (off by default; only active once you enable it)                                                                                                                                         |
| `clipboardWrite` | Copies username / password / 2FA code to the clipboard                                                                                                                                                  |
| `clipboardRead`  | Verifies before clipboard auto-clear that the content is still the password that was copied, so it never deletes something you copied later                                                             |
| `webNavigation`  | Calls `getAllFrames` only, to enumerate frames so credentials go to the top frame or a same-main-domain iframe (cross-iframe login forms)                                                               |
| `contextMenus`   | The "Fill Credentials" menu on inputs and the "Account Password Helper" menu on pages                                                                                                                   |
| `favicon`        | Reads Chrome's **local** favicon cache (the internal `_favicon/` extension endpoint); no favicon service is ever contacted                                                                              |
| `<all_urls>`     | Login forms live on arbitrary sites, so detection and filling must run there                                                                                                                            |

### What the extension never does

- No `cookies`, `history`, `downloads` or any undeclared permission; no `storage.sync` / `storage.managed`;
- No telemetry, analytics, ads or crash reporting, and no device fingerprint or usage statistics;
- The master password is never stored in any recoverable form — only a PBKDF2-derived verifier is kept;
- Sensitive fields are ciphertext at rest (the at-rest invariant); unlocking only obtains the key, it never writes a plaintext copy of the vault back to `storage.local`.

### The only outbound request

The update check runs every 6 hours: store installs send an opaque HEAD request to the Chrome Web Store listing page, manual installs query the public GitHub Releases API. Both are anonymous and carry **no vault content, no accounts, no identifiers and nothing derivable from them**; if the network is unavailable the check fails silently and no core feature is affected. Beyond this, the extension makes no external requests at all — even website icons come from Chrome's local cache.

## Quick Start

### Install from the Chrome Web Store (recommended)

Visit the [Chrome Web Store page](https://chromewebstore.google.com/detail/account-password-helper/fgimkdodpjfkddmildjieojpfakpanli) and click "Add to Chrome". Updates are pushed automatically by the store.

### Download from GitHub Releases (if Google is unreachable)

If you cannot access the Chrome Web Store, download the latest zip from [GitHub Releases](https://github.com/liaolongdong/account-password-helper/releases/latest) and install manually:

1. Download and extract the zip to any directory (keep this directory — future updates overwrite it)
2. Open `chrome://extensions/` and enable "Developer mode"
3. Click "Load unpacked" and select the extracted directory
4. On first use, set a master password (at least 8 characters with letters + digits + special characters)

> 💡 Manually loaded extensions do not auto-update, but the extension checks GitHub Releases every 6 hours and shows an update notice in the popup. When notified, download the new package and overwrite the original installation directory.

### Build from Source (developers)

```bash
# Install dependencies (pnpm-managed; packageManager pins 10.12.1)
pnpm install

# Dev mode (HMR; output in .output/chrome-mv3-dev/)
pnpm dev

# Production build (runs prebuild → icons:build and postbuild → wxt zip automatically)
pnpm build
```

The build outputs to `.output/chrome-mv3/` — enable "Developer mode" at `chrome://extensions/` and "Load unpacked" from that directory.

Common verification and tooling commands:

| Command              | What it does                                               |
| -------------------- | ---------------------------------------------------------- |
| `pnpm typecheck`     | TypeScript type checking                                   |
| `pnpm lint`          | ESLint with `--max-warnings 0` (a warning fails the build) |
| `pnpm lint:style`    | Stylelint (including CSS property ordering)                |
| `pnpm test:run`      | Full Vitest suite (632 tests)                              |
| `pnpm lint:all`      | lint + stylelint + format check in one go                  |
| `pnpm build:firefox` | Firefox build (see the note below)                         |
| `pnpm gen:blog`      | Regenerates `blog/*.html` from `docs/blog/**`              |

Environment: Node 22 (matching CI).

> ⚠️ The Firefox target currently emits `manifest_version: 2` (`.output/firefox-mv2/`) and is experimental. Every statement in this README about MV3, the Side Panel API and Chrome's favicon cache applies to Chrome/Edge and other Chromium browsers.

> 📖 More dev commands and environment requirements in the [Contributing Guide](./docs/CONTRIBUTING.md).

### Updating

- **Chrome Web Store users**: updates are pushed automatically.
- **Manual installs (GitHub Releases / developers)**: simply **overwrite** the files in the original installation directory with the new package. **Never** load the extension from a different directory. Chrome extension local data (passwords, settings) lives in browser-internal storage keyed by the extension ID; overwriting files preserves it. Loading from a different path makes Chrome treat it as a fresh install and **your existing password data becomes inaccessible**.

> 💡 **Finding the current installation directory**: open `chrome://extensions/`, find the extension card, click "Details", and look for "Source: /path/to/your/directory" near the bottom. Overwrite the files in that path when updating.

## User Guide

1. **Initial setup**: click the extension icon to open the popup — it is the action hub, offering manage passwords, side-panel quick fill, direct fill and open-inline-dropdown, plus a manual lock button, the session countdown chip and the update card. On first visit to the manager you set a master password and choose a session validity (default 24 hours); "Preferences" configures themes, language, floating button, fill mode, and more
2. **Password management**: full CRUD on the options page, bulk import/export (exports require master password verification), multi-field smart search (pinyin/initials + match highlighting) and sorting, tags and favorites; click an entry's "View details" for a read-only, single-screen view of every field including full notes and password history (password masked by default; copied passwords are auto-cleared per clipboard settings) — no need to enter edit mode
3. **Quick fill**: fresh installs default to inline fill — a key icon appears in a focused login field; click it to pick an account and fill instantly. Switch to "Sidebar" (auto-opens on focus) or "Manual" in Preferences; users upgrading keep the side-panel auto-show behaviour they had before, so nothing changes silently under them. Shortcuts and right-click fill also work
4. **Shortcuts**: four high-frequency actions have defaults (`Cmd` on Mac) — see the cheat sheet below

### Shortcut Cheat Sheet

| Action (command ID)                         | Windows / Linux | macOS         | Default behaviour                                                                                            |
| ------------------------------------------- | --------------- | ------------- | ------------------------------------------------------------------------------------------------------------ |
| Open the password manager `open_options`    | `Ctrl+Shift+P`  | `Cmd+Shift+P` | Opens the options page                                                                                       |
| Toggle the side panel `toggle_sidepanel`    | `Ctrl+Shift+L`  | `Cmd+Shift+L` | Opens/closes the side panel                                                                                  |
| Quick fill `quick_fill`                     | `Ctrl+Shift+F`  | `Cmd+Shift+F` | Fills the best-matching account + ticks consent; with "Auto-submit login" on, it clicks the login button too |
| Open inline dropdown `open_inline_dropdown` | `Ctrl+Shift+K`  | `Cmd+Shift+K` | Expands the account dropdown on the focused input                                                            |

> Shortcuts cannot be rebound inside the extension: Chrome exposes no `commands.update()` API and all four command slots are already taken. The overviews on the manager page ("Security Settings → Keyboard Shortcuts") and in the side panel's Help dialog are read-only — they flag keys that are currently not active (usually taken by the OS or another extension) and link straight to `chrome://extensions/shortcuts`, where the change actually happens.

> 📖 Full walkthroughs and demos are on the [live demo page](https://liaolongdong.github.io/account-password-helper/) (bilingual FAQ included), or via the "Help" entry inside the side panel.

## FAQ

**Q: Will my passwords be uploaded to the cloud?**

A: No. Password data lives only in your browser's local storage (`chrome.storage.local`), with sensitive fields encrypted field by field with AES-256-GCM, so it never leaves the machine as plaintext. The only outbound request is an anonymous version check every 6 hours that carries no vault content or identifiers — see [Permissions & Data Flow](#-permissions--data-flow).

**Q: What if I forget the master password?**

A: It cannot be recovered. You can only use "Reset" to wipe the data and start over. Back up regularly via data export or encrypted backup (.aph) to avoid data loss.

**Q: What happens when the session expires?**

A: Expiry clears key material and the in-memory cache only — the sensitive fields on disk are already ciphertext (the at-rest invariant), so there is no bulk re-encryption step and nothing stalls at the moment of expiry. Verify the master password again to restore access; no data is lost.

**Q: The side panel doesn't show?**

A: The side panel relies on Chrome's Side Panel API, which needs Chrome >= 114 (this extension's manifest declares no `minimum_chrome_version`, so older Chrome won't hard-block the install, but side-panel features won't work there). You can also click the extension icon (shortcut `Ctrl+Shift+L` / `Cmd+Shift+L`) or "Quick fill" on the floating button.

**Q: Filling doesn't work?**

A: Wait for the page to fully load and retry; the filler tries three strategies in turn (Native Setter / execCommand / simulated typing). If it still fails, refresh the page.

**Q: How do I customize shortcuts?**

A: Go to `chrome://extensions/shortcuts`, find "Account Password Helper", click the shortcut box next to a command, and press a new combination. The popup display syncs automatically. You can also open the read-only overview under "Security Settings → Keyboard Shortcuts" on the manager page — its "Edit Shortcuts" button links straight there, and it flags which keys are currently inactive (usually taken by the OS or another extension, or a command added by an update that Chrome never auto-bound). The side panel's Help dialog offers the same overview and entry point.

**Q: Can I import from other password managers?**

A: Yes. Upload a CSV or JSON file in the import dialog; Chrome, LastPass, Bitwarden, and 1Password formats are auto-detected and mapped.

**Q: Can I recover deleted passwords?**

A: Yes. Deleted passwords move to the trash for 30 days — restore or permanently delete them under "Data Management" → "Trash". Mistaken password edits can be reverted via the entry's "Password history".

**Q: How do I enable auto-save?**

A: Turn on the switch under "Auto-save Settings"; optionally configure domain rules (exact or regex). On login a confirmation card appears (Save / Not now / Never) with editable tag and remark. If the password about to be saved is weak, or is already shared by other accounts, the card shows an inline risk hint beneath the password row; the hint only informs — it never blocks the save and requires no extra confirmation.

**Q: How do I switch themes or the interface language?**

A: Open the preferences panel via the "Preferences" button on the management page, the floating button gear icon, or the side panel gear icon. Pick one of 6 themes or switch between 中文 / English — changes apply instantly without refresh.

**Q: Why is the first sidebar open on Windows slow?**

A: Windows Defender scans each extension file on first load, adding 1-2 seconds to cold starts. Add the Chrome extensions folder to Defender's exclusion list to skip scanning: open "Windows Security" → "Virus & threat protection" → "Manage settings" → "Exclusions" → "Add an exclusion" → select "Folder" → paste `%LOCALAPPDATA%\Google\Chrome\User Data\Default\Extensions`. This cuts cold-start time from 2-3s to under 1s. Not needed on Mac.

**Q: Does the clipboard get cleared automatically after copying a password?**

A: Yes. By default it clears 30 seconds after the copy (the delay is configurable), and before clearing it reads the clipboard to confirm the content is still the password it copied — so it never destroys something you copied afterwards. One exception: a 2FA code expires on its own after 30 seconds, so no clear timer is attached to it.

**Q: Will I be warned when a password goes stale?**

A: Yes. Each entry can carry an expiry reminder (7/30/90 days); a background alarm checks every 12 hours and raises a desktop notification when one is due. The manager and side panel also flag entries that have passed their date.

> 📖 More questions (TOTP usage & troubleshooting, email backup, encrypted backup, favorites limit, performance, etc.) are covered in the full FAQ on the [live demo page](https://liaolongdong.github.io/account-password-helper/) and the per-feature notes in [docs/ARCHITECTURE.en.md](./docs/ARCHITECTURE.en.md).

## Try It Now

🔗 [Install from Chrome Web Store](https://chromewebstore.google.com/detail/account-password-helper/fgimkdodpjfkddmildjieojpfakpanli) (one-click install, auto-updates) · [Download from GitHub Releases](https://github.com/liaolongdong/account-password-helper/releases/latest) (if Google is unreachable) · [Live Demo](https://liaolongdong.github.io/account-password-helper/)

If this project helps you, please give it a ⭐️ and leave a review on the Chrome Web Store — it means the world to an independent developer! Issues and pull requests are welcome; the full changelog is in [CHANGELOG.md](./CHANGELOG.md).

## Security Notes

- Account Password Helper is built for development, testing and everyday sign-in scenarios. We recommend not storing highly sensitive credentials (banking, payment, etc.) in any browser extension;
- A forgotten master password **cannot be recovered** — keep it safe;
- Sensitive fields are stored locally, encrypted field by field with AES-256-GCM; password data never leaves the machine as plaintext (the single outbound request is the anonymous version check — see [Permissions & Data Flow](#-permissions--data-flow));
- Back up regularly via encrypted backup (.aph files);
- Enable clipboard auto-clear and auto idle lock; for higher security, enable "Lock on browser restart".

## License

This project is released under the GNU GPL-3.0 (version 3 only, not "or any later version").

- Free to use, modify and distribute (including commercially), but **derivative works must be open-sourced under GPL-3.0**; closed-source redistribution is not permitted.
- The names "Account Password Helper" and "账号密码管理助手", its logos and brand assets are trademarks of the author and are NOT covered by the license. See [THIRD-PARTY-NOTICES.md](./docs/THIRD-PARTY-NOTICES.md).
- This project bundles third-party dependencies (including jsQR under Apache-2.0); attribution is provided in [THIRD-PARTY-NOTICES.md](./docs/THIRD-PARTY-NOTICES.md).
- Previously released versions remain under the MIT license they were published with; GPL-3.0 applies from the first version after the switch.

## Contact

Email: [924902324@qq.com](mailto:924902324@qq.com?subject=Account%20Password%20Helper%20Feedback)

**WeChat group**: scan the QR code below to add the author on WeChat (ID: `lld_1025`) with the note "aph" to get invited into the plugin user group for feedback and discussion.

<img src="./assets/wx-qrcode/wechat-qrcode.jpg" alt="WeChat group QR code" width="160" />

---

> 📅 Last updated: Sep 2026 · Features described match the latest published release — see [Releases](https://github.com/liaolongdong/account-password-helper/releases/latest)
