---
title: 'Password-Manager-Grade Encryption with Web Crypto: PBKDF2 at 600,000 Iterations + AES-256-GCM in Practice'
description: No crypto libraries, just the browser-native Web Crypto API. How Account Password Helper implements an auditable encryption system — key derivation, field-level encryption, session lifecycle, and atomic re-keying.
tags: web crypto,encryption,password manager,security,chrome extension
date: 2026-08-28
author: liaolongdong
image: imgs/blog-cover-03-webcrypto.png
---

# Password-Manager-Grade Encryption with Web Crypto: PBKDF2 at 600,000 Iterations + AES-256-GCM in Practice

![From master password to ciphertext: the full encryption pipeline](imgs/02-flowchart-security-pipeline.png)

When building the encryption module for a password manager, the instinct is to pull in a crypto library. But if you're building a browser extension, there's a better option: **import nothing, and build directly on the browser-native Web Crypto API**.

[Account Password Helper](https://github.com/liaolongdong/account-password-helper) is a zero-cloud, local-first password manager extension. Its encryption module (`utils/encryption.ts`) is built entirely on Web Crypto — not a single line of third-party crypto code. This post breaks down the full design: why these choices, how each parameter was set, and the edge cases that are easy to miss.

## Why Web Crypto Instead of a Library

Three reasons, in order of importance:

1. **Auditability.** A password manager's trust foundation is "users can verify you're not doing anything shady." Depending on a thousands-of-lines third-party crypto library immediately widens the audit surface. `crypto.subtle` is implemented by the browser engine itself — stable interfaces, public behavior — and the crypto logic in your source stays small enough to count on one hand.
2. **Attack surface.** Supply-chain poisoning is a real threat in the extension ecosystem. One fewer npm dependency is one fewer entry point for a poisoned package.
3. **Performance.** For heavy-iteration workloads like PBKDF2, native implementations are an order of magnitude faster than JavaScript ones.

The cost is a low-level, fully async API with terse error messages — which is exactly the kind of constraint that forces you to think through every step.

## Key Derivation: PBKDF2-SHA256, 600,000 Iterations

The user's master password can't be used directly as an encryption key: it lacks entropy, and it needs salting against rainbow tables. The standard answer is a key derivation function. We chose PBKDF2-SHA256 with **600,000 iterations** — the value the OWASP Password Storage Cheat Sheet has recommended for PBKDF2-SHA256 since 2023, calibrated to make each brute-force attempt expensive enough.

Two design points:

**Random salt, bound to storage.** Each installation generates its own random salt, stored alongside the ciphertext. The salt isn't secret — its job is to ensure "the same master password derives different keys on different installations," defeating precomputed attacks.

**Domain separation for the verification hash.** To check "is this master password correct," we don't attempt a trial decryption of real data (decryption failures are ambiguous — wrong password vs. corrupted data). Instead, the master password goes through a prefixed verification hash. The prefix `aph-verify|` provides **domain separation**: the input spaces for verification and encryption never overlap, ruling out cross-purpose abuse like feeding a verification value off as ciphertext or grinding captured ciphertext against the verifier.

## Data Encryption: Field-Level, AES-256-GCM

Rather than encrypting the vault as one blob, we encrypt **per field**: each entry's username, password, URL, notes, and TOTP secret are encrypted individually. The payoff is practical — the list view renders titles, icons, and tags without ever decrypting sensitive fields; side panel search and rendering touch metadata only.

The algorithm is **AES-256-GCM**:

- GCM is an authenticated mode — tampered ciphertext fails decryption outright, so integrity checking is built in, no separate HMAC layer needed;
- Every encryption uses a **fresh random 12-byte IV**, stored as `Base64(IV || ciphertext)`. IV and ciphertext travel together; there is no path to IV reuse;
- IVs come from `crypto.getRandomValues` — never counters or predictable sources. Under GCM, IV reuse is catastrophic, and this point admits no compromise.

Key handles (`CryptoKey`) are cached with a small capacity (4 slots, LRU semantics) to avoid re-derivation inside batch operations; **locking the session clears the handles immediately** — no key material left in memory to be recovered by anything other than GC.

## Sessions: How Long Does a Key Live in Memory?

Get the encryption right but fumble key management, and you've accomplished nothing. The session layer:

- **Configurable lifetime:** 24 hours by default, selectable from 1 hour to 7 days. On expiry, sensitive fields revert to ciphertext; the next use re-verifies the master password.
- **Idle lock:** via `chrome.idle` — system screen lock triggers an immediate lock; idle beyond the threshold locks too.
- **Relock on browser restart:** optional, enforced at `onStartup` for shared-device scenarios.
- **Manual lock:** one click in the popup; locking synchronously wipes in-memory key handles and decrypted snapshots.

Every lock path must funnel through the same cleanup function. This is the line code review watches hardest, because a single missed path turns "lock" into theater.

## Re-Keying: Atomic Master-Password Changes

"Change master password" is the feature encryption systems most often get wrong: everything must be re-encrypted with the new key — what happens if it fails halfway?

The implementation decrypts and verifies first, derives the new key with a fresh salt, re-encrypts the entire vault, and only then commits atomically. Any step failing rolls back the whole operation, leaving old data intact. The one unforgivable sin of a password manager — "you changed the password and now nothing decrypts" — is structurally impossible. Tests cover success, mid-flight failure, and legacy-format compatibility.

## Treat Every Input as Hostile

Extensions run in hostile environments. Page DOM, imported CSV files, runtime messages, legacy data in storage — all treated as untrusted input, validated at the boundary for type, length, and shape, failing safe. The rendering layer never passes external or user-derived strings through `v-html`/`innerHTML`. None of this produces features. It's the muscle memory a password manager is supposed to have.

## Why We Moved from MIT to GPL-3.0

At v3.0 the project switched licenses from MIT to GPL-3.0 — deliberately. A password manager's value is "auditable + trustworthy," and GPL ensures that anyone building derivatives must release them under equally open terms. The supply chain of a security tool should have no closed-source forks. Previously published versions remain under MIT; GPL applies from the switch forward.

## An Honest Disclaimer

The other side of security is knowing your limits:

- This tool is positioned for development, testing, and everyday logins. **Do not store banking or payment credentials in any browser extension.**
- A forgotten master password cannot be recovered. Enable encrypted backups (.aph files).
- The entire encryption implementation is open source. Audits and issues welcome — for a password manager, being read line by line isn't an intrusion; it's the source of trust.

Source and discussion: [the GitHub repository](https://github.com/liaolongdong/account-password-helper). If you're building local-first security tools too, share the traps you've hit in the comments.

---

_Key files referenced: `utils/encryption.ts` (crypto core), `utils/sessionManager.ts` (session management), `tests/` (364 automated tests, including encryption and re-key paths)._
