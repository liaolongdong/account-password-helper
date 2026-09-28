# Pricing — Account Password Helper

## Free (Forever)

- **Price**: $0 — completely free, open-source (GPL-3.0)
- **Users**: Unlimited, no account registration required
- **Storage**: Unlimited local password entries in your browser
- **Features** (all included):
  - One-click login (autofill + tick consent + click login)
  - Multi-environment account isolation (dev / test / staging / prod)
  - Cross-subdomain matching, three tiers set from the manager page header: "Exact match only" (default), "Exact + wildcard entries" (entries saved as `*.qq.com` are offered on every subdomain of that site) and "Same main domain" (additionally falls back to the apex domain and sibling subdomains when the current host has no entry, badged as cross-subdomain). Widening only changes which entries are offered; the auto-save duplicate rule is deliberately tier-independent and `localhost` / `127.0.0.1` always stay separated by port
  - Built-in TOTP 2FA authenticator (RFC 6238)
  - Per-field AES-256-GCM local encryption (PBKDF2, 600,000 iterations) of username, password, URL, remark and TOTP secret
  - Offline security audit (0–100 score across four weighted dimensions; missing-2FA reported separately, unscored)
  - Password generator (random + passphrase from a bundled 3,080-word list)
  - Quadruple fill strategy (inline / side panel / right-click menu / shortcut)
  - Site rules: per-domain custom CSS selectors for the username and password input fields, for login pages heuristic detection gets wrong (typically Web Components sites); each rule has a Shadow DOM penetration switch, on by default, that reaches open shadow roots only — no extension can read a closed (`mode: 'closed'`) root. Domains must equal the login page domain exactly (no wildcards inside rules); rules export as plain-text JSON (`site_rules_<timestamp>.json`, domains and selectors only, never credentials) and merge-import by domain, reporting added / updated / skipped, within limits of 500 rules and 2 MiB per file (export / import buttons live in the site-rules dialog footer)
  - Auto-save credentials with smart dedup
  - Import / export (CSV & JSON, Chrome / LastPass / Bitwarden / 1Password)
  - Encrypted backup (.aph) + email backup
  - Trash bin (30 days) + password change history
  - Identity vault: an independently encrypted store available on the Options page only — name, ID number, phone, email, address, bank card and custom fields, whole-blob AES-256-GCM, secret fields masked by default, master-password re-check to open, per-field or whole-card copy under the timed clipboard wipe, pinyin search, 30-record cap; encrypted `.aphid` backup export / import plus an optional plaintext `.json` export and re-import gated by a re-check and a risk confirmation (merged by id). Not covered by automatic backups
  - Command palette: `Ctrl+K` / `Cmd+K` on the manager page (not on web pages, not in the side panel) filters 23 commands by Chinese, pinyin or initials, Enter to open; requires an unlocked session and destructive commands keep their confirmations. Not a manifest command, so absent from `chrome://extensions/shortcuts`
  - 6 color themes + bilingual UI (中文 / English)
  - Smart search (pinyin / initials with match highlighting)
  - Tags, favorites, batch operations
- **Cloud**: None — password data stays on your machine; the only outbound traffic is an anonymous version check (Chrome Web Store reachability probe, falling back to GitHub's Releases API when the store is unreachable), which carries no vault content and no personal identifier
- **Subscription**: None — no recurring fees, no premium tier
- **Account required**: No
- **Support**: Community (GitHub Issues + WeChat group)

> Account Password Helper is and will always be 100% free. There is no paid tier, no premium features, and no subscription. All features are available to all users from day one.
