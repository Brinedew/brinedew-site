---
description: "What changed in the Iconoplasm browser extension, release by release."
docsSection: Updates
docsOrder: 1
docsLabel: "Patch notes"
title: Iconoplasm Patch Notes
date: 2026-05-19
draft: false
---

# Iconoplasm Patch Notes

## Unreleased

## 0.5.10 - 2026-10-05

* Highlights on animated text are now more reliable
## 0.5.9 - 2026-10-01

* Hover cards now load each gene from one up-to-date file on the free CDN, so hovering never costs a metered request to our server, and portrait changes appear on the cards within minutes.

## 0.5.8 - 2026-09-30

* Fixed highlights of gene names that looked wrong in multi-column tables.
## 0.5.7 - 2026-09-06

* hotfix for previous release
## 0.5.6 - 2026-09-06

* Improved the speed and reliability of highlighting gene names
## 0.5.5 - 2026-08-28

* Made data load faster across browser tabs
## 0.5.4 - 2026-08-28

* Fixed duplicated and inefficient image loading
## 0.5.3 - 2026-08-27

* Made portraits download faster from the host, and added a regional fallback
## 0.5.2 - 2026-08-26

* Hotfix to how the backend manages data.
* Hotfix: when you open a local PDF, the extension now copies the exact PDF path before it opens Firefox’s file picker, so you can press Ctrl+V → Open.
## 0.5.1 - 2026-08-26

* Hotfix: PDF highlighting now works with local PDFs
## 0.5.0 - 2026-08-26

* Separated the lookup of which portraits exist from the larger request for full details, so that gene portraits load more reliably
## 0.4.15 - 2026-08-25

* New feature: gene names now highlight in PDFs. Turn on the "PDF highlighting" slider in the extension settings - this replaces the browser's PDF reader with a viewer based on pdf.js that is capable of highlighting.
* Gene data on a page now downloads in advance, so images appear faster on hover.
## 0.4.14 - 2026-08-12

* Hover pop-up now loads faster
* Fixed some edge cases in how highlights are parsed
## 0.4.13 - 2026-08-11

* updated the extension to retrieve the blocklist of gene aliases from online storage instead of relying only on local storage
## 0.4.12 - 2026-08-02

- Fixed Microsoft Edge losing all gene highlights after the extension catalog exceeded the browser's quota for local storage.
- Replaced the large cache of the whole catalog, which was mostly portraits, with a compact index for the page scanner; hover details and portraits now load only when needed.
- On existing installs, the extension automatically converts the old catalog data to the new index, so storage use drops from about 19 MB to about 1.9 MB.
- Removed the unlimited-storage permission and set size limits on the persistent caches that store details.
## 0.4.11 - 2026-07-24

* Fixed simple hover mode not displaying portraits in MS Edge browser
* Fixed "on hover" option not hiding color pills
## 0.4.10 - 2026-07-19

- Gene highlights now appear from the local catalog immediately while checks for newer data run in the background.
- Highlights now recover after pagination, after changes to the text of virtualized rows, and after an interrupted startup in the background.

* hotfix
## 0.4.9 - 2026-07-19

- Fixed Firefox 0.4.8 starting without the background component that delivers portraits, which prevented the gene dictionary and all highlights from loading.
- Corrected the minimum version of Firefox for Android. It is now the first version that supports a required part of the extension: its declaration of what data it collects.

* hotfix
## 0.4.8 - 2026-07-19

- While a release is in review at a browser store, we now keep supporting the previous version of the interface between the extension and the API, and then retire that version automatically at the next release that a person publishes.
- Portrait APIs now return canonical references to first-party assets instead of URLs from the CDN provider.
- The website and extension now deliver portraits through the same shared code in every part of a browser tab, and both follow one delivery policy that the server publishes.
- Fixed previews of newly generated edits and candidates, which failed once Bunny had been unreachable earlier in the same tab.
- Added a limited number of retries for Bunny Storage operations that fail temporarily, while operations with permanent errors in authorization or configuration still fail immediately.

- Fixed the broad term `cadherin` incorrectly resolving to CDH17.
- Added full, explicit mappings for E-cadherin/E-cadherins and N-cadherin/N-cadherins, including forms of `cadherin` written with a hyphen or a space, in lowercase or with a capital letter.
- The website can now remove an incorrectly generated alias through its alias policy, with no new download of the catalog and no new release of the extension.
- The published API lists every spelling that is currently in effect, as a dictionary that anyone can inspect; the extension does not execute matching rules from a remote source.

- Added a versioned overlay of aliases found in publications, delivered through the catalog's existing manifest.
- Fixed highlighting for C/EBPβ, IL-1, p65, TGF-β, N1ICD, IL-1α, IL-1β, and cGAS.
- When an update changes only aliases, the extension now reuses the base catalog that it has already cached, instead of downloading the roughly 6 MB catalog again.
- Fixed the timestamp for the five-minute refresh of the catalog so unchanged manifests no longer get probed on every page.

* Support for Firefox on Android
* Faster alias updates
* Portraits now keep loading when the CDN is unavailable
* Improvements for mobile and for cards.
## 0.4.7 - 2026-05-22

- added link to the extension header

## 0.4.6 - 2026-05-21

- Images now load faster on hover
- Fixed boxes that split incorrectly across multiple lines

## 0.4.5 - 2026-05-21

Hotfix for a bug in how frames were packaged in 0.4.4. All three styles of hover cards should now render correctly.

## 0.4.4 - 2026-05-21

Fixed Firefox hover cards so that the Blot only and Vintage lab label styles use the intended renderer for detailed frames. Blot only portraits now become visible after the cards are prewarmed, the lab label now loads the renderer that draws its rough, hand-drawn loops, and the extension's frame uses the card CSS that ships with the extension instead of the live site's CSS, which can change independently.

## 0.4.3 - 2026-05-19

- Refined the typography of the extension popup.
- Renamed popup controls to be clearer.
- Improved how readable the segmented controls are.
- Stopped the manifest from exposing unused legacy fonts of the extension.
- Fixed the boundaries for matching genes so highlights are less likely to trigger inside larger tokens made of letters and numbers.
- Fixed the theming of the card on first hover so that the frame of the tooltip gets the same card classes immediately, not only after the layout changes later.
- Improved prewarming of portraits for hover cards.
- Archival hover cards now discard old renders that finish late, so that an older render can no longer replace a newer hover target.
- Fixed the sizing and margins of image-only cards so that blot-only cards keep a stable 384:512 frame and do not inherit unwanted spacing around images from the page.
- Tightened the shared layout of card labels so that row labels keep a stable width, wrap without splitting words at awkward points, and reliably leave room for the body text.
