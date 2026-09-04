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

> **Free local-first password manager** · One-click login (fill + tick + click) · AES-256-GCM zero cloud · TOTP 2FA · Security audit · Multi-environment isolation · One-click migration from Chrome / Bitwarden / 1Password · Built for developers & QA

A **free, open-source**, local-first Chrome password manager built for developers & QA: **one-click login** (autofill + tick consent + click login — not just form fill), exact-domain matching to isolate dev/test/staging/prod accounts, built-in **TOTP 2FA**, **security audit** & **password generator**. **PBKDF2 (600,000 iterations) + AES-256-GCM** encryption with an instantly-opening side panel (**20–50ms** warm path), zero network transfer — passwords never leave your browser, no account needed.

> **Security notice**: Account Password Helper is built for development, testing and everyday sign-in scenarios. All data stays in your browser, encrypted with AES-256-GCM, and never leaves your machine over the network. For the safety of your assets, we recommend not storing highly sensitive credentials (banking, payment, etc.) in any browser extension.
>
> 🌐 **Live demo**: https://liaolongdong.github.io/account-password-helper/
>
> 📊 **Technical highlights**: PBKDF2 600K iterations · AES-256-GCM authenticated encryption · Instant side panel (20–50ms warm path) · 6 themes · Bilingual UI · Fully offline · 495 automated tests

<p align="center">
  <img src="./assets/icons/icon.svg" alt="Extension icon" width="120" />
</p>

<p align="center">
  <img src="./docs/demo-login.webp" alt="One-keystroke login demo" width="100%" />
  <br/>
  <sub>Ctrl+Shift+F → autofill → tick consent → click login → 2FA verification → enter code → login success, done in 1 second</sub>
</p>

## 🖥️ Feature Showcase

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
  <sub>Security audit — five-dimension risk detection, all computed locally</sub>
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

| Feature                                   | What sets it apart                                                                                                                                                        |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ⚡ **One-keystroke login, not just fill** | hotkey `Ctrl+Shift+F` does it all: fill → tick consent → click login. Other tools only fill the form — **you still have to click login yourself**                         |
| 🎯 **Multi-environment isolation**        | Exact-domain matching separates dev / test / staging / prod credentials — **same site, different environments, zero mix-ups**. A must-have for developers                 |
| 🔑 **Built-in TOTP + 2FA handoff**        | Verification codes live with your passwords; on GitHub-style two-step logins, the live code capsule auto-anchors beside the input — **no phone authenticator app needed** |
| 🔒 **Local AES-256-GCM, zero cloud**      | No cloud, no account, no subscription. Everything is encrypted in your browser — **even if the server were breached, your passwords stay safe**                           |
| 📊 **Offline security audit**             | One-click 0–100 score: weak / reused / leaked / stale / missing-2FA checks — **all computed offline**                                                                     |
| 📦 **One-click migration**                | Auto-detects exports from Chrome / LastPass / Bitwarden / 1Password; CSV & JSON — **move in in 30 seconds**                                                               |

## Who It's For

- **Developers** — exact-domain matching isolates dev / test / staging / prod accounts for the same site, zero mix-ups
- **QA engineers** — quickly switch test accounts, `Ctrl+Shift+F` one-keystroke login, cross-environment efficiency
- **Privacy-conscious users** — pure local AES-256-GCM encryption, zero network transfer, no account registration, no cloud sync
- **Everyday users** — stop memorizing passwords, built-in TOTP 2FA, password generator for strong credentials

## How It Compares

| Feature                                   | Account Password Helper |   Bitwarden   | 1Password | Chrome Built-in |
| ----------------------------------------- | :---------------------: | :-----------: | :-------: | :-------------: |
| Price                                     |     Completely free     | Free / $10/yr | $2.99/mo  |      Free       |
| Data storage                              |       Pure local        |     Cloud     |   Cloud   |      Local      |
| Account required                          |           No            |      Yes      |    Yes    |       No        |
| One-keystroke login (fill + tick + click) |           Yes           |   Fill only   | Fill only |    Fill only    |
| Multi-environment isolation               |           Yes           |      No       |    No     |       No        |
| Built-in TOTP authenticator               |           Yes           | Paid ($10/yr) | Paid tier |       No        |
| Offline security audit                    |           Yes           |      No       |    No     |       No        |
| Open source (GPL-3.0)                     |           Yes           |      Yes      |    No     |       No        |

## Core Features

### 🔐 Security

- **Native browser encryption**: Built on the Web Crypto API with PBKDF2 + AES-256-GCM; sensitive fields (username/password/URL/remark/TOTP) stored as ciphertext with zero network transfer
- **Flexible session control**: Validity from 1 hour to 7 days; auto idle lock, lock on browser restart, one-click lock in the popup; remaining time visible in the manager/sidebar/popup with color-coded warnings (amber → red); click the badge to renew
- **Offline health check**: One-click 0–100 score across 5 dimensions (weak / reused / leaked / stale / missing 2FA), all computed offline
- **TOTP 2FA**: Local code generation (RFC 6238) with live codes and countdowns in the list/sidebar; add secrets by scanning a webpage QR code or uploading an image; GitHub-style two-step login auto-anchors a live-code capsule for one-click fill

### ⚡ Smart Fill

- **Quadruple fill strategy**: Inline fill (key icon in the input, the default), side panel one-click fill, right-click fill (right-click an input to fill username/password/2FA code, or generate & fill a strong password), and quick-fill shortcut (`Ctrl+Shift+F` — fill + tick consent + click login); results reported via desktop notification + toolbar badge
- **Exact domain matching**: Only entries whose host exactly matches the current page are shown, keeping dev/test/staging/prod accounts apart; `localhost` matches everything by default
- **Auto-save credentials**: Chrome-style capture with save confirmation, smart dedup (identical credentials never re-prompt, changed passwords trigger an "Update" confirmation), domain allow/block lists, one-click "Never for this site"; the save prompt also flags weak and reused passwords inline (a heads-up only — it never blocks saving)
- **Side panel quick add**: Click "+" in the side panel header to save credentials in place (an add invitation also appears when the current site has none); the site field is prefilled from the current domain, with "Open Password Manager for all fields" for full fields like TOTP
- **Side panel search scope**: The icon beside the search box toggles between "This site" and "All entries" — by default only entries matching the current domain are listed, while all-entry mode opens up the whole vault (switching tabs resets it back to this site). Off-site hits keep copy username/password/2FA code, favorite and edit, and clicking the row opens that site in a new tab. When this site has no match but the vault does, the empty state offers a "Search all entries (N found)" shortcut
- **Broad compatibility**: Dynamically detects login forms (including cross-iframe), compatible with React/Vue and other frameworks; covers username + password, phone + verification code, and more
- **Password visibility toggle**: Injects a show/hide button into page password fields (enable in floating button preferences) — verify filled content with one click, no separate extension needed

### 📦 Data Management

- **Import/export**: CSV / JSON formats with auto-detection of Chrome, LastPass, Bitwarden, and 1Password exports; Chinese/English column mapping
- **Multiple backup options**: Encrypted backup (.aph) export/import with decrypt preview; email backup (plain or encrypted); scheduled backup reminders
- **Powerful organization**: Multi-select tags with filtering, favorites with configurable limit + LRU eviction, multi-field smart search (pinyin/initials with match highlighting), one-click dedup, batch delete/tag editing/export selected
- **Mistake-proofing**: 30-day trash bin (soft delete), configurable password change history (1–10 encrypted snapshots per entry, restorable), atomic master password change without data loss

### 🎨 Experience

- **Themes & language**: 6 color themes + bilingual UI (中文 / English), instant switching without refresh, synchronized across extension pages and injected in-page UI
- **Site favicons**: Password list, side panel and inline dropdown entries show the matching website icon (read from Chrome's local favicon cache, zero external requests); falls back to the default icon when unavailable
- **Password generator**: Random mode (length/charset/ambiguous-character exclusion) and passphrase mode (EFF Diceware, 2048-word list)
- **Caps Lock warning**: Master password fields detect Caps Lock state in real time and show a warning, preventing case-sensitivity mistakes
- **Instant open**: Side panel loads in about 20–50ms on the warm cache path, instantly even after session expiry

> 🛠 Tech stack, architecture and project structure are covered in the [Contributing Guide](./docs/CONTRIBUTING.md).
>
> 📖 Per-feature implementation details (source paths, strategies, constraints) live in [docs/ARCHITECTURE.en.md — Feature Implementation Details](./docs/ARCHITECTURE.en.md#feature-implementation-details).

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
# Install dependencies
pnpm install

# Dev mode (HMR)
pnpm dev

# Production build
pnpm build

# Build and package as zip
pnpm postbuild
```

The build outputs to `.output/chrome-mv3/` — enable "Developer mode" at `chrome://extensions/` and "Load unpacked" from that directory.

> 📖 More dev commands and environment requirements in the [Contributing Guide](./docs/CONTRIBUTING.md).

### Updating

- **Chrome Web Store users**: updates are pushed automatically.
- **Manual installs (GitHub Releases / developers)**: simply **overwrite** the files in the original installation directory with the new package. **Never** load the extension from a different directory. Chrome extension local data (passwords, settings) lives in browser-internal storage keyed by the extension ID; overwriting files preserves it. Loading from a different path makes Chrome treat it as a fresh install and **your existing password data becomes inaccessible**.

> 💡 **Finding the current installation directory**: open `chrome://extensions/`, find the extension card, click "Details", and look for "Source: /path/to/your/directory" near the bottom. Overwrite the files in that path when updating.

## User Guide

1. **Initial setup**: click the extension icon to open the manager, set a master password, and choose a session validity (default 24 hours); "Preferences" configures themes, language, floating button, fill mode, and more
2. **Password management**: full CRUD on the options page, bulk import/export (exports require master password verification), multi-field smart search (pinyin/initials + match highlighting) and sorting, tags and favorites; click an entry's "View details" for a read-only, single-screen view of every field including full notes and password history (password masked by default; copied passwords are auto-cleared per clipboard settings) — no need to enter edit mode
3. **Quick fill**: inline fill by default — a key icon appears in a focused login field; click it to pick an account and fill instantly. Switch to "Sidebar" (auto-opens on focus) or "Manual" in Preferences, use the shortcuts, or right-click an input to fill
4. **Shortcuts**: every high-frequency action has one (`Cmd` on Mac) — see the cheat sheet below

### Shortcut Cheat Sheet

| Action                                    | Windows / Linux | macOS         |
| ----------------------------------------- | --------------- | ------------- |
| Open the password manager                 | `Ctrl+Shift+P`  | `Cmd+Shift+P` |
| Toggle the side panel                     | `Ctrl+Shift+L`  | `Cmd+Shift+L` |
| One-keystroke login (fill + tick + click) | `Ctrl+Shift+F`  | `Cmd+Shift+F` |
| Open the inline fill dropdown             | `Ctrl+Shift+K`  | `Cmd+Shift+K` |

> All shortcuts are customizable at `chrome://extensions/shortcuts`. You can also check the live status of all four bindings under "Security Settings → Keyboard Shortcuts" on the manager page (unbound or taken keys are explicitly flagged as "Not active"), or jump straight to the manager from the "Keyboard Shortcuts" group in the side panel's Help dialog.

> 📖 Full walkthroughs and demos are on the [live demo page](https://liaolongdong.github.io/account-password-helper/) (bilingual FAQ included), or via the "Help" entry inside the side panel.

## FAQ

**Q: Will my passwords be uploaded to the cloud?**

A: No. The extension stores everything locally in your browser. Sensitive fields are encrypted with AES-256-GCM and never travel over the network.

**Q: What if I forget the master password?**

A: It cannot be recovered. You can only use "Reset" to wipe the data and start over. Back up regularly via data export or encrypted backup (.aph) to avoid data loss.

**Q: What happens when the session expires?**

A: All sensitive fields are automatically re-encrypted. Verify the master password again to restore access — no data is lost.

**Q: The side panel doesn't show?**

A: Confirm Chrome >= 114 and that the page has a login form; you can also click the extension icon (shortcut `Ctrl+Shift+L` / `Cmd+Shift+L`) or "Quick fill" on the floating button.

**Q: Filling doesn't work?**

A: Wait for the page to fully load and retry; the filler tries three strategies in turn (Native Setter / execCommand / simulated typing). If it still fails, refresh the page.

**Q: How do I customize shortcuts?**

A: Go to `chrome://extensions/shortcuts`, find "Account Password Helper", click the shortcut box next to a command, and press a new combination. The popup display syncs automatically. You can also open the read-only overview under "Security Settings → Keyboard Shortcuts" on the manager page — its "Edit Shortcuts" button links straight there, and it flags which keys are currently inactive (usually taken by the OS or another extension, or a command added by an update that Chrome never auto-bound). The side panel's Help dialog offers the same overview and entry point.

**Q: Can I import from other password managers?**

A: Yes. Upload a CSV in the import dialog; Chrome, LastPass, Bitwarden, and 1Password formats are auto-detected and mapped.

**Q: Can I recover deleted passwords?**

A: Yes. Deleted passwords move to the trash for 30 days — restore or permanently delete them under "Data Management" → "Trash". Mistaken password edits can be reverted via the entry's "Password history".

**Q: How do I enable auto-save?**

A: Turn on the switch under "Auto-save Settings"; optionally configure domain rules (exact or regex). On login a confirmation card appears (Save / Not now / Never) with editable tag and remark. If the password about to be saved is weak, or is already shared by other accounts, the card shows an inline risk hint beneath the password row; the hint only informs — it never blocks the save and requires no extra confirmation.

**Q: How do I switch themes or the interface language?**

A: Open the preferences panel via the "Preferences" button on the management page, the floating button gear icon, or the side panel gear icon. Pick one of 6 themes or switch between 中文 / English — changes apply instantly without refresh.

**Q: Why is the first sidebar open on Windows slow?**

A: Windows Defender scans each extension file on first load, adding 1-2 seconds to cold starts. Add the Chrome extensions folder to Defender's exclusion list to skip scanning: open "Windows Security" → "Virus & threat protection" → "Manage settings" → "Exclusions" → "Add an exclusion" → select "Folder" → paste `%LOCALAPPDATA%\Google\Chrome\User Data\Default\Extensions`. This cuts cold-start time from 2-3s to under 1s. Not needed on Mac.

> 📖 More questions (TOTP usage & troubleshooting, email backup, encrypted backup, clipboard clearing, favorites limit, performance, etc.) are covered in the full FAQ on the [live demo page](https://liaolongdong.github.io/account-password-helper/) and the per-feature notes in [docs/ARCHITECTURE.en.md](./docs/ARCHITECTURE.en.md).

## Try It Now

🔗 [Install from Chrome Web Store](https://chromewebstore.google.com/detail/account-password-helper/fgimkdodpjfkddmildjieojpfakpanli) · [Download from GitHub Releases](https://github.com/liaolongdong/account-password-helper/releases/latest) · [Live Demo](https://liaolongdong.github.io/account-password-helper/)

If this project helps you, please give it a ⭐️ and leave a review on the Chrome Web Store — it means the world to an independent developer!

🔥 **Get started now**: [Install from Chrome Web Store](https://chromewebstore.google.com/detail/account-password-helper/fgimkdodpjfkddmildjieojpfakpanli) (one-click install, auto-updates) · [Download from GitHub Releases](https://github.com/liaolongdong/account-password-helper/releases/latest) (if Google is unreachable)

Issues and pull requests are welcome! Full changelog at [CHANGELOG.md](./CHANGELOG.md).

## Security Notes

- Account Password Helper is built for development, testing and everyday sign-in scenarios. We recommend not storing highly sensitive credentials (banking, payment, etc.) in any browser extension;
- A forgotten master password **cannot be recovered** — keep it safe;
- All data is stored locally with AES-256-GCM encryption and zero network transfer;
- Back up regularly via encrypted backup (.aph files);
- Enable clipboard auto-clear and auto idle lock; for higher security, enable "Lock on browser restart".

## License

This project is released under the GNU GPL-3.0 (version 3 only, not "or any later version").

- Free to use, modify and distribute (including commercially), but **derivative works must be open-sourced under GPL-3.0**; closed-source redistribution is not permitted.
- The name "Account Password Helper", its logos and brand assets are trademarks of the author and are NOT covered by the license. See [THIRD-PARTY-NOTICES.md](./docs/THIRD-PARTY-NOTICES.md).
- This project bundles third-party dependencies (including jsQR under Apache-2.0); attribution is provided in [THIRD-PARTY-NOTICES.md](./docs/THIRD-PARTY-NOTICES.md).
- Previously released versions remain under the MIT license they were published with; GPL-3.0 applies from the first version after the switch.

## Contact

Email: [924902324@qq.com](mailto:924902324@qq.com?subject=Account%20Password%20Helper%20Feedback)

**WeChat group**: scan the QR code below to add the author on WeChat (ID: `lld_1025`) with the note "aph" to get invited into the plugin user group for feedback and discussion.

<img src="./assets/wx-qrcode/wechat-qrcode.jpg" alt="WeChat group QR code" width="160" />

---

> 📅 Last updated: Aug 2026 · [v3.7.0](https://github.com/liaolongdong/account-password-helper/releases/latest)
