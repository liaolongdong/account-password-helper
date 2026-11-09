---
title: Is Storing Passwords in a Browser Safe?
description: No jargon. Three plain questions — where passwords live, who can read them, what if you lose them — to tell browser storage from a local-first manager.
tags: password security,local-first,password manager,browser,explainer
date: 2026-11-07
modified: 2026-11-07
author: liaolongdong
image: imgs/blog-cover-11-is-it-safe.png
---

"Is it actually safe to hand my passwords to a tool?" is the second question I get most — the first is "why won't it autofill?" The people asking usually aren't developers. They just want a way to store passwords that they can trust for themselves or their parents.

This post skips the jargon and won't tell you which product to buy. It answers three plain questions: **where do passwords live, who can read them, and what happens if you lose them?** Once those are clear, "safe" stops being a vague adjective and becomes a set of facts you can check yourself.

## First: Where Do Your Passwords Live Right Now?

Most people have never really thought about this. There are three common answers:

- **In your head or on paper.** It sounds the "safest," but human memory pushes you to reuse — to remember them, you use one password across ten sites. When one of those ten leaks, the other nine fall with it. Paper gets lost or photographed.
- **In your browser's built-in manager.** Convenient: click "Save" at login and they pile up. But turn on sync and those passwords are hosted on the vendor's servers under your browser account; turn sync off and they live only on this one device.
- **In a password manager.** Where the data lands, whether it's encrypted, and whether it needs the network all depend on how the tool is designed.

"Where they live" determines the answers to the next two questions. So don't rush to compare feature lists — fill in this box first.

## Three Ways to Store, Three Different Attack Surfaces

Security isn't the single question "is it encrypted?" It's "under what circumstances, and who, gets a chance to read your plaintext?"

**Reuse is the biggest real-world risk.** Attackers rarely bother cracking your encryption — they far more often take credentials leaked elsewhere and try them against your accounts ("credential stuffing"). The password you reused may already sit in a dictionary from a breach that had nothing to do with you. So "a different password for every site" matters more than "is my password complex enough."

**Browser sync hands trust to the vendor.** That doesn't mean the vendor is untrustworthy — it means you should be clear-eyed: with sync on, a copy of your passwords leaves your device, and part of their safety now rests on someone else's servers and account system. If your browser account is compromised, the blast radius is more than one computer.

**Local-first pulls that trust back to you.** Take [Account Password Helper](https://github.com/liaolongdong/account-password-helper): it's a local-first Chrome extension. Passwords are encrypted field by field and stored in the browser's `chrome.storage.local`, with no account and no sync server. Whether data leaves this device is your decision, not a default. The price is that moving between devices is a manual export/import — a trade-off between control and convenience. There's no free lunch.

## What Encryption Actually Protects

A lot of people picture "encryption" as one lock around the whole vault. A more granular approach is **field-level encryption**: each record's username, password, URL, notes, and TOTP secret are encrypted separately before being written to the browser's `chrome.storage.local`. Tags and timestamps stay in plaintext, because the list sorts and filters on them. So someone with disk access gets no plaintext password — but not nothing. Decryption happens only within your unlocked session, and the plaintext in memory is cleared the moment you lock or the session expires.

Two things worth knowing even if you're not technical:

**Your master password isn't used as the key directly.** It first runs through a key-derivation function called PBKDF2, with 600,000 iterations, before becoming the actual encryption key. The point: even if someone gets your ciphertext file and tries to guess the master password one attempt at a time, every single guess costs 600,000 operations, which makes brute force impractical. That's also why a master password can be a memorable long passphrase rather than an inhuman string of symbols — length matters more than variety.

**Encryption protects data at rest.** It stops someone who gets your storage file from reading the plaintext. It does not stop malware that already controls the computer you're using, and it does not stop someone leaning over your shoulder while you're unlocked. "Strong encryption" and "absolutely safe" are two different claims — the next section is about that boundary.

## Local-First Isn't a Cure-All: What It Won't Block

Drawing the boundary honestly is more useful than slogans. A local password manager **cannot** do these for you:

- **It won't stop phishing.** If you type your master password or a saved password into a fake site yourself, no amount of encryption can catch that. The tool can match by domain and lower the odds of filling the wrong site, but you're the one who presses submit.
- **It won't stop a compromised device.** If your computer already has a keylogger or remote control, the plaintext is in memory once you unlock, and no local tool can undo that.
- **It won't fix a weak master password.** 600,000 iterations raise the cost of *each guess*; they don't add information to a `123456`. The master password itself has to be long and unique.
- **It won't back up for you.** Local-first means the data mostly lives on this device. If the device dies or the browser data is cleared, without a backup it's genuinely gone. Exporting an encrypted backup is your responsibility.

Keep these "won'ts" in mind and you won't treat any tool as a shrine.

## What If You Lose It: Backup and Recovery

The convenience and the risk of local-first are two sides of one coin. Since no cloud is catching you, **exporting an encrypted backup regularly** is a must-do, not a nice-to-have.

A good backup meets three conditions: the file itself is encrypted (holding it reveals no plaintext), restoring it requires your master password (not just anyone who has the file), and you keep it somewhere separate from your everyday device. That way you can recover when a device fails, and a thief can't use the backup when a device is stolen.

One aside: exporting a plaintext CSV is a different thing — that's for migrating to another tool, the passwords in it are directly readable, and you should delete it soon after use rather than treat it as a long-term backup.

## A Five-Point Checklist for Everyone

If you'd rather skip the theory, these five habits keep risk very low:

1. **Use a different password for every site.** This one habit beats every fancy feature combined. Let a generator produce them randomly; don't reuse your own.
2. **Make the master password a long passphrase.** Four or five unrelated words strung together are harder to guess than a short "complex" `P@ssw0rd!` — and easier to remember.
3. **Turn on two-factor for important accounts.** A second step beyond the password (a code, TOTP, or a hardware key) means a leaked password still has another layer behind it.
4. **Export an encrypted backup regularly and keep it elsewhere.** Local-first tools especially need this habit.
5. **Think sync through.** Want cross-device convenience? Accept hosting your data with a vendor. Want it to stay on your machine? Accept manual migration. Both are fine — just don't default into one without realizing it.

Security isn't a one-time purchase decision; it's a set of daily habits. A tool can make these things smoother, but the one pressing "Save" and "Submit" is always you.