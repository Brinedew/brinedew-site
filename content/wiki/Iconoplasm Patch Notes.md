---
title: Iconoplasm Patch Notes
tags:
  - content/wiki
date: 2026-05-19
draft: false
---

# Iconoplasm Patch Notes

## Unreleased

## 0.5.3 - 2026-08-27

* Optimized portrait retrieval from host, with regional fallback
## 0.5.2 - 2026-08-26

* Hotfix: Backend data management.
* Hotfix: Opening a local PDF now copies the exact PDF path before opening Firefox’s picker, allowing the user to press Ctrl+V → Open.
## 0.5.1 - 2026-08-26

* Hotfix: PDF highlighting now works with local PDFs
## 0.5.0 - 2026-08-26

* Decoupled portrait discovery from the larger rich-detail request for more robust gene portrait loading
## 0.4.15 - 2026-08-25

* New feature: gene names now highlight in PDFs. Turn on "PDF highlighting" slider in the extension settings - this swaps the browser's PDF reader to a pdf.js based viewer capable of highlighting.
* Enabled predictive download of gene data on pages - now images will appear quicker on hover.
## 0.4.14 - 2026-08-12

* Hover pop-up now loads faster
* Fixed some highlight parsing edge cases
## 0.4.13 - 2026-08-11

* updated the gene alias blocklist retrieval to rely on online storage instead of purely local storage
## 0.4.12 - 2026-08-02

- Fixed Microsoft Edge losing all gene highlights after the extension catalog exceeded the browser's local-storage quota.
- Replaced the portrait-heavy whole-catalog cache with a compact scanner index; hover details and portraits now load only when needed.
- Existing installs automatically migrate legacy catalog storage from about 19 MB to about 1.9 MB.
- Removed the unlimited-storage permission and bounded the persistent detail caches.
## 0.4.11 - 2026-07-24

* Fixed simple hover mode not displaying portraits in MS Edge browser
* Fixed "on hover" option not hiding color pills
## 0.4.10 - 2026-07-19

- Gene highlights now appear from the local catalog immediately while freshness checks run in the background.
- Highlights now recover after pagination, virtualized-row text changes, and interrupted background startup.

* hotfix
## 0.4.9 - 2026-07-19

- Fixed Firefox 0.4.8 starting without its portrait-delivery background dependency, which prevented the gene dictionary and all highlights from loading.
- Corrected the Firefox Android minimum to the first version that supports the extension's required data-collection declaration.

* hotfix
## 0.4.8 - 2026-07-19

- Store releases now keep the immediately previous extension/API contract supported during browser-store review, then retire it automatically at the following human-published release.
- Portrait APIs now publish canonical first-party asset references instead of CDN-provider URLs.
- The website and extension now use one tab-wide portrait delivery engine and one server-published delivery policy.
- Fixed newly generated edit and candidate previews failing after Bunny was already found unreachable in the tab.
- Added bounded retry for transient Bunny Storage operations while permanent authorization/configuration errors fail immediately.

- Fixed the broad term `cadherin` incorrectly resolving to CDH17.
- Added complete, concrete mappings for E-cadherin/E-cadherins and N-cadherin/N-cadherins, including hyphen-or-space and lowercase-or-capitalized `cadherin` forms.
- Website-owned alias policy can now retract an incorrect generated alias without downloading the catalog again or requiring another extension release.
- The published API exposes every effective spelling as an inspectable dictionary; the extension does not execute remote matching rules.

- Added a versioned publication-alias overlay delivered through the existing catalog manifest.
- Fixed highlighting for C/EBPβ, IL-1, p65, TGF-β, N1ICD, IL-1α, IL-1β, and cGAS.
- Alias-only updates now reuse the cached base catalog instead of downloading the roughly 6 MB catalog again.
- Fixed the five-minute catalog refresh timestamp so unchanged manifests no longer get probed on every page.

* Firefox Android support
* Faster alias updates
* Resilient portrait loading when the CDN is unavailable
* Mobile/card improvements.
## 0.4.7 - 2026-05-22

- added link to the extension header

## 0.4.6 - 2026-05-21

- Improved image loading speed on hover
- Fixed improper multi-line box splitting

## 0.4.5 - 2026-05-21

Hotfix for frame packaging bug in 0.4.4. Now should render all three hover card styles correctly.

## 0.4.4 - 2026-05-21

Fix Firefox hover cards so Blot only and Vintage lab label use the intended rich frame renderer. Blot only portraits now become visible after prewarm, lab-label pen loops load the rough hand-drawn renderer, and the extension frame uses packaged card CSS instead of drifting against live site CSS.

## 0.4.3 - 2026-05-19

- Refined the extension popup typography.
- Renamed popup controls to be clearer.
- Improved segmented control readability.
- Removed unused legacy extension font exposure from the manifest.
- Fixed gene matching boundaries so highlights are less likely to trigger inside larger letter/number tokens.
- Fixed first-hover card theming so the tooltip frame gets the same card classes immediately, not only after later layout switches.
- Improved hover-card portrait prewarming.
- Hardened the archival hover-card renderer against stale async renders, preventing an older card render from replacing a newer hover target.
- Fixed image-only card sizing and margins so blot-only cards keep a stable 384:512 frame and do not inherit unwanted page-level image spacing.
- Tightened shared card label layout so row labels have stable width, avoid awkward hyphenation, and leave more reliable room for the body text.
