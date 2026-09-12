---
title: Mosaic vs regulative development spectrum
tags:
  - content/wiki
date: 2026-09-13
draft: true
aliases:
  - Mosaic development
  - Regulative development
---
# Mosaic vs regulative development spectrum

**Mosaic and regulative development** are the two ends of a spectrum of cell fate specification in animal embryos. In mosaic (autonomous) development, a cell's fate follows from maternal determinants that the egg localizes and that dividing cells pass to their daughters. In regulative (conditional) development, a cell's fate follows from signals exchanged with neighboring cells after each division. The modes separate cleanly when cells are moved or destroyed: a strictly mosaic embryo that loses a cell leaves the corresponding structure missing, while a strictly regulative embryo redistributes fates and builds a complete, smaller animal. Most embryos combine both strategies, and the balance varies with tissue, developmental stage, and species.[^1][^2]

![[mosaic-regulative-modes.png|Schematic of the two modes. Mosaic mode distributes fate determinants down a lineage tree; regulative mode assigns fates through signals exchanged between neighboring cells. From Song and Villoutreix, 2025, *PLOS Computational Biology* (CC BY 4.0).]]

## Evidence

Experimental embryologists tested a blastomere's fate by deleting or isolating it and watching what the remaining cells build.[^3] In 1888, Wilhelm Roux destroyed one blastomere of a two-cell frog embryo with a hot needle; the survivor developed into a half-embryo, and Roux took the result as evidence that each blastomere carries instructions for a predetermined share of the body.[^3][^4] In 1891, Hans Driesch separated the first two and then four blastomeres of sea urchin embryos; each isolated blastomere produced a complete but smaller pluteus larva.[^5][^6] Half-embryo versus whole-embryo became the operational test separating the two modes.[^1][^2]

![[sea-urchin-halved-embryo.png|A sea urchin embryo is split into half-embryos at the two-cell stage; each half develops into a complete pluteus larva. From Suzuki et al., 2025, *Nature Communications* (CC BY 4.0).]]

Roux's result reflected his method: his needle left cytoplasm of the destroyed cell in contact with the survivor, and that residue interfered with its development. When frog blastomeres are separated cleanly, each forms a complete tadpole, which places the frog on the regulative side. Strongly mosaic embryos occur in tunicates, spiralians (mollusks, annelids, and their relatives), and nematodes.[^3]

Modern repeats of Driesch's experiment follow the isolated blastomeres through development. Isolated two-cell sea urchin blastomeres first spread into a flat sheet of cells, round up into a half-sized blastula, transiently lose their anterior–posterior axis, then re-establish it and gastrulate on the normal schedule; from the blastula stage onward they form a pluteus larva in the same way intact embryos do.[^7] The classical assays work at low cell numbers and become unmanageable as the embryo grows larger, which is why recent work measures mosaic and regulative contributions statistically from single-cell data.[^1]

The nematode *C. elegans* shows the mosaic pattern in its extreme form: development follows an invariant lineage, which [[Cell lineage recorders|lineage tracing]] has mapped cell by cell, and cell ancestry and fate stay tightly correlated across individuals.[^8]

## Mechanism

### Autonomous specification

Autonomous specification works through materials the egg stores before fertilization and distributes to daughter cells at division.[^9]

- **Tunicate *Styela partita*:** yellow cytoplasm concentrates at the vegetal pole, segregates into the blastomeres that form muscle, and its removal prevents muscle from forming; the mRNA *macho-1* localizes inside that cytoplasm and is required for muscle fate.
- ***C. elegans*:** PAR proteins polarize the zygote and confine P granules and other germline factors to the posterior blastomere, while PIE-1 and MEX-5/6 partition unequally and SKN-1 is enriched in the P1 daughter that produces the pharynx.
- **Snail *Ilyanassa*:** a polar lobe sequesters cortical material into one daughter cell and supplies the input that activates the MAPK (mitogen-activated protein kinase) pathway specifying fate.

Each division hands the daughters a specific inheritance, so an isolated blastomere continues on the trajectory it would have followed inside the embryo.[^3][^9]

### Conditional specification

Conditional specification works through interactions between cells after they are born. Grafting the dorsal blastopore lip of one amphibian gastrula onto the flank of another embryo induces host cells near the graft to build a second body axis, which shows cells adopting fates according to signals from their new neighbors.[^10] In *C. elegans*, the two AB descendants are born with equal potential; the one that sits against the P2 blastomere receives the Notch ligand APX-1 through the GLP-1 receptor and becomes ABp, and displacing blastomeres shifts which cell receives the signal.[^11] Positional information carried by morphogen gradients gives cells a readout of their location, a model that explains how pattern forms during development and re-forms after perturbation.[^12]

Potency narrows as cleavage proceeds: by the sixteen-cell stage each tier is restricted, though the cells retain limited plasticity, and mammalian embryos lose plasticity as the blastocyst forms.[^13]

## Spectrum

Most embryos combine both strategies.[^1][^2] *C. elegans* follows its invariant lineage and still uses induction in specific lineages: the ABp fate comes from an APX-1 signal, muscle formation in AB descendants requires interaction with P1 or EMS, and gut development depends on inductive interactions; displaced blastomeres can adopt fates other than their normal ones.[^11] Sea urchin embryos partition maternal determinants to establish the animal–vegetal axis and isolate a vegetal domain through stereotyped asymmetric divisions, all while retaining the ability to build a whole larva from an isolated blastomere.[^9][^13] Mammalian two-cell blastomeres inherit animal and vegetal materials unevenly and differ reciprocally in potency from the start.[^14]

Position on the spectrum varies by tissue and stage as much as by species. A statistical decomposition of *C. elegans* development assigns most tissue determination to lineage-inherited contributions, with context-dependent contributions taking over at the end of skin determination.[^1] Two annelids that share spiral cleavage specify their embryonic organizer at different times, and their transcriptional dynamics diverge accordingly until the programs converge at gastrulation.[^15] Dissociated cells of the sea anemone *Nematostella vectensis* reaggregate and rebuild body axes using Wnt signals from cells that had constituted the blastopore lip organizer.[^16]

## Consequences

Regulative embryos tolerate splitting. Human identical twins form when an early mammalian embryo splits;[^5] shaking apart the first two or four sea urchin blastomeres yields two, three, or four complete plutei;[^12] and separating mouse blastomeres was the classical route to experimental twins, while more recent work finds the two blastomeres differ in their ability to produce a live animal.[^14]

Mosaic embryos trade that flexibility for precision. Isolated blastomeres of the annelid *Lanice* form partial larvae, and deleting an eye-progenitor blastomere in *Capitella teleta* at the sixteen-cell stage produces lasting defects.[^3] Mosaic animals also tend toward [[eutely]], a fixed number of somatic cells; regulative embryos absorb extra or missing cells, whether the egg is cut in half or its chromosome number changes.[^2]

Embryonic plasticity and adult regeneration are separate capacities. A frog embryo cut in half at the eight-cell stage develops into a complete tadpole, while an amputated limb heals into scar tissue in the adult frog; the annelid *Tubifex tubifex* regenerates a whole worm from either half of a bisected adult.[^3]

## Evolution

Regulative capacity appears to be the ancestral state: cnidarians, an early-diverging animal lineage, rebuild axes from reaggregated cells, and this plasticity and the capacity for regulative development were likely present at the earliest stages of animal evolution.[^16] Mosaic development is concentrated in tunicates, spiralians, and nematodes, lineages whose cleavage programs are invariant.[^3]

Specification mode shapes how development evolves. In two annelids with the same spiral cleavage but different specification modes, early transcriptional dynamics diverge and then converge at gastrulation, so the mode of specification leaves a measurable signature on the evolution of the developmental program.[^15] Across lineages, mosaic development goes with invariant cleavage and eutely, and regulative capacity goes with adult regenerative ability.[^2][^3]

## See also

- [[eutely]]
- [[Cell lineage recorders]]

## Citations

[^1]: Song S, Villoutreix P. "Assessing the relative contributions of mosaic and regulatory developmental modes from single-cell trajectories." *PLOS Computational Biology*. 2025;21(12):e1012352. [doi:10.1371/journal.pcbi.1012352](https://doi.org/10.1371/journal.pcbi.1012352).

> [!info]- Primary source excerpt (Song & Villoutreix, 2025 — the two modes)
> ![[song2025-p2-b6-86e3307ba3.png|Song & Villoutreix, 2025 — regulative development depends on interactions with the environment, and both modes often co-exist.]]
>
> **OCR excerpt:** "the fate of a cell depends on its interactions with its environment. Both modes often co-exist" (`doc:song2025/page:2/block:6`)

[^2]: Alicea B, Gordon R. "Quantifying Mosaic Development: Towards an Evo-Devo Postmodern Synthesis of the Evolution of Development via Differentiation Trees of Embryos." *Biology (Basel)*. 2016;5(3):33. [doi:10.3390/biology5030033](https://doi.org/10.3390/biology5030033).

> [!info]- Source excerpt (Alicea & Gordon, 2016 — cutting an embryo in two, and the eutely association)
> ![[alicea2016-intro.png|Alicea & Gordon, 2016 — regulative embryos cut in two produce whole embryos, mosaic embryos produce half embryos; mosaic organisms tend to be eutelic, and regulating embryos adjust to cell number.]]
>
> **Excerpt:** "This is seen most dramatically if an early embryo is cut in two: regulative embryos produce two smaller, but whole embryos, whereas mosaic embryos produce two half embryos. … Organisms that develop in a mosaic fashion also tend to be eutelic, having a fixed number of cells per adult individual across a particular species, whereas regulating embryos easily adjust to the number of cells available, whether varied by cutting or by ploidy." (Screenshot taken from the publisher's HTML edition; OCR packaging was unavailable for this source.)

[^3]: Rock AQ, Srivastava M. "The gain and loss of plasticity during development and evolution." *Trends in Cell Biology*. 2025;35(10):823–839. [doi:10.1016/j.tcb.2025.01.008](https://doi.org/10.1016/j.tcb.2025.01.008).

> [!info]- Primary source excerpt (Rock & Srivastava, 2025 — Roux's half-embryo and its correction)
> ![[rock2025-p21-b4-6a0c6a1982.png|Rock & Srivastava, 2025 — Roux left exogenous cytoplasm from the cytolyzed blastomere in contact with the survivor, and it interfered with development.]]
>
> **OCR excerpt:** "Roux had failed to fully isolate the blastomere, leaving behind exogenous cytoplasm from the cytolyzed blastomere" (`doc:rock2025/page:21/block:4`)

[^4]: Roux W. "Beiträge zur Entwickelungsmechanik des Embryo." *Archiv für pathologische Anatomie und Physiologie und für klinische Medicin*. 1888;114:246–291.

[^5]: Suzuki H, Yaguchi J, Tsuyuzaki K, Yaguchi S. "Unraveling the regulative development and molecular mechanisms of identical sea urchin twins." *Nature Communications*. 2025;16:8005. [doi:10.1038/s41467-025-63111-z](https://doi.org/10.1038/s41467-025-63111-z).

> [!info]- Primary source excerpt (Suzuki et al., 2025 — Driesch's experiment and identical twins)
> ![[suzuki2025-p1-b8-c691e3eb28.png|Suzuki et al., 2025 — Driesch's 1891 isolation of sea urchin blastomeres, and the link between self-organization and identical twins.]]
>
> **OCR excerpt:** "In 1891, Hans Driesch demonstrated that isolated 2-cell and 4-cell stage sea urchin blastomeres can each develop into a complete individual" (`doc:suzuki2025/page:1/block:8`)

[^6]: Driesch H. "Entwicklungsmechanische Studien I, II." *Zeitschrift für wissenschaftliche Zoologie*. 1891;53:160–184.

[^7]: Suzuki H, Yaguchi J, Tsuyuzaki K, Yaguchi S. "Unraveling the regulative development and molecular mechanisms of identical sea urchin twins." *Nature Communications*. 2025;16:8005. [doi:10.1038/s41467-025-63111-z](https://doi.org/10.1038/s41467-025-63111-z).

> [!info]- Primary source excerpt (Suzuki et al., 2025 — the halved embryo rejoins the normal program)
> ![[suzuki2025-p2-b5-81f524b533.png|Suzuki et al., 2025 — once the blastula has formed, halved embryos gastrulate and form a pluteus like intact embryos.]]
>
> **OCR excerpt:** "such as mesenchyme cell ingression, gastrulation, and pluteus" (`doc:suzuki2025/page:2/block:5`)

[^8]: Rothman J, Jarriault S. "Developmental Plasticity and Cellular Reprogramming in *Caenorhabditis elegans*." *Genetics*. 2019;213(3):723–757. [doi:10.1534/genetics.119.302333](https://doi.org/10.1534/genetics.119.302333). The original lineage maps: Sulston JE, Horvitz HR. *Developmental Biology*. 1977;56(1):110–156; Sulston JE, Schierenberg E, White JG, Thomson JN. *Developmental Biology*. 1983;100(1):64–119.

> [!info]- Primary source excerpt (Rothman & Jarriault, 2019 — invariant lineage)
> ![[rothman2019-p4-b8-838ffa56ca.png|Rothman & Jarriault, 2019 — cell ancestry and fate stay correlated, and cell positioning is largely invariant across C. elegans embryos.]]
>
> **OCR excerpt:** "cell ancestry and cell fate, as well as largely invariant cell positioning" (`doc:rothman2019/page:4/block:8`)

[^9]: Rock AQ, Srivastava M. "The gain and loss of plasticity during development and evolution." *Trends in Cell Biology*. 2025;35(10):823–839. [doi:10.1016/j.tcb.2025.01.008](https://doi.org/10.1016/j.tcb.2025.01.008).

> [!info]- Primary source excerpt (Rock & Srivastava, 2025 — maternal determinants)
> ![[rock2025-p8-b4-9c238c3def.png|Rock & Srivastava, 2025 — macho-1 localizes to the yellow cytoplasm of the tunicate egg and is required for muscle fate.]]
>
> **OCR excerpt:** "macho-1 is maternally-loaded and localized within the yellow cytoplasm" (`doc:rock2025/page:8/block:4`)

[^10]: Spemann H, Mangold H. "Induction of embryonic primordia by implantation of organizers from a different species" (1923). *International Journal of Developmental Biology*. 2001;45(1):13–38.

> [!info]- Source excerpt (Rock & Srivastava, 2025 — the Spemann–Mangold organizer graft)
> ![[rock2025-p22-b2-71e9580fb1.png|Rock & Srivastava, 2025 — the transplanted Spemann–Mangold organizer induces surrounding host cells to build a secondary axis.]]
>
> **OCR excerpt:** "The transplanted piece of tissue, the Spemann-Mangold organizer, is able to induce surrounding cells" (`doc:rock2025/page:22/block:2`)

[^11]: Rothman J, Jarriault S. "Developmental Plasticity and Cellular Reprogramming in *Caenorhabditis elegans*." *Genetics*. 2019;213(3):723–757. [doi:10.1534/genetics.119.302333](https://doi.org/10.1534/genetics.119.302333).

> [!info]- Primary source excerpt (Rothman & Jarriault, 2019 — induction of ABp)
> ![[rothman2019-p8-b7-6a097ac329.png|Rothman & Jarriault, 2019 — the AB descendant that contacts P2 receives the Notch ligand APX-1 and becomes ABp.]]
>
> **OCR excerpt:** "only the posterior one contacts P2, which expresses the Notch ligand APX-1" (`doc:rothman2019/page:8/block:7`)

[^12]: Drozdov A, Lebedev E, Adonin L. "Comparative Analysis of Bivalve and Sea Urchin Genetics and Development: Investigating the Dichotomy in Bilateria." *International Journal of Molecular Sciences*. 2023;24(24):17163. [doi:10.3390/ijms242417163](https://doi.org/10.3390/ijms242417163).

> [!info]- Primary source excerpt (Drozdov et al., 2023 — complete larvae from divided blastomeres)
> ![[drozdov2023-p3-b3-a516b8d8c7.png|Drozdov et al., 2023 — dividing the first two or four blastomeres yields two, three, or four complete pluteus larvae.]]
>
> **OCR excerpt:** "It is possible to obtain two, three, or four fully formed larvae at the pluteus stage" (`doc:drozdov2023/page:3/block:3`)

[^13]: Rock AQ, Srivastava M. "The gain and loss of plasticity during development and evolution." *Trends in Cell Biology*. 2025;35(10):823–839. [doi:10.1016/j.tcb.2025.01.008](https://doi.org/10.1016/j.tcb.2025.01.008).

> [!info]- Primary source excerpt (Rock & Srivastava, 2025 — progressive loss of potency)
> ![[rock2025-p7-b3-ca21788e4b.png|Rock & Srivastava, 2025 — at the sixteen-cell stage every tier has restricted potency, and the cells keep limited plasticity.]]
>
> **OCR excerpt:** "producing an embryo where no tier is totipotent, but the cells still retain limited plasticity" (`doc:rock2025/page:7/block:3`)

[^14]: Nolte T, Halabian R, Israel S, Suzuki Y, Avelar RA, Palmer D, Fuellen G, Makalowski W, Boiani M. "Animal and vegetal materials of mouse oocytes segregate at first zygotic cleavage: a simple mechanism that makes the two-cell blastomeres differ reciprocally from the start." *Molecular Human Reproduction*. 2025;31(1):gaae045. [doi:10.1093/molehr/gaae045](https://doi.org/10.1093/molehr/gaae045). For the classical mouse blastomere separation experiments, see Tarkowski AK. *Nature*. 1959;184:1286–1287.

> [!info]- Primary source excerpt (Nolte et al., 2025 — sister blastomeres differ)
> ![[nolte2025-p2-b6-414803818d.png|Nolte et al., 2025 — after separation at the two-cell stage, usually a single mouse blastomere develops into a viable blastocyst or a live mouse.]]
>
> **OCR excerpt:** "only one blastomere is able to develop into a viable blastocyst or a live mouse" (`doc:nolte2025/page:2/block:6`)

[^15]: Liang Y, Wei J, Kang Y, Carrillo-Baltodano AM, Martín-Durán JM. "Cell fate specification modes shape transcriptome evolution in the highly conserved spiral cleavage." *EMBO Reports*. 2025;26(20):5088–5114. [doi:10.1038/s44319-025-00569-4](https://doi.org/10.1038/s44319-025-00569-4).

> [!info]- Primary source excerpt (Liang et al., 2025 — specification modes compared)
> ![[liang2025-p1-b5-43c30e328e.png|Liang et al., 2025 — two annelids share spiral cleavage but specify their primary progenitor cells differently.]]
>
> **OCR excerpt:** "with spiral cleavage but different modes of specifying their primary progenitor cells" (`doc:liang2025/page:1/block:5`)

[^16]: Kirillova A, Genikhovich G, Pukhlyakova E, Demilly A, Kraus Y, Technau U. "Germ-layer commitment and axis formation in sea anemone embryonic cell aggregates." *Proceedings of the National Academy of Sciences of the USA*. 2018;115(8):1813–1818. [doi:10.1073/pnas.1711516115](https://doi.org/10.1073/pnas.1711516115).

> [!info]- Primary source excerpt (Kirillova et al., 2018 — regulative capacity was present early)
> ![[kirillova2018-p6-b1-7cbb59b253.png|Kirillova et al., 2018 — plasticity and the capacity for regulative development were likely present at the earliest stages of animal evolution.]]
>
> **OCR excerpt:** "the capacity for regulative development were present already at the earliest stages of animal evolution" (`doc:kirillova2018/page:6/block:1`)
