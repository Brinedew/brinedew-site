---
title: Compensatory proliferation
date: 2026-11-15
draft: true
tags:
  - content/wiki
class: C
vital_level: 3
aliases:
  - Apoptosis-induced proliferation
  - AiP
---

**Compensatory proliferation** is the damage-triggered return of surviving somatic cells to the cell cycle to replace lost tissue mass, architecture, or cell number. Conserved across animals from freshwater cnidarians such as *Hydra* to mammalian liver and surface epithelia, this recovery program restores structural integrity after trauma, infection, radiation, or localized cell death. It operates in a distinct biological regime from [[Cell competition|cell competition]], where neighbors eliminate viable but sub-optimal clones *without* an acute drop in organ volume.

Why doesn't natural selection leave compensatory proliferation dialed up continuously so adult tissues flush out worn-out cells in real time? Inside a multicellular host's [[Clonal governance|clonal governance]] regime, every extra round of somatic division carries a double penalty: DNA replication introduces new driver mutations during S phase, and rapid cell turnover hands any mutant that shirks tissue restraint extra compounding generations to outgrow functional neighbors. Long-lived animals therefore ration compensatory proliferation tightly. Healthy tissues handle small vacancies through passive mechanical stretch, lock high-amplitude mitogens behind dying-cell proteolysis and spatial brakes, substitute non-mitotic cell enlargement or cell fusion in post-developmental organs, and epigenetically silence cell-cycle enhancers once morphogenesis ends ([[Conflict between development and tumor suppression]]). Viewed through clonal governance, pharmacologically forcing quiescent adult cells back into division once mutation load and cell-intrinsic vigor decay have climbed accelerates clonal neoplasia unless niche containment and oncogenic mutation rates are controlled simultaneously.[^nelson2017][^michaels2023]

---

## Mechanical sensing versus apoptosis-induced proliferation

Experimental biology often lumps all injury-induced division together, yet animals split the task according to how much positional information and signaling structure vanished alongside the dead cells.[^bergmann2025ccs] Small, localized losses inside a crowded sheet leave an empty footprint directly bordered by intact neighbors, so local geometric stretch already specifies *where* replacement division belongs. Widespread trauma inside patterned primordia—or cell loss in stiff, matrix-separated niches where neighbor tension blurs out—cannot reconstruct missing positional identity from scalar stretch alone. In those settings, dying cells must actively broadcast diffusible growth factors before macrophages engulf them.[^bergmann2025ccs][^bergmann2025arg]

- **Compensatory proliferation (CP)** names the broad response in which surviving cells detect missing mass—through lowered crowding stress, lost junctional contact, systemic hormonal cues, or debris—and divide until organ size recovers, whether or not cell-death proteases fire.
- **Apoptosis-induced proliferation (AiP)** names the specialized subset in which cells undergoing programmed suicide ([[apoptosis|apoptosis]]) co-opt their own intracellular cleavage proteases (**caspases**) to emit mitogens that instruct intact neighbors to divide.[^bergmann2025ccs][^bergmann2025arg]

![[comp-prolif-modes.png|Figure 1. Cellular injury responses partition into caspase-independent mechanical tension sensing (Branch 1), caspase-driven genuine versus blocked-execution AiP (Branch 2), non-proliferative mass recovery via hypertrophy or endoreplication (Branch 3), and irreversible developmental chromatin closure (Branch 4), bounded below by the clonal-governance division tradeoff.]]

### Tension release across junctions

Cohesive epithelia are mechanically pre-stressed sheets. Each cell pulls inward through contractile actin–myosin cables tethered to neighbors via **E-cadherin** adherens junctions, while dense packing compresses cells laterally against one another.[^aragona2013][^benhampyle2015] When a neighbor dies or extrudes out of the sheet, compressive force drops and surviving neighbors stretch across the gap without requiring apoptotic enzymes.

Two physical checkpoints translate that stretch into nuclear transcription and shut division off automatically once the gap closes:

1. **Cytoskeletal restraint via actin capping and severing:** In crowded epithelia, actin-capping and filament-severing proteins (**cofilin**, **CapZ**, and **gelsolin**) keep contractile stress fibers short, restraining the proliferative co-activators **[[yap-yap1|YAP]]** and **[[taz-wwtr1|TAZ]]** (Yorkie in *Drosophila*) in the cytoplasm—both through the **Hippo** kinase cascade (`MST1/2 → LATS1/2`, which phosphorylates YAP/TAZ to retain them in the cytosol) and directly downstream of canonical Hippo kinases.[^aragona2013] Stretching across a wound tensioned by actomyosin overcomes that actin brake, letting YAP/TAZ enter the nucleus, partner with **TEAD** DNA-binding factors, and turn on cell-cycle genes.
2. **Force-switched E-cadherin gating:** At first glance, E-cadherin appears paradoxical because intact extracellular E-cadherin binding is required *both* to keep YAP excluded from the nucleus during quiet contact inhibition and to trigger proliferation under stretch.[^benhampyle2015] Mechanical tension resolves the apparent contradiction through an intracellular conformational switch: intact E-cadherin–catenin complexes anchor cells together in quiescence, and applying physical strain across those engaged complexes relays force inward to drive sequential **YAP** nuclear entry within 1–6 hours (`G₁`) followed by **β-catenin** transcriptional entry across the `G₁`-to-`S` replication boundary.[^benhampyle2015]

Once daughter divisions refill the hole and restore compressive packing, actin-severing restraint and Hippo–junctional exclusion snap back on—implementing **closed-loop negative feedback** that halts proliferation with zero central coordinator and zero diffusible mitogens.[^aragona2013][^benhampyle2015]

### Caspase-driven relays across animal phyla

Routing tissue repair through suicide proteases solves an evolutionary alignment problem alongside an engineering timing problem. Letting healthy living cells broadcast diffusible growth factors unchecked would invite self-amplifying proliferation and mutant cheating. Gating mitogens behind caspase proteolysis acts as a biological **proof-of-burn gate**: in unblocked physiology, sending a proliferative broadcast requires committing the sender cell to execution (or near-lethal crisis), ensuring that only damaged sites issue division orders. The engineering constraint is keeping that mitogen factory running long enough while apoptotic enzymes dismantle the sender's cytoskeleton and DNA:

- **Mid-gastric organizer rescue in *Hydra*:** When a *Hydra* polyp is bisected across its mid-body, multipotent progenitors called **interstitial cells** bordering the head-facing wound undergo rapid apoptosis and secrete **[[wnt3a-wnt3a-p56704|Wnt3]]**. That signal activates β-catenin in surviving neighbors just beneath the apoptotic band, launching an acute burst of synchronous division that reconstructs the head organizer rapidly.[^chera2009][^jiang2026] Tellingly, polyps experimentally cleared of interstitial cells can still slowly regenerate a head by rearranging existing epithelial sheets *without* acute division (**morphallaxis**); intact animals use caspase-gated Wnt3 division whenever available because fast mitotic organizer rebuild restores feeding symmetry faster than slow tissue shuffling.[^chera2009][^jiang2026]
- **Membrane-tethered initiator caspases in *Drosophila*:** In larval fly imaginal discs, the apical initiator caspase **Dronc** (orthologue of mammalian **Caspase-9**) avoids instant suicidal self-destruction by tethering to the inner basal membrane via the unconventional myosin **Myo1D**.[^bergmann2025ccs][^braun2025] When executioner caspases are blocked with baculovirus `p35` (creating chronic **"undead"** eye discs), membrane-bound Dronc continuously activates the NADPH oxidase **DUOX**, emitting **extracellular reactive oxygen species (eROS)** that recruit macrophage-like blood cells (**hemocytes**). Recruited hemocytes secrete the TNF ligand **Eiger**, triggering **JNK** and **p38 MAPK** stress kinases in surviving neighbors to force chronic division.[^bergmann2025ccs]
- **Radiation-resistant survivor lineages (DARE and NARE):** Acute high-dose X-irradiation in the *Drosophila* wing disc reveals an opposite hemocyte–TNF polarity cleanly separated from `p35` undead artifacts.[^braun2025] Delayed lineage tracing splits post-irradiation epithelial survivors into **Dronc-activating radiation-resistant (DARE)** clones and **non-activating (NARE)** clones. Inside DARE cells, **Myo1D** anchors active **Dronc** at the cortex *without* assembling the cytosolic apoptosome (**Dark**)—while **Myo7A/Crinkled** checks runaway effector leakage—keeping caspase activity sublethal. DARE cells then produce ROS internally through **Duox** and **Nox** to stimulate the TNF receptor **Wengen (`Wgn`)** and **p38 MAPK**, expanding both DARE and NARE lineages while genetic hemocyte ablation proves wandering blood cells are **dispensable** here.[^braun2025] In fact, hemocyte-derived **Eiger** engaging a second TNF receptor (**Grindelwald**, `Grnd`) actively *restrains* excessive DARE growth rather than driving it—showing that undead eye overgrowth (`Eiger → overgrowth`) and genuine irradiated wing repair (`Duox/Nox → Wgn/p38` with `Eiger/Grnd` restraint) invert TNF polarity across regimes.[^braun2025] Expanding DARE descendants also inherit elevated radiation resistance, illustrating how sublethal caspase survival can seed apoptosis-hardened lineages.[^braun2025]
- **Mammalian "Phoenix Rising" lipid relays versus basal gland scaling:** During acute trauma in mouse skin, regenerating liver, and irradiated tumors, executioner **[[caspase-3-casp3-p42574|Caspase-3]]** and **Caspase-7** clip an inhibitory domain off **calcium-independent phospholipase A₂ (`iPLA₂`)**, locking the lipase active.[^li2010][^huang2011] Freed arachidonic acid feeds **cyclooxygenase-1/2 (`COX-1/2`)** to synthesize **prostaglandin E₂ (`PGE₂`)**, accelerating progenitor proliferation through **EP2** receptors.[^li2010][^huang2011] Outside acute cell-loss crises, mammalian sebaceous glands and epidermis deploy a distinct **non-lethal** basal mechanism: tonic Caspase-3 cleaves **α-catenin** at intact cell junctions to release **YAP** into the nucleus for quiet steady-state organ size scaling rather than injury rescue.[^yosefzon2018]

> [!info]- Primary source excerpt: hemocyte-independent Duox/Nox ROS and Wengen signaling in irradiated wing discs (*Nature Communications* 2025)
>
> ![[comp-prolif-braun2025-duox-wgn.png|Excerpt from Braun et al., Nature Communications 16:10871 (2025), establishing cell-intrinsic ROS production via Duox and Nox driving DARE proliferation independently of hemocytes.]]
>
> Verbatim heading & opening text ([`doi:10.1038/s41467-025-65996-2`](https://doi.org/10.1038/s41467-025-65996-2)): *"ROS produced by Duox and Nox in DARE cells promote their proliferation independently of hemocyte-derived mediators. We next investigated the molecular mechanism through which non-lethal Dronc drives DARE cell proliferation. Given that membrane-localized Dronc promotes AiP by activating the NADPH oxidase Duox to generate extracellular ROS (eROS), which attracts hemocytes that in turn secrete Eiger (Egr) to activate JNK and promote AiP, we examined whether a similar mechanism operates in DARE cells following irradiation. Using the DCFH-DA probe to detect intracellular ROS and dihydroethidium (DHE) for superoxide detection, we observed strong ROS accumulation in IR-treated discs at 48 hours post-irradiation (Fig. 1g–j)."*

---

## Undead artifacts versus genuine fly regeneration

Much of early AiP genetics grew out of an experimental trap that proved treacherous when read straight onto normal physiology. In *Drosophila* imaginal discs, researchers expressed upstream pro-apoptotic genes (*hid*, *reaper*, or *grim*—which strip away the caspase inhibitor DIAP1) alongside the baculovirus peptide **p35**, blocking downstream effector caspases (*Drice* and *Dcp-1*) while leaving initiator **Dronc** running (`ey>hid,p35` in eye discs).[^huh2004][^ryoo2004][^perezgarijo2004] Suspended between life and execution, these immortalized **"undead" cells** break the proof-of-burn gate: they fire Dronc indefinitely and pump out chronic **Wingless (`Wg`)** and **Decapentaplegic (`Dpp`)** morphogens until surrounding larval discs balloon into hyperplastic tumor-like masses.[^bergmann2025ccs]

Comparing undead `p35` tissues against **"genuine" (`p35`-free)** regeneration exposes clean mechanistic separation alongside an active methodological warning. In a standard genuine AiP assay (`DE^ts>hid`), a temperature-sensitive dorsal-eye driver (`DE^ts`) pulses *hid* expression for 12 hours strictly in the dorsal half of the larval eye disc *without* `p35`, followed by 72 hours of recovery at permissive low temperature so surviving progenitors restore dorsal photoreceptor rows.[^fan2008][^suthar2026]

| Experimental feature | Undead model (`p35` blocks effector caspases) | Genuine physiological AiP (`DE^ts>hid`, irradiation) | Evidence status |
| :--- | :--- | :--- | :--- |
| **Sender cell fate** | Execution blocked; initiator **Dronc** stays chronically ON | Cells complete apoptosis rapidly or persist as sublethal **DARE** survivors | Established across fly disc models[^bergmann2025ccs][^braun2025] |
| **Ca²⁺ channel requirement** | Screen reports `TrpA1`, `RyR`, `TrpM`, and `Pkd2` requirement in `ey>hid,p35` | Single-lab eye knockdown reports `TrpA1`/`RyR` defects (`TrpM`/`Pkd2` dispensable) | **Tentative / confounded:** `30 °C` shift activates heat-gated `TrpA1`; no Ca²⁺/ROS/hemocyte validation; peer-review data flags[^suthar2026] |
| **Wg & Dpp necessity** | Ectopic **Wg** and **Dpp** drive tumor-like disc overgrowth | **Dispensable** when apoptosis finishes cleanly; repair uses **JNK/p38** and **[[egfr-erbb1-p00533|EGFR]]** | Mutant compartment genetics[^perezgarijo2009][^fan2008] |
| **Tissue outcome** | Pathological hyperplastic distortion | Self-limiting restoration of normal photoreceptor pattern | Comparative disc genetics[^bergmann2025ccs][^perezgarijo2009] |

Conflating `p35` overgrowths with physiological repair mistakes a broken synthetic signaling loop for normal tissue homeostasis.[^bergmann2025ccs][^perezgarijo2009] Whether Ca²⁺ channels (`TrpA1`, a warmth-and-chemical-gated cation channel disrupted in `TrpA1^ins/+` transposon insertion mutants, and `RyR`, an endoplasmic-reticulum ryanodine Ca²⁺ release channel) sit upstream of DUOX in genuine *Drosophila* regeneration remains unestablished.[^suthar2026] Three concrete methodological gaps block generalization from the primary screen:

1. **Thermosensitive channel confounding:** `DE^ts>hid` triggers apoptosis via a **12-hour `30 °C` heat shift** directly overlapping *Drosophila* `TrpA1`'s canonical warmth-activation window (while `S8 Fig` confirmed that unablated `30 °C` `TrpA1` controls still patterned late `ELAV` photoreceptors normally, thermal gating and knockdown kinetics during the active `hid` pulse were left unaddressed).[^suthar2026]
2. **Unmeasured intermediate cascade:** In `DE^ts>hid`, investigators scored only final dorsal photoreceptor patterning (`16/20` incomplete recovery with `TrpA1` RNAi, `17/20` with `TrpA1^ins/+`, `15/20` with `RyR` RNAi) *without* recording a single Ca²⁺ transient (`GCaMP6s`, a genetically encoded fluorescent Ca²⁺ sensor), `DUOX` ROS signal, or hemocyte count outside the undead `p35` background.[^suthar2026]
3. **Published peer-review irregularities:** Round 1–2 open peer-review logs on *PLOS Biology* (`e3003607`) record reused control micrographs across main and supplementary panels, identical RNAi bar measurements graphed across `Fig 3B` and `S4A Fig` against non-identical controls, and a purely visual `GCaMP6s` flash criterion (*"clearly distinguishable from background fluctuations"*) without a quantitative amplitude/duration threshold.[^suthar2026]

---

## Non-proliferative repair and developmental lockouts

Mitosis inside working adult organs carries acute structural costs beyond mutation risk: entering division rounds disrupts polarized apical–basal junctions, interrupts differentiated metabolic work, and hands selfish mutants extra selective rounds. Mature vertebrate organs and postmitotic insect tissues therefore prefer hypertrophy, DNA endoreplication without cytokinesis, or permanent chromatin locking whenever trauma stays within survivable bounds:

- **Two-stage size control in mammalian liver (`CCH` vs. division):** Lineage tracing after mouse partial hepatectomy explains *why* evolution sets a sharp division threshold rather than dividing after minor injury.[^miyaoka2012] When **≤ 30%** of liver mass is removed, hepatocyte loss leaves enough shared blood flow and metabolic spare that surviving cells simply enlarge in volume, protein content, and organelle load—**compensatory cellular hypertrophy (`CCH`)**—restoring hepatic detox and synthesis capacity with **zero replication mutagenesis and zero disruption of bile-canaliculi polarity**.[^miyaoka2012][^korchilava2025] Only massive **70% resection** outstrips hypertrophy alone, layering proliferation (~**1.6-fold** hepatocyte count rise alongside ~**2.4-fold** lobe mass recovery) and **reductive binuclear-to-mononuclear divisions**—splitting pre-existing polyploid cells directly into two functional daughters without running a fresh S-phase copy.[^miyaoka2012][^korchilava2025]
- **Endoreplication and syncytial cell fusion with circuit restraint:** In postmitotic or [[eutely|eutelic]] adult *Drosophila* epithelia, ovarian follicle cells and abdominal epidermis avoid mitotic chromosome mis-segregation by shifting to [[insulin|insulin/IGF]]-driven **endocycles** (copying DNA without mitosis) or **wound-induced polyploidization (`WIP`)**, fusing surviving neighbors via **Rac** actin remodeling into large multinucleated **syncytia** scaled to missing cell area—a mechanism conserved in injured or degenerating mouse corneal endothelium.[^tamori2013][^losick2013][^losick2016] Crucially, whereas **JNK** promotes *mitotic* proliferation in larval discs, **JNK/AP-1** switches polarity in adult `WIP` repair to act as a **negative feedback brake on Yorkie ([[yap-yap1|YAP]])**.[^losick2016] Because polyploid healing lacks daughter-cell cleavage boundaries to re-establish lateral Hippo contact inhibition cleanly, unconstrained Yorkie would overshoot missing mass and thicken the sheet; AP-1 restraint caps genome amplification cleanly to wound size.[^losick2016]
- **Developmental chromatin closure (`E93` and `DRMS` enhancers):** As *Drosophila* transitions into metamorphosis, a pulse of the steroid hormone **ecdysone** ends normal pupal wing division at **~24 hours after puparium formation (APF)** by snapping the positive feedback loop between **Cyclin E (`CycE`)** and **[[e2f1-e2f1-q01094|E2F1]]**.[^ahmeddeprado2024] Induced apoptosis can pull surviving pupal wing cells back into compensatory mitosis up to **34 h APF**, extending regenerative competence roughly 10 hours. Past ~34–36 h APF, injury still switches on **JNK** normally, yet proliferation stalls because the ecdysone-induced transcription factor **E93** physically compacts regulatory chromatin across `CycE`, `E2F1`, and the mitotic-entry phosphatase **`stg` (`Cdc25`)**—demonstrated directly when pupae irradiated at **20 h APF** at 29 °C and scored 20 hours later (**40–44 h APF**) fail to divide unless `E93` is mutated.[^ahmeddeprado2024] Separately, modular **damage-responsive, maturity-silenced (`DRMS`)** enhancers (such as `DRMS^WNT`) function as chromatin **AND gates**: they pair injury-triggered **JNK/AP-1** with permissive juvenile **JAK/STAT** signaling to activate `wg`/`Wnt6` repair early, then lock their damage modules permanently through developmental chromatin compaction later.[^quinn2025]

Developmental `E93` and `DRMS` lockouts exemplify scheduled **morphogenetic differentiation closure** (covered under [[Conflict between development and tumor suppression]]), *not* stress-triggered mammalian **[[cellular-senescence|cellular senescence]]** or chronic **[[sasp|SASP]]** inflammation.[^ahmeddeprado2024] Once adult tissues commit to fixed chromatin lockouts or non-mitotic hypertrophy, they accept structural trade-offs—scar stiffness or inability to regenerate after massive loss (plus in vertebrates, separate p16/p21 damage senescence when injury exceeds genomic tolerance)—as the evolutionary price of starving clonal tumorigenesis.

> [!info]- Primary source excerpt: AP-1/JNK brakes Yorkie during wound-induced polyploidization (*PLOS ONE* 2016)
>
> ![[comp-prolif-losick2016-jnk-brake.png|Discussion excerpt from Losick, Jun & Spradling, PLOS ONE 11(3):e0151251 (2016), p. 8.]]
>
> Verbatim text ([`doi:10.1371/journal.pone.0151251`](https://doi.org/10.1371/journal.pone.0151251)): *"Here we have observed that AP-1 surprisingly functions as a brake to limit Yki activation, and consequently WIP appears to be restrained and does not overcompensate and produce excess tissue mass."*

---

## Oncogenic hijacking and therapeutic pitfalls

Because compensatory relays tie parenchymal death directly to neighbor division, any chronic injury or cytotoxic therapy that kills ordinary cells repeatedly while sparing apoptosis-resistant clones converts homeostatic repair into persistent tumor promotion. Evaluating this trap cleanly, however, requires separating extreme chronic necro-inflammatory models and immunodeficient xenograft boluses from physiological homeostatic CP.

### Chronic hepatocyte death and inflammatory confounding

Hepatocellular carcinoma (**HCC**) typically develops after decades of hepatocyte turnover inside cirrhotic livers. Two widely cited conditional **NF-κB** pathway knockouts in mice illustrate both the oncogenic power of unremitting hepatocyte death *and* why genetic perturbations rarely isolate pure "clean" compensatory proliferation:

- **Complete canonical NF-κB loss (`NEMO/IKKγ` deletion):** Removing **`NEMO / IKKγ`** specifically in liver parenchymal cells wipes out canonical NF-κB survival protection altogether, sparking spontaneous death-receptor and oxidative apoptosis, severe chronic steatohepatitis (fatty inflammatory liver injury), bridging fibrosis, compensatory proliferation of hepatocytes and biliary **oval cells**, and **spontaneous HCC by 12 months** with no added carcinogen.[^luedde2007] Rather than testing sterile proliferation cleanly, `NEMO` deletion models sustained necro-inflammatory tissue destruction.
- **Partial kinase deletion plus mutagen (`IKKβ` deletion + `DEN`):** By contrast, deleting only hepatocyte **`IKKβ`** leaves `NEMO` and residual **`IKKα`** functional, so mice do *not* develop spontaneous liver cancer; accelerating HCC in hepatocyte `IKKβ`-null livers requires injecting the chemical carcinogen **diethylnitrosamine (`DEN`)**, which triggers acute hepatocyte death and recruits myeloid **Kupffer cells** to drive cytokine-stimulated compensatory division (`IL-6`/`TNF`).[^maeda2005] Although this *Cell* study carries no publisher correction or PubPeer figure notice, pairing chemical mutagenesis with Kupffer-cell cytokine amplification blends genotoxic initiation, myeloid inflammation, and regenerative turnover in one phenotype.

### Therapy-driven repopulation and clinical reality checks

Radiotherapy and chemotherapy debulk solid tumors while bathing rare surviving tumor stem cells or `DARE`-like resistant survivors in apoptotic **Phoenix Rising** signals (**[[caspase-3-casp3-p42574|Caspase-3]] → iPLA₂ → PGE₂**).[^huang2011][^braun2025] To isolate signals emitted purely by dying tumor or stromal cells, investigators seeded small tracer populations (**500–1,000** firefly-luciferase-tagged murine **4T1** breast carcinoma cells) onto massive beds (**2.5 × 10⁵** cells; a **250:1 dead-to-live bolus**) of lethally X-irradiated feeders implanted into **immunodeficient *nude* mice** lacking T-cell adaptive governance, tracking whole-graft bioluminescence (which reflects vascular perfusion, oxygen/ATP access, and stromal recruitment alongside cell division):[^huang2011]

- **Feeder-stimulated tumor growth:** At `1,000` live tagged `4T1` cells, irradiated unlabeled `4T1` feeders drove up to **700-fold** greater luciferase signal than `live dividing unlabeled 4T1 feeders` (which actively compete with the tagged tracer seed inside the same graft). Switching feeders to irradiated wild-type mouse embryonic fibroblasts (`MEFs`) boosted growth up to **400-fold** relative to `1,000` tagged `4T1` cells injected *alone* in the opposite flank.[^huang2011]
- **Caspase-3 and eicosanoid dependence:** Using `Casp3`⁻/⁻ irradiated MEFs (`500` live `4T1` cells) collapsed that stromal rescue up to **1,000-fold** back down toward the alone-injected baseline, while expressing truncated constitutively active **iPLA₂** restored `PGE₂` release, `PGE₂` pre-treatment sped `1,000`-cell tumor outgrowth, and blocking **COX-1/2** (`indomethacin`) or silencing **EP2** receptors blunted feeder stimulation.[^huang2011]

Unadjusted human Kaplan–Meier cohorts follow the same superficial direction—high immunohistochemical cleaved **[[caspase-3-casp3-p42574|CASP3]]** associates with elevated relapse after radiotherapy in head-and-neck carcinoma and worse survival in advanced breast cancer—yet omit multivariable Cox adjustment for proliferative index or tumor grade, leaving baseline mitotic aggressiveness as a major confounder (fast-cycling tumors naturally generate high birth *and* death rates simultaneously).[^huang2011]

Directly drugging the death trigger is equally hazardous. Co-administering pan-caspase inhibitors during radiotherapy invites two cellular escape paths:

1. **Undead secretion, `anastasis`, and `EndoG` mutagenesis:** Blocking executioner caspases *after* **mitochondrial outer membrane permeabilization (`MOMP`)**—the step where mitochondrial membranes puncture to release cytochrome *c*—either strands doomed cells in chronic mitogen secretion or enables **anastasis**, cellular reversal and survival after crossing late apoptotic checkpoints.[^tang2012] Sublethal Caspase-3 bursts also dispatch mitochondrial **Endonuclease G (`EndoG`)** into the nucleus, inflicting chronic DNA double-strand breaks, genomic instability, and **`Src–STAT3`** malignant transformation.[^liu2015][^zhu2024]
2. **Release of lytic necroptosis and `DAMPs`:** Blocking apical **Caspase-8** removes its physiological brake on the **RIPK1–RIPK3–MLKL** kinase cascade, which ruptures the plasma membrane (**lytic necroptosis**, [[apoptosis|apoptosis]]) and floods the niche with **damage-associated molecular patterns (`DAMPs`)** that amplify tumor-promoting inflammation.

Targeting downstream paracrine effectors (`COX-1/2`, `EP2`, or `p38`/`Wgn` relays) spares doomed tumor cells from completing suicide while intercepting the proliferative wave in mouse models.[^huang2011][^braun2025] Yet human clinical trials show how sharply systemic tumor biology resists that simple recipe: adding the selective **COX-2** inhibitor **celecoxib** to standard platinum chemotherapy in **CALGB 30801** (`n = 312`, advanced non-small-cell lung cancer selected for `COX-2` overexpression) stopped early for futility with no progression-free or overall survival advantage (`HR = 1.046` in highest `COX-2` patients).[^calgb30801] Worse, an exploratory follow-up of the randomized **REMAGUS02** neoadjuvant breast-cancer trial found overall inferior event-free survival with celecoxib (`HR = 1.70`, `p = 0.046`), driven sharply by excess relapse in **estrogen-receptor-negative / `PTGS2`-low** tumors (`HR = 7.18`, interaction `p = 0.01`).[^remagus02] Translating anti-AiP strategies into clinics will likely require patient stratification and downstream `EP2`/`p38`/survival-lineage targets rather than untargeted systemic COX-2 suppression.

---

## Injury pulses, replication mutagenesis, and the clonal double bind

Why does tissue maintenance force organisms onto a razor's edge between functional decay and cancer—and why do pulsed compensatory repairs outperform permanently elevated tissue turnover?

The general baseline theorem for **constitutive open-loop clonal governance** ($f_0 = \text{const}$ across well-mixed compartments, along with *PNAS* evolutionary debates, zero-death differentiation hierarchies, crowding potentials, crypt drift, and regime switching) lives on **[[Clonal governance]]** (`[[Clonal governance#the-intercellular-competition-double-bind|the intercellular competition double bind]]` and `[[Clonal governance#hierarchical-tissue-architecture-and-compartment-size|hierarchical tissue architecture]]`). Summarizing its four-state reduction ($v \in \{0,1\}$ housekeeping vigor and $c \in \{0,1\}$ multicellular cooperation, where normalized vitality happens to equal the healthy cell fraction $\tilde{V}(\tau) = p_v(\tau)\,p_c(\tau) = \rho_h(\tau)$ at $n = m = 1$) connects those open-loop equilibrium bounds directly to two real-world features of **compensatory proliferation**:

1. **Replication-coupled mutagenesis ($\beta > 0$):** Constant-clock models[^nelson2017][^michaels2023] hold oncogenic mutation flux fixed in chronological time ($r_0 = \mu_c/\mu_v$, i.e., $\beta = 0$) independent of division rate. Under that idealization, setting the cooperative division penalty $k \to 0$ would allow infinite turnover ($\tilde{f}_{\text{eff}} \to \infty$) to purge every degraded $v=0$ cell with zero added mutation risk. Adding S-phase replication mutagenesis scales the effective cheater mutation ratio linearly with turnover load $\tilde{f}_{\text{eff}} = f_{\text{eff}}/\mu_v$:
   $$r_{\text{eff}}\bigl(\tilde{f}_{\text{eff}}\bigr) = r_0\bigl(1 + \beta\,\tilde{f}_{\text{eff}}\bigr)$$
   so division pressure $\tilde{f}_{\text{eff}}$ drives vigorous ($v=1$) purging ($\tilde{f}_v = \tilde{f}_{\text{eff}}(1 - k)$) while eroding [[multicellular-cooperation|multicellular cooperation]] ($c=1$) through **both** clonal selective advantage ($\tilde{f}_c = \tilde{f}_{\text{eff}} k$) **and** faster oncogenic mutation supply ($r_{\text{eff}}$):
   $$p_v(\tau) = \begin{cases} \dfrac{1}{1 + \tau}, & \tilde{f}_v = 1, \\[6pt] \dfrac{\tilde{f}_v - 1}{\tilde{f}_v - e^{-(\tilde{f}_v - 1)\tau}}, & \tilde{f}_v \neq 1, \end{cases}$$
   $$p_c(\tau) = \frac{\tilde{f}_c + r_{\text{eff}}}{\tilde{f}_c + r_{\text{eff}}\,e^{(\tilde{f}_c + r_{\text{eff}})\tau}}$$
   across dimensionless somatic age $\tau = \mu_v t$.[^michaels2023] Note carefully that at $k = 0.3, r_0 = 0.01, \beta = 0$, maximizing $\tilde{V}(3)$ at Michaels and Mahadevan's baseline horizon $T = 3\,\mu_v^{-1}$ sits at $\tilde{f}_0^* = 3.870$, whereas positive S-phase mutagenesis ($\beta > 0$) depresses the peak and shifts optimal turnover left toward slower replacement.
2. **Closed-loop injury gating ($\tilde{f}_{\text{eff}}(\tau) = \tilde{f}_{\text{base}} + \Delta\tilde{f}(\tau)$):** Unlike constitutively churning open-loop tissues, closed-loop Hippo crowding locks, liver `CCH` thresholds, and pupal `E93` silencing keep undamaged tissue near a quiescent floor $\tilde{f}_{\text{base}}$ and fire a bounded injury burst $\Delta\tilde{f}$ only during tissue repair ($\tau \in [1.0, 2.0]$ in Figure 2), returning cleanly to $\tilde{f}_{\text{base}}$ once vacancies seal. Tracking the exact piecewise Riccati trajectory demonstrates why **bounded repair pulsing beats both starvation and lock-in**: staying frozen at low $\tilde{f}_{\text{base}}$ wastes tissue vigor to stagnant $v=0$ accumulation, while failing to re-lock after injury (chronic inflammation or `p35` undead signaling, stuck at $\tilde{f}_{\text{base}} + \Delta\tilde{f}$ indefinitely) produces brief short-term vigor parity followed by steep late-life collapse via clonal cheater takeover ($p_c \to 0$).

```vega-lite
{
  "$schema": "https://vega.github.io/schema/vega-lite/v6.json",
  "description": "Figure 2. Two-panel model linking the clonal-governance double bind (top) to injury-gated compensatory proliferation pulses versus chronic turnover (bottom). Top panel plots normalized vitality V(3) at horizon T = 3/μv against total turnover pressure f_eff/μv under both constant-clock mutation (β = 0, dashed) and S-phase replication mutagenesis r_eff = r0*(1 + β*f_eff/μv) (solid), evaluated consistently at the live cooperation cost k (with r0 = 0.01). Bottom panel propagates the exact piecewise Riccati equations over scaled somatic age τ = μv*t: low resting maintenance (f_base), a closed-loop compensatory pulse (f_base + Δf over τ in [1.0, 2.0] before Hippo/junction re-locking), and un-gated chronic turnover (f_base + Δf stuck ON from τ = 1.0 onward).",
  "padding": {"top": 34, "right": 14, "left": 8, "bottom": 8},
  "params": [
    {"name": "fBase", "value": 0.8, "bind": {"input": "range", "min": 0.2, "max": 4.0, "step": 0.2, "name": "Resting turnover (f_base / μv)"}},
    {"name": "deltaF", "value": 3.8, "bind": {"input": "range", "min": 0.0, "max": 6.0, "step": 0.2, "name": "Injury / undead load (Δf / μv)"}},
    {"name": "k", "value": 0.45, "bind": {"input": "range", "min": 0.05, "max": 0.85, "step": 0.05, "name": "Cooperation tax / cheater edge (k)"}},
    {"name": "beta", "value": 0.25, "bind": {"input": "range", "min": 0.0, "max": 0.6, "step": 0.05, "name": "S-phase mutagenesis (β)"}}
  ],
  "spacing": 32,
  "vconcat": [
    {
      "width": 560,
      "height": 230,
      "layer": [
        {
          "data": {"sequence": {"start": 0.0, "stop": 10.05, "step": 0.1, "as": "x"}},
          "transform": [
            {"calculate": "datum.x * (1 - k)", "as": "fv"},
            {"calculate": "datum.x * k", "as": "fc"},
            {"calculate": "abs(datum.fv - 1) < 1e-6 ? 1 / 4 : (datum.fv - 1) / (datum.fv - exp(-(datum.fv - 1) * 3))", "as": "pv"},
            {"calculate": "(datum.fc + 0.01) / (datum.fc + 0.01 * exp((datum.fc + 0.01) * 3))", "as": "pc"},
            {"calculate": "datum.pv * datum.pc", "as": "Vconst"}
          ],
          "mark": {"type": "line", "style": "alt", "strokeDash": [5, 4], "strokeWidth": 1.8, "opacity": 0.85},
          "encoding": {"x": {"field": "x", "type": "quantitative"}, "y": {"field": "Vconst", "type": "quantitative"}}
        },
        {
          "data": {"sequence": {"start": 0.0, "stop": 10.05, "step": 0.1, "as": "x"}},
          "transform": [
            {"calculate": "datum.x * (1 - k)", "as": "fv"},
            {"calculate": "datum.x * k", "as": "fc"},
            {"calculate": "0.01 * (1 + beta * datum.x)", "as": "r"},
            {"calculate": "abs(datum.fv - 1) < 1e-6 ? 1 / 4 : (datum.fv - 1) / (datum.fv - exp(-(datum.fv - 1) * 3))", "as": "pv"},
            {"calculate": "(datum.fc + datum.r) / (datum.fc + datum.r * exp((datum.fc + datum.r) * 3))", "as": "pc"},
            {"calculate": "datum.pv * datum.pc", "as": "Vmut"}
          ],
          "mark": {"type": "line", "style": "model", "strokeWidth": 2.6},
          "encoding": {"x": {"field": "x", "type": "quantitative"}, "y": {"field": "Vmut", "type": "quantitative"}}
        },
        {
          "data": {"values": [{"kind": "base", "y0": 0}]},
          "transform": [
            {"calculate": "fBase", "as": "x"},
            {"calculate": "datum.x * (1 - k)", "as": "fv"},
            {"calculate": "datum.x * k", "as": "fc"},
            {"calculate": "0.01 * (1 + beta * datum.x)", "as": "r"},
            {"calculate": "abs(datum.fv - 1) < 1e-6 ? 1 / 4 : (datum.fv - 1) / (datum.fv - exp(-(datum.fv - 1) * 3))", "as": "pv"},
            {"calculate": "(datum.fc + datum.r) / (datum.fc + datum.r * exp((datum.fc + datum.r) * 3))", "as": "pc"},
            {"calculate": "datum.pv * datum.pc", "as": "V"}
          ],
          "layer": [
            {"mark": {"type": "rule", "style": "guide", "strokeDash": [2, 2], "strokeWidth": 1.1}, "encoding": {"x": {"field": "x", "type": "quantitative"}, "y": {"field": "y0", "type": "quantitative"}, "y2": {"field": "V", "type": "quantitative"}}},
            {"mark": {"type": "circle", "style": "model-point", "size": 70, "clip": false}, "encoding": {"x": {"field": "x", "type": "quantitative"}, "y": {"field": "V", "type": "quantitative"}}}
          ]
        },
        {
          "data": {"values": [{"kind": "chronic", "y0": 0}]},
          "transform": [
            {"calculate": "fBase + deltaF", "as": "x"},
            {"calculate": "datum.x * (1 - k)", "as": "fv"},
            {"calculate": "datum.x * k", "as": "fc"},
            {"calculate": "0.01 * (1 + beta * datum.x)", "as": "r"},
            {"calculate": "abs(datum.fv - 1) < 1e-6 ? 1 / 4 : (datum.fv - 1) / (datum.fv - exp(-(datum.fv - 1) * 3))", "as": "pv"},
            {"calculate": "(datum.fc + datum.r) / (datum.fc + datum.r * exp((datum.fc + datum.r) * 3))", "as": "pc"},
            {"calculate": "datum.pv * datum.pc", "as": "V"}
          ],
          "layer": [
            {"mark": {"type": "rule", "style": "alt", "strokeDash": [2, 2], "strokeWidth": 1.1, "opacity": 0.75}, "encoding": {"x": {"field": "x", "type": "quantitative"}, "y": {"field": "y0", "type": "quantitative"}, "y2": {"field": "V", "type": "quantitative"}}},
            {"mark": {"type": "circle", "style": "alt", "size": 70, "clip": false}, "encoding": {"x": {"field": "x", "type": "quantitative"}, "y": {"field": "V", "type": "quantitative"}}}
          ]
        },
        {
          "data": {"values": [{}]},
          "transform": [
            {"calculate": "fBase * (1 - k)", "as": "fvB"},
            {"calculate": "fBase * k", "as": "fcB"},
            {"calculate": "0.01 * (1 + beta * fBase)", "as": "rB"},
            {"calculate": "(abs(datum.fvB - 1) < 1e-6 ? 0.25 : (datum.fvB - 1) / (datum.fvB - exp(-(datum.fvB - 1) * 3))) * ((datum.fcB + datum.rB) / (datum.fcB + datum.rB * exp((datum.fcB + datum.rB) * 3)))", "as": "VB"},
            {"calculate": "(fBase + deltaF) * (1 - k)", "as": "fvC"},
            {"calculate": "(fBase + deltaF) * k", "as": "fcC"},
            {"calculate": "0.01 * (1 + beta * (fBase + deltaF))", "as": "rC"},
            {"calculate": "(abs(datum.fvC - 1) < 1e-6 ? 0.25 : (datum.fvC - 1) / (datum.fvC - exp(-(datum.fvC - 1) * 3))) * ((datum.fcC + datum.rC) / (datum.fcC + datum.rC * exp((datum.fcC + datum.rC) * 3)))", "as": "VC"},
            {"calculate": "'Rest V(3) = ' + format(datum.VB, '.3f') + '  |  Chronic V(3) = ' + format(datum.VC, '.3f')", "as": "hdr"}
          ],
          "mark": {"type": "text", "style": "model-label", "align": "left", "dx": 4, "dy": -10, "fontSize": 12, "clip": false},
          "encoding": {"x": {"datum": 0, "type": "quantitative"}, "y": {"datum": 1.0, "type": "quantitative"}, "text": {"field": "hdr", "type": "nominal"}}
        },
        {
          "data": {"values": [{}]},
          "mark": {"type": "text", "style": "label", "align": "left", "dx": 4, "dy": -24, "fontSize": 11.5, "clip": false},
          "encoding": {"x": {"datum": 0, "type": "quantitative"}, "y": {"datum": 1.0, "type": "quantitative"}, "text": {"value": "Solid: replication mutagenesis (β)  |  Dashed: β = 0 limit"}}
        }
      ],
      "encoding": {
        "x": {"type": "quantitative", "scale": {"domain": [0, 10], "nice": false}, "axis": {"title": "Total turnover load f_eff / μv", "values": [0, 2, 4, 6, 8, 10]}},
        "y": {"type": "quantitative", "scale": {"domain": [0, 1], "nice": false}, "axis": {"title": "Horizon vitality V(3)", "values": [0, 0.2, 0.4, 0.6, 0.8, 1.0]}}
      }
    },
    {
      "width": 560,
      "height": 230,
      "layer": [
        {
          "data": {"values": [{"x1": 1.0, "x2": 2.0, "y1": 0, "y2": 1}]},
          "mark": {"type": "rect", "style": "guide", "opacity": 0.14},
          "encoding": {
            "x": {"field": "x1", "type": "quantitative"},
            "x2": {"field": "x2", "type": "quantitative"},
            "y": {"field": "y1", "type": "quantitative"},
            "y2": {"field": "y2", "type": "quantitative"}
          }
        },
        {
          "data": {"sequence": {"start": 0.0, "stop": 5.05, "step": 0.05, "as": "tau"}},
          "transform": [
            {"calculate": "fBase * (1 - k)", "as": "fvB"},
            {"calculate": "fBase * k", "as": "fcB"},
            {"calculate": "0.01 * (1 + beta * fBase)", "as": "rB"},
            {"calculate": "abs(datum.fvB - 1) < 1e-6 ? 1 / (1 + datum.tau) : (datum.fvB - 1) / (datum.fvB - exp(-(datum.fvB - 1) * datum.tau))", "as": "pvR"},
            {"calculate": "(datum.fcB + datum.rB) / (datum.fcB + datum.rB * exp((datum.fcB + datum.rB) * datum.tau))", "as": "pcR"},
            {"calculate": "datum.pvR * datum.pcR", "as": "Vrest"}
          ],
          "mark": {"type": "line", "style": "guide", "strokeDash": [3, 3], "strokeWidth": 1.8},
          "encoding": {"x": {"field": "tau", "type": "quantitative"}, "y": {"field": "Vrest", "type": "quantitative"}}
        },
        {
          "data": {"sequence": {"start": 0.0, "stop": 5.05, "step": 0.05, "as": "tau"}},
          "transform": [
            {"calculate": "min(datum.tau, 1.0)", "as": "dt1"},
            {"calculate": "max(0, min(datum.tau, 2.0) - 1.0)", "as": "dt2"},
            {"calculate": "max(0, datum.tau - 2.0)", "as": "dt3"},
            {"calculate": "fBase * (1 - k)", "as": "fvB"},
            {"calculate": "fBase * k", "as": "fcB"},
            {"calculate": "0.01 * (1 + beta * fBase)", "as": "rB"},
            {"calculate": "(fBase + deltaF) * (1 - k)", "as": "fvOn"},
            {"calculate": "(fBase + deltaF) * k", "as": "fcOn"},
            {"calculate": "0.01 * (1 + beta * (fBase + deltaF))", "as": "rOn"},
            {"calculate": "abs(datum.fvB - 1) < 1e-6 ? 1 / (1 + datum.dt1) : (datum.fvB - 1) / (datum.fvB - exp(-(datum.fvB - 1) * datum.dt1))", "as": "pv1"},
            {"calculate": "(datum.fcB + datum.rB) / (datum.fcB + datum.rB * exp((datum.fcB + datum.rB) * datum.dt1))", "as": "pc1"},
            {"calculate": "abs(datum.fvOn - 1) < 1e-6 ? datum.pv1 / (1 + datum.pv1 * datum.dt2) : (datum.pv1 * (datum.fvOn - 1)) / (datum.pv1 * datum.fvOn + ((datum.fvOn - 1) - datum.pv1 * datum.fvOn) * exp(-(datum.fvOn - 1) * datum.dt2))", "as": "pv2"},
            {"calculate": "(datum.pc1 * (datum.fcOn + datum.rOn)) / (datum.pc1 * datum.fcOn + (datum.rOn + datum.fcOn * (1 - datum.pc1)) * exp((datum.fcOn + datum.rOn) * datum.dt2))", "as": "pc2"},
            {"calculate": "abs(datum.fvB - 1) < 1e-6 ? datum.pv2 / (1 + datum.pv2 * datum.dt3) : (datum.pv2 * (datum.fvB - 1)) / (datum.pv2 * datum.fvB + ((datum.fvB - 1) - datum.pv2 * datum.fvB) * exp(-(datum.fvB - 1) * datum.dt3))", "as": "pv3"},
            {"calculate": "(datum.pc2 * (datum.fcB + datum.rB)) / (datum.pc2 * datum.fcB + (datum.rB + datum.fcB * (1 - datum.pc2)) * exp((datum.fcB + datum.rB) * datum.dt3))", "as": "pc3"},
            {"calculate": "datum.pv3 * datum.pc3", "as": "Vpulse"}
          ],
          "mark": {"type": "line", "style": "model", "strokeWidth": 2.6},
          "encoding": {"x": {"field": "tau", "type": "quantitative"}, "y": {"field": "Vpulse", "type": "quantitative"}}
        },
        {
          "data": {"sequence": {"start": 0.0, "stop": 5.05, "step": 0.05, "as": "tau"}},
          "transform": [
            {"calculate": "min(datum.tau, 1.0)", "as": "dt1"},
            {"calculate": "max(0, datum.tau - 1.0)", "as": "dtC"},
            {"calculate": "fBase * (1 - k)", "as": "fvB"},
            {"calculate": "fBase * k", "as": "fcB"},
            {"calculate": "0.01 * (1 + beta * fBase)", "as": "rB"},
            {"calculate": "(fBase + deltaF) * (1 - k)", "as": "fvOn"},
            {"calculate": "(fBase + deltaF) * k", "as": "fcOn"},
            {"calculate": "0.01 * (1 + beta * (fBase + deltaF))", "as": "rOn"},
            {"calculate": "abs(datum.fvB - 1) < 1e-6 ? 1 / (1 + datum.dt1) : (datum.fvB - 1) / (datum.fvB - exp(-(datum.fvB - 1) * datum.dt1))", "as": "pv1"},
            {"calculate": "(datum.fcB + datum.rB) / (datum.fcB + datum.rB * exp((datum.fcB + datum.rB) * datum.dt1))", "as": "pc1"},
            {"calculate": "abs(datum.fvOn - 1) < 1e-6 ? datum.pv1 / (1 + datum.pv1 * datum.dtC) : (datum.pv1 * (datum.fvOn - 1)) / (datum.pv1 * datum.fvOn + ((datum.fvOn - 1) - datum.pv1 * datum.fvOn) * exp(-(datum.fvOn - 1) * datum.dtC))", "as": "pvC"},
            {"calculate": "(datum.pc1 * (datum.fcOn + datum.rOn)) / (datum.pc1 * datum.fcOn + (datum.rOn + datum.fcOn * (1 - datum.pc1)) * exp((datum.fcOn + datum.rOn) * datum.dtC))", "as": "pcC"},
            {"calculate": "datum.pvC * datum.pcC", "as": "Vchronic"}
          ],
          "mark": {"type": "line", "style": "alt", "strokeDash": [6, 3], "strokeWidth": 2.2},
          "encoding": {"x": {"field": "tau", "type": "quantitative"}, "y": {"field": "Vchronic", "type": "quantitative"}}
        },
        {
          "data": {"values": [{}]},
          "mark": {"type": "text", "style": "label", "align": "left", "dx": 4, "dy": -10, "fontSize": 11.5, "clip": false},
          "encoding": {"x": {"datum": 0, "type": "quantitative"}, "y": {"datum": 1.0, "type": "quantitative"}, "text": {"value": "Solid: CP pulse [1,2]  |  Dashed: chronic Δf  |  Dotted: rest"}}
        }
      ],
      "encoding": {
        "x": {"type": "quantitative", "scale": {"domain": [0, 5], "nice": false}, "axis": {"title": "Scaled somatic age τ = μv t (shaded pulse window τ = 1..2)", "values": [0, 1, 2, 3, 4, 5]}},
        "y": {"type": "quantitative", "scale": {"domain": [0, 1], "nice": false}, "axis": {"title": "Tissue vitality V(τ)", "values": [0, 0.2, 0.4, 0.6, 0.8, 1.0]}}
      }
    }
  ]
}
```

Comparative anatomy confirms why different lineages settle on radically different resting setpoints $\tilde{f}_{\text{base}}$ and repair strategies.[^nelson2017] The [[eutely|eutelic]] nematode *Caenorhabditis elegans* shuts down somatic proliferation permanently around hatching ($\tilde{f}_{\text{base}} \approx 0$), confining observable tumors exclusively to its continually dividing germline.[^nelson2017] At the opposite pole, freshwater *Hydra* keeps somatic stem proliferation active across its body column and flushes cellular defects continually by budding off progeny rather than accumulating long-lived non-dividing soma.[^chera2009][^jiang2026] Complex long-lived vertebrates sit between those extremes: non-genetic [[telomeres|telomere shortening]] and metabolic wear still accumulate continuously, so resting compartments suppress routine proliferation while reserving high-output division strictly for acute, gated injury pulses—or bypassing DNA synthesis altogether through hypertrophy and binucleate splitting whenever possible.[^miyaoka2012][^nelson2017]

---

## See also

- [[Clonal governance]] — general baseline double bind, *PNAS* evolutionary debates, hierarchical differentiation trees, and small-niche drift
- [[Conflict between development and tumor suppression]] — adult regenerative chromatin lockouts and developmental tumor suppression
- [[tumor-suppressor-theory-of-aging|Tumor suppressor theory of aging]] — systemic framing of cancer–degeneration trade-offs
- [[adaptive-oncogenesis|Adaptive oncogenesis]] — how degraded late-life tissue landscapes invert selective fitness across clones
- [[Anti-frontrunner dynamics]] — embryonic suppression of fast-cycling clones
- [[Cell competition]] — loser elimination across viable neighboring clones without tissue deficits
- [[de-darwinization|De-Darwinization]] — suppression of intra-organismal cell-level evolution
- [[Glossary]] — definitions of AiP, CCH, and clonal governance terms

---

## References

[^nelson2017]: Nelson P, Masel J. Intercellular competition and the inevitability of multicellular aging. *Proceedings of the National Academy of Sciences*. 2017;114(49):12982–12987. [doi:10.1073/pnas.1618854114](https://doi.org/10.1073/pnas.1618854114).
[^michaels2023]: Michaels TCT, Mahadevan L. Optimal intercellular competition in senescence and cancer. *Proceedings of the Royal Society A*. 2023;479:20230204. [doi:10.1098/rspa.2023.0204](https://doi.org/10.1098/rspa.2023.0204).
[^bergmann2025ccs]: Bergmann A, Fan Y. Decoding the divide: what distinguishes apoptosis-induced proliferation from compensatory proliferation? *Cell Communication and Signaling*. 2025;23:334. [doi:10.1186/s12964-025-02336-3](https://doi.org/10.1186/s12964-025-02336-3).
[^bergmann2025arg]: Bergmann A. Cell death, compensatory proliferation, and cell competition. *Annual Review of Genetics*. 2025;59:165–187. [doi:10.1146/annurev-genet-012125-083359](https://doi.org/10.1146/annurev-genet-012125-083359).
[^aragona2013]: Aragona M, Panciera T, Manfrin A, et al. A mechanical checkpoint controls multicellular growth through YAP/TAZ regulation by actin-processing factors. *Cell*. 2013;154(5):1047–1059. [doi:10.1016/j.cell.2013.07.042](https://doi.org/10.1016/j.cell.2013.07.042).
[^benhampyle2015]: Benham-Pyle BW, Pruitt BL, Nelson WJ. Mechanical strain induces E-cadherin-dependent Yap1 and β-catenin activation to drive cell cycle entry. *Science*. 2015;348(6238):1024–1027. [doi:10.1126/science.aaa4559](https://doi.org/10.1126/science.aaa4559).
[^chera2009]: Chera S, Ghila L, Dobretz K, et al. Apoptotic cells provide an unexpected source of Wnt3 signaling to drive *Hydra* head regeneration. *Developmental Cell*. 2009;17(2):279–289. [doi:10.1016/j.devcel.2009.07.014](https://doi.org/10.1016/j.devcel.2009.07.014).
[^jiang2026]: Jiang M, Yu Y, Jiao Z, et al. Dying cells as architects of the stem cell niche: a conserved mechanism driving tissue regeneration and tumor therapy resistance. *Cell Communication and Signaling*. 2026;24:220. [doi:10.1186/s12964-026-02777-4](https://doi.org/10.1186/s12964-026-02777-4).
[^braun2025]: Braun T, Afgin N, Sapozhnikov L, Sivan E, Bergmann A, Baena-Lopez LA, Yacobi-Sharon K, Arama E. Apoptosis-resistant cells drive compensatory proliferation via cell-autonomous and non-autonomous functions of the initiator caspase Dronc. *Nature Communications*. 2025;16:10871. [doi:10.1038/s41467-025-65996-2](https://doi.org/10.1038/s41467-025-65996-2).
[^li2010]: Li F, Huang Q, Chen J, et al. Apoptotic cells activate the "phoenix rising" pathway to promote wound healing and tissue regeneration. *Science Signaling*. 2010;3(110):ra13. [doi:10.1126/scisignal.2000634](https://doi.org/10.1126/scisignal.2000634).
[^huang2011]: Huang Q, Li F, Liu X, et al. Caspase 3-mediated stimulation of tumor cell repopulation during cancer radiotherapy. *Nature Medicine*. 2011;17:860–866. [doi:10.1038/nm.2385](https://doi.org/10.1038/nm.2385). *Note on clinical survival data:* unadjusted radiotherapy-treated HNSCC cohort (`n = 39`; text `p = 0.011`, Fig. 6c log-rank `p = 0.0114`, `HR = 3.44`, `95% CI: 1.35–8.75`), advanced breast cancer IHC cohort (`n = 48`; text `p = 0.0002`, Fig. 6d log-rank `p = 0.0006`, `HR = 5.29`, `95% CI: 1.70–16.46`), and `CASP3` mRNA microarray cohort (`n = 249`; `p = 0.0001`).
[^yosefzon2018]: Yosefzon Y, Soteriou D, Feldman A, et al. Caspase-3 regulates YAP-dependent cell proliferation and organ size. *Molecular Cell*. 2018;70(4):573–587.e4. [doi:10.1016/j.molcel.2018.04.019](https://doi.org/10.1016/j.molcel.2018.04.019).
[^huh2004]: Huh JR, Guo M, Hay BA. Compensatory proliferation induced by cell death in the *Drosophila* wing disc requires activity of the apical cell death caspase Dronc in a nonapoptotic role. *Current Biology*. 2004;14(14):1262–1266. [doi:10.1016/j.cub.2004.06.015](https://doi.org/10.1016/j.cub.2004.06.015).
[^ryoo2004]: Ryoo HD, Gorenc T, Steller H. Apoptotic cells can induce compensatory cell proliferation through the JNK and the Wingless signaling pathways. *Developmental Cell*. 2004;7(4):491–501. [doi:10.1016/j.devcel.2004.08.019](https://doi.org/10.1016/j.devcel.2004.08.019).
[^perezgarijo2004]: Pérez-Garijo A, Martín FA, Morata G. Caspase inhibition during apoptosis causes abnormal signalling and developmental aberrations in *Drosophila*. *Development*. 2004;131(22):5591–5598. [doi:10.1242/dev.01432](https://doi.org/10.1242/dev.01432).
[^perezgarijo2009]: Pérez-Garijo A, Shlevkov E, Morata G. The role of Dpp and Wg in compensatory proliferation and in the formation of hyperplastic overgrowths caused by apoptotic cells in the *Drosophila* wing disc. *Development*. 2009;136(7):1169–1177. [doi:10.1242/dev.034017](https://doi.org/10.1242/dev.034017).
[^fan2008]: Fan Y, Bergmann A. Distinct mechanisms of apoptosis-induced compensatory proliferation in proliferating and differentiating tissues in the *Drosophila* eye. *Developmental Cell*. 2008;14(3):399–410. [doi:10.1016/j.devcel.2008.01.003](https://doi.org/10.1016/j.devcel.2008.01.003).
[^suthar2026]: Suthar KP, Hounsell C, Fan Y, Bergmann A. Calcium signaling regulates apoptosis-induced proliferation in *Drosophila* (including published *PLOS Biology* Round 1–2 peer-review history). *PLOS Biology*. 2026;24:e3003607. [doi:10.1371/journal.pbio.3003607](https://doi.org/10.1371/journal.pbio.3003607).
[^miyaoka2012]: Miyaoka Y, Ebato K, Kato H, Arakawa S, Shimizu S, Miyajima A. Hypertrophy and unconventional cell division of hepatocytes underlie liver regeneration. *Current Biology*. 2012;22(13):1166–1175. [doi:10.1016/j.cub.2012.05.016](https://doi.org/10.1016/j.cub.2012.05.016).
[^korchilava2025]: Korchilava B, Khachidze T, Megrelishvili N, et al. Liver regeneration after partial hepatectomy: Triggers and mechanisms. *World Journal of Hepatology*. 2025;17(7):107378. [doi:10.4254/wjh.v17.i7.107378](https://doi.org/10.4254/wjh.v17.i7.107378).
[^tamori2013]: Tamori Y, Deng WM. Tissue repair through cell competition and compensatory cellular hypertrophy in postmitotic epithelia. *Developmental Cell*. 2013;25(4):350–363. [doi:10.1016/j.devcel.2013.04.013](https://doi.org/10.1016/j.devcel.2013.04.013).
[^losick2013]: Losick VP, Fox DT, Spradling AC. Polyploidization and cell fusion contribute to wound healing in the adult *Drosophila* epithelium. *Current Biology*. 2013;23(22):2224–2232. [doi:10.1016/j.cub.2013.09.029](https://doi.org/10.1016/j.cub.2013.09.029).
[^losick2016]: Losick VP, Jun AS, Spradling AC. Wound-induced polyploidization: regulation by Hippo and JNK signaling and conservation in mammals. *PLOS ONE*. 2016;11(3):e0151251. [doi:10.1371/journal.pone.0151251](https://doi.org/10.1371/journal.pone.0151251).
[^ahmeddeprado2024]: Ahmed-de-Prado S, Estella C, Baonza A. Temporal dynamics of apoptosis-induced proliferation in pupal wing development: implications for regenerative ability. *BMC Biology*. 2024;22:98. [doi:10.1186/s12915-024-01894-1](https://doi.org/10.1186/s12915-024-01894-1).
[^quinn2025]: Quinn JW, Lee MC, Van Hazel C, et al. A threshold level of JNK activates damage-responsive enhancers via JAK/STAT to promote tissue regeneration. *Development*. 2025;152:dev204632. [doi:10.1242/dev.204632](https://doi.org/10.1242/dev.204632).
[^luedde2007]: Luedde T, Beraza N, Kotsikoris V, van Loo G, Nenci A, De Vos R, Roskams T, Trautwein C, Pasparakis M. Deletion of NEMO/IKKγ in liver parenchymal cells causes steatohepatitis and hepatocellular carcinoma. *Cancer Cell*. 2007;11(2):119–132. [doi:10.1016/j.ccr.2006.12.016](https://doi.org/10.1016/j.ccr.2006.12.016).
[^maeda2005]: Maeda S, Kamata H, Luo JL, Leffert H, Karin M. IKKβ couples hepatocyte death to cytokine-driven compensatory proliferation that promotes chemical hepatocarcinogenesis. *Cell*. 2005;121(7):977–990. [doi:10.1016/j.cell.2005.04.014](https://doi.org/10.1016/j.cell.2005.04.014).
[^tang2012]: Tang HL, Tang HM, Mak KH, et al. Cell survival, DNA damage, and oncogenic transformation after a transient and reversible apoptotic response. *Molecular Biology of the Cell*. 2012;23(12):2240–2252. [doi:10.1091/mbc.e11-11-0926](https://doi.org/10.1091/mbc.e11-11-0926).
[^liu2015]: Liu X, He Y, Li F, Huang Q, Kato TA, Hall RP, Li CY. Caspase-3 promotes genetic instability and carcinogenesis. *Molecular Cell*. 2015;58(2):284–296. [doi:10.1016/j.molcel.2015.03.003](https://doi.org/10.1016/j.molcel.2015.03.003).
[^zhu2024]: Zhu C, Fan F, Li CY, et al. Caspase-3 promotes oncogene-induced malignant transformation via EndoG-dependent Src-STAT3 phosphorylation. *Cell Death & Disease*. 2024;15:486. [doi:10.1038/s41419-024-06884-3](https://doi.org/10.1038/s41419-024-06884-3).
[^calgb30801]: Edelman MJ, Wang X, Hodgson L, Cheney RT, Baggstrom MQ, et al. Phase III randomized, placebo-controlled, double-blind trial of celecoxib in addition to standard chemotherapy for advanced non–small-cell lung cancer with cyclooxygenase-2 overexpression: CALGB 30801 (Alliance). *Journal of Clinical Oncology*. 2017;35(19):2184–2192. [doi:10.1200/JCO.2016.71.3743](https://doi.org/10.1200/JCO.2016.71.3743).
[^remagus02]: Hamy AS, Tury S, Wang X, Gao J, Pierga JY, et al. Celecoxib with neoadjuvant chemotherapy for breast cancer might worsen outcomes differentially by COX-2 expression and ER status: Exploratory analysis of the REMAGUS02 trial. *Journal of Clinical Oncology*. 2019;37(8):624–635. [doi:10.1200/JCO.18.00636](https://doi.org/10.1200/JCO.18.00636).
