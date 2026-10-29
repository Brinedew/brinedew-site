# Chrome Web Store listing

The listing copies the live Edge listing (`EDGE-LISTING-COPY.md`), adjusted to the Chrome Web Store's fields.

- Item ID: `hphoofaocpclmdnhknicfpfjleifpppj`
- Dashboard: https://chrome.google.com/webstore/devconsole/823a405e-3908-4ac8-9c05-2e01a5319890/hphoofaocpclmdnhknicfpfjleifpppj/edit/listing
- Publisher: Brinedew.bio (non-trader)

## Summary

The store takes the summary from `manifest.json`'s `description`.

## Description

```
* Turn gene names on any web page into a cast of intracellular characters.
* Hover over a gene symbol to see the mnemonic character card.
* Tap the hover card to jump to the full Iconoplasm gene page.
* Collect found genes in your personal gene library.
* Connect with other Iconoplasm users on Discord to pick the most representative gene illustrations.
```

## Fields

- Category: Education
- Language: English (United States)
- Homepage: https://iconoplasm.brinedew.bio/
- Support: https://iconoplasm.brinedew.bio/docs/faq

The store's checker doesn't follow redirects. It refused `https://brinedew.bio/wiki/iconoplasm-faq` (a 301 to the address above) as "Support URL is not reachable", so every URL here must answer 200 directly.

## Images

- Icon: `../icons/icon-128.png`
- Screenshots, 1280 x 800: `amo/amo-screenshot-1-hovercard.png`, `amo/amo-screenshot-2-hovercard-alt.png`, `amo/amo-screenshot-3-archive.png` (made by `generate-amo-screenshots.mjs`)
- Small promo tile, 440 x 280: `promo-small.png`
- Marquee, 1400 x 560: `promo-marquee.png`

## Distribution

Free of charge, Public, all regions, published automatically once review passes.

The review is the slow, in-depth kind, because the extension asks for access to every site. That access is the product: the extension highlights genes on whatever page the reader opens, so narrowing it to `activeTab` or a site list would turn automatic highlighting into a button press.
