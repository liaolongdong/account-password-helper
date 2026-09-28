# Security Policy

## Supported Versions

| Version  | Supported |
| -------- | --------- |
| Latest   | Yes       |
| < Latest | No        |

Please always upgrade to the latest version for the most up-to-date security fixes.

## Security Model

Account Password Helper is a **local-first** password manager: credentials are encrypted and kept in your own browser, and no vault data ever leaves the device. The extension's only outbound request is an anonymous version check every 6 hours (see _Data Storage_ below).

### Encryption

- **Key derivation**: PBKDF2 with 600,000 iterations (Web Crypto API) → 256-bit key from your master password + random salt
- **Symmetric encryption**: AES-256-GCM authenticated encryption with random IV per field
- **Encrypted fields**: username, password, URL, remark, TOTP secret
- **Master password**: never persisted in any recoverable form — only a PBKDF2-SHA256 verifier hash is stored, so a forgotten master password cannot be recovered

### Data Storage

- All data is stored in `chrome.storage.local`, encrypted at rest
- No telemetry, no analytics, no crash reporting, no cloud sync, no user data collection. The single outbound request is the automatic version check every 6 hours, which carries no vault contents, accounts, identifiers or analytics payload
- Session expiry or locking discards the session key material and the decrypted in-memory cache; data on disk is ciphertext at rest throughout, so no bulk re-encryption ever occurs

### Session Management

- Configurable session validity (1 hour – 7 days)
- Auto-lock on idle timeout, system lock, or browser restart (optional)
- Clipboard auto-wipe after copying passwords (default 30 seconds, configurable)

### Permissions

All Chrome permissions follow the principle of least privilege. Detailed justifications are available in the [CWS Privacy Documentation](../docs/CWS_FILL_CONTENT.md#第五步隐私惯例-privacy-practices).

## Reporting a Vulnerability

If you discover a security vulnerability, please report it responsibly:

1. **Do NOT open a public GitHub issue** for security vulnerabilities.
2. Email the maintainer at [924902324@qq.com](mailto:924902324@qq.com?subject=Security%20Vulnerability%20Report) with:
   - A description of the vulnerability
   - Steps to reproduce or a proof of concept
   - Any suggested fixes (if applicable)
3. We will acknowledge receipt within **48 hours** and provide a detailed response within **5 business days**.

### What to Expect

- We will work with you to understand the scope and impact of the vulnerability.
- A fix will be developed and tested privately. We may create a draft security advisory.
- Once a fix is released, we will publish a security advisory with credit to the reporter (unless you prefer to remain anonymous).
- We follow a **90-day disclosure timeline** from the date of reporting.

## Security Audits

As an open-source project, the code is available for public review. We welcome security research and analysis from the community.

## Known Limitations

- This extension is designed for development, testing, and everyday sign-in scenarios. We recommend **not** storing highly sensitive credentials (banking, payment, etc.) in any browser extension.
- The master password **cannot be recovered** if forgotten. Regular backups via encrypted export (.aph) or data export are strongly recommended.
