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

- Unlimited password entries and tags; favorites pinning (default cap 10, configurable 1–50)
- One-click login (autofill + tick consent + click login)
- Cross-subdomain matching, three tiers set on the manager page header: "Exact match only" (default), "Exact + wildcard entries" (an entry saved as `*.qq.com` is offered on every subdomain of that site), "Same main domain" (additionally falls back to the apex domain and sibling subdomains when the current host has no entry, badged as cross-subdomain). Widening only affects which entries are offered: the auto-save duplicate rule is deliberately tier-independent, and `localhost` / `127.0.0.1` always stay separated by port
- Site rules: per-domain custom CSS selectors for the username and password input fields, for login pages heuristic detection gets wrong (typically Web Components sites). Each rule carries a Shadow DOM penetration switch, on by default, that reaches OPEN shadow roots only — no extension can read a closed (`mode: 'closed'`) root. The domain must equal the login page domain exactly (no wildcards inside rules). Rules export as a plain-text JSON file (`site_rules_<timestamp>.json`, domains and selectors only, never credentials) and merge-import by domain, reporting added / updated / skipped; limits are 500 rules and 2 MiB per file, and the export / import buttons live in the site-rules dialog footer
- Built-in TOTP 2FA authenticator (RFC 6238)
- Offline security audit (0–100 score, four weighted dimensions; missing-2FA reported separately, unscored)
- Password generator (random + passphrase from a bundled 3,080-word list)
- CSV / JSON import; auto-detects Chrome, LastPass, Bitwarden, 1Password exports
- Encrypted backup (.aph), email backup reminders, 30-day trash, password history
- Identity vault: an independently encrypted store on the Options page only — name, ID number, phone, email, address, bank card and custom fields, whole-blob AES-256-GCM, secret fields masked by default, master-password re-check to open, per-field or whole-card copy under the timed clipboard wipe, pinyin search, 30-record cap. Encrypted `.aphid` backup export / import, plus an optional plaintext `.json` export and re-import gated by a master-password re-check and a risk confirmation, merged by id. Not covered by automatic backups
- Command palette: `Ctrl+K` / `Cmd+K` on the manager page (not on web pages, not in the side panel) filters 23 commands by Chinese, pinyin or initials, Enter to open; requires an unlocked session and destructive commands keep their confirmations. It is not a manifest command, so it is absent from `chrome://extensions/shortcuts`
- 6 color themes, Chinese / English bilingual UI

## Data & privacy

- Local storage only (`chrome.storage.local`) — password data stays on your machine; per-field AES-256-GCM encryption of username, password, URL, remark and TOTP secret, and a separately encrypted identity vault (whole-blob AES-256-GCM)
- No vault content, credential or personal identifier is ever transmitted; no telemetry, no analytics
- The only outbound request is an anonymous version check every 6 hours: a reachability probe of chromewebstore.google.com (cached 24h) and, when the store is unreachable, a read-only call to GitHub's public API. It carries no vault content and no personal identifier.
