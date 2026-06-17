---
title: Types of cell senescence
tags:
- content/wiki
date: 2026-05-04
draft: true
aliases:
- 
---
# Types of cell senescence

## 1. Quiescence

Quiescence (G₀) is a reversible cell cycle exit state that cells enter in response to growth factor withdrawal or contact inhibition, retaining the capacity to re-enter the cell cycle upon mitogenic stimulation. Senescence, by contrast, is a deeply entrenched, generally irreversible cell cycle arrest accompanied by extensive phenotypic changes including chromatin remodeling, metabolic reprogramming, and the senescence-associated secretory phenotype (SASP). Senescence functions as an evolutionary failsafe to permanently incapacitate cells carrying high oncogenic risk—such as those with activated oncogenes (oncogene-induced senescence, OIS) or critically short telomeres (replicative senescence)—by rendering mitosis physically impossible **\[**1**–**3**\]**.

Fujimaki and Yao (2020) have proposed that quiescence and senescence exist on a continuum: quiescence progressively "deepens" into senescence through a dimmer-switch mechanism, where the activation threshold of the RB-E2F-CDK gene network switch continuously increases until the cell can no longer respond to mitogenic signals **\[**1**\]**. This framework positions quiescence and senescence not as discrete binary states but as attractor basins along a continuum of proliferative potential.

## 2. Core Molecular Control Loops of Quiescence

### 2.1 The RB-E2F Bistable Switch

The foundational control loop governing quiescence is the RB-E2F bistable switch. In quiescent cells, hypophosphorylated retinoblastoma protein (pRb) binds and represses E2F transcription factors, silencing genes required for DNA replication (e.g., CCNE, CCNA, PCNA, MCM proteins). Upon growth factor signaling, cyclin D-CDK4/6 and cyclin E-CDK2 sequentially phosphorylate pRb, relieving E2F repression and triggering S-phase entry. This system operates as a bistable switch due to positive feedback: E2F activates cyclin E transcription, and cyclin E-CDK2 further phosphorylates pRb, creating self-reinforcing activation **\[**1**,**4**\]**. This is why the G1/S transition behaves as a true "restriction point" — once past it, cells are committed to division.

### 2.2 The DREAM Complex and p130-E2F4 Repression

A second, less appreciated but equally critical control loop for quiescence involves the **DREAM complex** (DP, RB-like, E2F, and MuvB). The DREAM complex consists of p130 (or p107), E2F4, DP1, and a five-protein MuvB core (LIN9, LIN37, LIN52, LIN54, RBBP4). During quiescence, DREAM represses cell cycle-dependent genes including those required for G2/M progression (e.g., CCNB1, CDK1, AURKA, PLK1) **\[**5**,**6**\]**. This goes beyond simple G1 arrest: DREAM actively silences the late cell cycle transcriptional program, creating a "second layer" of quiescence control.

A rare but critical node within this loop: **DYRK1A protein kinase** phosphorylates LIN52 at serine 28, which is required for DREAM assembly. Inhibition of DYRK1A or mutation of LIN52 disrupts DREAM assembly, impairing quiescence entry and OIS **\[**6**\]**.

### 2.3 APC/C^CDH1 - Proteolytic Reinforcement of Quiescence

The anaphase-promoting complex/cyclosome (APC/C) with its coactivator CDH1 actively degrades S-phase and M-phase promoting proteins (cyclin A, cyclin B, geminin, SKP2, and CDC25A) in quiescent cells. Bainor et al. (2018) demonstrated that the HDAC-associated Sin3B protein cooperates with DREAM to repress target genes, and that Sin3B inactivation alone is insufficient to allow S-phase re-entry — but when combined with APC/C^CDH1 inhibition, quiescent cells efficiently re-enter S phase **\[**7**\]**. This reveals a functional cooperation between transcriptional repression (DREAM-Sin3B) and post-translational proteolytic control (APC/C^CDH1) that maintains quiescence.

### 2.4 p53-p21 in Maintaining Quiescence

p53 contributes to both establishing and maintaining quiescence through transcriptional activation of p21^WAF1/CIP1. A role for p53 in maintaining quiescence has been demonstrated: p53-null cells fail to sustain a stable G₀ arrest and spontaneously re-enter the cell cycle **\[**8**\]**. The p53-p21 axis provides a "brake" on CDK activity at low levels, maintaining quiescence without fully committing to senescence.

## 3. Core Senescence Control Loops

### 3.1 The p53-p21-RB Axis (Primary Loop)

Upon oncogenic or genotoxic stress, the DNA damage response (DDR) activates ATM/ATR-CHK1/CHK2 kinases, which stabilize and activate p53. p53 transcriptionally upregulates p21^CIP1, a universal CDK inhibitor that binds and inhibits cyclin D-CDK4/6, cyclin E-CDK2, and cyclin B-CDK1 complexes. This prevents pRb phosphorylation, maintaining it in its active, growth-suppressive hypophosphorylated form. p21 also directly inhibits CDK1 by blocking Thr161 phosphorylation, enforcing the G2/M checkpoint **\[**9**,**10**\]**.

A key rare loop involves **p53-mediated transcriptional repression via DREAM**. Uxa et al. (2019) demonstrated that p53 activation leads not only to p21 induction but also to recruitment of DREAM and RB to the promoters of cell cycle genes, producing a cooperative gene repression program far broader than p21 alone could achieve. RB and DREAM cooperate to repress both G1/S and G2/M genes, ensuring comprehensive cell cycle shutdown **\[**11**\]**.

### 3.2 The p16^INK4a-RB Irreversibility Loop

p16^INK4a is a CDK4/6-specific inhibitor that, once expressed at high levels, locks pRb in its active hypophosphorylated state. Takahashi et al. (2007) defined the critical distinction: in murine cells, senescence can be reversed by subsequent Rb inactivation, but in **human** cells, once p16^INK4a fully activates the Rb pathway, senescence becomes irreversible and is **not** revoked by subsequent Rb withdrawal **\[**3**\]**. This irreversibility involves the formation of senescence-associated heterochromatin foci (SAHF) that epigenetically silence proliferation-promoting genes (see below). This is a crucial "lock-in" mechanism consistent with your premise.

### 3.3 The p21-ROS Positive Feedback Loop (DDR Amplification)

Passos et al. (2010) identified a dynamic feedback loop between p21 and reactive oxygen species (ROS) that locks cells into "deep" senescence. The initial DDR triggers p21 expression, which causes mitochondrial dysfunction and increased ROS production. ROS in turn causes further DNA damage, which amplifies DDR signaling, creating a self-sustaining loop. Stochastic modeling showed this creates a delayed bistable switch — after several days of oscillation, the system flips into an irreversible "locked" state **\[**12**\]**. This explains why senescence establishment has a characteristic delay period.

### 3.4 The p14^ARF-MDM2-p53 Loop

Oncogenic signals (e.g., Ras, Myc, E2F1) induce p14^ARF (Alternative Reading Frame of the INK4a locus). p14^ARF binds MDM2, sequestering it into the nucleolus and preventing MDM2-mediated ubiquitination and degradation of p53. This relieves p53 from negative regulation, leading to p53 stabilization and activation of p21 and other downstream effectors. This creates an oncogene-sensing loop that links aberrant proliferative signals directly to p53-dependent senescence **\[**13**\]**. Notably, p14^ARF expression can also induce G2 arrest in p53/p21-deficient cells by downregulating CDK1 (CDC2) kinase activity, revealing a p53-independent failsafe.

### 3.5 The mTOR Geroconversion Loop (Quiescence-to-Senescence Transition)

The mTOR pathway drives **geroconversion** — the conversion from quiescence to senescence. Blagosklonny (2018) formulated that mTOR activity in non-proliferating cells (arrested by p21/p16) drives cellular hyperfunction, leading to the senescent phenotype. When CDK inhibitors halt the cell cycle, residual mTOR activity continues to drive cell growth, ribosome biogenesis, and protein synthesis, which becomes maladaptive without division, eventually locking cells into senescence **\[**14**\]**. Leontieva and Blagosklonny (2013) showed that CDK4/6-inhibiting drugs could substitute for p21/p16, but the duration of arrest and mTOR activity determined whether cells underwent geroconversion to senescence or remained quiescent **\[**15**\]**.

Rapamycin and other mTOR inhibitors preserve "re-proliferative potential" (RPP) by suppressing geroconversion, maintaining cells in reversible quiescence rather than allowing them to slide into senescence **\[**14**\]**.

## 4. Rare and Lesser-Understood Control Loops

### 4.1 E2F7: The Atypical Backup Checkpoint

Aksoy et al. (2012) identified E2F7 as the only E2F family member potently upregulated during OIS. E2F7 is a direct p53 transcriptional target that, once induced, binds and represses canonical E2F target genes. Crucially, when RB is disrupted, E2F7 expression increases further, inducing a **second cell cycle checkpoint** that prevents unconstrained division despite aberrant DNA replication. This creates a "double-lock": if RB is lost, E2F7 compensates, providing a backup barrier **\[**16**\]**. This is a rare but critically important backstop mechanism.

### 4.2 DEC1 (BHLHE40/Stra13): The p53-Independent Senescence Effector

DEC1 is a basic helix-loop-helix transcription factor identified as a p53 target gene that mediates p53-dependent premature senescence. Remarkably, DEC1-induced senescence is **p21-independent** — overexpression of DEC1 induces G1 arrest and senescence even in cells where p21 is knocked down. DEC1 thus provides an alternative branch of p53's tumor suppressor program that can operate when p21 is compromised **\[**17**\]**.

### 4.3 CDK5-Rac1 Senescence Requirement

The atypical CDK family member CDK5 — generally considered neuron-specific — is required for senescence in fibroblasts. Alexander et al. (2004) showed that CDK5 represses Rac1 activity, and this repression is necessary for the establishment of senescence. Without CDK5, cells fail to senesce and continue proliferating **\[**18**\]**. This provides an unexpected link between cytoskeletal signaling and senescence commitment.

### 4.4 The 4E-BP/Gas2 Translational Control Loop

Petroulakis et al. (2009) uncovered a p53-dependent translational control mechanism: p53 activation leads to 4E-BP1/2 dephosphorylation, which sequesters the cap-binding protein eIF4E, inhibiting translation of a subset of mRNAs. Among these is Gas2, which stabilizes p53. This creates a positive feedback loop: p53 → 4E-BP activation → translational repression → Gas2 → p53 stabilization. Loss of 4E-BPs in p53-null mice accelerates tumorigenesis, while loss of 4E-BPs in p53-proficient cells paradoxically triggers premature senescence **\[**19**\]**.

### 4.5 The GATA4-p62-Autophagy SASP Loop

Kang et al. (2015) discovered that GATA4 acts as a senescence and SASP regulator. In normal cells, GATA4 is constitutively turned over by p62-mediated selective autophagy (SQSTM1-dependent). The DDR inhibits this autophagy of GATA4, causing GATA4 accumulation, which then activates NF-κB and C/EBPβ to drive SASP gene expression. This creates a senescence-specific inflammatory loop that operates independently of p53 and p16^INK4a **\[**20**\]**.

### 4.6 DEC1/LKB1/AMPK Metabolic Checkpoint

DEC1 negatively regulates AMPK activity via LKB1 **\[**21**\]**. Since AMPK is a key energy sensor that suppresses mTOR activity, this DEC1-LKB1-AMPK axis connects p53-dependent senescence to metabolic control in a poorly appreciated feedback circuit.

### 4.7 The miR-17-92 and miR-34 Regulatory Networks

The **miR-34 family** (direct p53 transcriptional targets) and the **miR-17-92 cluster** form a counter-regulatory network. miR-34a represses CDK4, cyclin E2, E2F1-3, and Bcl-2, reinforcing cell cycle arrest and lowering the apoptotic threshold. The miR-17-92 cluster, by contrast, suppresses p21 expression and promotes cell cycle progression. Oncogenic signaling (e.g., Myc) drives miR-17-92, which opposes senescence — but if p53 is activated, miR-34 supersedes, tipping the balance toward arrest **\[**22**,**23**\]**.

## 5. Epigenetic Lock-In: SAHF and Nuclear Envelope Remodeling

### 5.1 Senescence-Associated Heterochromatin Foci (SAHF)

The most definitive "lock-in" mechanism is SAHF formation. Zhang et al. (2005) showed that the HIRA/ASF1a complex drives formation of macroH2A-containing SAHF, specialized domains of transcriptionally silent heterochromatin that repress proliferation-promoting genes **\[**24**\]**. HIRA transiently colocalizes with HP1 proteins in PML nuclear bodies before HP1 is incorporated into SAHF. This epigenetic silencing is thought to be the structural basis for senescence irreversibility in human cells.

### 5.2 Lamin B1 Loss and Nuclear Envelope Destabilization

A rare but critical finding: senescent cells undergo dramatic loss of lamin B1, a key nuclear lamina protein. This leads to global reorganization of heterochromatic domains, including repositioning of centromeres and telomeres, and contributes to SAHF formation. Lamin B1 loss may also increase genomic instability in senescent cells **\[**25**\]**.

## 6. Transcriptional Repression of DNA Repair as a Senescence Driver

Collin et al. (2018) demonstrated that transcriptional repression of DNA repair genes is both a hallmark and a **cause** of senescence. E2F1/E2F4 target genes involved in nucleotide excision repair, homologous recombination, and mismatch repair become coordinately silenced during senescence, creating a self-reinforcing cycle of accumulating DNA damage that deepens the arrest **\[**26**\]**.


## 7. How Attractor State Transitions Are Executed

### 7.1 The "Dimmer Switch" Model

Fujimaki and Yao (2020) propose that the RB-E2F-CDK network operates as a "dimmer switch" whose activation threshold progressively increases. In early quiescence, low-level mitogenic signaling can still activate the switch. As quiescence deepens, more p16 and p21 accumulate, shifting the dose-response curve to require ever-higher mitogen levels for reactivation. Eventually the threshold exceeds any physiologically achievable mitogen concentration, and the cell becomes functionally senescent **\[**1**\]**.

### 7.2 The "Push-Pull" Bistability Model

Krishna and Laxman (2018) described a "push-pull" bistable oscillator model for quiescence-proliferation transitions. Two states (quiescent and growth) exhibit mutual inhibition and self-reinforcement. Cells in each state exhibit hysteresis (memory of their current state). A central metabolic resource (possibly acetyl-CoA or NADPH) acts as the controller of switching. When the resource falls below a threshold, cells "push" into quiescence; when it rises, they are "pulled" into growth **\[**27**\]**.

### 7.3 The p53-Pulsing Model of Cell Fate Determination

p53 exhibits dynamic pulsing behavior: after DNA damage, p53 levels oscillate with characteristic periodicity. The frequency and amplitude of p53 pulses determine cell fate — pulsatile p53 leads to DNA repair and quiescence, while sustained p53 leads to senescence or apoptosis. This creates distinct attractor states with different downstream consequences: transient p53-p21 activation → reversible quiescence; sustained p53-p21 + p16 → irreversible senescence **\[**28**\]**.

### 7.4 The Phase-Space Description of Cell Cycle

The classic "phase-space" model describes cell cycle entry and exit as movements through attractor landscapes. The proliferative state, quiescence, and senescence each represent distinct attractor basins. The depth of the quiescence attractor increases with time, and senescence represents a "terminal attractor" from which no trajectory leads back to the proliferative basin. This model explicitly describes how increasing p16 and p21 levels deepen the quiescence well, while SAHF formation creates an insurmountable energy barrier for reversion **\[**29**\]**.

### 7.5 Geroconversion: The mTOR-Driven Slide

The geroconversion model provides a specific molecular mechanism for the quiescence→senescence transition: when cell cycle arrest is enforced by CDK inhibitors, but mTOR remains active, the cell continues to grow, synthesize proteins, and secrete factors (SASP). This "hypertrophic" state is incompatible with eventual cell cycle re-entry, shifting the attractor landscape. Rapamycin treatment shifts cells back toward the quiescence attractor **\[**14**,**15**\]**.

## 8. The Adaptive Logic: Senescence as an Irreversible Lock-In Against Oncogenic Risk

Your framing is strongly supported by the literature. The multiplicity of control loops — the p53-p21-pRb axis, the p16^INK4a-RB irreversibility lock, the DREAM-MuvB system, SAHF epigenetic silencing, the p21-ROS feedback amplifier, the E2F7 backup checkpoint, the 4E-BP translational brake, and mTOR geroconversion — all converge on a single functional outcome: **making mitotic entry physically impossible**.

Several features illustrate the adaptive design:

1.  **Redundancy**: The p53-p21 and p16-RB pathways can each independently enforce arrest. If p53 is lost, p16 can still stop the cell cycle **\[**3**,**4**\]**. If RB is lost, E2F7 provides an alternative barrier **\[**16**\]**.
    
2.  **Multiple arrest points**: Senescence can be established from G1 (via pRb dephosphorylation, SAHF) or from G2 (via p21-mediated CDK1 inhibition, preventing mitotic entry). Gire and Dulić (2015) confirmed that cells can enter senescence directly from a G2 arrest, where CDK1 inhibition prevents activation of the mitotic machinery **\[**10**\]**.
    
3.  **The SAP/SASP inflammatory reinforcement**: Once senescent, cells secrete inflammatory factors (IL-6, IL-8, chemokines) via the GATA4-NF-κB-C/EBPβ axis **\[**20**\]**. This reinforces arrest in the senescent cell itself (autocrine) and can induce paracrine senescence in neighboring at-risk cells, spreading the tumor-suppressive barrier.
    
4.  **Translational silencing**: The 4E-BP pathway shuts down cap-dependent translation of growth-promoting and survival proteins, creating a metabolic environment incompatible with mitosis **\[**19**\]**.
    
5.  **Epigenetic tombstoning**: SAHF physically condenses euchromatin at E2F target loci into heterochromatin that is inaccessible to transcription machinery, rendering the cell incapable of expressing proliferation genes even if pRb or p53 are later disabled **\[**3**,**24**\]**.
    

## 9. Summary

The molecular control of quiescence and senescence involves a layered, nested network of at least a dozen distinct control loops, ranging from the well-characterized (p53-p21-RB, p16-RB, p14^ARF-MDM2-p53) to the rare and underappreciated (E2F7 backup, DEC1-p21-independent senescence, CDK5-Rac1, 4E-BP/Gas2, GATA4-autophagy-NF-κB, miR-17-92/miR-34 counter-regulation). These loops exhibit extensive cross-talk, creating a highly canalized system where multiple independent mechanisms must all fail for a cell to escape senescence and become cancerous. The transitions between proliferative, quiescent, and senescent attractor states are driven by bistable switches (RB-E2F), metabolic oscillators (push-pull), delayed positive feedback loops (p21-ROS), and progressive threshold shifts (dimmer switch). The system is designed to make senescence an evolutionarily irreversible lock — a terminal attractor from which no path leads forward to mitosis.

## References

[**\[1\]**Fujimaki K, Yao G. Cell dormancy plasticity: quiescence deepens into senescence through a dimmer switch. Physiological Genomics. 2020;52(11):558–562\
DOI: 10.1152/physiolgenomics.00068.2020](https://sci-hub.box/10.1152/physiolgenomics.00068.2020)[**\[2\]**Birch J, Gil J. Senescence and the SASP: many therapeutic avenues. Genes & Development. 2020;34(23–24):1565–1576\
DOI: 10.1101/gad.343129.120](https://sci-hub.box/10.1101/gad.343129.120)[**\[3\]**Takahashi A, Ohtani N, Hara E. Irreversibility of cellular senescence: dual roles of p16INK4a/Rb-pathway in cell cycle control. Cell Division. 2007;2(1)\
DOI: 10.1186/1747-1028-2-10](https://sci-hub.box/10.1186/1747-1028-2-10)[**\[4\]**Chicas A, Wang X, Zhang C, et al. Dissecting the Unique Role of the Retinoblastoma Tumor Suppressor during Cellular Senescence. Cancer Cell. 2010;17(4):376–387\
DOI: 10.1016/j.ccr.2010.01.023](https://sci-hub.box/10.1016/j.ccr.2010.01.023)[**\[5\]**Sadasivam S, DeCaprio JA. The DREAM complex: master coordinator of cell cycle-dependent gene expression. Nature Reviews Cancer. 2013;13(8):585–595\
DOI: 10.1038/nrc3556](https://sci-hub.box/10.1038/nrc3556)[**\[6\]**Litovchick L, Florens LA, Swanson SK, Washburn MP, DeCaprio JA. DYRK1A protein kinase promotes quiescence and senescence through DREAM complex assembly. Genes & Development. 2011;25(8):801–813\
DOI: 10.1101/gad.2034211](https://sci-hub.box/10.1101/gad.2034211)[**\[7\]**Bainor AJ, Saini S, Calderon A, et al. The HDAC-Associated Sin3B Protein Represses DREAM Complex Targets and Cooperates with APC/C to Promote Quiescence. Cell Reports. 2018;25(10):2797-2807.e8\
DOI: 10.1016/j.celrep.2018.11.024](https://sci-hub.box/10.1016/j.celrep.2018.11.024)[**\[8\]**Itahana K, Dimri GP, Hara E, et al. A role for p53 in maintaining and establishing the quiescence growth arrest in human cells. Journal of Biological Chemistry. 2002;277(20):18206–18214\
DOI: 10.1074/jbc.m201028200](https://sci-hub.box/10.1074/jbc.m201028200)[**\[9\]**Demidenko ZN, Korotchkina LG, Gudkov AV, Blagosklonny MV. Paradoxical suppression of cellular senescence by p53. Proceedings of the National Academy of Sciences. 2010;107(21):9660–9664\
DOI: 10.1073/pnas.1002298107](https://sci-hub.box/10.1073/pnas.1002298107)[**\[10\]**Gire V, Dulić V. Senescence from G2 arrest, revisited. Cell Cycle. 2015;14(3):297–304\
DOI: 10.1080/15384101.2014.1000134](https://sci-hub.box/10.1080/15384101.2014.1000134)[**\[11\]**Uxa S, Bernhart SH, Mages CFS, et al. DREAM and RB cooperate to induce gene repression and cell-cycle arrest in response to p53 activation. Nucleic Acids Research. 2019;47(17):9087–9103\
DOI: 10.1093/nar/gkz635](https://sci-hub.box/10.1093/nar/gkz635)[**\[12\]**Passos JF, Nelson G, Wang C, et al. Feedback between p21 and reactive oxygen production is necessary for cell senescence. Molecular Systems Biology. 2010;6(1)\
DOI: 10.1038/msb.2010.5](https://sci-hub.box/10.1038/msb.2010.5)[**\[13\]**Sherr CJ. The INK4a/ARF network in tumour suppression. Nature Reviews Molecular Cell Biology. 2001;2(10):731–737\
DOI: 10.1038/35096061](https://sci-hub.box/10.1038/35096061)[**\[14\]**Blagosklonny MV. Rapamycin, proliferation and geroconversion to senescence. Cell Cycle. 2018;17(24):2655–2665\
DOI: 10.1080/15384101.2018.1554781](https://sci-hub.box/10.1080/15384101.2018.1554781)[**\[15\]**Leontieva OV, Blagosklonny MV. CDK4/6-inhibiting drug substitutes for p21 and p16 in senescence: Duration of cell cycle arrest and MTOR activity determine geroconversion. Cell Cycle. 2013;12(18):3063–3069\
DOI: 10.4161/cc.26130](https://sci-hub.box/10.4161/cc.26130)[**\[16\]**Aksoy O, Chicas A, Zeng T, Zhao Z, McCurrach M, Wang X, Lowe SW. The atypical E2F family member E2F7 couples the p53 and RB pathways during cellular senescence. Genes & Development. 2012;26(14):1546–1557\
DOI: 10.1101/gad.196238.112](https://sci-hub.box/10.1101/gad.196238.112)[**\[17\]**Qian Y, Zhang J, Yan B, Chen X. DEC1, a Basic Helix-Loop-Helix Transcription Factor and a Novel Target Gene of the p53 Family, Mediates p53-dependent Premature Senescence. Journal of Biological Chemistry. 2008;283(5):2896–2905\
DOI: 10.1074/jbc.m708624200](https://sci-hub.box/10.1074/jbc.m708624200)[**\[18\]**Alexander K, Yang H-S, Hinds PW. Cellular Senescence Requires CDK5 Repression of Rac1 Activity. Molecular and Cellular Biology. 2004;24(7):2808–2819\
DOI: 10.1128/mcb.24.7.2808-2819.2004](https://sci-hub.box/10.1128/mcb.24.7.2808-2819.2004)[**\[19\]**Petroulakis E, Parsyan A, Dowling RJO, et al. p53-Dependent Translational Control of Senescence and Transformation via 4E-BPs. Cancer Cell. 2009;16(5):439–446\
DOI: 10.1016/j.ccr.2009.09.025](https://sci-hub.box/10.1016/j.ccr.2009.09.025)[**\[20\]**Kang C, Xu Q, Martin TD, et al. The DNA damage response induces inflammation and senescence by inhibiting autophagy of GATA4. Science. 2015;349(6255)\
DOI: 10.1126/science.aaa5612](https://sci-hub.box/10.1126/science.aaa5612)[**\[21\]**Shi Y, et al. DEC1 negatively regulates AMPK activity via LKB1. Biochemical and Biophysical Research Communications. 2015;467(4):891–896\
DOI: 10.1016/j.bbrc.2015.10.077](https://sci-hub.box/10.1016/j.bbrc.2015.10.077)[**\[22\]**He L, He X, Lim LP, et al. A microRNA component of the p53 tumour suppressor network. Nature. 2007;447(7148):1130–1134\
DOI: 10.1038/nature05939](https://sci-hub.box/10.1038/nature05939)[**\[23\]**Hong L, Lai M, Chen M, et al. The miR-17-92 cluster of microRNAs confers tumorigenicity by inhibiting oncogene-induced senescence. Cancer Research. 2010;70(21):8547–8557\
DOI: 10.1158/0008-5472.can-10-1938](https://sci-hub.box/10.1158/0008-5472.can-10-1938)[**\[24\]**Zhang R, Poustovoitov MV, Ye X, et al. Formation of MacroH2A-Containing Senescence-Associated Heterochromatin Foci and Senescence Driven by ASF1a and HIRA. Developmental Cell. 2005;8(1):19–30\
DOI: 10.1016/j.devcel.2004.10.019](https://sci-hub.box/10.1016/j.devcel.2004.10.019)[**\[25\]**Shah PP, Donahue G, Otte GL, et al. Lamin B1 depletion in senescent cells triggers large-scale changes in gene expression and the chromatin landscape. Genes & Development. 2013;27(16):1787–1799\
DOI: 10.1101/gad.223834.113](https://sci-hub.box/10.1101/gad.223834.113)[**\[26\]**Collin G, Huna A, Warnier M, Flaman J-M, Bernard D. Transcriptional repression of DNA repair genes is a hallmark and a cause of cellular senescence. Cell Death & Disease. 2018;9(3)\
DOI: 10.1038/s41419-018-0300-z](https://sci-hub.box/10.1038/s41419-018-0300-z)[**\[27\]**Krishna S, Laxman S. A minimal "push–pull" bistability model explains oscillations between quiescent and proliferative cell states. Molecular Biology of the Cell. 2018;29(19):2243–2255\
DOI: 10.1091/mbc.e18-01-0017](https://sci-hub.box/10.1091/mbc.e18-01-0017)[**\[28\]**Purvis JE, Karhohs KW, Mock C, Batchelor E, Loewer A, Lahav G. p53 dynamics control cell fate. Science. 2012;336(6087):1440–1444\
DOI: 10.1126/science.1218351](https://sci-hub.box/10.1126/science.1218351)[**\[29\]**Zs.-Nagy I. Phase-space description of the cell cycle: Application to noncycling, senescent, and transformed cells. Mechanisms of Ageing and Development. 1980;13(2):199–209\
DOI: 10.1016/0047-6374(80)90024-x](https://sci-hub.box/10.1016/0047-6374\(80\)90024-x)