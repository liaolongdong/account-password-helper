---
title: Which Subdomains Should an Account Show On: Three Tiers of Cross-Subdomain Matching, and the Bug Only a Real Browser Caught
description: Exact-host matching is the foundation of multi-environment isolation, but real logins span a whole subdomain family. This post breaks down the three-tier matching predicate, the root-domain-equality security boundary that must not be cut, and the time Chrome percent-encoded a wildcard into %2A and every unit test went silent.
tags: chrome extension, password manager, domain matching, multi-environment testing, frontend
date: 2026-09-22
author: liaolongdong
image: imgs/blog-cover-05-cross-subdomain-matching.png
---

# Which Subdomains Should an Account Show On: Three Tiers of Cross-Subdomain Matching, and the Bug Only a Real Browser Caught

![Three tiers of cross-subdomain matching: implementation notes and a real-browser bug](imgs/blog-cover-05-cross-subdomain-matching.png)

Ever since the matching rule was narrowed to "hostnames must be equal" in July 2026, that rule has been this extension's foundation for multi-environment isolation: a page on `fat.example.com` never sees entries from `uat.example.com` or from `example.com`. It is also the wall users hit most often — an account saved under one host of a domain family simply does not appear on its siblings.

This post covers the trade-offs behind the three widening tiers, and a bug that only a real browser could catch.

## Exact matching is the right default — but logins don't respect hostname boundaries

To be clear: exact matching isn't conservatism for its own sake. It is the **only default that blocks both classes of incident at once** — `fat.example.com` can't reach `example.com` credentials, and a phishing site can't reach anything that merely looks close. Widening must be an explicit user choice; that part isn't negotiable.

The problem is that real login flows were never drawn along hostname lines:

- Corporate SSO lives on `login.corp.example.com` while the app lives on `app.example.com`, and there is only one account;
- the QA console is at `test-api.example.com`, but the entry was typed from the team wiki, which says `api.example.com`;
- on sites with many subdomains (`mail` / `music` / `news` and friends) nobody saves an entry per subdomain, so people write `*.qq.com` into the URL field by hand — a form that used to be inert: it matched no host, and when navigated it got completed into `https://*.qq.com/`, a hostname that can never resolve;
- an entry saved once at the apex (`qq.com`) is simply invisible on `mail.qq.com`.

The failure modes are obvious. Giving them a non-abusable answer meant splitting "wider" into tiers of different strength instead of loosening subdomain matching across the board.

## The three tiers: off / wildcard / sameMainDomain

The setting lives in the "Cross-Subdomain Matching" dialog in the manager page header (`components/options/DomainMatchSettingDialog.vue`). The three tiers are nested:

| Tier | Label | Semantics |
| --- | --- | --- |
| `off` (default) | Exact match only | Only entries whose full hostname is equal; entries with an empty URL keep showing, as before |
| `wildcard` | Exact match + wildcard entries | Additionally includes entries the user deliberately wrote as `*.qq.com` — the scope of each one is declared per entry |
| `sameMainDomain` | Same root domain (most permissive) | When the current hostname has no entry of its own, fall back to the apex entry (`qq.com`), then to sibling subdomains (`music.qq.com`), labelling the source in the list |

Selecting `sameMainDomain` expands a read-only warning right under the radio group: `fat.example.com` and `uat.example.com` share one root domain, so test-environment accounts will appear together — switch to the wildcard tier if you need isolation. That is the only new risk this tier carries, and exactly why it sits last: `wildcard` widens per entry the user chose, `sameMainDomain` widens the whole family at once.

Only one storage key lands on disk, `domain_match_config`, and its value is a bare enum — no domains, no accounts. So it stays in plain `storage.local`, outside the encrypted snapshot and outside the backup format; a missing key, a read failure, or an invalid value all fall back to `off`. Neither the side panel nor the inline dropdown gets its own copy of the switch: the same setting rendered in three places just creates three sources of truth for later contributors to disagree about.

## One predicate, two fill paths

Every widening decision lives in one pure function in `utils/domain.ts`:

```ts
resolveMatchTier(currentHost, storedUrl, mode) → MatchTier | -1
```

The return value doubles as the sort weight: 0 exact host, 1 wildcard entry, 2 apex of the same root domain, 3 sibling subdomain, 4 entry with an empty URL; `-1` means no match. Under `off` only 0, 4 or -1 can come back, and the function short-circuits inside the exact-comparison branch rather than resolving a root domain it doesn't need — a constraint held in place by a benchmark (below). Whether a hit counts as "cross-subdomain" is one other function in the same file, `isCrossSubdomainTier` (tiers 1–3).

Its consumers are the two fill paths plus everything that presents results:

- **Side panel**: `utils/passwordFilter.ts` decides the this-site visible set and `utils/passwordSort.ts` decides the order; the single source of truth for the "cross-subdomain" badge is one precomputed set of IDs in `entrypoints/sidepanel/App.vue`, so row components only do a lookup instead of re-parsing a domain per row;
- **Inline dropdown**: rows come back from the background's `getMatchingAccounts`, and entry metadata now carries a `tier` (a number, nothing sensitive). The content script only reads it to decide whether to render the "cross-subdomain" source chip — it performs no domain reasoning itself, keeping the existing "content script receives conclusions, never does policy" boundary intact;
- **Quick fill and the context menu** share `sortMatchesForDomain` (`entrypoints/background/quickFillHandler.ts`, `contextMenuManager.ts`), so passing the tier through gives them the identical order for free, first row wins;
- The **Popup's "N matches for this page" counter** (`composables/usePopupInit.ts`), the **empty-state "N more accounts on the same root domain" hint** (`countSameMainDomainCandidates`), and the **auto-save "this will update that other account" note** (`utils/storage/autoSaveManager.ts`) read the same predicate too. The Popup number deliberately keeps excluding empty-URL entries — it answers "how many accounts does this site already have", where a site-agnostic entry doesn't belong, so it is intentionally a different set from the side panel's visible list; `localhost` stays on exact-host there as well.

The value here isn't fewer lines of code — it's that "should this entry appear on this site?" has exactly one answer. The classic way this kind of feature rots is one predicate for the list and another for filling, which eventually produces either "it's in the dropdown but clicking does nothing" or "the side panel badges it and the inline dropdown doesn't". A tier is a property of the entry, not a per-screen heuristic.

## The boundary that must not be cut: root-domain equality, not endsWith

The natural way to implement a wildcard hit is `hostname.endsWith('.qq.com')`, and the lazier way is `hostname.endsWith('qq.com')`. The lazy version behaves perfectly in a demo — nobody logs into `evil-qq.com` during a demo. In production it's a credential collector: `evil-qq.com` and `myqq.com` both end with `qq.com`, so a `*.qq.com` entry gets surfaced there, and the user is the one typing the password into it.

The dotted version looks careful and is still wrong, just for a different reason: it hands "which suffix counts as the same family" to string comparison, so it inherits none of what `getMainDomain` already solved — two-part ccTLDs (the root domain of `example.com.cn` is three labels), the heuristic for unlisted country codes, and the "return IPs and `localhost` verbatim" behaviour. It also needs a special case to accept an apex entry (`qq.com` itself), and special cases are what drift apart from each other.

The shipped implementation reuses exactly one trusted boundary instead: **root-domain equality**.

```
storedHost starts with `*.` → base = storedHost minus the `*.` prefix
hit ⟺ getMainDomain(currentHost) === getMainDomain(base)
```

The same `getMainDomain` already gates cross-domain iframe delegation, so two security-relevant decisions share one implementation and one bug fix. One directional detail is worth keeping in mind: `getMainDomain`'s heuristic branch can only make a root domain **more** specific (three labels instead of two), meaning it only ever narrows matching, never adds a match — the same "fail toward the safe side" property that matters in crypto, just in a different building.

## Chrome's URL parser percent-encoded the `*`

The first real-browser Playwright run showed the `wildcard` tier widening nothing at all.

In unit tests, `resolveMatchTier('mail.qq.com', '*.qq.com', 'wildcard')` returned 1 and passed reliably. The difference is that a stored URL passes through `normalizeToHostname` before the predicate sees it, and that function calls `new URL()`. `*` is not a valid host codepoint: Chrome yields `%2A.qq.com` (and never decodes `%2A` back), while Node.js keeps the `*` verbatim. So on a real browser the stored host arriving at the matcher was `%2A.qq.com` — it doesn't start with `*.`, so the wildcard branch is skipped; under `sameMainDomain` its root domain still equals the page's, so it landed in tier 3, "sibling subdomain", getting both the wrong rank and the wrong badge.

Net result: **every unit test green, not one character of behaviour widened in a real browser.** The fix restores the marker explicitly (`restoreWildcardMarker` in `utils/domain.ts`), and both normalizers need it — `normalizeToHostname` plus the port-carrying `normalizeToHostAndPort`, which also serves as a matching key. Patching one of the two is patching half of it.

The lesson isn't the empty truism "test on real browsers". It's more specific: **the test runtime and the shipping runtime are two different URL parsers.** Whenever a decision depends on input that went through URL, path, or i18n parsing and normalization, green in Node is only a necessary condition. That path is now pinned by `e2e/cross-subdomain.spec.ts`, which changes the tier through the real dialog and watches an already-open panel's list and badges update without re-unlocking — a stretch of storage listener plus messaging plus Vue reactivity that stubs in unit tests can never reach.

## Three things widening deliberately doesn't touch

1. **Auto-save duplicate detection is untouched.** Saving still uses the pre-existing `findMatchingEntry` in `utils/storage/autoSaveManager.ts` (same username plus hostname equality or parent-domain containment, most specific hit wins), and no tier changes it — otherwise "enable cross-subdomain matching" would secretly mean "your saves may land on another site", which isn't reversible. The tiers only buy two read-only note lines: when the update targets a same-username account on a different host, say which one; when a same-root-domain twin exists but wasn't matched, say that this save creates a new entry. Separately, the by-URL lookup in `utils/storage/passwordCrud.ts` keeps exact-host semantics and its JSDoc now states plainly that it does not consult the tier, so nobody mistakes it for the widened entry point.
2. **`localhost` / `127.0.0.1` stay separated by port.** In local multi-project work `:3000` and `:8080` are different apps, and a tier is meaningless there, so those hosts keep going through `matchesPortForLocalDev` and the predicate doesn't participate at all.
3. **Changing the tier does not invalidate the decrypted password cache.** Filtering happens after decryption; the tier changes which entries reach the result, never any ciphertext. Adding it to the cache invalidation keys would drop the `storage.session` snapshot and trigger a full decrypt-back-to-warm on every switch, breaking the documented sub-second side-panel SLA. A source-scan test pins that boundary, for a simple reason: once this lands in the invalidation list, no functional test will ever show anything wrong.

## What widening actually costs

Numbers from the project's own Vitest benchmark, `benchmarks/sidepanel-p0.bench.ts` (tiers compared inside one multi-environment fixture; absolute values aren't comparable against other fixtures):

| Scenario | `off` | `sameMainDomain` |
| --- | --- | --- |
| Side-panel this-site pipeline, 2000 entries | 5.9ms | 9.9ms |
| Side-panel this-site pipeline, 600 entries | 1.6ms | 2.7ms |
| Cross-subdomain badge scan (2000 entries) | zero traversal (shared empty set) | ~2.9ms |
| Empty-state widening counter (2000 entries) | 5.6–5.7ms | constant 0 (nothing left to widen) |

The content script bundle grew from 217,062 to 217,080 bytes: +18 B. The predicate is a pure function and tree-shaking absorbed it, which is where it belongs.

Three caveats so these numbers aren't over-read: they measure the JS data layer, not end-to-end render time — the side-panel list already renders in a windowed fashion, so the first frame doesn't care about the tier; the badge scan and the empty-state count are both lazy, so the `off` default path pays nothing; and the honest conclusion is that **the wider tiers needed no performance work at all**. The most expensive cell in the table is still single- to double-digit milliseconds, and what it buys is "accounts for this site show up on its subdomains".

## Test and guard surface

The repo currently holds 1563 automated test cases across 142 test files. What covers this area directly: the `resolveMatchTier` tier cases (`off` reproducing the pre-migration exact-host rule, `wildcard` admitting only wildcard entries, `sameMainDomain` producing the 1 → 2 → 3 sequence, the apex page itself, a wildcard marker already encoded as `%2A`, two-part ccTLDs, IPs and malformed input degrading to no-match, and the no-domain short circuit); a security regression asserting prefix collisions (`evil-qq.com` / `notqq.com` / `mail.qq.com.evil.io`) all return -1 against `*.qq.com`; an equivalence guard on `filterAndSortEntriesForDomain` claiming the same set in the same order id by id under `off`, plus the widened tiers' priority sequence (wildcard ahead of apex, local-dev hosts identical across all three tiers); presentation tests that the inline dropdown renders one source chip per widened tier; and the e2e above.

The unusual one is `tests/architecture/crossSubdomainTierWiring.test.ts`: it doesn't exercise behaviour, it scans source. Invariants of the form "all four consumers must agree" die most often when a new call site forgets to pass the tier — and because the parameter has an `off` default, type checking and ESLint stay completely silent. It happened once for real: a full row click in the side panel used the tier-aware predicate while the keyboard Enter path ate the default value, producing "clickable, but Enter won't open it" for cross-subdomain entries. The same file mechanically forbids hand-writing range comparisons like `tier >= 1 && tier <= 3` in runtime code, locking the one definition of that interval inside `isCrossSubdomainTier`. Constraints of the shape "these two places must agree" drift when they rely on discipline; they don't drift when a scanner enforces them.

## If this is the wall you hit

First decide which of the two you actually want on `mail.qq.com`: only a few accounts spanning subdomains (`wildcard` tier, hand-write `*.qq.com`), or the whole subdomain family (`sameMainDomain`, and remember it drags `fat` / `uat` in with it). The switch is "Cross-Subdomain Matching" in the manager page header, and it takes effect immediately without re-unlocking.

Account and password data still live encrypted in local storage exactly as before, and this feature added no permissions and no network requests; the extension's only recurring request remains its anonymous version check every 6 hours.

Source and discussion: [the GitHub repository](https://github.com/liaolongdong/account-password-helper). It's listed on the [Chrome Web Store](https://chromewebstore.google.com/detail/account-password-helper/fgimkdodpjfkddmildjieojpfakpanli), completely free, open source under GPL-3.0.

---

_Key files referenced: `utils/domain.ts` (`resolveMatchTier` / `isCrossSubdomainTier` / `getMainDomain` / `restoreWildcardMarker`), `components/options/DomainMatchSettingDialog.vue` (the tier dialog), `utils/passwordFilter.ts` and `utils/passwordSort.ts` (side-panel visibility and order), `entrypoints/background/passwordCache.ts` (data path for the inline dropdown and quick fill), `entrypoints/content/inlineDropdown/InlineFillDropdown.ts` (the source chip), `tests/architecture/crossSubdomainTierWiring.test.ts` (the wiring guard), `e2e/cross-subdomain.spec.ts` (real-browser regression), `benchmarks/sidepanel-p0.bench.ts` (cross-tier benchmark)._
