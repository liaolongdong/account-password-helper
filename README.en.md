# Account Password Helper · Free Open-Source Local Password Manager

[中文](./README.md) | **English**

[![Star this repo](https://img.shields.io/github/stars/liaolongdong/account-password-helper?style=for-the-badge&logo=github&label=%E2%AD%90%20Star%20this%20repo&color=yellow)](https://github.com/liaolongdong/account-password-helper/stargazers)

[![Chrome Web Store](https://img.shields.io/chrome-web-store/v/fgimkdodpjfkddmildjieojpfakpanli?style=for-the-badge&label=CWS&logo=googlechrome&logoColor=white&color=4285F4)](https://chromewebstore.google.com/detail/account-password-helper/fgimkdodpjfkddmildjieojpfakpanli)
[![Users](https://img.shields.io/chrome-web-store/users/fgimkdodpjfkddmildjieojpfakpanli?style=for-the-badge&label=Users&logo=googlechrome&logoColor=white&color=4285F4)](https://chromewebstore.google.com/detail/account-password-helper/fgimkdodpjfkddmildjieojpfakpanli)
[![Rating](https://img.shields.io/chrome-web-store/rating/fgimkdodpjfkddmildjieojpfakpanli?style=for-the-badge&label=Rating&color=4285F4)](https://chromewebstore.google.com/detail/account-password-helper/fgimkdodpjfkddmildjieojpfakpanli)
[![Release](https://img.shields.io/github/v/release/liaolongdong/account-password-helper?style=for-the-badge&label=Release&logo=github&color=24292f)](https://github.com/liaolongdong/account-password-helper/releases/latest)
[![Manifest V3](https://img.shields.io/badge/Chrome-MV3-4285F4?style=for-the-badge&logo=googlechrome&logoColor=white)](https://developer.chrome.com/docs/extensions/mv3/intro/)
[![License](https://img.shields.io/badge/License-GPL--3.0-blue?style=for-the-badge)](#-license)
[![Last Commit](https://img.shields.io/github/last-commit/liaolongdong/account-password-helper?style=for-the-badge&label=Last%20Commit&logo=github&logoColor=white)](https://github.com/liaolongdong/account-password-helper/commits/main)
[![CI](https://img.shields.io/github/actions/workflow/status/liaolongdong/account-password-helper/ci.yml?style=for-the-badge&label=CI&logo=github&logoColor=white)](https://github.com/liaolongdong/account-password-helper/actions/workflows/ci.yml)

> **A free, open-source, local-first password manager**: one-keystroke login that clicks the submit button too, exact-domain matching that keeps dev/test/staging/prod accounts apart, plus built-in **TOTP 2FA** and an **offline security audit**. Completely free — no subscription, no account to register, and your password data stays on your machine.

> 🌐 **[Live demo](https://liaolongdong.github.io/account-password-helper/en.html)** ｜ ⚙️ Chrome MV3 ｜ 🔒 PBKDF2 600K iterations + AES-256-GCM ｜ 🎨 6 themes · bilingual UI ｜ 🧪 1093 automated tests

**Contents**: [Core Advantages](#-core-advantages) · [Feature Tour](#-feature-tour) · [How It Compares](#-how-it-compares) · [Feature Overview](#-feature-overview) · [Security & Privacy](#-security--privacy) · [Install & Get Started](#-install--get-started) · [FAQ](#-faq) · [Contributing](#-contributing) · [License](#-license)

<p align="center">
  <img src="./assets/icons/icon.svg" alt="Account Password Helper extension icon" width="120" />
  <br/>
  <img src="./docs/demo-totp-en.webp" alt="One-click login plus two-factor handoff demo: pick the account in the in-page panel and it fills and signs in, then the live code capsule anchors beside the code field on the code page" width="100%" />
  <br/>
  <sub>Pick the account in the in-page panel → credentials filled and submitted → the live-code capsule anchors beside the code field on the same-domain page → tap Fill, no phone authenticator in sight</sub>
</p>

## ✨ Core Advantages

| Advantage                                 | What sets it apart                                                                                                                                                                                 |
| ----------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ⚡ **One-keystroke login, not just fill** | `Ctrl+Shift+F` runs fill → tick "remember me / I agree" in one press; turn on "Auto-submit login" (or use the side panel's "Fill and sign in") and it clicks the login button too                  |
| 🎯 **Multi-environment isolation**        | Exact-domain matching separates dev / test / staging / prod credentials — **same site, different environments, zero mix-ups**. A must-have for developers and QA                                   |
| 🔑 **Built-in TOTP + 2FA handoff**        | Verification codes live with your passwords; on GitHub-style two-step logins the live code capsule auto-anchors beside the input — **no phone authenticator app needed**                           |
| 🔒 **Local AES-256-GCM, zero cloud**      | No cloud, no account, no subscription — **so there is no server for anyone to breach**. Five sensitive fields are encrypted field by field and password data never leaves the machine as plaintext |
| 📊 **Offline security audit**             | One-click 0–100 score weighted across four dimensions, **computed entirely on your machine**                                                                                                       |
| 📦 **One-click migration**                | Auto-detects exports from Chrome / LastPass / Bitwarden / 1Password; CSV & JSON — **move in in 30 seconds**                                                                                        |

**Who it's for**

- 💻 **Developers** — isolate multi-environment accounts for the same site, so dev / test / staging / prod never mix
- 🧪 **QA engineers** — one-keystroke fill plus auto-submit login, doubling cross-environment throughput
- 🔏 **Privacy-conscious users** — local encryption only, no password data leaves the machine, no account or cloud sync
- 🙋 **Everyday users** — stop memorizing passwords with built-in TOTP and a password generator

## 🖼️ Feature Tour

> One module per shot: the bold line above is the module name, and the line below carries **only what the image cannot show** — the defaults people trip over, where to switch them, and the hidden capabilities.

<p align="center">
  <b>⚡ One-click login</b><br/>
  <img src="./docs/demo-login-en.webp" alt="One-click login demo: pick an entry in the side panel and it fills the credentials, ticks the consent box and clicks sign in" width="100%" /><br/>
  <sub>The <b>Ctrl+Shift+F</b> shortcut stops at "filled + ticked" — it will not submit for you.</sub>
</p>

<p align="center">
  <b>🔑 Built-in TOTP</b><br/>
  <img src="./assets/cws-store/screen-2-totp-en.png" alt="Two-factor codes: a live 6-digit code with a countdown ring shown right in the password list" width="100%" /><br/>
  <sub>Add a key by scanning an on-page QR code or uploading a QR image (decoded locally); the algorithm and 6 / 7 / 8 digits are configurable.</sub>
</p>

<p align="center">
  <b>📝 In-page fill panel</b><br/>
  <img src="./assets/cws-store/screen-9-inline-fill-en.png" alt="In-page fill panel: the key icon beside the input opens a mini panel for picking an account" width="100%" /><br/>
  <sub>Fresh installs default to this inline fill; switch to Sidebar or Manual in Preferences.</sub>
</p>

<p align="center">
  <b>🎯 Multi-environment isolation</b><br/>
  <img src="./assets/cws-store/screen-3-multi-env-en.png" alt="Per-environment accounts: dev, staging and production entries for one site separated by tags" width="100%" /><br/>
  <sub>On <b>localhost</b> / <b>127.0.0.1</b> the port is matched too.</sub>
</p>

<p align="center">
  <b>📊 Offline security audit</b><br/>
  <img src="./assets/cws-store/screen-4-security-audit-en.png" alt="Offline security audit: a 0 to 100 score with the four problem categories broken out" width="100%" /><br/>
  <sub>The leaked-password dictionary is a built-in offline list of nearly a thousand entries; "2FA not enabled" is listed separately and never costs points.</sub>
</p>

<p align="center">
  <b>🛠️ Password generator</b><br/>
  <img src="./assets/cws-store/screen-13-generator-en.png" alt="Password generator panel offering random password and passphrase modes" width="100%" /><br/>
  <sub>The "Generate &amp; Fill Strong Password" right-click option touches no stored credential, so it works even while the session is locked.</sub>
</p>

<p align="center">
  <b>🔒 Local encryption</b><br/>
  <img src="./assets/cws-store/screen-6-local-encryption-en.png" alt="Local encryption: the first-run master password screen, with data encrypted before it is written to browser storage" width="100%" /><br/>
  <sub>The master password is the only key: if it is forgotten it <b>cannot be recovered</b> and resetting wipes the data, so take an encrypted (.aph) backup first.</sub>
</p>

<p align="center">
  <b>🎨 Themes &amp; bilingual UI</b><br/>
  <img src="./assets/cws-store/screen-5-preferences-en.png" alt="Preferences panel with six theme swatches and the Chinese/English language switch" width="100%" /><br/>
  <sub>The six themes are Sky Blue, Bamboo Green, Peach Pink, Blossom Mauve, Sunset Orange and Misty Slate, and they apply instantly with no reload.</sub>
</p>

> 📸 The shots and animations come from the store asset pipeline (`scripts/store-shots/`) and use placeholder `example.com` demo data. More screens (the floating button, the auto-save prompt, import/export and encrypted backups, the trash bin and password history) are on the [live demo page](https://liaolongdong.github.io/account-password-helper/en.html).

## 🆚 How It Compares

| Feature                                   | ⭐ **Account Password Helper** |        Bitwarden        |         1Password         |           Chrome Built-in            |
| ----------------------------------------- | :----------------------------: | :---------------------: | :-----------------------: | :----------------------------------: |
| Price                                     |     **✅ Completely free**     | Free / Premium ≈ $10/yr |   $2.99/mo (see vendor)   |                 Free                 |
| Data storage                              |    **✅ Local, zero cloud**    |          Cloud          |           Cloud           | Local + optional Google account sync |
| Account required                          |       **✅ No sign-up**        |           Yes           |            Yes            |                  No                  |
| One-keystroke login (fill + tick + click) |      **✅ Yes, no setup**      |    Needs extra setup    |     Needs extra setup     |              Fill only               |
| Multi-environment isolation               |           **✅ Yes**           |           No            |            No             |                  No                  |
| TOTP authenticator                        |   **✅ Built in (same ext)**   |    Separate free app    | In all subscription tiers |                  No                  |
| Offline security audit (0–100 score)      |           **✅ Yes**           |           No            |     Hosted Watchtower     | Compromised-password check, no score |
| Open source (GPL-3.0)                     |           **✅ Yes**           |           Yes           |            No             |                  No                  |

> ⭐ marks this project's column; ✅ means it works out of the box with no extra setup. Competitor pricing and feature boundaries are as of Sep 2026 and change often — check each vendor's site. Full comparison on the [alternatives page](https://liaolongdong.github.io/account-password-helper/compare.en.html).

## 📋 Feature Overview

### 🔐 Security

- 🛡️ **Strong local encryption**: the master password derives a key through PBKDF2-SHA256 (600,000 iterations); username / password / URL / remark / TOTP secret are encrypted one field at a time with AES-256-GCM, using a fresh random IV each time
- ⏳ **Session control you own**: validity from 1 hour to 7 days (default 24 hours); remaining time is always visible in the manager / side panel / popup, turns amber near expiry, and clicking the badge renews it
- 🔐 **Auto-lock & clipboard**: copied sensitive fields are wiped from the clipboard after 30 seconds by default; auto idle lock and "Lock on browser restart" are off by default and can each be turned on in Preferences
- 🩺 **Offline security audit**: a 0–100 score weighted across four dimensions (reused 35 / weak 25 / hit in the leaked dictionary 20 / stale 20); accounts without 2FA are listed separately and do not affect the score, and nothing leaves the machine
- ⏰ **Expiry reminders**: set a 7 / 30 / 90-day change-password reminder on any entry from the audit's stale-password detail; due reminders arrive as desktop notifications
- 🔑 **TOTP 2FA**: local code generation (RFC 6238) with live codes and countdowns in the list and side panel; GitHub-style two-step login auto-anchors a live-code capsule for one-click fill

### ⚡ Smart Fill

- ⚡ **One-keystroke login**: fills the credentials and ticks consent boxes such as "remember me / I have read and agree / accept terms"; with "Auto-submit login" on (or the side panel's "Fill and sign in") it clicks the login button too
- 🧩 **Four fill entry points**: in-page panel (the default), side panel one-click fill, right-click on an input, and the shortcut; login forms are detected dynamically (including cross-iframe) and it works with React / Vue as well as phone + SMS-code sign-ins
- 💾 **Auto-save credentials**: Chrome-style capture with a save confirmation, smart dedup (identical credentials never re-prompt, a changed password triggers an "Update" confirmation); domain allow/block lists and "Never for this site", and the prompt flags weak or reused passwords inline
- 🎯 **Exact domain matching**: every fill entry point and list shows only entries whose host exactly matches the current page, keeping dev / test / staging / prod apart
- ➕ **Add in place & search beyond the site**: "+" in the side panel header saves credentials with the current domain prefilled; the search scope toggles between "This site" and "All entries", and off-site hits stay copyable, favoritable and editable
- 📇 **Share card**: one click copies the username, password and URL as one plain-text block to the clipboard (the URL line is omitted when empty), from either the side panel row or the detail drawer; the card carries the plaintext password, so it is subject to the same timed clipboard clearing, and it only ever reaches your local clipboard with no network request

### 📦 Data Management

- 📥 **Import / export**: CSV / JSON, with auto-detection of Chrome, LastPass, Bitwarden and 1Password exports and bilingual column mapping (re-save Excel sheets as CSV)
- 🔐 **Several backups**: encrypted (.aph) export/import with a decrypt preview; email backup that assembles everything locally and hands it to your own mail client over `mailto:`; scheduled reminders that only notify you — nothing is ever sent automatically
- 🏷️ **Organization that scales**: tag filtering, favorites pinned to the top (cap defaults to 10, configurable 1–50, evicted LRU), multi-field smart search with pinyin/initials and highlighting, one-click dedup, batch delete / retag / export selected to CSV, and a read-only detail drawer with the full remark and password history
- ♻️ **Mistake-proofing**: 30-day trash bin (soft delete), password change history keeping 3 encrypted snapshots per entry by default (configurable 1–10, restorable), and an atomic master password change that never loses data
- 🪪 **Identity vault**: a separate locker for personal details — name, ID number, phone, email, address, bank card info and custom fields — masked by default and gated by a master-password re-check when you open it; supports encrypted (.aphid) export/import, exporting a selected subset, and an optional plaintext .json export/import (master-password re-check + risk confirmation; import merges by id); it is not covered by automatic backups, so export an encrypted backup regularly

### 🎨 Experience

- 🎨 **Themes & language**: 6 color themes plus an instant 中文 / English switch with no reload, synchronized across extension pages and the UI injected into web pages
- 🚀 **Instant open**: the side panel opens with no blank frame in every state; with a live session it takes the cached warm path and returns data in 20–50ms
- 🛠️ **Password generator**: random mode (default 16 characters, configurable 6–50, with charset and ambiguous-character exclusion) and passphrase mode (built-in 3,080-word English list, 3–8 words with optional digits)
- 🔍 **Small touches**: a live strength bar with a per-rule checklist while you type a password, an instant Caps Lock warning on every master password field, a show/hide toggle injected into page password fields (off by default, enabled in Preferences), and site favicons read from Chrome's local cache with zero external requests

> 🛠 The tech stack, architecture and project structure are covered in the [Contributing Guide](./docs/CONTRIBUTING.md); per-feature implementation details (source paths, strategies, constraints) live in [ARCHITECTURE.en.md — Feature Implementation Details](./docs/ARCHITECTURE.en.md#feature-implementation-details); the engineering write-ups are on the [Tech Blog](https://liaolongdong.github.io/account-password-helper/blog/index.en.html) (Chinese & English).

## 🔒 Security & Privacy

- **Data stays local**: entries are stored in `chrome.storage.local` with sensitive fields encrypted field by field before they hit disk, so they never leave the machine as plaintext; key material and decrypted snapshots live only in `chrome.storage.session`, and `storage.sync` / `storage.managed` are **never** used.
- **Locking and expiry destroy the key only**: sensitive fields are already ciphertext on disk (the at-rest invariant), so locking or expiring a session does not re-encrypt the vault and never stalls. Verify the master password again to restore access — no data is lost.
- **The only outbound request**: an anonymous update check every 6 hours — store installs send an opaque HEAD request to the listing page, manual installs query the public GitHub Releases API. Neither carries any vault content, account, identifier or anything derivable from them; offline, the check fails silently and no core feature is affected. Beyond this the extension makes no external requests at all — even site icons come from Chrome's local cache.
- **What it never does**: no `cookies`, `history`, `downloads` or any undeclared permission; no telemetry, analytics, ads or crash reporting, and no device fingerprint or usage statistics; the master password is never stored in any recoverable form — only a PBKDF2-derived verifier is kept.
- **Good practice**: this extension is built for development, testing and everyday sign-in scenarios, so we recommend not storing highly sensitive credentials (banking, payment, etc.) in any browser extension; a forgotten master password **cannot be recovered**, so keep it safe and take regular encrypted (.aph) backups. Clipboard auto-clear is already on — the two locks you may want to switch on are auto idle lock and "Lock on browser restart".

> 📋 The per-permission breakdown for all 13 permissions is in the [Contributing Guide — Chrome Permissions](./docs/CONTRIBUTING.md#chrome-permissions); the encryption scheme, session lifecycle and backup formats are in [ARCHITECTURE.en.md](./docs/ARCHITECTURE.en.md#encryption-scheme).

## 📥 Install & Get Started

### Install

| Method                  | Steps                                                                                                                                                                                                                                                                                                                                                                                       |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 🛍 **Chrome Web Store**  | Visit the [store page](https://chromewebstore.google.com/detail/account-password-helper/fgimkdodpjfkddmildjieojpfakpanli) and click "Add to Chrome" — updates are pushed automatically. **Recommended**                                                                                                                                                                                     |
| 📦 **GitHub Releases**  | Download the latest zip from [Releases](https://github.com/liaolongdong/account-password-helper/releases/latest), extract it to a **fixed directory**, then enable "Developer mode" at `chrome://extensions/` and "Load unpacked" that directory. For users who cannot reach Google; no auto-update, but the extension checks GitHub Releases every 6 hours and shows a notice in the popup |
| 🛠 **Build from source** | `pnpm install && pnpm build`, then load `.output/chrome-mv3/` the same way. Full commands and requirements are in the [Contributing Guide — Common Commands](./docs/CONTRIBUTING.md#common-commands)                                                                                                                                                                                        |

> ⚠️ When updating a manually loaded install, **overwrite** the files in the original directory — **never** load from a different path, or Chrome treats it as a fresh install and **your existing password data becomes inaccessible**.

### Four steps to running

1. **Set the master password**: on first visit to the manager, choose one (at least 8 characters with letters + digits + special characters) and a session validity (default 24 hours)
2. **Pick a fill mode**: fresh installs default to **inline fill** — a key icon appears in a focused login field and you pick an account there. Switch to **Sidebar** (auto-opens on focus) or **Manual** in Preferences; users upgrading keep the side-panel behaviour they had before, so nothing changes silently under them
3. **Import what you have**: "Data Management → Import" on the manager page accepts CSV or JSON and auto-detects Chrome, LastPass, Bitwarden and 1Password exports
4. **Turn on auto-submit if you want it**: with "Preferences → Auto-submit login" enabled, `Ctrl+Shift+F` clicks the login button as well

### Shortcut Cheat Sheet

| Action                    | Windows / Linux | macOS         | Default behaviour                                                                                            |
| ------------------------- | --------------- | ------------- | ------------------------------------------------------------------------------------------------------------ |
| Open the password manager | `Ctrl+Shift+P`  | `Cmd+Shift+P` | Opens the options page                                                                                       |
| Toggle the side panel     | `Ctrl+Shift+L`  | `Cmd+Shift+L` | Opens / closes the side panel                                                                                |
| Quick fill                | `Ctrl+Shift+F`  | `Cmd+Shift+F` | Fills the best-matching account + ticks consent; with "Auto-submit login" on, it clicks the login button too |
| Open inline dropdown      | `Ctrl+Shift+K`  | `Cmd+Shift+K` | Expands the account dropdown on the focused input                                                            |

> Keys cannot be rebound inside the extension (Chrome exposes no `commands.update()`) — change them at `chrome://extensions/shortcuts`. The read-only overviews on the manager page ("Security Settings → Keyboard Shortcuts") and in the side panel's Help dialog flag any key that is currently not active. Command IDs and constraints are in the [Contributing Guide — Keyboard Shortcuts](./docs/CONTRIBUTING.md#keyboard-shortcuts).

## ❓ FAQ

**Q: Will my passwords be uploaded to the cloud?**

A: No. Data lives only in your browser's local storage, with sensitive fields encrypted field by field before they are written. The only outbound request is an anonymous version check every 6 hours — see [Security & Privacy](#-security--privacy).

**Q: What if I forget the master password?**

A: It cannot be recovered. You can only use "Reset" to wipe the data and start over. Back up regularly via data export or an encrypted (.aph) backup to avoid data loss.

**Q: What happens when the session expires?**

A: Expiry clears key material and the in-memory cache only — the sensitive fields on disk are already ciphertext, so there is no bulk re-encryption step and nothing stalls. Verify the master password again to restore access; no data is lost.

**Q: Can I import from other password managers?**

A: Yes. Upload a CSV or JSON file in the import dialog; Chrome, LastPass, Bitwarden and 1Password formats are auto-detected and mapped, which takes about 30 seconds. Excel files must be re-saved as CSV (.xlsx is not parsed).

**Q: When I open the exported CSV in Excel, some passwords or notes turn into error values?**

A: If a field's value itself starts with `=`, `+`, `-` or `@` (all four are in the password generator's symbol set), Excel evaluates that cell as a formula. The export deliberately does not formula-escape: prefixing rewrites the field, and a password is consumed character by character, so a prefixed value would be wrong both when copied out of the sheet and when re-imported — and the export → import round trip would stop being reversible. Treat export files as data you produced on your own machine, and prefer the encrypted backup (.aph) when moving between machines.

**Q: Can I recover deleted passwords?**

A: Yes. Deleted entries move to the trash for 30 days — restore or permanently delete them under "Data Management → Trash". Mistaken password edits can be reverted from the entry's "Password history".

**Q: The side panel doesn't show, or is slow the first time?**

A: The side panel relies on Chrome's Side Panel API (Chromium 114 or newer); you can also click the extension icon or press `Ctrl+Shift+L` / `Cmd+Shift+L`. On Windows the first cold start can take 1–2 extra seconds because Defender scans each extension file — add `%LOCALAPPDATA%\Google\Chrome\User Data\Default\Extensions` to the exclusion list to bring it under one second (not needed on Mac).

> 📖 More questions (TOTP usage & troubleshooting, fill troubleshooting, email backup, encrypted backup, the favorites limit, etc.) are covered in the full FAQ on the [live demo page](https://liaolongdong.github.io/account-password-helper/en.html) and the per-feature notes in [docs/ARCHITECTURE.en.md](./docs/ARCHITECTURE.en.md).

## 🚀 Try It Now

🔗 [Install from Chrome Web Store](https://chromewebstore.google.com/detail/account-password-helper/fgimkdodpjfkddmildjieojpfakpanli) (one-click install, auto-updates) · [Download from GitHub Releases](https://github.com/liaolongdong/account-password-helper/releases/latest) (if Google is unreachable) · [Live Demo](https://liaolongdong.github.io/account-password-helper/en.html)

If this project helps you, please give it a ⭐️ and leave a review on the Chrome Web Store — it means the world to an independent developer! Issues and pull requests are welcome; the full changelog is in [CHANGELOG.md](./CHANGELOG.md).

## 🤝 Contributing

Issues and pull requests are welcome. This is a local-first project, and two constraints are hard: **credential data never leaves the machine** and **minimal permissions**. Proposals that cross either line should be discussed in an issue first.

- **Open an issue**: [pick a template](https://github.com/liaolongdong/account-password-helper/issues/new/choose) (bug report and feature request, both with reproduction steps and blast radius)
- **Report a vulnerability**: use the private channel in [.github/SECURITY.md](./.github/SECURITY.md) rather than a public issue
- **Before attaching a screenshot or log**: replace real accounts, emails, passwords and live TOTP codes with placeholders such as `example.com` / `dummy` — published content cannot reliably be withdrawn
- **Setup and commands**: [docs/CONTRIBUTING.md](./docs/CONTRIBUTING.md) | **Code of conduct**: [.github/CODE_OF_CONDUCT.md](./.github/CODE_OF_CONDUCT.md)
- **Quality gates**: every pull request and every commit to `main` runs [ci.yml](./.github/workflows/ci.yml) — `typecheck`, `lint`, `lint:style`, `test:run`, and `build` for both Chrome and Firefox
- **For AI search engines**: a machine-readable project summary lives at [llms.txt](https://liaolongdong.github.io/account-password-helper/llms.txt), alongside the site's `robots.txt` and `sitemap.xml`

## 📄 License

This project is released under the GNU GPL-3.0 (version 3 only, not "or any later version").

- Free to use, modify and distribute (including commercially), but **derivative works must be open-sourced under GPL-3.0**; closed-source redistribution is not permitted.
- The names "Account Password Helper" and "账号密码管理助手", its logos and brand assets are trademarks of the author and are NOT covered by the license.
- This project bundles third-party dependencies (including jsQR under Apache-2.0); attribution is provided in [THIRD-PARTY-NOTICES.md](./docs/THIRD-PARTY-NOTICES.md).
- Previously released versions remain under the MIT license they were published with; GPL-3.0 applies from the first version after the switch.

## 📮 Contact

Email: [924902324@qq.com](mailto:924902324@qq.com?subject=Account%20Password%20Helper%20Feedback)

**WeChat group**: scan the QR code below to add the author on WeChat (ID: `lld_1025`) with the note "aph" to get invited into the plugin user group for feedback and discussion.

<img src="./assets/wx-qrcode/wechat-qrcode.jpg" alt="WeChat group QR code" width="160" />

---

> 📅 Last updated: Sep 2026 · Features described match the latest published release — see [Releases](https://github.com/liaolongdong/account-password-helper/releases/latest)
