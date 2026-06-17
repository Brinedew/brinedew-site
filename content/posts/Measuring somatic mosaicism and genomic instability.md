---
title: Measuring somatic mosaicism and genomic instability
tags:
  - content/post
date: 2026-03-18
draft: true
---
# Measuring genomic instability

If you buy into tumor suppression lens on aging, then reducing DNA mutations and epimutations is the priority number one (followed by priority number 2, killing off somatic drifters, and priority number 3, disabling constitutive tumor suppression adaptations)

Let's say someone comes up to you claiming they have a method to reduce or repair age-driven DNA instability. What experiments could you conduct to check if that method really works?

We'll look at the methods that are used to validate this narrow task - that genomic instability is actually reduced, and by how much - without getting into the whole speculative life extension claims.


Readouts: 
1. Damage mapping
	1. OxiDIP-seq
	2. AP-seq
	3. RADD-seq
	4. Damage-seq
	5. PADD-seq
2. Histo DSB markers
	1. γH2AX
	2. 53BP1
	3. Can be fooled, reduction by inhibiting DDR kinases (ATM/ATR/DNA-PK)
3. Comet assays
4. Micronucleus assays
	1. Erythrocyte micronucleus test
5. Sequencing
	1. Nanoseq (nanorate duplex sequencing)
	2. Older duplex sequencing methods, Safe-SeqS + UMI
	3. PTA-based single-cell WGS
		1. Watch out for allelic dropout and coverage-related false negatives
	
6. Structural variation / copy number variation / chromosome instability assays
	1. circular consensus reads (PacBio HiFi)
	2. optical mapping
	3. single-cell CNV profiling
	4. copy-number mosaicism tools
7. Retrotransposition assays
	1. TIPseq
	2. RC-seq
	3. junction PCR
	4. long-read confirmation
8. Clonal expansion analysis
	1. Quantify low Variant Allele Frequency driver clones (VAF <1%)
		1. Panel sequencing
		2. Clonogenic/Colony-forming-unit (CFU) assays
		3. Limited-cell FACS sequencing
		4. cell-free (cfDNA) analysis
	2. clone-size distribution analysis
	3. epimutation-based clonal tracing

Experimental designs:
1. Damage pulse + short-term repair kinetics
	1. Damage via radiation or genotoxic agent
	2. Quantify damage loci numbers and size, dynamics over multiple timepoints
	3. Compare kinetics within each treatment condition, not baselines between two conditions (control and treatment groups can differ in proliferation or kinase activity)
	4. Pulse-chase labeling with BrdU/EdU (be careful about label-induced DDR and apoptosis induction, plan controls for both)
2.  Sampling
	1. Longitudinal sampling for non-terminal tissues (serial bleeds, skin). At least 2 timepoints: Before and after treatment. More timepoints for kinetics.
	2. Terminal tissues: colonic crypts, bladder, esophagus. Brain is good for cumulative lifetime mutation burden in the absence of proliferation.
	3. 5 animals per group minimum for cytological endpoints (foci counts, comet tail, micronucleus)

Confounders:
1. Cell turnover speed
	1. Slower proliferation -> less damage readouts, but not better genome maintenance, and probably worse frailty
	2. Control with Ki-67 for all cycling cells, BrdU/EdU for pulse-chase
2. Apoptosis and immune surveillance
	1. Increased apoptosis -> less damage readouts, but not better genome maintenance, probably worse autoimmune reaction
3. Repair inhibition
	1. Less repair because less damage? or because worse repair?
	2. ATM/DNA-PK inhibitors can suppress γH2AX; chromatin modifiers can change 53BP1 recruitment; and any intervention that perturbs replication fork dynamics can alter foci biology.
	3. Control for it with outcome-measurement assays (micronucleus, mutation frequency)