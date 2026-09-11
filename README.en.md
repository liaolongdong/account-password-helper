# Account Password Helper · Free Open-Source Local Password Manager

[中文](./README.md) | **English**

[![Star this repo](https://img.shields.io/github/stars/liaolongdong/account-password-helper?style=for-the-badge&logo=github&label=%E2%AD%90%20Star%20this%20repo&color=yellow)](https://github.com/liaolongdong/account-password-helper/stargazers)

[![Chrome Web Store](https://img.shields.io/chrome-web-store/v/fgimkdodpjfkddmildjieojpfakpanli?style=for-the-badge&label=CWS&logo=googlechrome&logoColor=white&color=4285F4)](https://chromewebstore.google.com/detail/account-password-helper/fgimkdodpjfkddmildjieojpfakpanli)
[![Users](https://img.shields.io/chrome-web-store/users/fgimkdodpjfkddmildjieojpfakpanli?style=for-the-badge&label=Users&logo=googlechrome&logoColor=white&color=4285F4)](https://chromewebstore.google.com/detail/account-password-helper/fgimkdodpjfkddmildjieojpfakpanli)
[![Rating](https://img.shields.io/chrome-web-store/rating/fgimkdodpjfkddmildjieojpfakpanli?style=for-the-badge&label=Rating&color=4285F4)](https://chromewebstore.google.com/detail/account-password-helper/fgimkdodpjfkddmildjieojpfakpanli)
[![Release](https://img.shields.io/github/v/release/liaolongdong/account-password-helper?style=for-the-badge&label=Release&logo=github&color=24292f)](https://github.com/liaolongdong/account-password-helper/releases/latest)
[![Manifest V3](https://img.shields.io/badge/Chrome-MV3-4285F4?style=for-the-badge&logo=googlechrome&logoColor=white)](https://developer.chrome.com/docs/extensions/mv3/intro/)
[![License](https://img.shields.io/badge/License-GPL--3.0-blue?style=for-the-badge)](#license)
[![Last Commit](https://img.shields.io/github/last-commit/liaolongdong/account-password-helper?style=for-the-badge&label=Last%20Commit&logo=github&logoColor=white)](https://github.com/liaolongdong/account-password-helper/commits/main)

> **Free open-source local-first password manager** · One-click login (fill → tick → click) · Local AES-256-GCM, zero cloud · TOTP 2FA · Security audit · Multi-environment isolation · One-click migration from Chrome / Bitwarden / 1Password · Built for developers & QA

A **free, open-source** local Chrome password manager: **one-click login** that clicks the submit button too, exact-domain matching to isolate dev/test/staging/prod accounts, plus a built-in **TOTP 2FA** and an **offline security audit**. **PBKDF2 (600,000 iterations) + AES-256-GCM** encryption, an instantly-opening side panel, and your password data never leaves the machine — no account needed.

> **Security notice**: All data stays in your browser; sensitive fields are encrypted individually with AES-256-GCM and password data never travels over the network. The extension's only outbound behaviour is an anonymous version check every 6 hours (it reads Chrome Web Store reachability and the GitHub Releases version number, carrying no account data) — see [Permissions & Data Flow](#-permissions--data-flow). For the safety of your assets, we recommend not storing highly sensitive credentials (banking, payment, etc.) in any browser extension.
>
> 🌐 **Live demo**: https://liaolongdong.github.io/account-password-helper/en.html ｜ 📊 **Technical highlights**: PBKDF2 600K iterations · AES-256-GCM authenticated encryption · Instant side panel in every state (20–50ms to data on the cached warm path) · 6 themes · Bilingual UI · Core features work fully offline · 632 automated tests

**Contents**: [Core Advantages](#-core-advantages) · [Feature Tour](#-feature-tour) · [How It Compares](#how-it-compares) · [Core Features](#core-features) · [Permissions & Data Flow](#-permissions--data-flow) · [Quick Start](#quick-start) · [FAQ](#faq) · [License](#license)

<p align="center">
  <img src="./assets/icons/icon.svg" alt="Account Password Helper extension icon" width="120" />
  <br/>
  <img src="./docs/demo-login.webp" alt="One-click login demo: shortcut triggers autofill, ticks the consent box and clicks sign in" width="100%" />
  <br/>
  <sub>Ctrl+Shift+F → autofill → tick "remember me / I agree" → (with "Auto-submit login" on) click login → 2FA live-code handoff → done in 1 second</sub>
</p>

## ✨ Core Advantages

| Advantage                                 | What sets it apart                                                                                                                                                                                                                                      |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ⚡ **One-keystroke login, not just fill** | `Ctrl+Shift+F` runs fill → tick "remember me / I agree" in one press; turn on "Auto-submit login" (or use the side panel's "Fill and sign in") and it clicks the login button too. Other tools fill — **you still click login yourself**                |
| 🎯 **Multi-environment isolation**        | Exact-domain matching separates dev / test / staging / prod credentials — **same site, different environments, zero mix-ups**. A must-have for developers                                                                                               |
| 🔑 **Built-in TOTP + 2FA handoff**        | Verification codes live with your passwords; on GitHub-style two-step logins, the live code capsule auto-anchors beside the input — **no phone authenticator app needed**                                                                               |
| 🔒 **Local AES-256-GCM, zero cloud**      | No cloud, no account, no subscription — **so there is no server for anyone to breach**. Username / password / URL / remark / TOTP secret are encrypted field by field; non-sensitive metadata (tags, timestamps) stays plaintext so the list can render |
| 📊 **Offline security audit**             | One-click 0–100 score, four weighted dimensions: reused 35 / weak 25 / in offline leaked dictionary 20 / stale 20 (missing 2FA is listed but not scored) — **all computed offline**                                                                     |
| 📦 **One-click migration**                | Auto-detects exports from Chrome / LastPass / Bitwarden / 1Password; CSV & JSON — **move in in 30 seconds**                                                                                                                                             |

**Who it's for**: **Developers** — isolate multi-environment accounts for the same site; **QA engineers** — one-keystroke fill plus auto-submit login, doubling cross-environment throughput; **Privacy-conscious users** — local encryption only, no account or cloud sync; **Everyday users** — stop memorizing passwords with built-in TOTP and a password generator.

## 🖥️ Feature Tour

<table>
  <tr>
    <td width="50%" align="center">
      <img src="./assets/screenshots/09-totp-code.png" alt="Two-factor field in the edit dialog: TOTP secret, live code and a 30-second countdown" width="100%" /><br />
      <sub><b>Built-in TOTP</b> — secret and 30-second live code side by side; add via QR scan or image upload</sub>
    </td>
    <td width="50%" align="center">
      <img src="./assets/screenshots/10-health-check.png" alt="Security audit panel: 71 overall score plus four checks — reused, weak, commonly leaked and stale passwords" width="100%" /><br />
      <sub><b>Offline security audit</b> — 0–100 score across four weighted dimensions; missing 2FA listed separately</sub>
    </td>
  </tr>
  <tr>
    <td width="50%" align="center">
      <img src="./assets/screenshots/02-password-list.png" alt="Password list: site icons, tags, pinned favorites, timestamps and batch actions" width="100%" /><br />
      <sub><b>List &amp; management</b> — tags, pinned favorites, pinyin search, one-click dedupe</sub>
    </td>
    <td width="50%" align="center">
      <img src="./assets/screenshots/11-inline-fill.png" alt="Inline fill mini panel on a login page: search box and accounts matching the current site" width="100%" /><br />
      <sub><b>Inline fill</b> — the key icon inside a login field opens a keyboard-friendly mini panel</sub>
    </td>
  </tr>
  <tr>
    <td width="50%" align="center">
      <img src="./assets/screenshots/06-sidepanel-fill.png" alt="Auto-save confirmation card with account, password, tag, remark and save or not-now actions" width="100%" /><br />
      <sub><b>Auto-save credentials</b> — a save card after login with editable tags and remarks, plus smart dedup</sub>
    </td>
    <td width="50%" align="center">
      <img src="./assets/screenshots/12-theme-skin.png" alt="Preferences panel with six theme swatches and the Chinese/English language switch" width="100%" /><br />
      <sub><b>Themes &amp; bilingual UI</b> — 6 color themes and instant 中文 / English switching</sub>
    </td>
  </tr>
</table>

> 📸 The full one-click login sequence (fill → tick → click) is in the demo animation above; more screens (floating button, session validity, CSV import/export) are on the [live demo page](https://liaolongdong.github.io/account-password-helper/en.html).

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

> Competitor pricing and feature boundaries are as of Sep 2026 and change often — check each vendor's site. Full comparison on the [alternatives page](https://liaolongdong.github.io/account-password-helper/compare.en.html).

## Core Features

### 🔐 Security

- **Native browser encryption**: The master password derives a key through PBKDF2-SHA256 (600,000 iterations); username / password / URL / remark / TOTP secret are encrypted one field at a time with AES-256-GCM (a fresh random IV per encryption), while non-sensitive metadata such as tags and timestamps stays plaintext so the list can render. Password data never travels over the network
- **Flexible session control**: Validity from 1 hour to 7 days (default 24 hours); auto idle lock and lock-on-browser-restart are both opt-in and off by default; one-click lock in the popup. Remaining time is visible in the manager/sidebar/popup (amber near expiry, red at the end) and clicking the badge opens the validity dialog where you can renew
- **Offline security audit**: One-click 0–100 score across four weighted dimensions (reused 35 / weak 25 / hit in the leaked dictionary 20 / stale 20); accounts without 2FA are listed separately and do not affect the score. The leaked-password dictionary is a built-in top-1,000 offline list — everything computed locally with no network request
- **TOTP 2FA**: Local code generation (RFC 6238) with live codes and countdowns in the list/sidebar; add secrets by scanning a webpage QR code or uploading an image; GitHub-style two-step login auto-anchors a live-code capsule for one-click fill

### ⚡ Smart Fill

- **One-keystroke login, not just fill**: `Ctrl+Shift+F` (Mac `Cmd+Shift+F`) fills the best-matching account for the site and ticks consent boxes matched by keywords such as "remember me / I have read and agree / accept terms"; turn on "Auto-submit login" in preferences (or use the "Fill and sign in" icon on a side panel entry) and one press runs the whole chain — fill → tick → click login
- **Quadruple fill strategy**: Inline fill (key icon in the input, the default), side panel one-click fill, right-click fill (right-click an input → "Fill Credentials", or "Generate & Fill Strong Password" — the latter touches no stored credential, so it works even while the session is locked), and the quick-fill shortcut. Fill failures are reported through an in-page notice + desktop notification + toolbar badge, and a locked session opens an unlock prompt right on the page
- **Auto-save credentials**: Chrome-style capture with save confirmation, smart dedup (identical credentials never re-prompt, changed passwords trigger an "Update" confirmation), domain allow/block lists, one-click "Never for this site"; the save prompt also flags weak and reused passwords inline (a heads-up only — it never blocks saving)
- **Exact domain matching**: Every fill entry point and list shows only entries whose host exactly matches the current page, keeping dev/test/staging/prod accounts apart (`localhost` matches everything by default)
- **Side panel quick add & search scope**: Click "+" in the header to save credentials in place with the current domain prefilled; the icon beside the search box toggles between "This site" and "All entries", and off-site hits stay copyable, favoritable and editable with the whole row opening that site in a new tab

### 📦 Data Management

- **Import/export**: CSV / JSON formats (the import dialog accepts `.csv` and `.json` only — re-save Excel as CSV), with auto-detection of Chrome, LastPass, Bitwarden, and 1Password exports and Chinese/English column mapping
- **Multiple backup options**: Encrypted backup (.aph) export/import with decrypt preview; email backup that assembles the content locally and hands it to your own mail client over `mailto:`; scheduled reminders that notify you on the desktop to make a backup — nothing is ever sent automatically
- **Powerful organization**: Multi-select tags with filtering, favorites pinned to the top (cap defaults to 10, configurable 1–50, evicted LRU), multi-field smart search (pinyin/initials with match highlighting), one-click dedup, batch delete/tag editing/export selected; each entry also opens a read-only "View details" drawer with the full remark and password history
- **Mistake-proofing**: 30-day trash bin (soft delete, purged by a daily background alarm), configurable password change history (default 3 encrypted snapshots per entry, 1–10 allowed, restorable), atomic master password change without data loss

### 🎨 Experience

- **Themes & language**: 6 color themes + bilingual UI (中文 / English), instant switching without refresh, synchronized across extension pages and injected in-page UI
- **Instant open**: The side panel opens instantly with no blank frame in every state; with a live session it takes the cached warm path and returns data in 20–50ms
- **Password generator**: Random mode (default 16 characters, configurable 6–50, with charset and ambiguous-character exclusion) and passphrase mode (built-in 3,080-word English list, 3–8 words with optional digits)
- **Small touches**: Site favicons read from Chrome's local cache with zero external requests; real-time Caps Lock warnings on every master password field; a show/hide toggle injected into page password fields — all configurable in preferences

> 🛠 Tech stack, architecture and project structure are covered in the [Contributing Guide](./docs/CONTRIBUTING.md); per-feature implementation details (source paths, strategies, constraints) live in [ARCHITECTURE.en.md — Feature Implementation Details](./docs/ARCHITECTURE.en.md#feature-implementation-details); engineering write-ups are on the [Tech Blog](https://liaolongdong.github.io/account-password-helper/blog/index.en.html) (Chinese & English).

## 🧭 Permissions & Data Flow

### Every permission and what it actually does

| Permission                       | Real use                                                                                                                                                                                                |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `storage`                        | Stores ciphertext entries, settings and session key material. Only `chrome.storage.local` (persistent ciphertext) and `chrome.storage.session` (in-memory key/snapshot) — **never** `sync` or `managed` |
| `activeTab`                      | When you act (shortcut, toolbar icon, right-click menu, floating button), reads the current tab's URL and handle so the right form is targeted                                                          |
| `scripting`                      | Injects the fill script into the login page (setting input values and dispatching the events frameworks recognise)                                                                                      |
| `sidePanel`                      | The side panel quick-fill UI                                                                                                                                                                            |
| `alarms`                         | Scheduled work: session expiry checks, trash purge (every 24h), backup reminders (every 12h), version check (every 6h), service-worker keep-alive revival                                               |
| `notifications`                  | Desktop notifications: fill failures, backup reminders, new-version notices                                                                                                                             |
| `idle`                           | Auto idle lock (off by default; only active once you enable it)                                                                                                                                         |
| `clipboardWrite` `clipboardRead` | Copies username / password / 2FA code to the clipboard; before auto-clearing, verifies the clipboard still holds the copied password so it never deletes something you copied later                     |
| `webNavigation`                  | Calls `getAllFrames` only, to enumerate frames so credentials go to the top frame or a same-main-domain iframe (cross-iframe login forms)                                                               |
| `contextMenus`                   | The "Fill Credentials" menu on inputs and the "Account Password Helper" menu on pages                                                                                                                   |
| `favicon`                        | Reads Chrome's **local** favicon cache (the internal `_favicon/` extension endpoint); no favicon service is ever contacted                                                                              |
| `<all_urls>`                     | Login forms live on arbitrary sites, so detection and filling must run there                                                                                                                            |

### What the extension never does

- No `cookies`, `history`, `downloads` or any undeclared permission; no `storage.sync` / `storage.managed`;
- No telemetry, analytics, ads or crash reporting, and no device fingerprint or usage statistics;
- The master password is never stored in any recoverable form — only a PBKDF2-derived verifier is kept; sensitive fields are ciphertext at rest (the at-rest invariant), so unlocking only obtains the key and never writes a plaintext copy of the vault back to `storage.local`.

### The only outbound request

The update check runs every 6 hours: store installs send an opaque HEAD request to the Chrome Web Store listing page, manual installs query the public GitHub Releases API. Both are anonymous and carry **no vault content, no accounts, no identifiers and nothing derivable from them**; if the network is unavailable the check fails silently and no core feature is affected. Beyond this, the extension makes no external requests at all — even website icons come from Chrome's local cache.

## Quick Start

### Install from the Chrome Web Store (recommended)

Visit the [Chrome Web Store page](https://chromewebstore.google.com/detail/account-password-helper/fgimkdodpjfkddmildjieojpfakpanli) and click "Add to Chrome". Updates are pushed automatically by the store.

### Download from GitHub Releases (if Google is unreachable)

Download the latest zip from [GitHub Releases](https://github.com/liaolongdong/account-password-helper/releases/latest), extract it to a **fixed directory**, then open `chrome://extensions/`, enable "Developer mode" and click "Load unpacked" to select that directory. On first use, set a master password (at least 8 characters with letters + digits + special characters).

> 💡 Manually loaded extensions do not auto-update, but the extension checks GitHub Releases every 6 hours and shows a notice in the popup. When updating, **overwrite** the files in the original installation directory — **never** load from a different path, or Chrome treats it as a fresh install and **your existing password data becomes inaccessible**.

### Build from Source (developers)

```bash
pnpm install   # Install dependencies (pnpm version pinned by packageManager to 10.12.1)
pnpm dev       # Dev mode (HMR; output in .output/chrome-mv3-dev/)
pnpm build     # Production build (runs icon generation + zip packaging automatically)
```

The build outputs to `.output/chrome-mv3/` — enable "Developer mode" at `chrome://extensions/` and "Load unpacked" from that directory. Environment: Node 22 (matching CI).

> 📖 Full dev commands (`typecheck` / `lint` / `test:run` / `build:firefox` / `gen:*` …), generated-artifact rules and the Firefox build caveat live in the [Contributing Guide — Common Commands](./docs/CONTRIBUTING.md#common-commands).

## User Guide

1. **Initial setup**: click the extension icon to open the popup — the action hub with manage passwords, side-panel quick fill, direct fill, open inline dropdown, a manual lock button and the session countdown chip. On first visit to the manager you set a master password and choose a session validity (default 24 hours); "Preferences" configures themes, language, floating button and fill mode
2. **Password management**: full CRUD on the options page, bulk import/export (exports require master password verification), multi-field smart search (pinyin/initials + match highlighting) and sorting, tags and favorites; click an entry's "View details" for a read-only view of every field
3. **Quick fill**: fresh installs default to inline fill — a key icon appears in a focused login field; click it to pick an account and fill instantly. Switch to "Sidebar" (auto-opens on focus) or "Manual" in Preferences; users upgrading keep the side-panel auto-show behaviour they had before, so nothing changes silently under them. Shortcuts and right-click fill also work
4. **Shortcuts**: four high-frequency actions have defaults (`Cmd` on Mac) — see the cheat sheet below

### Shortcut Cheat Sheet

| Action (command ID)                         | Windows / Linux | macOS         | Default behaviour                                                                                            |
| ------------------------------------------- | --------------- | ------------- | ------------------------------------------------------------------------------------------------------------ |
| Open the password manager `open_options`    | `Ctrl+Shift+P`  | `Cmd+Shift+P` | Opens the options page                                                                                       |
| Toggle the side panel `toggle_sidepanel`    | `Ctrl+Shift+L`  | `Cmd+Shift+L` | Opens/closes the side panel                                                                                  |
| Quick fill `quick_fill`                     | `Ctrl+Shift+F`  | `Cmd+Shift+F` | Fills the best-matching account + ticks consent; with "Auto-submit login" on, it clicks the login button too |
| Open inline dropdown `open_inline_dropdown` | `Ctrl+Shift+K`  | `Cmd+Shift+K` | Expands the account dropdown on the focused input                                                            |

> Shortcuts cannot be rebound inside the extension: Chrome exposes no `commands.update()` API and all four command slots are already taken. The overviews on the manager page ("Security Settings → Keyboard Shortcuts") and in the side panel's Help dialog are read-only — they flag keys that are currently not active and link straight to `chrome://extensions/shortcuts`, where the change actually happens.

## FAQ

**Q: Will my passwords be uploaded to the cloud?**

A: No. Password data lives only in your browser's local storage (`chrome.storage.local`), with sensitive fields encrypted field by field with AES-256-GCM, so it never leaves the machine as plaintext. The only outbound request is an anonymous version check every 6 hours — see [Permissions & Data Flow](#-permissions--data-flow).

**Q: What if I forget the master password?**

A: It cannot be recovered. You can only use "Reset" to wipe the data and start over. Back up regularly via data export or encrypted backup (.aph) to avoid data loss.

**Q: What happens when the session expires?**

A: Expiry clears key material and the in-memory cache only — the sensitive fields on disk are already ciphertext (the at-rest invariant), so there is no bulk re-encryption step and nothing stalls at the moment of expiry. Verify the master password again to restore access; no data is lost.

**Q: Can I import from other password managers?**

A: Yes. Upload a CSV or JSON file in the import dialog; Chrome, LastPass, Bitwarden, and 1Password formats are auto-detected and mapped — migration takes about 30 seconds.

**Q: Can I recover deleted passwords?**

A: Yes. Deleted passwords move to the trash for 30 days — restore or permanently delete them under "Data Management" → "Trash". Mistaken password edits can be reverted via the entry's "Password history".

**Q: The side panel doesn't show, or is slow the first time?**

A: The side panel relies on Chrome's Side Panel API (needs Chrome >= 114); you can also click the extension icon or press `Ctrl+Shift+L` / `Cmd+Shift+L`. On Windows the first cold start can take 1–2 extra seconds because Defender scans each extension file — add `%LOCALAPPDATA%\Google\Chrome\User Data\Default\Extensions` to the exclusion list to bring it under one second (not needed on Mac).

> 📖 More questions (TOTP usage & troubleshooting, fill troubleshooting, email backup, encrypted backup, favorites limit, etc.) are covered in the full FAQ on the [live demo page](https://liaolongdong.github.io/account-password-helper/en.html) and the per-feature notes in [docs/ARCHITECTURE.en.md](./docs/ARCHITECTURE.en.md).

## Try It Now

🔗 [Install from Chrome Web Store](https://chromewebstore.google.com/detail/account-password-helper/fgimkdodpjfkddmildjieojpfakpanli) (one-click install, auto-updates) · [Download from GitHub Releases](https://github.com/liaolongdong/account-password-helper/releases/latest) (if Google is unreachable) · [Live Demo](https://liaolongdong.github.io/account-password-helper/en.html)

If this project helps you, please give it a ⭐️ and leave a review on the Chrome Web Store — it means the world to an independent developer! Issues and pull requests are welcome; the full changelog is in [CHANGELOG.md](./CHANGELOG.md).

## Security Notes

- Account Password Helper is built for development, testing and everyday sign-in scenarios. We recommend not storing highly sensitive credentials (banking, payment, etc.) in any browser extension;
- A forgotten master password **cannot be recovered** — keep it safe;
- Sensitive fields are stored locally, encrypted field by field with AES-256-GCM; password data never leaves the machine as plaintext (the single outbound request is the anonymous version check — see [Permissions & Data Flow](#-permissions--data-flow));
- Back up regularly via encrypted backup (.aph files), and enable clipboard auto-clear and auto idle lock; for higher security, enable "Lock on browser restart".

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
