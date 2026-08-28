---
title: 'Opening the Chrome Side Panel in Under One Second: MV3 Service Worker Keep-Alive and Pre-Warming in Practice'
description: Manifest V3 service workers can be terminated at any time, and side panel cold-start white screens are the #1 pain in extension UX. A complete breakdown of Account Password Helper's sub-second strategy — dual-layer keep-alive, four-layer resource pre-warming, three-way data racing, and non-blocking CSS.
tags: chrome extension,manifest v3,service worker,performance,frontend engineering
date: 2026-08-28
author: liaolongdong
image: imgs/blog-cover-02-sub-second-sidepanel.png
---

# Opening the Chrome Side Panel in Under One Second: MV3 Service Worker Keep-Alive and Pre-Warming in Practice

If you've shipped a Manifest V3 extension, you've probably been bitten by the same bug: **the side panel cold-start white screen**.

The user clicks your icon. The side panel frame appears, the content area stays white, and two seconds later it finally renders. In desktop software terms, that's broken. Worse, MV3 replaced persistent background pages with service workers — short-lived processes the browser can terminate at any moment. Your carefully maintained in-memory cache and connection state? Gone without notice.

[Account Password Helper](https://github.com/liaolongdong/account-password-helper) is a local-first password manager extension whose side panel is its highest-frequency surface — unlock, search, and fill all happen there. We set a hard SLA: **the side panel must open in under one second with no white screen, in every scenario** (valid or expired session, browser cold start, quick restart). End result: about 20–50ms on the cached fast path.

This post publishes the entire playbook, with source paths. Steal it.

## First: Where Does the White Screen Come From?

Break the side panel launch into segments, and each one can cost you visible latency:

1. **Service worker cold start.** The SW was terminated; nobody answers messages; the extension page's init request hangs.
2. **Cold disk reads.** HTML, JS chunks, and CSS load from disk for the first time. On Windows, add per-file antivirus scanning of the extension directory — easily 1–2 extra seconds.
3. **Data loading.** The vault needs decryption (PBKDF2 key derivation + AES-256-GCM decryption). Done serially, that's more white screen.
4. **CSS blocking.** `<link rel="stylesheet">` blocks rendering by default — no stylesheet, no paint.

Four problems, four countermeasures.

## Countermeasure 1: Dual-Layer Keep-Alive

An idle MV3 service worker gets terminated after roughly 30 seconds. The common community trick is messaging yourself on a timer, but there's a subtlety: **a `setInterval` inside the SW dies together with the SW**. Relying on it alone is not stable.

Our design is two-layered (`entrypoints/background/backgroundServices.ts`):

- **Layer 1: a 20-second heartbeat.** A runtime `setInterval` touches `chrome.storage.session` every 20 seconds, resetting the idle timer.
- **Layer 2: a 0.5-minute revival alarm.** A `chrome.alarms` alarm (`sw-keepalive`) fires every 30 seconds. Even if the heartbeat's SW gets terminated unexpectedly, the alarm event wakes a fresh SW immediately and the heartbeat resumes.

Each layer covers the other's failure mode: the heartbeat maintains steady-state residency; the alarm guarantees resurrection. The strategy runs unconditionally on all platforms — even when the session is locked. Because what keep-alive buys is not "the password stays in memory"; it's **"the next side panel open never pays cold-start costs."**

Two limits you must know:

- `chrome.alarms` enforces a **one-minute minimum period** for packed extensions — don't expect second-level precision; sub-minute continuity is the heartbeat layer's job, while the alarm layer only guarantees resurrection;
- The keep-alive alarm also carries session-expiry checks — expiry locks the vault immediately, independent of any page being open.

## Countermeasure 2: Four-Layer Resource Pre-Warming

Once the SW is resident, the next step is getting "the files the user is about to need" into the OS cache before they need them. The pre-warming logic (`utils/warmSidePanelResources.ts`) works in four progressive layers:

1. The side panel HTML itself;
2. `modulepreload` declarations + CSS;
3. Dynamically imported secondary chunks;
4. Static dependencies referenced by those secondary chunks.

Two engineering constraints keep it from being a naive firehose:

**Platform differentiation.** Windows' main bottleneck is Defender scanning extension files one by one — the more files you touch, the longer it scans. So Windows gets the full treatment (~25 files), amortizing scan cost upfront. macOS doesn't have this problem, so it pre-warms only a whitelist of ~15 core files. **Trigger points:** extension install/update, browser startup, window focus, tab activation, keep-alive alarm ticks, and 5 seconds after the side panel opens — all leading indicators that the user may open the panel soon.

**Throttling and dedup.** A persisted 5-minute throttle window plus an in-flight mutex prevents multiple triggers from hammering the disk simultaneously.

There's also an SW pre-wake layer (`utils/preWarmSw.ts`, 8-second throttle): any user interaction in the popup pokes the background, guaranteeing the SW is alive by the time "open side panel" is clicked.

## Countermeasure 3: Three-Way Data Racing

The vault has three viable routes (`composables/useSidepanelData.ts`):

1. **Direct read of the encrypted `storage.session` snapshot.** While the session is valid, the background keeps a decrypted snapshot in AES-256-GCM encrypted form in `storage.session`; the side panel reads it directly, no message channel involved.
2. **Background `GET_INITIAL_DATA` memory cache.** The background re-warms its password cache ~500ms after SW startup; fetch it over the message channel.
3. **Direct local-storage fallback.** If both routes fail, the side panel reads `storage.local` and decrypts itself, with a 3000ms timeout.

All three race concurrently: **whichever returns first renders first; one route failing never affects the others.** Every async commit carries a session generation and request sequence guard — if the user locks or re-keys mid-flight, stale results can never write back into the UI.

The core idea: **treat "where the data lives" as a runtime decision, not an architectural assumption.** SW alive? Fast path. SW dead? Fallback. The user notices nothing.

## Countermeasure 4: Non-Blocking CSS

The last slice of white screen comes from render-blocking stylesheets. Our fix (a custom Vite plugin in `wxt.config.ts`): emit the side panel's `<link rel="stylesheet">` with `media="print"` (browsers don't block rendering on print media), then flip it to `media="all"` once loaded.

Result: the HTML parses and paints a skeleton immediately; styles arrive asynchronously. Combined with CSS-variable theme tokens, switching cost is near zero. It's a classic browser trick, and it fits the extension side panel perfectly.

## One Iron Rule: Never `await` Before a User Gesture

`chrome.sidePanel.open()` must be triggered by a user gesture, and **no `await` is allowed before the call** — any async wait in between invalidates the gesture context and the panel simply won't open. So the open call is always fired synchronously, with the tabId fetched via a synchronous API. All "pre-open preparation" is moved upstream into keep-alive and pre-warming phases, rather than scrambling after the click.

## Verification: Sub-Second Is Measured, Not Felt

Alongside the implementation, tests went into CI (vitest):

- `swKeepalive`: heartbeat/alarm registration, revival, cleanup;
- `warmSidePanelResources`: throttle windows, platform branches, file lists;
- `passwordCache` / `startupRelock` / `idleLock`: cache re-warm and every lock path;
- `sidePanelManager`: open sequencing.

The repo now has 364 automated tests. Performance outcome: **20–50ms on the cached fast path.** Even with an expired session requiring master-password re-entry, the UI appears first and waits for unlock — never a white screen.

## Retrospective: Three Lessons

1. **Don't fight MV3's lifecycle; design around it.** The SW _will_ be terminated. Assume it's never there: put state in `chrome.storage`, delegate wake-ups to alarms, and push costs forward into pre-warming.
2. **Speed is purchased in layers.** Keep-alive buys "the process exists." Pre-warming buys "files are hot." Racing buys "data arrives fast." Non-blocking CSS buys "paint first." Each layer works independently; stacked, they produce sub-second.
3. **Handle platform differences head-on.** Windows antivirus scanning is a real, non-technical bottleneck. Full pre-warming plus guiding users to add an exclusion beats pretending it doesn't exist.

Full source on [GitHub](https://github.com/liaolongdong/account-password-helper) — Stars, critique, and issues welcome. If you're building a side-panel extension, I hope this saves you a few months of detours.

---

_Key files referenced: `entrypoints/background/backgroundServices.ts` (keep-alive), `utils/warmSidePanelResources.ts` (pre-warming), `composables/useSidepanelData.ts` (three-way race), `wxt.config.ts` (non-blocking CSS)._
