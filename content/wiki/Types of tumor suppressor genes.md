---
title: Types of tumor suppressor genes
tags:
  - content/wiki
date: 2025-12-09
draft: true
aliases:
  - 
---
# Types of tumor suppressor genes

The **types of tumor suppressor genes** most commonly distinguished in cancer biology are gatekeeper, caretaker, and landscaper genes. They differ by the control that is lost when a gene is inactivated: direct growth restraint, genome maintenance, or regulation of the surrounding tissue.

![[deininger1999-tumor-suppressor-inactivation.jpg|A common tumor-suppressor failure mode: one copy is deleted and the remaining copy is mutated, ending the cell's supply of the inhibitory gene product. From Deininger, 1999.]]

## Classification

Tumor suppressor genes are grouped by the control that is lost when the gene is inactivated:

- **Gatekeepers:** restrain the potentially malignant cell itself by limiting division, enforcing cell-cycle arrest, or promoting apoptosis.
- **Caretakers:** maintain genome stability and lower the rate at which later driver mutations appear.
- **Landscapers:** regulate the tissue environment around the potentially malignant cell.

Kinzler and Vogelstein introduced the gatekeeper/caretaker distinction in the late 1990s, and later reviews treat landscapers as a third functional class.[^1][^4]

A cell carries two alleles of each tumor suppressor. A mutation that inactivates one allele leaves the second allele producing functional protein, so the suppressor's growth-restraining activity survives the first hit. In the classic two-hit pattern the cell loses that activity only when a second event inactivates the remaining allele.[^3]

## Gatekeeper genes

Gatekeeper genes restrain the expansion of abnormal cells. When both alleles are inactivated, the cell loses a brake on proliferation. The failure is cell-autonomous: the abnormal clone persists longer and acquires later changes.

Common gatekeeper examples include:

- **APC:** an initiation gatekeeper in colorectal epithelium; APC loss can allow colon crypt cells to form adenomas.
- **[[rb-rb1|RB1]]:** gates the G1/S transition by controlling E2F-dependent cell-cycle entry.
- **[[p53-tp53|p53]]:** a broader progression gatekeeper; DNA damage, oncogene stress, and other signals can feed into p53-mediated arrest, senescence, or apoptosis.

Gatekeeper loss is rate-limiting in a tissue that already contains dividing cells, because the lost gatekeeper had been the one deciding which of those cells may keep dividing.[^2]

## Caretaker genes

Caretaker genes maintain the genome from which later cancer mutations are drawn. Their loss lets later mutations accumulate, so a subsequent mutation, deletion, rearrangement, or replication error can reach a gatekeeper, an oncogene, or another cancer-relevant system.

Common caretaker examples include:

- **DNA mismatch repair genes:** defective mismatch repair lets replication errors persist, producing microsatellite instability and a higher mutation supply.
- **BRCA1 and BRCA2:** homologous recombination repair helps maintain chromosome integrity.
- **[[atm|ATM]] and [[atr|ATR]]:** DNA damage response kinases that help coordinate checkpoint and repair programs after damage.

A defective caretaker supplies a clone with a larger mutation pool, so later driver mutations surface more often and a gatekeeper or oncogene hit grants the growth advantage more easily. Caretaker loss touches more tissue types, since each renewing tissue depends on replication fidelity and repair.[^2][^3]

## Landscaper genes

Landscaper genes regulate the tissue environment around epithelial cells. A mutated landscaper makes the local microenvironment friendlier to neoplastic growth. Reviews describe this class as genes whose loss changes extracellular matrix proteins, cell-surface markers, adhesion molecules, growth factors, and neighboring stromal cells.[^4]

Epithelial cells grow in a structured neighborhood of basement membrane, stromal cells, immune cells, mechanical constraints, soluble signals, and adhesion cues. When the neighborhood changes, a clone picks up survival, growth, or invasion support from its surroundings.

Landscaper loss acts through the tissue before it acts through the epithelial clone:

1. A gene that normally maintains stromal or extracellular-matrix conditions is inactivated.
2. The local tissue environment changes.
3. Epithelial cells that would otherwise be restrained receive more survival, growth, or invasion support.

A cell found in a cancer may be important in three ways:

- It changes the cell itself.
- It changes how the cell communicates with the stroma.
- It reflects a changed tissue environment.

## Boundary cases

[[p53-tp53|p53]] spans two classes. As a gatekeeper it stops damaged or stressed cells from expanding. It also shows caretaker-like effects, because p53 signaling shapes DNA damage responses and genomic stability.[^2] NF1 sits in the gatekeeper and landscaper classes in some contexts.[^4]

A gene can contribute through one or several mechanisms: enforcing a cell-cycle checkpoint, repairing DNA damage, maintaining cell adhesion, or transmitting signals that reshape the local tissue. The class follows the cancer-preventing function lost in a given tissue and stage.

## Consequences

Each class makes a different first prediction:

| Class | First prediction | Measurement |
|---|---|---|
| Gatekeeper | clonal expansion | proliferation, arrest |
| Caretaker | higher supply of later mutations | mutation burden, repair defects |
| Landscaper | changed tissue context | stromal or extracellular-matrix changes |

The [[tumor-suppressor-theory-of-aging|tumor suppressor theory of aging]] uses the same split. A gatekeeper-heavy tissue may suppress cancer by arresting or killing damaged cells. The same response depletes proliferative capacity or accumulates senescent cells. A caretaker-heavy tissue may postpone cancer by keeping the mutation supply low. A tissue whose landscape shifts with age may grow permissive before a clone has acquired every cell-autonomous advantage.

## References

[^1]: Kinzler KW, Vogelstein B. *Cancer-susceptibility genes. Gatekeepers and caretakers*. Nature. 1997;386(6627):761-763. [doi:10.1038/386761a0](https://doi.org/10.1038/386761a0). [PubMed](https://pubmed.ncbi.nlm.nih.gov/9126728/).

[^2]: Harris VK, Schiffman JD, Boddy AM. *Evolution of Cancer Defense Mechanisms Across Species*. 2017.

> [!info]- Source excerpt (Harris et al., 2017)
> ![[valerieharris2017-p5-b6-c5e6b7de77.png|Harris et al., 2017 — passage defining gatekeeper tumor suppressor genes.]]
>
> **OCR excerpt:** "Gatekeepers serve to prevent cancer by directly inhibiting the growth of dysplastic cells through arrested mitosis or apoptosis." (`doc:valerieharris2017/page:5/block:6`)

[^3]: Deininger P. *Genetic Instability in Cancer: Caretaker and Gatekeeper Genes*. Ochsner Journal. 1999;1(4):206-209. [PMC](https://pmc.ncbi.nlm.nih.gov/articles/PMC3145442/).

> [!info]- Review excerpt (Deininger, 1999)
> ![[deininger1999-caretaker-passage.png|Deininger, 1999 — passage defining caretaker genes and their mutation-suppressing role.]]
>
> **HTML excerpt:** "Caretaker genes are genes responsible for keeping other genes healthy (i.e. suppressing mutation)." (`https://pmc.ncbi.nlm.nih.gov/articles/PMC3145442/`, Caretaker Genes section)

[^4]: Rajabi S, Alix-Panabières C, Sharbatdar Alaei A, et al. *Looking at Thyroid Cancer from the Tumor-Suppressor Genes Point of View*. Cancers. 2022;14(10):2461. [doi:10.3390/cancers14102461](https://doi.org/10.3390/cancers14102461). [PMC](https://pmc.ncbi.nlm.nih.gov/articles/PMC9139614/).

> [!info]- Review excerpt (Rajabi et al., 2022)
> ![[rajabi2022-landscaper-passage.png|Rajabi et al., 2022 — passage defining landscaper tumor suppressor genes and their microenvironmental mechanism.]]
>
> **HTML excerpt:** "When mutated, these genes contribute to tumor growth by creating a favorable microenvironment for uncontrolled cell proliferation... the mechanisms of action of landscaper genes involve the direct or indirect regulation of extracellular matrix proteins, cell-surface markers, adhesion molecules, and growth factors." (`https://pmc.ncbi.nlm.nih.gov/articles/PMC9139614/`, section 2.3)
