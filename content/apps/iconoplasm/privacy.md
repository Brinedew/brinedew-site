---
title: "Privacy Policy — Iconoplasm"
description: "How Iconoplasm handles your data"
date: 2026-05-22
draft: false
---

# Privacy Policy — Iconoplasm

**Last updated:** August 30, 2026

This policy describes what data Iconoplasm collects and how it's handled.

## What the Extension Does

Iconoplasm scans web pages you visit for human gene symbols (like TP53, BRCA1). When it finds them, it highlights the text and shows hover cards with the gene's assigned character-card data and blot. It also tracks which genes you've encountered (your "discovery" count).

## Data Collected

### Page Content (read locally, never transmitted)

The extension reads the text content of pages you visit to find gene symbol matches. **This text never leaves your browser.** Gene matching happens entirely on your device using a local trie data structure.

### Gene Symbol Lists (sent to our server)

When the extension finds gene symbols on a page, it sends those symbols — and only those symbols — to `iconoplasm.brinedew.bio` to fetch card data and blots. We do not send the URL you're visiting, the page content, or any other browsing data.

### Discovery Encounters (optional, sent to our server)

If you're signed in via Discord, the extension reports which gene symbols you've encountered so your discovery count syncs across devices. If you're not signed in, discoveries are stored locally in `chrome.storage.local` and never leave your browser.

### Discord Login (website only)

If you sign in on the Iconoplasm website, we store your Discord user ID, username, and avatar URL so we can keep your account, discoveries, votes, requests, and settings connected to you.

### Caretaker manifestations (website only)

If you accept a gene caretaker invitation, we store the assignment, the exact terms version you accepted, your departure-policy choices, manifestation versions you write, canonical-selection history, and the public credit label attached to your authorship. Manifestation and generated Tags bodies are encrypted before they enter private object storage. The authority database stores stable IDs, hashes, byte counts, wrapped encryption keys, lifecycle state, and bounded audit events rather than plaintext bodies.

Every save creates an immutable version. Withdrawing a manifestation immediately makes that lineage ineligible for canonical use, but it does not immediately rewrite or erase the private version record. Hard purge becomes eligible 30 days after withdrawal, unless a legal hold requires preservation. It destroys the decryption key before deleting the encrypted object. The one-time encrypted cutover backup contains only original system material, not manifestations users write afterward, and is deleted 30 days after verified retirement of the old plaintext unless a legal hold applies. If your account is erased while history must remain, provider identity is removed and retained authorship uses a stable anonymous label.

An unsaved caretaker draft is kept in that tab's session storage so a refresh, conflict, or temporary suspension does not destroy your text, while two open tabs cannot erase or overwrite each other's drafts. The draft is not sent to the server until you save it. Saving clears that tab's draft; closing the browser session, using the interface's remove control, or clearing site data also removes it.

### Image Generation and Editing (website only)

If you use direct image generation or image editing, we store the job details needed to run and display the result: gene symbol, selected provider, prompt mode, selected emulsion, source image for edits, job status, and generated image metadata.

If you add an image API key, we store it encrypted and use it only for generation or editing requests you start. Those requests may send the prompt, selected emulsion, source image for edits, and generated result to the image provider you selected.

### User Emulsions (website only)

If you save a custom emulsion, we store its text and a public ID based on your Discord username, such as `USERNAME-1`. Saved emulsions may appear in the website's emulsion picker and may be attached to generated or published blots.

### Preferences (stored locally)

Your settings — highlight mode, tooltip theme, card variant, and blocklist — are stored in `chrome.storage.local` on your device. They are not transmitted to any server.

## What We Don't Collect

- **Browsing history**: We never see which URLs you visit.
- **Page content**: The full text of pages stays on your device.
- **Personal information from extension scanning**: The extension itself doesn't collect names, emails, URLs, or page text from the pages it scans.
- **Extension analytics or telemetry**: The extension has no usage tracking, no crash reports, and no third-party analytics.

## Network Requests

The extension makes requests only to `iconoplasm.brinedew.bio`:

| Request | What's Sent | When |
|---------|-------------|------|
| Gene batch lookup | List of gene symbols found on the current page | When you visit a page with gene symbols |
| Blot fetch | Gene symbol | When a hover card is shown |
| Discovery encounter | Gene symbol | When a gene is first encountered (signed-in users only) |
| Discovery state sync | Session cookie | On page load (signed-in users only) |
| Caretaker dossier and changes | Session cookie, gene symbol, explicit command inputs, and manifestation prose when saving | Only on signed-in gene pages for an invited, current, or former caretaker |

No requests are made to any other domain.

The signed-in website may also contact Discord for login and the image API provider you choose for generation or editing.

The website may load Cloudflare Web Analytics only after you allow analytics in the site prompt. Cloudflare Web Analytics is cookieless and used for aggregate page-visit counts.

## Content Script Scope

The extension's content script runs on all web pages (except `iconoplasm.brinedew.bio` and `staging.brinedew.bio`, which are excluded). This broad scope is necessary because gene symbols can appear on any website — research papers, Wikipedia articles, databases, forums, etc. The content script only reads text nodes to find gene symbols; it does not read form inputs, passwords, or other sensitive page elements.

## Data Storage

| What | Where | Duration |
|------|-------|----------|
| Display preferences | `chrome.storage.local` | Until you change them |
| Blocklist customizations | `chrome.storage.local` | Until you change them |
| Guest discoveries | `chrome.storage.local` | Until you sign in (merged to server) or clear extension data |
| Unsaved caretaker draft | Per-tab browser session storage | Until saved, removed by the caretaker interface, the browser session closes, or site data is cleared |
| Signed-in discoveries | Cloudflare D1 database at `iconoplasm.brinedew.bio` | Until you request deletion |
| Discord account link | Cloudflare D1 database at `iconoplasm.brinedew.bio` | Until you request deletion |
| Caretaker assignment, accepted terms, and bounded authority audit history | Private Cloudflare D1 database | While needed to operate the version record, resolve disputes, or meet legal obligations |
| Encrypted manifestation and Tags bodies | Dedicated private Bunny Storage zone with no public Pull Zone | While active or retained; withdrawn bodies become hard-purge eligible after 30 days unless a legal hold applies |
| One-time encrypted cutover recovery artifact | Separate private Bunny Storage zone with no public Pull Zone | 30 days after verified legacy-plaintext retirement; longer only while an active legal hold applies |
| User emulsion | Cloudflare D1 database at `iconoplasm.brinedew.bio` | Until you change it or request deletion |
| Image provider API keys | Encrypted in Cloudflare D1 database at `iconoplasm.brinedew.bio` | Until you remove them or request deletion |
| Generation and edit jobs | Cloudflare D1 database and image storage | Until removed by site maintenance or deletion request |

## Third Parties

- **Cloudflare**: Infrastructure provider for `iconoplasm.brinedew.bio`. See [Cloudflare's privacy policy](https://www.cloudflare.com/privacypolicy/).
- **Cloudflare Web Analytics**: Used on the website only after analytics consent, for aggregate traffic measurement.
- **Discord**: Used for website login.
- **Image API providers you choose**: Used only when you start direct generation or editing.
- No data is shared with advertisers, analytics providers, or unrelated third parties.

## Your Rights

You can:

- **Clear all local data** by removing the extension or clearing its storage in your browser's extension settings.
- **Remove website settings** such as saved image API keys and your user emulsion in Iconoplasm settings.
- **Withdraw manifestations you wrote** without changing another caretaker's or the system's records, and choose whether to retain or withdraw your manifestation when ending a caretaker assignment.
- **Request deletion** of server-side account, discovery, generation, or settings data by emailing **support@brinedew.bio**. We'll respond within 30 days.

## Children's Privacy

This extension is not directed at children under 13. We don't knowingly collect data from children under 13.

## Changes

We may update this policy. The "Last updated" date at the top will reflect changes.

## Contact

**Email:** support@brinedew.bio

---

*Iconoplasm is a personal project. This policy reflects our commitment to handling your data responsibly and transparently.*
