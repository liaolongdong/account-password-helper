# I built a free, local-first password manager for developers — one-click login, zero cloud, AES-256-GCM

Hey r/passwordmanagers 👋

I've been a developer/tester who manages dozens of accounts across dev/test/staging/prod environments. Existing password managers either store data in the cloud (Bitwarden, 1Password) or only do basic form filling (Chrome built-in). Neither solved my core pain points:

1. **One-click login that actually works** — not just filling forms, but also ticking "agree to terms" and clicking the login button
2. **Multi-environment isolation** — keeping dev/staging/prod credentials separate by exact domain matching
3. **Free TOTP 2FA** — without paying for Bitwarden Premium or 1Password
4. **100% local** — no cloud, no account registration, no data leaving my browser

So I built **Account Password Helper** — an open-source Chrome extension.

![Core Value: One-Click Login, Local Encryption, Multi-Env Isolation, Free TOTP](imgs/01-infographic-core-value.png)

## What makes it different

| Feature                               | This Extension   | Chrome Built-in | Bitwarden | 1Password |
| ------------------------------------- | ---------------- | --------------- | --------- | --------- |
| Price                                 | **Free forever** | Free            | Freemium  | $2.99/mo  |
| Data storage                          | **100% local**   | Local           | Cloud     | Cloud     |
| One-click login (fill + tick + click) | **✓**            | ✗               | ✗         | ✗         |
| Multi-env account isolation           | **✓**            | ✗               | ✗         | ✗         |
| Built-in TOTP 2FA                     | **✓**            | ✗               | Paid only | ✓         |
| Security health audit                 | **✓**            | ✗               | Paid only | ✓         |
| Fully offline                         | **✓**            | ✓               | ✗         | ✗         |
| Account required                      | **No**           | No              | Yes       | Yes       |

## How it works

1. Install from Chrome Web Store (or GitHub Releases)
2. Set a master password (PBKDF2, 600K iterations → AES-256-GCM key)
3. Import from Chrome / Bitwarden / 1Password CSV, or add manually
4. Press **Ctrl+Shift+F** on any login page → it fills credentials, ticks consent checkboxes, and clicks login — all in one step

## Security architecture

```
Master Password → PBKDF2 (600,000 iterations) → 256-bit key
                                                        ↓
AES-256-GCM encrypts: username, password, URL, notes, TOTP secret
                                                        ↓
Session key derived via HKDF → memory cache during session
                                                        ↓
Session expires → all plaintext wiped → re-encrypted to ciphertext
```

- **Zero network transfer** — all encryption/decryption happens locally via Web Crypto API
- **Auto idle lock** — configurable 5/10/30/60 min, or lock on browser restart
- **Side panel opens instantly** — 20–50ms on the warm cache path via Service Worker keepalive + encrypted cache

![Security Encryption Pipeline: Master Password → PBKDF2 → AES-256-GCM → Session Lock](imgs/02-flowchart-security-pipeline.png)

## Built for developers

- **Exact domain matching** — `dev.example.com` and `prod.example.com` get separate credentials
- **Tags + smart search** — pinyin/initials search with match highlighting
- **Quadruple fill strategy** — inline panel / side panel / right-click menu / quick-fill shortcut
- **Auto-save** — detects new logins, prompts to save with smart dedup
- **Password health check** — weak passwords, reuse, stale entries, missing 2FA
- **Trash bin** — 30 days recovery, encrypted storage

![Developer Features: Domain Isolation, Triple Fill, Auto-Save, Health Check, Smart Search, Trash Recovery](imgs/03-infographic-dev-features.png)

## Tech stack

- WXT + Vue 3 + TypeScript + Element Plus
- Web Crypto API (PBKDF2 + AES-256-GCM + HKDF)
- Manifest V3, Closed Shadow DOM for content script isolation
- 6 color themes, bilingual UI (中文 / English)

## Links

- 🔗 [Chrome Web Store](https://chromewebstore.google.com/detail/account-password-helper/fgimkdodpjfkddmildjieojpfakpanli)
- 🐙 [GitHub (open source, GPL-3.0)](https://github.com/liaolongdong/account-password-helper)
- 📖 [Live Demo & Docs](https://liaolongdong.github.io/account-password-helper/)

Happy to answer any questions! If you're a developer managing multiple test environments, I think you'll find the domain isolation feature particularly useful.
