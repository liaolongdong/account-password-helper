# Pricing — Account Password Helper

> Machine-readable pricing summary for AI agents and comparison tools.
> Human version: https://liaolongdong.github.io/account-password-helper/pricing.html

## Free (the only tier)

- Price: $0 — completely free, forever
- Paid tiers: None
- Subscription: None
- Account registration: Not required
- Premium/locked features: None — every feature is available to everyone
- License: GPL-3.0 (open source)

## What's included

- Unlimited password entries, tags, and favorites
- One-click login (autofill + tick consent + click login)
- Built-in TOTP 2FA authenticator (RFC 6238)
- Offline security audit (0–100 score, four weighted dimensions; missing-2FA reported separately, unscored)
- Password generator (random + passphrase from a bundled 3,080-word list)
- CSV / JSON import; auto-detects Chrome, LastPass, Bitwarden, 1Password exports
- Encrypted backup (.aph), email backup reminders, 30-day trash, password history
- 6 color themes, Chinese / English bilingual UI

## Data & privacy

- 100% local storage (chrome.storage.local), per-field AES-256-GCM encryption of username, password, URL, remark and TOTP secret
- No user data is ever transferred; no telemetry, no analytics
- The only outbound request is an anonymous version check every 6 hours: a reachability probe of chromewebstore.google.com (cached 24h) and, when the store is unreachable, a read-only call to GitHub's public API. It carries no vault content and no personal identifier.
