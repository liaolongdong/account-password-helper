---
title: Password Generator: Length, Entropy, Strength
description: Why complex-looking short passwords are fragile, how length and entropy relate, and when to use random passwords versus passphrases.
tags: password generator,password strength,entropy,passphrase,security
date: 2026-11-07
modified: 2026-11-07
author: liaolongdong
image: imgs/blog-cover-12-generator-strength.png
---

Almost every password manager ships a "Generate" button, but a lot of people click it without feeling any more confident: is this string of gibberish really safer than what I had? And what is that strength bar actually scoring?

This post separates the two jobs — generating and evaluating. You'll see why "looks complex" and "hard to guess" aren't the same thing, how length and entropy relate, and where random passwords versus passphrases each belong. The examples use [Account Password Helper](https://github.com/liaolongdong/account-password-helper)'s generator, but the reasoning holds for any decent tool.

## Why "Looks Complex" Doesn't Mean "Hard to Guess"

`P@ssw0rd!` looks intimidating: uppercase, lowercase, a digit, a symbol — a shape-only strength bar may even call it "strong." But it's only 9 characters, and underneath it's `password`, the most common word in the universe, wrapped in a few substitutions everyone knows (a→@, o→0, a trailing !).

Attackers' dictionaries collected these tricks long ago. On a modern GPU, guessing a "mutated common word" isn't measured in years — it's measured in seconds. **Complexity theater fools the strength bar; it doesn't fool the dictionary.**

What actually determines guess-resistance is the quantity in the next section.

## Entropy: Turning "Hard to Guess" Into a Number

Entropy measures "how many equally likely possibilities a password has," in bits. Each extra bit doubles the number of possibilities — and doubles the attempts a brute-force attack needs.

For a **truly random** password, entropy has a simple formula:

> entropy ≈ length × log₂(character-set size)

The character set is "what each position could be." Lowercase only is 26; add uppercase and digits and it's 62; add common symbols and it's roughly 90. Plug in the numbers:

- 8 characters from a 62-character set: about 48 bits;
- 16 characters from a 90-character set: about 104 bits.

Going from 8 to 16 characters doubles the length and roughly doubles the entropy — but the cracking cost doesn't double, it multiplies by 2 to the power of dozens. **That's the mathematical reason "length beats variety":** widening the set from 62 to 90 adds only about 0.5 bit per character, while going from 8 to 16 characters adds dozens of bits at once.

Note the precondition: **truly random**. Gibberish a human "thinks up" doesn't count — you'll unconsciously reach for birthdays, keyboard patterns, favorite words, and the entropy lands far below the formula's ceiling. That's exactly why generators exist.

## Random Passwords: Let the Generator Do It, Don't "Think" Them Up

A proper generator should use a cryptographically secure random source (`crypto.getRandomValues` in the browser), not a predictable pseudo-random one like `Math.random()`. Account Password Helper's generator defaults to 16 characters with all four classes on, lets you set length from 6 to 50, and can exclude look-alike characters such as `1/l/I/0/O`.

A few practical tips:

- **For passwords you store in the manager, go long.** You don't have to remember them, so start at 16 and push important accounts past 20 — there's no downside.
- **Generate a fresh one for every site.** Half the generator's value is "random"; the other half is "makes you too lazy to reuse."
- **For anything you'll copy by hand or read aloud, exclude look-alikes.** It saves the "is that a capital I or a lowercase l" argument.

The weakness of random passwords is obvious: they're hard to remember. So they fit the "let the tool keep it and autofill when needed" case, not the one password you must memorize.

## Passphrases: For the One You Must Remember, Use Words

Master passwords, disk-encryption passphrases — the ones you have to keep in your head — suit a **passphrase**: several words picked at random from a large word list and joined, shaped like `correct-horse-battery-staple` (illustrating the structure only; don't actually use these words).

The beauty is that every word is familiar and the whole thing is easy to remember, yet because the words are chosen **at random**, the number of combinations is still enormous. With a word list of about 3,080 words, each word is roughly 11.6 bits:

- 4 words ≈ 46 bits;
- 6 words ≈ 69 bits;
- 7 words ≈ 81 bits.

The operative word, again, is "random." A catchy line you invent yourself (song lyrics, a poem) is not a passphrase — it lives in attackers' text corpora, and its entropy collapses. Let the generator roll the dice from the word list to actually get those bits.

## What the Strength Bar Measures — and What It Misses

The strength bar is a useful nudge, but don't treat it as a verdict. A common lightweight rule checks just four things: long enough (say ≥8 characters), has a letter, has a digit, has a symbol. Account Password Helper's core rules are exactly these four: all four pass is "strong," two or three pass is "medium," the rest is "weak."

The upside is speed and instant feedback as you type; the downside is that it **only looks at shape, not content**. `Abcdef1!` passes all four and shows "strong," but it's a short, patterned string whose real strength isn't high.

So a fuller evaluation adds two dimensions — which is what a security audit does:

- **Is it a commonly breached password?** Compare against a high-frequency weak-password dictionary; a hit gets flagged red — swapping `password` for `P@ssw0rd` is a trick the dictionary already knows.
- **Is it reused elsewhere?** The same password on multiple accounts puts all your eggs in one basket.

One common misconception worth clearing up: this kind of local audit **doesn't need to send your passwords online to check**. Reuse comparison groups entries in memory, and the breach dictionary is a preloaded local list of common weak passwords — nothing leaves the device. The strength bar handles "shape," the audit handles "content"; together they get close to the truth.

## In One Sentence

- Guess-resistance is about **entropy**, entropy is mostly built by **length**, and variety is just the change;
- Passwords you don't need to remember: hand them to a **random generator**, longer is better, one per site;
- The one you must remember: use a **random passphrase** with enough words;
- The strength bar only sees shape — don't relax just because it says "strong"; reuse and breaches are where things actually go wrong.

A generator solves the root problem that humans can't produce true randomness. Using it well beats agonizing over whether to squeeze in one more symbol.