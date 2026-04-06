---
title: "Privacy Policy — Iconoplasm Browser Extension"
description: "How the Iconoplasm browser extension handles your data"
date: 2026-04-06
draft: false
---

# Privacy Policy — Iconoplasm Browser Extension

**Last updated:** April 6, 2026

This policy describes what data the Iconoplasm browser extension collects and how it's handled.

## What the Extension Does

Iconoplasm scans web pages you visit for human gene symbols (like TP53, BRCA1). When it finds them, it highlights the text and shows hover cards with the gene's assigned color identity and portrait image. It also tracks which genes you've encountered (your "discovery" count).

## Data Collected

### Page Content (read locally, never transmitted)

The extension reads the text content of pages you visit to find gene symbol matches. **This text never leaves your browser.** Gene matching happens entirely on your device using a local trie data structure.

### Gene Symbol Lists (sent to our server)

When the extension finds gene symbols on a page, it sends those symbols — and only those symbols — to `iconoplasm.brinedew.bio` to fetch color data and portrait images. We do not send the URL you're visiting, the page content, or any other browsing data.

### Discovery Encounters (optional, sent to our server)

If you're signed in via Discord, the extension reports which gene symbols you've encountered so your discovery count syncs across devices. If you're not signed in, discoveries are stored locally in `chrome.storage.local` and never leave your browser.

### Preferences (stored locally)

Your settings — highlight mode, tooltip theme, card variant, and blocklist — are stored in `chrome.storage.local` on your device. They are not transmitted to any server.

## What We Don't Collect

- **Browsing history**: We never see which URLs you visit.
- **Page content**: The full text of pages stays on your device.
- **Personal information**: The extension itself doesn't collect names, emails, or identifiers. (If you sign in via Discord on the Iconoplasm website separately, that's covered by the site's own authentication — the extension only passes along the existing session cookie.)
- **Analytics or telemetry**: No usage tracking, no crash reports, no third-party analytics.

## Network Requests

The extension makes requests only to `iconoplasm.brinedew.bio`:

| Request | What's Sent | When |
|---------|-------------|------|
| Gene batch lookup | List of gene symbols found on the current page | When you visit a page with gene symbols |
| Portrait image fetch | Gene symbol | When a hover card is shown |
| Discovery encounter | Gene symbol | When a gene is first encountered (signed-in users only) |
| Discovery state sync | Session cookie | On page load (signed-in users only) |

No requests are made to any other domain.

## Content Script Scope

The extension's content script runs on all web pages (except `iconoplasm.brinedew.bio` and `staging.brinedew.bio`, which are excluded). This broad scope is necessary because gene symbols can appear on any website — research papers, Wikipedia articles, databases, forums, etc. The content script only reads text nodes to find gene symbols; it does not read form inputs, passwords, or other sensitive page elements.

## Data Storage

| What | Where | Duration |
|------|-------|----------|
| Display preferences | `chrome.storage.local` | Until you change them |
| Blocklist customizations | `chrome.storage.local` | Until you change them |
| Guest discoveries | `chrome.storage.local` | Until you sign in (merged to server) or clear extension data |
| Signed-in discoveries | Cloudflare D1 database at `iconoplasm.brinedew.bio` | Until you request deletion |

## Third Parties

- **Cloudflare**: Infrastructure provider for `iconoplasm.brinedew.bio`. See [Cloudflare's privacy policy](https://www.cloudflare.com/privacypolicy/).
- No data is shared with advertisers, analytics providers, or any other third parties.

## Your Rights

You can:

- **Clear all local data** by removing the extension or clearing its storage in your browser's extension settings.
- **Request deletion** of server-side discovery data by emailing **support@brinedew.bio**. We'll respond within 30 days.

## Children's Privacy

This extension is not directed at children under 13. We don't knowingly collect data from children under 13.

## Changes

We may update this policy. The "Last updated" date at the top will reflect changes.

## Contact

**Email:** support@brinedew.bio

---

*Iconoplasm is a personal project. This policy reflects our commitment to handling your data responsibly and transparently.*
