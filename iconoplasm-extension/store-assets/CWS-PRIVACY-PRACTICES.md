# Chrome Web Store: Privacy practices tab

Answers for the Chrome Web Store developer dashboard's **Privacy practices** tab, for Iconoplasm 0.5.10 (B-1009). The fields follow Google's [Privacy practices tab](https://developer.chrome.com/docs/webstore/cws-dashboard-privacy) documentation, checked 2026-10-05. The facts come from `iconoplasm-extension/manifest.json` and the live privacy policy at https://iconoplasm.brinedew.bio/privacy, and every sentence below uses their wording. If either changes, update this file in the same change.

## Single purpose

Highlights gene symbols on any page with hover cards, portraits, and gene colors.

## Permission justifications

| Permission                                     | Justification                                                                                                                                                            |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `storage`                                      | Stores display preferences (highlight mode, tooltip theme, blocklist) and, for guests, discoveries in local browser storage.                                             |
| Host `https://iconoplasm.brinedew.bio/*`       | Fetches card data for the gene symbols found on the page, and syncs discoveries for users who sign in.                                                                   |
| Host `https://iconoplasmportraits.b-cdn.net/*` | Loads the gene portrait images shown in hover cards.                                                                                                                     |
| Content scripts on `<all_urls>`                | Scans the page the user is reading for gene symbols and highlights matches. Gene matching happens entirely on the user's device; the page text never leaves the browser. |

## Remote code

**No, I am not using remote code.** Every script is packaged in the extension. The service worker's `importScripts` calls load packaged files only.

## Data usage

Tick these and leave the rest unticked:

- **Website content**: the gene symbols found on a page are sent to fetch their cards.
- **Personally identifiable information**: only for users who sign in via Discord. The Discord user ID, username and avatar URL are stored on the server.

Judgement calls (agent's reading, 2026-10-05): ticking "Website content" is conservative, because only gene symbols leave the device, not the page text. "Personally identifiable information" applies only after a Discord sign-in. Ticking both keeps the disclosure at least as wide as the privacy policy, which is what Google checks the disclosures against. "Web history" and "User activity" stay unticked: the policy says "We never see which URLs you visit", and there is no usage tracking.

Certify all three statements: the data isn't sold to third parties, isn't used for purposes unrelated to the single purpose, and isn't used to determine creditworthiness or for lending.

## Privacy policy URL

https://iconoplasm.brinedew.bio/privacy

## Owner's steps in the dashboard

1. Register a developer account at https://chrome.google.com/webstore/devconsole and pay the one-time fee (the amount is shown in the form).
2. **New item**: upload `quartz/static/iconoplasm/downloads/iconoplasm-extension-v0.5.10.zip`, also live at https://iconoplasm.brinedew.bio/static/iconoplasm/downloads/iconoplasm-extension-v0.5.10.zip.
3. **Store listing**: paste from `STORE-LISTING-COPY.md`, and upload the screenshots and promo tiles in this folder.
4. **Privacy practices**: paste the answers above.
5. Submit for review. When it's approved, the agent switches the homepage's Chrome install panel to the store link (B-1009).
