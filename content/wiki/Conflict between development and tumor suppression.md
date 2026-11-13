---
title: Conflict between development and tumor suppression
tags:
  - content/wiki
date: 2026-11-07
draft: true
vital_level: 1
class: C
aliases:
  - Development vs tumor suppression
---
# Conflict between development and tumor suppression

The **evolutionary trade-off between development and tumor suppression** is a biological conflict in metazoans between the cellular processes required for embryonic growth, tissue morphogenesis, and regeneration, and the physiological mechanisms that prevent neoplastic transformation.[^Pardal2005] The cellular behaviors essential for building and maintaining an organism—such as rapid cell division, tissue invasion, matrix remodeling, metabolic restructuring, and phenotypic plasticity—are functionally homologous to the hallmarks of cancer.[^Weinberg2011]

To maintain organismal viability through reproductive age, multicellular species evolved genomic networks of [[Types of tumor suppressor genes|tumor suppressor genes]], cell cycle checkpoints, and epigenetic boundaries. However, stringent activation of these pathways can restrict embryonic growth, cause tissue hypoplasia, and exhaust stem cell reserves.[^Sharpless2007] Conversely, permissiveness in these checkpoints leaves organisms vulnerable to early-onset embryonal malignancies, loss-of-imprinting diseases, and adult carcinomas.[^Haig2015]

This trade-off manifests across several evolutionary and developmental domains, including intragenomic parent-offspring conflict over nutrient allocation during placentation, antagonistic pleiotropy between early-life fitness and late-life cellular senescence, and the macroevolutionary reduction of epimorphic limb regeneration in mammals.[^Campisi2005][^Pomerantz2013]

## Evolutionary foundations

### Multicellularity and somatic restraint

The evolution of multicellularity required individual cells to subordinate their reproductive autonomy to the fitness of the organismal collective.[^MaynardSmith1995] In unicellular organisms, natural selection favors individual lineages that divide at maximum capacity. Within metazoans, cellular proliferation must be strictly regulated to coordinate tissue morphogenesis and prevent somatic cells from competing with the germline.[^Aktipis2015] (See [[multicellular-cooperation]], [[evolutionary-transitions-in-individuality]], and [[de-darwinization]].)

Cancer is conceptualized in evolutionary biology as a breakdown of this cooperation, characterized by [[clonal-evolution|somatic selection]] for single-cell survival and proliferative autonomy.[^DeGregori2017] Because the cellular machinery for migration, tissue digestion, and rapid growth was developed during early eukaryote evolution, embryonic morphogenesis relies on many of the same conserved mechanisms. Tumor suppression mechanisms evolved as an internal enforcement apparatus to suppress these behaviors outside of designated developmental windows.[^Aktipis2015]

### Kinship theory and genomic imprinting
In eutherian mammals, an intragenomic conflict exists between maternal and paternal alleles regarding the allocation of resources during gestation, formalized by David Haig as the **kinship theory of genomic imprinting**.[^Haig2015] Because fathers in non-monogamous species have genetic interests tied exclusively to their current offspring, natural selection acts on the paternal genome to extract maximal nutritional resources from the mother. Conversely, the maternal genome is selected to conserve metabolic resources to survive for future reproductive events, which may involve litters sired by different males.[^Crespi2005]

This evolutionary dynamic manifests through epigenetic imprinting (reciprocally expressed at loci such as *IGF2*/*H19* and *CDKN1C* on human chromosome 11p15.5):
* Paternally expressed genes generally function as growth promoters and tissue invaders, acting biologically as proto-oncogenes. The canonical example is insulin-like growth factor 2 (*IGF2*), which stimulates cellular mitosis, trophoblast invasion, and nutrient uptake.[^Haig2015]
* Maternally expressed genes function as growth limiters, acting as classical tumor suppressor genes. Examples include *CDKN1C* (encoding the cyclin-dependent kinase inhibitor p57<sup>KIP2</sup>), which forces cell cycle exit and differentiation, and *IGF2R*, which acts as a decoy receptor targeting extracellular IGF2 for lysosomal degradation.[^Crespi2005]

Bernard Crespi and Kyle Summers demonstrated that this evolutionary conflict prevents growth networks from stabilizing, leaving mammalian cells vulnerable to transcriptional and epigenetic disruptions later in life.[^Crespi2005] For example, loss of imprinting (LOI) at human chromosome 11p15.5—resulting in biallelic expression of *IGF2* alongside transcriptional silencing of *CDKN1C*—causes Beckwith–Wiedemann syndrome. Individuals with this condition exhibit fetal overgrowth (macrosomia), organomegaly, and a markedly increased incidence of embryonal childhood tumors, particularly Wilms tumor (nephroblastoma), hepatoblastoma, and rhabdomyosarcoma.[^Haig2015]

### Antagonistic pleiotropy and somatic senescence

The relationship between early-life developmental fitness and tumor suppression is also discussed through [[antagonistic-pleiotropy-theory|antagonistic pleiotropy]], an evolutionary hypothesis first proposed by [[george-c-williams|George C. Williams]] in 1957.[^Williams1957] Williams postulated that alleles conferring high reproductive or survival benefits in early life are favored by natural selection, even if they cause adverse effects in post-reproductive life, because the force of natural selection declines with age.[^Williams1957]

[[judith-campisi|Judith Campisi]] applied this concept to explain the evolution of [[cellular-senescence|cellular senescence]] and the [[p53-tp53|p53]] pathway.[^Campisi2005] Cellular senescence functions early in life as a tumor-suppressive mechanism, arresting damaged cells to prevent neoplastic transformation, and as a developmental patterning mechanism during embryonic digit separation and neural tube closure.[^Campisi2005] However, in older organisms, senescent cells accumulate and develop a [[sasp|senescence-associated secretory phenotype]] (SASP). The chronic secretion of pro-inflammatory cytokines, chemokines, and matrix metalloproteinases disrupts local tissue architecture, degrades the stem cell niche, and creates a permissive microenvironment that can stimulate pre-malignant cells, paradoxically increasing cancer incidence in advanced age.[^Sharpless2007][^Campisi2005] (For why tumor-suppressive arrest may also remain net-beneficial in late life rather than flipping sign, see [[tumor-suppressor-theory-of-aging#relationship-to-antagonistic-pleiotropy|Tumor Suppressor Theory of Aging]].)

### Developmental constraints and pleiotropy
Evolutionary developmental biologist Frietson Galis demonstrated that alterations in early embryonic patterning carry high oncogenic penalties.[^Galis1999] During the vertebrate phylotypic stage, developmental signaling pathways are deeply interdependent. Mutations that alter conserved morphological landmarks—such as changes in *Hox* gene boundaries that produce rudimentary cervical ribs in humans—are strongly correlated with an elevated risk of pediatric neuroblastoma and childhood leukemias.[^Galis1999] Galis concluded that morphological diversification of early mammalian body plans is constrained because mutations that modify body plans disrupt common signaling hubs responsible for cell division and spatial differentiation, lowering the barrier to early oncogenesis.[^Galis1999]

## Molecular and cellular mechanisms

### Epigenetic silencing of *CDKN2A*
The *[[p16ink4a-cdkn2a|CDKN2A]]* genomic locus encodes two key tumor suppressors: p16<sup>INK4a</sup> and [[arf-p14arf|p14<sup>ARF</sup>]] (p19<sup>ARF</sup> in rodents). p16<sup>INK4a</sup> inhibits the cyclin-dependent kinases CDK4 and CDK6 to prevent phosphorylation of the [[rb-rb1|Retinoblastoma protein]] (pRb), maintaining $G_1$ cell cycle arrest. p14<sup>ARF</sup> binds and inhibits [[mdm2|MDM2]], preventing the degradation of p53 and promoting cell cycle arrest or apoptosis.[^Sharpless2007]

During embryonic and fetal development, stem and progenitor cells must maintain high rates of proliferation with abbreviated $G_1$ phases to generate functional organ systems.[^Pardal2005] To enable this rapid growth, the *CDKN2A* locus is epigenetically silenced in embryonic tissues through Polycomb repressive complexes (PRC1 and PRC2). The methyltransferase EZH2, a core component of PRC2, catalyzes trimethylation of histone H3 at lysine 27 (H3K27me3) across the locus, forming a transcriptionally repressive heterochromatin structure maintained by the PRC1 component BMI1.[^Pardal2005]

Following the completion of organogenesis, Polycomb-mediated repression decreases in adult somatic tissues, allowing baseline expression of p16<sup>INK4a</sup> and p14<sup>ARF</sup> to restrict uncontrolled proliferation. Forced premature expression of p16<sup>INK4a</sup> during embryogenesis in mouse models leads to widespread hypoplasia, neural tube defects, and embryonic lethality.[^Sharpless2007] Conversely, failure to transition out of Polycomb-mediated silencing after development leads to persistent cellular proliferation and elevated susceptibility to adult carcinomas, sarcomas, and lymphomas.[^Pardal2005]

### Hemochorial placentation and metastatic mimicry
Hemochorial placentation in humans and rodents shares cellular, molecular, and immunological phenotypes with metastatic carcinomas.[^Murray2000] To establish an interface for nutrient exchange, specialized fetal cells known as extravillous trophoblasts must break through the maternal basement membrane, invade the uterine decidua, and remodel maternal spiral arteries:
* **Extracellular matrix degradation:** Trophoblasts secrete matrix metalloproteinases (MMP-2 and [[mmp9-mmp9-p14780|MMP-9]]) and urokinase-type plasminogen activator (uPA) to digest the extracellular matrix, mirroring the invasive mechanisms deployed by metastatic carcinoma cells.[^Murray2000]
* **Neo-angiogenesis:** Trophoblasts synthesize high levels of vascular endothelial growth factor ([[vegf-vegfa|VEGF]]) and placental growth factor (PGF) to drive vascular remodeling, parallel to tumor-induced angiogenesis.[^Murray2000]
* **Immune evasion:** Fetal trophoblasts are allogeneic to the maternal host, expressing foreign paternal antigens. To prevent destruction by maternal immune cells, trophoblasts downregulate polymorphic major histocompatibility complex (MHC) molecules ([[hla-a-hla-a-p04439|HLA-A]] and HLA-B) and express non-classical HLA-G, which directly inhibits maternal natural killer (NK) cells and cytotoxic T cells. Tumor cells use an analogous immune-checkpoint strategy by upregulating [[pd-l1-cd274|PD-L1]] (and in [[ctvt-line|transmissible cancers]] such as CTVT, MHC loss) to evade T-cell-mediated destruction.[^Weinberg2011][^Murray2000]

The key distinction between placentation and metastatic cancer is extrinsic regulation. While malignant tumors proliferate and disseminate continuously, trophoblast invasion is spatiotemporally restricted by counter-regulatory factors secreted by the maternal decidua, such as tissue inhibitors of metalloproteinases (TIMPs) and transforming growth factor beta ([[tgfb1-tgfb1-p01137|TGF-β]]).[^Murray2000] Disruption of this regulatory balance can lead to gestational trophoblastic diseases, such as invasive moles and choriocarcinoma, a highly malignant neoplasm.[^Haig2015]

### Reactivation of embryonic signaling cascades
During morphogenesis, non-motile epithelial cells transiently convert into mobile mesenchymal cells to migrate throughout the embryo, a process designated as the epithelial–mesenchymal transition (EMT).[^Kalluri2009] EMT is coordinated by embryonic transcription factors including SNAIL (*SNAI1*), SLUG (*SNAI2*), TWIST (*TWIST1*), and [[zeb1-p37275|ZEB1]]/*ZEB2*, which repress the cell-adhesion molecule E-cadherin and upregulate mesenchymal proteins such as vimentin and N-cadherin.[^Kalluri2009]

Upon reaching their developmental destinations, embryonic cells undergo the reverse process, mesenchymal-to-epithelial transition (MET), re-establishing apical-basal polarity and rigid tissue architecture.[^Kalluri2009] In adult tissues, reactivation of this latent developmental program is a primary driver of carcinoma invasion and metastasis.[^Weinberg2011] Tumor suppressor genes typically act as continuous repressors of EMT; for instance, wild-type p53 transcriptionally activates the microRNA miR-200 and miR-34 families, which directly bind and suppress the mRNAs of *ZEB1*, *ZEB2*, and *SNAI1*. Inactivation of p53 or related tumor suppressors relieves this repression, enabling adult cells to aberrantly re-execute embryonic migration programs.[^Kalluri2009]

## Comparative biology and regeneration

### Epimorphic regeneration in vertebrates
Urodele amphibians, including newts and axolotls, retain the capacity for epimorphic limb regeneration throughout adult life.[^Pomerantz2013] Following amputation, mature differentiated cells at the wound margin undergo dedifferentiation, revert to a proliferative progenitor-like state, form an embryonic-like blastema, and regenerate the patterned appendage.[^Tanaka2016]

```
Amphibian limb loss ──► Dedifferentiation ──► Blastema formation ──► Morphogenesis ──► Regrown limb
                             (Permissive p53/p16 checkpoints; no malignant progression)

Mammalian limb loss ──► Fibroblast migration ──► Collagen deposition ──► Scarring (Fibrosis)
                             (Strict p53/p16 checkpoints block dedifferentiation)
```

Mammals lack epimorphic limb regeneration, responding instead to severe trauma with fibrosis and scar formation.[^Pomerantz2013] Work by Jeremy Brockes and Jason Pomerantz demonstrated that this difference reflects divergent tumor-suppressive constraints:
1. Mammalian cells are constrained by rigid tumor-suppressor checkpoints. If mammalian differentiated myocytes or fibroblasts are induced to re-enter the cell cycle, intact p16<sup>INK4a</sup> and p53 signaling networks rapidly trigger senescence or apoptosis.[^Pomerantz2013]
2. In contrast, newts and axolotls can cycle through rounds of dedifferentiation and rapid proliferation while maintaining low rates of spontaneous neoplasia.[^Tanaka2016]

Because mammals are large-bodied, endothermic, and experience orders of magnitude more somatic cell divisions over their lifespans than small ectothermic amphibians, they face greater cumulative exposure to oncogenic mutations. Natural selection in the mammalian lineage favored rigid cell-cycle locks to suppress tumor formation, which functionally precluded the dedifferentiation required for blastema-mediated regeneration.[^Pomerantz2013]

### Peto's paradox
*Main article: [[petos-paradox|Peto's paradox]]*

[[petos-paradox|Peto's paradox]], formulated by epidemiologist Richard Peto, observes that the incidence of cancer does not scale proportionally with body size or lifespan across metazoan species.[^Peto1977] If all somatic cells had an equal baseline probability of malignant transformation, larger and longer-lived organisms would face high rates of neoplasia during early development or growth due to the vast number of cell divisions required to construct their bodies.[^Caulin2011]

Comparative genomic analyses have identified lineage-specific adaptations that resolve this conflict:
* **African elephants (*Loxodonta africana*):** Elephants possess 20 copies (40 alleles) of the *TP53* tumor suppressor gene, generated through sequential retrogene duplication.[^Abegglen2015] Rather than attempting DNA repair under moderate genotoxic stress, elephant lymphocytes exhibit an apoptotic threshold that destroys damaged cells before expansion can occur.[^Abegglen2015]
* **Naked mole-rats (*Heterocephalus glaber*):** Naked mole-rats exhibit early contact inhibition (ECI) mediated by high-molecular-weight hyaluronan (HMW-HA). When cellular density increases, HMW-HA triggers early activation of the *CDKN2A/B* locus via CD44 signaling, arresting proliferation long before pre-malignant contact points form.[^Tian2013]
* **Bowhead whales (*Balaena mysticetus*):** Bowhead whales, which exceed 80 metric tons in weight and 200 years of life, possess specific duplications and structural alterations in genes associated with DNA double-strand break repair, such as *PCNA*, *ERCC1*, and *CIRBP*, reducing the somatic mutation accumulation rate during development.[^Keane2015]

| Organism | Lifespan (years) | Body mass | Primary mechanism | Key genetic elements |
| :--- | :--- | :--- | :--- | :--- |
| Human (*Homo sapiens*) | 80–120 | ~70 kg | Classical diploid cell-cycle checkpoints; tissue senescence | *TP53* (1 pair), *CDKN2A*, *RB1* |
| African elephant (*Loxodonta africana*) | 60–70 | ~4,000 kg | Apoptotic threshold elevation via retrogene duplication | *TP53* (20 copies / 40 alleles) |
| Naked mole-rat (*Heterocephalus glaber*) | >30 | ~0.035 kg | Early contact inhibition via extracellular matrix signaling | High-molecular-weight hyaluronan, *CDKN2A/B* |
| Bowhead whale (*Balaena mysticetus*) | >200 | ~80,000 kg | Enhanced DNA double-strand break repair efficiency | *ERCC1*, *PCNA*, *CIRBP* |

## Developmental microenvironments as tumor suppressors

### Morphogenetic field suppression

In the 1970s, developmental oncologists demonstrated that the embryonic developmental field (including [[bioelectricity|bioelectric cues]] and extracellular matrix structure studied by [[mina-bissell|Mina Bissell]]) can override oncogenic mutations and revert malignant cells to a normal phenotype.[^Pierce1974]

In 1975, Beatrice Mintz and Karl Illmensee isolated malignant, undifferentiated embryonal carcinoma cells from a mouse teratocarcinoma and microinjected them into normal mouse blastocysts at day 3.5 of development.[^Mintz1975] Rather than forming tumors, the embryonal carcinoma cells integrated into the inner cell mass, responded to the morphogenetic signaling cues of the blastocyst, and differentiated into normal somatic cell types.[^Mintz1975] The resulting mice were viable, non-cancerous chimeras whose tissues—including functional germ cells—carried the genome of the original cancer cell line.[^Mintz1975]

Subsequent work confirmed that morphogenetic microenvironments can reprogram other transformed cells:
* Microinjection of metastatic melanoma cells into embryonic day 8.5 mouse embryonic neural crest fields inhibits their tumorigenicity and induces differentiation into melanocytes, peripheral neurons, and glia.[^Kulesa2006]
* Mammary epithelial cells carrying oncogenic alterations can be constrained from forming tumors when embedded in normal three-dimensional laminin-rich basement membrane matrices in vitro.[^Bissell2001]

These experiments demonstrated that the expression of neoplastic traits depends on both cell-intrinsic genetic mutations and the permissive or suppressive state of the surrounding physical and signaling architecture.[^Bissell2001]

### Tissue organization field theory
The contextual constraint of neoplasia forms the core of the Tissue Organization Field Theory (TOFT), developed by Ana Soto and Carlos Sonnenschein.[^Soto2004] TOFT challenges the classical Somatic Mutation Theory by arguing that the default cellular state in metazoans is continuous proliferation, which must be restrained by intact tissue architecture and morphogenetic signaling.[^Soto2004] Under this framework, cancer is conceptualized not as a series of cell-autonomous genetic mutations, but as an architectural collapse of tissue structure, releasing underlying cells back to an unconstrained, pseudo-embryonic developmental state.[^Soto2004]

## See also
* [[antagonistic-pleiotropy-theory]]
* [[tumor-suppressor-theory-of-aging]]
* [[evolutionary-transitions-in-individuality]]
* [[petos-paradox]]
* [[clonal-evolution]]
* [[oncogene-classification]]
* [[Terminal selectors]]

## References

[^Pardal2005]: Pardal R, Clarke MF, Morrison SJ. "Role of stem-cell self-renewal in regular organs and tumors." *Nature Reviews Cancer*. 2005;5(1):67–76. doi:10.1038/nrc1594.
[^Weinberg2011]: Hanahan D, Weinberg RA. "Hallmarks of cancer: the next generation." *Cell*. 2011;144(5):646–674. doi:10.1016/j.cell.2011.02.013.
[^Sharpless2007]: Sharpless NE, DePinho RA. "How stem cells age and why this makes us grow old." *Nature Reviews Molecular Cell Biology*. 2007;8(9):703–713. doi:10.1038/nrm2241.
[^Haig2015]: Haig D. "Maternal-fetal conflict, genomic imprinting and mammalian vulnerabilities to cancer." *Philosophical Transactions of the Royal Society of London. Series B, Biological Sciences*. 2015;370(1673):20140178. doi:10.1098/rstb.2014.0178.
[^Campisi2005]: Campisi J. "Aging, tumor suppression and cancer: high wire-act!" *Mechanisms of Ageing and Development*. 2005;126(1):51–58. doi:10.1016/j.mad.2004.09.024.
[^Pomerantz2013]: Pomerantz JH, Blau HM. "Tumor suppressors: enhancers or suppressors of regeneration?" *Development*. 2013;140(12):2502–2512. doi:10.1242/dev.088195.
[^MaynardSmith1995]: Maynard Smith J, Szathmáry E. *The Major Transitions in Evolution*. W. H. Freeman, 1995. ISBN 978-0-19-850294-4.
[^Aktipis2015]: Aktipis CA, Boddy AM, Jansen G, Hibner U, Hochberg ME, Maley CC, Wilkinson GS. "Cancer across the tree of life: cooperation and cheating in multicellularity." *Philosophical Transactions of the Royal Society B*. 2015;370(1673):20140219. doi:10.1098/rstb.2014.0219.
[^DeGregori2017]: DeGregori J. *Adaptive Oncogenesis: A New Understanding of How Cancer Evolves Inside Us*. Harvard University Press, 2017. ISBN 978-0-674-97217-9.
[^Crespi2005]: Crespi B, Summers K. "Evolutionary biology of cancer." *Trends in Ecology & Evolution*. 2005;20(10):545–552. doi:10.1016/j.tree.2005.07.007.
[^Williams1957]: Williams GC. "Pleiotropy, natural selection, and the evolution of senescence." *Evolution*. 1957;11(4):398–411. doi:10.2307/2406060.
[^Galis1999]: Galis F. "Why do almost all mammals have seven cervical vertebrae? Developmental constraints, Hox genes, and cancer." *Journal of Experimental Zoology*. 1999;285(1):19–26. doi:10.1002/(sici)1097-010x(19990415)285:1<19::aid-jez3>3.0.co;2-z.
[^Murray2000]: Murray MJ, Lessey BA. "Embryo implantation and tumor metastasis: common pathways of invasion and angiogenesis." *Seminars in Reproductive Medicine*. 2000;18(3):249–256. doi:10.1055/s-2000-12563.
[^Kalluri2009]: Kalluri R, Weinberg RA. "The basics of epithelial-mesenchymal transition." *The Journal of Clinical Investigation*. 2009;119(6):1420–1428. doi:10.1172/JCI39104.
[^Tanaka2016]: Tanaka EM. "The molecular and cellular choreography of appendage regeneration." *Cell*. 2016;165(7):1598–1608. doi:10.1016/j.cell.2016.05.038.
[^Peto1977]: Peto R. "Epidemiology, multistage models, and short-term mutagenicity tests." *Cold Spring Harbor Conferences on Cell Proliferation*. 1977;4:1403–1428.
[^Caulin2011]: Caulin AF, Maley CC. "Peto's Paradox: evolution's solution to cancer." *Trends in Ecology & Evolution*. 2011;26(4):175–182. doi:10.1016/j.tree.2011.01.002.
[^Abegglen2015]: Abegglen LM, Caulin AF, Chan A, Bultron K, Tollis M, McKean R, Schiffman JD. "Potential mechanisms for cancer resistance in elephants and comparative cellular response to DNA damage in humans." *JAMA*. 2015;314(17):1850–1860. doi:10.1001/jama.2015.13134.
[^Tian2013]: Tian X, Azpurua J, Hine C, Vaidya A, Myakishev-Mempel M, Ablaeva J, Seluanov A, Gorbunova V. "High-molecular-mass hyaluronan mediates the cancer resistance of the naked mole rat." *Nature*. 2013;499(7458):346–349. doi:10.1038/nature12234.
[^Keane2015]: Keane M, Semeiks J, Webb AE, Li YI, Quesada V, Craig T, de Magalhães JP. "Insights into the evolution of longevity from the bowhead whale genome." *Cell Reports*. 2015;10(1):112–122. doi:10.1016/j.celrep.2014.12.008.
[^Pierce1974]: Pierce GB. "Neoplasms, differentiations and mutations." *The American Journal of Pathology*. 1974;77(1):103–118. PMID 4371424.
[^Mintz1975]: Mintz B, Illmensee K. "Normal genetically mosaic mice produced from malignant teratocarcinoma cells." *Proceedings of the National Academy of Sciences of the United States of America*. 1975;72(9):3585–3589. doi:10.1073/pnas.72.9.3585.
[^Kulesa2006]: Kulesa PM, Kasemeier-Kulesa JC, Teddy JM, Margaryan NV, Seftor EA, Seftor RE, Hendrix MJ. "Reprogramming metastatic melanoma cells to assume a diverse neural crest-like phenotype in an embryonic microenvironment." *Proceedings of the National Academy of Sciences of the United States of America*. 2006;103(10):3752–3757. doi:10.1073/pnas.0506977103.
[^Bissell2001]: Bissell MJ, Radisky D. "Putting tumours in context." *Nature Reviews Cancer*. 2001;1(1):46–54. doi:10.1038/35094059.
[^Soto2004]: Soto AM, Sonnenschein C. "The somatic mutation theory of cancer: growing problems with the paradigm?" *BioEssays*. 2004;26(10):1097–1107. doi:10.1002/bies.20087.

## Further reading
* Frank SA. *Dynamics of Cancer: Incidence, Inheritance, and Evolution*. Princeton University Press, 2007. ISBN 978-0-691-13366-9.
* Gatenby RA. *The Biology and Treatment of Cancer: Using Global Pathfinding to Win the Battle*. Cambridge University Press, 2020. ISBN 978-1-108-83567-1.
* Soto AM, Sonnenschein C. *The Society of Cells: Cancer and Control of Cell Proliferation*. Springer, 1999. ISBN 978-0-387-98547-3.
