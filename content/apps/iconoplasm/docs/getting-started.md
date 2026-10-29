---
title: "Getting started"
description: "Install the extension, read a paper with it, and find your way around the site."
docsSection: Start here
docsOrder: 1
docsLabel: "Getting started"
date: 2026-10-23
draft: false
---

# Getting started

Iconoplasm is a browser extension that highlights all the gene names on any web page. When you hover your cursor over any human gene, it shows that gene as a character card.

Steps 1 to 3 happen in your browser, on pages that you already read. Steps 4 to 6 happen on the Iconoplasm website. The numbers in each picture match the numbered list under it.

## 1. Install the extension

![[iconoplasm-start-install.webp|The install card on iconoplasm.brinedew.bio, opened in Chrome|416]]

1. Pick your browser.
2. On Chrome or Brave, click **Download extension file** and follow the five steps under the button.

On Firefox or Edge you can install it in one click from the [Firefox Add-ons](https://addons.mozilla.org/en-US/firefox/addon/iconoplasm-gene-illustrations/) or [Edge Add-ons](https://microsoftedge.microsoft.com/addons/detail/iconoplasm/ocfhohjhkflpmaiimgjfobdoogdfpmog) store. It's also available on mobile Firefox.

## 2. Read a page as usual

Open any page that names human genes. Here it's the table of human Hox clusters in Wikipedia's [Homeobox](https://en.wikipedia.org/wiki/Homeobox) article.

![[iconoplasm-start-wikipedia.webp|Wikipedia's Homeobox article with Iconoplasm installed]]

1. Every human gene symbol gets a color pill. Rest your cursor on one, here **HOXA5**.
2. The gene's character card opens. HOXA5 is a centaur in a magical girl's dress, and her skin is the color of her pill.
3. Gene symbols that start with the same letter share a hue, so the whole Hox array is olive. The pills differ only in how light and how vivid they are.

A pill's color comes from three numbers about the gene:

- **Hue** comes from the first letter of the gene symbol.
- **Saturation** comes from the HPA tau score, which measures how tissue-specific the gene's expression is: from 0 (ubiquitous, gray) to 1 (tissue-specific, saturated).
- **Lightness** comes from gnomAD LOEUF, which measures how well mutations in this gene are tolerated: from 0.0 (intolerable, black) to 2.0 (tolerable, white).

So, looking at a gene symbol pill in your browser, you will be able to deduce:

- black pill? important gene.
- white pill? mutation-tolerant gene.
- vibrantly colored pill? tissue-specific gene.
- gray pill? ubiquitous gene, medium importance.

The essay [[posts/Mnemonic-portraits-for-19023-human-genes|Mnemonic portraits for 19,023 human genes]] explains why each number got its job.

To stop the extension from highlighting a word, click its icon in your browser's toolbar and add the word on the **Blocklist** tab.

## 3. Turn on PDF highlighting

The extension can also highlight gene names inside PDFs, figures included. It replaces the browser's PDF reader with a viewer that is based on pdf.js and that can highlight. This is off until you turn it on.

![[iconoplasm-start-pdf-switch.webp|The Appearance tab in the extension's settings|380]]

1. Click the Iconoplasm icon in your browser's toolbar. On the **Appearance** tab, set **PDF highlighting** to **On**.

If you don't see the **PDF highlighting** row, update your browser to its latest version and look again.

Now open a paper. This one is Sanchez-Vega et al., [Oncogenic Signaling Pathways in The Cancer Genome Atlas](https://doi.org/10.1016/j.cell.2018.03.035), *Cell* 173:321–337 (2018). Its Figure 2A shows how often each gene of the RTK-RAS pathway is altered across 9,125 tumor samples.

![[iconoplasm-start-pdf-figure.webp|Figure 2A of the paper, open in Iconoplasm's PDF reader]]

1. The PDF opens in Iconoplasm's reader instead of the browser's own viewer.
2. Each gene name gets an outline, also inside the figure's boxes.
3. Rest your cursor on one, here **NF1**.
4. NF1's card opens. Her card gives her 319 kg, because the protein weighs 319 kDa. Her skin is a very dark green, because the gene tolerates few mutations. The figure marks NF1 blue, as a tumor suppressor, and her gene card marks her *pro-control* for the same reason.
5. To read this PDF without highlights, click **Use browser PDF viewer** in the top-right corner.

## 4. Collect cards in the Archive

The front page of [iconoplasm.brinedew.bio](https://iconoplasm.brinedew.bio) is the Archive. It's basically a Pokedex system: the genes that you have hovered over get added into your archive gallery.

![[iconoplasm-start-archive.webp|The Archive before you log in]]

1. The number on the **Your discoveries** tab shows how many genes you have found. Rest your cursor on it to see that number out of all 19,381.
2. To see discoveries of others, open the **Global discoveries** tab.
3. You get four starter genes that you probably already know: INS, RHO, PRL and CD4. Rest your cursor on a symbol, or tap it on a phone, and its card turns over below. Click a card to open its gene page.

The genes that you find before you log in show under **Your discoveries**, but only in this browser. To keep them, click **Log in to save** beside the search box, or **Discord Login** in the top-right corner. From then on, each gene that you rest your cursor on for about a second, on any web page or PDF, joins your Archive. The genes that you hovered before you logged in join it too.

## 5. Open a gene page

Clicking on a gene image transfers you to the gene's page. There you will find the gene card, as well as an interface for image generation, editing, transfer and voting.

![[iconoplasm-start-gene-page.webp|HOXA5's gene page]]

1. Click the star to keep this portrait's style (its emulsion) in your favorites. In the free queue, **Add all favorites** puts every favorite in your batch at once.
2. Click the printer to download a print copy: the portrait with the gene's name and symbol printed on it.
3. Click **Add portraits** to request a new portrait for this gene. See [[apps/iconoplasm/docs/request-a-new-portrait|Request a new portrait]].
4. **MISFIT** and **FIT** are your vote on this portrait: **Reject portrait** or **Approve portrait**. The current portrait is the one with the highest approval score.
5. Under the card, **Overview** shows comments and the other candidate portraits for this gene. **Comments** and **Candidates** show one of the two.

## 6. Read the gene card

The gene card is an accession sheet. Each handwritten note on it is a fact about the gene, written as a feature of the character. A portrait that fits its card shows all of them.

![[iconoplasm-start-accession-sheet.webp|HOXA5's gene card]]

| | On the card | Where it comes from | In the portrait |
|---|---|---|---|
| 1 | Swatch `#727A58`, Parrot Green | Hue from the letter H, saturation from HPA tau 0.61, lightness from gnomAD LOEUF 0.996 | Her skin, and her pill on every page |
| 2 | SOLUBLE circled, *female* | Female = soluble protein, male = transmembrane protein | A woman |
| 3 | 1989, *31 y.o.* | Character age = the year when the gene was first noted, counted back from 2020 | A young adult |
| 4 | 29 ~~kDa~~ *kg* | Character weight = protein mass: 29 kDa becomes 29 kg | A slight build |
| 5 | HELIX-TURN-HELIX, *Magical Girl* | Fashion style = Pfam clan | The wand, the star and the frilly dress |
| 6 | *centaur* | Fantastic feature = gene symbol stem. All four Hox families, HOXA to HOXD, are centaurs | The horse's body |
| 7 | ~~ONCOGENE~~ ~~TUMOR SUPPRESSOR~~ | HOXA5 is listed as neither. On a tumor suppressor such as TP53, TUMOR SUPPRESSOR is circled and marked *pro-control* | |
| 8 | MISFIT / FIT | Your vote: does this portrait show its card? | |

## Next steps

- [[apps/iconoplasm/docs/request-a-new-portrait|Request a new portrait]] for free, in about 5 minutes.
- [[apps/iconoplasm/docs/edit-and-vote-on-portraits|Edit and vote on portraits]].
- [[apps/iconoplasm/docs/get-an-api-key|Get an API key]] to get a portrait in 1-2 minutes.
- [[apps/iconoplasm/docs/Caretakers Handbook|Become a gene's caretaker]].
