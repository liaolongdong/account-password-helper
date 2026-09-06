---
title: Four New Features, Four Implementation Notes: Right-Click Fill, Site-Wide Search, Quick Add & Read-Only Details
description: None of these updates added a settings toggle. This post walks through the implementation trade-offs and security boundaries behind right-click fill, inline panel positioning, side panel site-wide search, and the read-only entry drawer.
tags: chrome extension, browser extension, password manager, frontend, interaction design
date: 2026-09-05
author: liaolongdong
image: imgs/blog-cover-04-login-flow-details.png
---

# Four New Features, Four Implementation Notes: Right-Click Fill, Site-Wide Search, Quick Add & Read-Only Details

![Implementation highlights of the four new features](imgs/blog-cover-04-login-flow-details.png)

Not one feature in this batch added a switch to the settings page, and only one permission grew the manifest — `contextMenus`, belonging to the single heavyweight item in the group (right-click fill). Everything else rides on rails that already existed: the login field, the side panel, the password list. That was deliberate — every extra toggle on a password manager's settings page is one more "should I turn this on?" decision pushed onto the user.

That doesn't mean any of it was simple. Each feature ran into a Chrome-extension-specific trap, and each deserves its own note.

## Right-click fill: Chrome won't tell you which element was clicked

Right-click an input → fill username / password / 2FA code, or generate and fill a strong password. This sounds like ten lines of `chrome.contextMenus`.

The first trap: **`contextMenus.onClicked` gives you the `frameId`, not the clicked element.** The background knows "the user right-clicked somewhere in this frame" but not whether it was the username box or the password box — and _which box the remembered password lands in_ is the entire point of the feature. The fix: the content script records the target input itself during the capture phase of the `contextmenu` event (`entrypoints/content/contextMenuTarget.ts`), and the background then sends the fill message targeted at that frame. The same memory later got reused to anchor the unlock panel when the session is invalid — dig one hole in the right place and the second feature comes free.

The second trap: **an over-long parent label pushes the submenu off screen.** Chrome only collapses an extension's items under a submenu titled with the extension's full name when several top-level items are visible in the same context; with a single visible top-level item, the parent you registered is used as-is. This extension's store name carries a subtitle ("Account Password Helper - Local Encrypted Password Manager"), and using it as the parent makes the label so wide that the second level spills outside the viewport — users right-click and see a half-off menu. So the menu now registers an explicit single parent ("Fill Credentials" in an input context, "Account Password Helper" on blank page space), keeping exactly the same two-level depth the collapsed layout would have had. Parents must be created before children — Chrome requires the `parentId` target to already exist — and the whole menu is rebuilt on language switch, because item titles render in the user's language.

The third trade-off: **"Generate & fill a strong password" is exempt from the session gate.** Signing up for a new account is the most frequent context for generating a strong password, and at that moment the session is usually locked. The action only generates random characters with Web Crypto and reads no encrypted or decrypted entry, so letting it through the session check is safe — while the cross-frame gate (plaintext is only sent to the top frame or same-main-domain frames) and targeted delivery stay in place. A security exception has to be harder to abuse than the main path, or it shouldn't be opened at all.

## The inline panel: invisible elements can't be measured

The inline fill panel anchors below the login field and flips above when there's no room. The first version had a subtle bug in the "position, then show" order: while an element is `display: none`, `offsetHeight` is always 0, so on first open the above/below space comparison was reading 0 and the panel forever "believed" there was room below — in a narrow viewport such as a nested-iframe login box, half of it got clipped.

The fix isn't a delay or an extra frame — it's **show first, then position**, both inside the same synchronous task. The browser paints nothing in between, so the measurement is real and no wrong position ever flashes. Three fallbacks came with it: anchor below the input by default, flipping above only when the space below can't fit the panel and the space above is larger; compress the panel height to the available space on the chosen side (the list scrolls internally, floored at 120px so the search row plus at least one account stay usable); and when the viewport is narrower than the floor, snap inside the viewport — better to overlap the input than to clip the list. One more detail that's easy to forget: the panel may already be closed by the time positioning finishes (e.g. the input scrolled out of view), and then the remaining interaction binding and focus must be aborted — otherwise you attach listeners to a panel that no longer exists.

## Site-wide search: one predicate, two consumers

The side panel lists only accounts matching the current domain by default — that is the foundation of multi-environment isolation. But "I know I saved a GitHub account, and I'm currently on some other site" is a lookup the this-site mode can't serve. Hence the icon right of the search box, toggling between "This site" and "All entries".

The important design isn't the button, it's **the single source of truth for the predicate**: two pure functions in `utils/passwordFilter.ts` (`matchesSiteScope` for the decision, `filterEntriesByScope` for the filtering) answer both questions at once — "should this entry appear in the list" and "can this entry be filled into this page". They are the same question: filling requires the target field to exist on the current page, so a domain-mismatched entry can only fail. Split into two judgments they drift sooner or later, producing "it's in the list but clicking does nothing", or the inverse. Making them Vue-free pure functions has a side benefit: unit tests and benchmarks can hit them directly.

The off-site degradation comes from the same predicate: when `canFill` is falsy the whole row becomes "open this site in a new tab", while copying username / password / 2FA code, favoriting and editing all stay available — users come to all-entries mode to _find_, not to _fill_. The URL used for navigation isn't string concatenation either; it goes through `toNavigableUrl`, which adds the default protocol, uses http for local dev domains, and explicitly rejects non-navigational schemes such as `javascript:` (returning `null` means no link is rendered). A stored URL is a user-editable field, i.e. untrusted input.

There was a worry that opening up the whole vault would slow the first paint. The benchmark says otherwise: from 100 to 2000 entries, the throughput difference between the this-site and all-entries paths stays inside the ±1% noise band (reproducible via `benchmarks/sidepanel-p0.bench.ts`). The reason is counter-intuitive — this-site mode runs a hostname comparison per candidate (including URL parsing and protocol completion), while all-entries mode just does one shallow copy plus a sort. **What costs time isn't "looking at more", it's "re-parsing an address for every one of them".**

Worth noting: when this site has no result but the vault does, the empty state offers a "Search all entries (N found)" button. The user shouldn't have to first discover that a toggle exists — that's exactly what decides whether an escape-hatch feature gets used at all.

## Quick add and read-only details: separate "take a look" from "change it"

The "+" in the side panel header opens a dialog with just five fields (account / password / URL / tag / remark), the site field prefilled from the current domain; when the site has no account the header shows an invitation, and when a search returns nothing the empty state offers the same entry — all three open the identical dialog. When full fields such as TOTP are needed, the bottom of the dialog sends users to the manager page. The light path serves the frequent action, the heavy path serves completeness; don't turn the dialog into a clone of the options page.

The read-only detail drawer (`components/options/PasswordDetailDrawer.vue`) serves another frequent action: wanting to see the full remark or the password history, but having to open the edit dialog to do it. Its constraint is **presentation only** — no storage writes, no touching encryption or the session; "Edit" merely emits the entry upward so the parent reuses the existing edit flow, keeping exactly one write path. The password is masked by default, visibility is component-local state that resets — together with the loaded history list — when the closing animation ends, so no plaintext reference lingers. Copying a password isn't a bare `writeText`: it goes through the UI-agnostic layer in `utils/clipboard.ts` (write, timed clear per configuration, verify the clipboard wasn't replaced before clearing, degrade to best-effort `execCommand` when the document has no focus), with success/failure handed back through a callback so each entry point uses its own wording. That mechanism used to live inside the side panel; extracted, it is now shared by the drawer and the panel — the two entry points can't evolve their "copies get auto-cleared" promise apart from each other.

## What the four have in common

Looking back, all four chains obey the same constraints: **no new toggles, no new permissions beyond `contextMenus`, no change to storage layout or encryption format, no redefinition of existing entries**; every new user-visible string ships in Chinese and English as a pair; every feature came with regression tests, with 632 automated tests across 53 test files plus `pnpm build` for both browsers as the acceptance bar.

Feature increments in a password manager shouldn't be "a few more buttons". They should polish the same login chain until it's a little smoother: one less app switch, one less wrong input box, one less accidental edit made just to read a note.

Source and discussion: [the GitHub repository](https://github.com/liaolongdong/account-password-helper). It's listed on the [Chrome Web Store](https://chromewebstore.google.com/detail/account-password-helper/fgimkdodpjfkddmildjieojpfakpanli), completely free, open source under GPL-3.0.

---

_Key files referenced: `entrypoints/background/contextMenuManager.ts` (menu registration and action dispatch), `entrypoints/content/contextMenuTarget.ts` (right-click target memory), `entrypoints/content/inlineDropdown/InlineFillDropdown.ts` (panel positioning), `utils/passwordFilter.ts` (scope and filtering predicate), `utils/clipboard.ts` (copy and auto-clear), `components/options/PasswordDetailDrawer.vue` (read-only detail drawer)._
