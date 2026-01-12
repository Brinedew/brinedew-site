---
title: Types of explanations in biology
tags:
  - content/post
date: 2026-01-12
draft: true
---
# Types of explanations in biology

Much of classical philosophy of science was built on the language of  reduction and laws, following 20th century physics. In biology, we have a different explanatory toolkit.

1. Mechanistic models

The [“new mechanist”](https://plato.stanford.edu/entries/science-mechanisms) program in philosophy of science is basically the claim that a big fraction of successful explanation in biology looks like this:

![[image-14.png|From SEP, adapted from Craver, 2007]]

Explaining some phenomenon S mechanistically from beginning to end  means treating this phenomenon as a black box that can be opened up to reveal 
1) material entities (x1, x2, x3...), 
2) activities/operations those entities do (ф1, ф2, ф3...),
3) the chain of interactions between the entities (the causal arrows).
You then show “productive continuity”: the beginning and end of the phenomenon can be linked by a chain of cause-and-effect relationships without any "gaps" remaining. That's it, explaining done.

Let's look at this diagram showing how cells can rapidly adapt their gene expression to respond to cytokine signals.

![[Jak_Stat_-_cytokine_signalling[1]_waifu2x_art_noise1_scale.png]]

Here we have all the elements of a mechanistic model:
1) Material entities: cell membrane, nuclear membrane, cytokines, cytokine recepor monomers, Janus kinase molecules (JAK), STAT protein monomers, DNA, tyrosine residues and phosphate residues.
2) Activities: dimerization, phosphorylation, nuclear translocation, DNA binding, gene transcription.
3) Causal chain: Cytokine signal -> 1 -> 2 -> 3 -> 4 -> 5 -> gene expression response

JAK-STAT pathway is probably the simplest pathway in cell signalling, so a diagram has plenty of space to spell out the chain of events explicitly. Most cell signaling diagrams assume you're already familiar with the will compress this explanation

Look at this mechanistic diagram of cell senescence. It's a list of molecules connected by interactions, that causally translate "stuff that causes cell senescence" (irradiation, chemotherapy, telomere shortening) into "observable effects of cell senescence" (cell cycle arrest, inflammation etc.).

![[image-16.png|Simplified mechanism of cell senescence. Source: https://www.cellsignal.com/pathways/senescence-signaling-pathway]]

![[image-17.png|Simplified mechanism of apoptosis. Source: https://www.abeomics.com/cellular-apoptosis-pathway]]

Note that the arrows are not just "correlations"

So: which areas of biology naturally “follow New Mechanism”? The ones where the central game is _intervenable causal story + parts list + organisation diagram_.

Molecular biology / biochemistry / enzymology.  
Core explanatory currency is literally mechanisms: binding, catalysis, conformational change, allostery, kinetics, structure–function, pathway wiring. If you can do mutagenesis, inhibition, reconstitution, and show necessity/sufficiency-ish claims, you are playing the mechanist game.

Cell biology (incl. trafficking, cytoskeleton, organelles, cell cycle).  
A lot of “what does X do?” cashes out as: which protein complexes, which physical interactions, which localisations, which state transitions. Intervention is king: knockdown/KO, rescue, perturbation, live-cell imaging.

Gene regulation / epigenetics / chromatin.  
Even when people get sloppy and say “X regulates Y”, the field’s gold standard is mechanistic: TF binding + cofactor recruitment + chromatin state change + polymerase dynamics + measurable expression change, ideally with perturbations (CRISPRi/a, degrons, locus editing).

Developmental biology (especially modern evo-devo adjacent mechanistic dev).  
Classic “gene regulatory networks”, morphogen interpretation, pattern formation mechanisms, cell fate attractors: heavily mechanist, even when it borrows dynamical-systems language. The explanation is still usually: components + interactions + spatial/temporal organisation.

Neuroscience at the circuit/cellular level; neurophysiology.  
Ion channels → excitability → synapses → circuits → behaviour. When it’s good, it’s mechanistic with interventions (optogenetics, lesions, pharmacology, targeted recordings). When it’s “just” fMRI correlations, it’s less mechanist (more on that below).

Immunology and host–pathogen biology.  
Receptor–ligand, signalling cascades, antigen presentation, effector mechanisms, immune evasion strategies: again, entities/activities/organisation with perturbation evidence.

Physiology and pathophysiology (at least in the causal story sense).  
Even though physiology sometimes uses control theory and phenomenological models, the culture still wants a mechanism: which tissues, what signals, what feedback loops, what constraints, what breaks in disease.

Microbial genetics / metabolic regulation / many parts of microbiology.  
Regulons, operons, metabolic control: strongly mechanistic when interventions are feasible.

A quick heuristic: if a subfield’s best papers are basically “here is the cartoon diagram of parts and arrows; here are the perturbations that force the arrows to be real; here is the reconstitution”, it’s the mechanist lens.
		

3. Dynamical-systems  / control theory models

A lot of theoretical ecology, systems biology in its more mathematical form, some neuroscience, some developmental theory.  

Here the “explanation” is not a parts list so much as a state-space landscape: feedback loops, attractors, bifurcations, stability, oscillations, robustness.


![[image-15.png|Classic illustration of Waddington's landscape. Taken from Allen, M. (2015)]]


Typical outputs: differential equations, phase portraits, stability analyses, control laws, attractor structure.  
This is adjacent to New Mechanism but not identical: it can be mechanistic if states map cleanly to entities/activities; it becomes non-mechanistic when variables are abstract aggregates with no clean decomposition.

[Alex M. Plum, Mattia Serra. Dynamical systems of fate and form in development, 2025](https://www.sciencedirect.com/science/article/pii/S1084952125000308)

Statistical/associational models + causal inference mode  
    Genetic epidemiology, GWAS, much of human complex trait biology, and a lot of ecology/field biology.  
    The central objects are effects, associations, and identification strategies (instrumental variables, Mendelian randomization, natural experiments), not a parts-and-operations mechanism. You might later _attach_ a mechanism, but the workhorse is: estimate an effect under assumptions.
    

Typical outputs: effect sizes, heritability partitions, risk models, causal graphs, confidence intervals.  
Why not just do mechanisms? Because the intervention you want (randomly assign genomes, environments, life histories) is impossible; and the mapping genotype→phenotype is massively polygenic and context-dependent.

2. Historical reconstruction models  
    Phylogenetics, comparative genomics, much of paleobiology, macroevolution, systematics.  
    Explanations are often “how did this come to be?” not “what parts produce it now?” You infer ancestral states, branching histories, and sequence of events.
    

Typical outputs: trees, divergence times, ancestral reconstructions, narratives constrained by evidence.  
Why not just do mechanisms? You can do mechanisms of development, sure, but “why do birds have feathers?” is partly answered by history: contingencies, lineage constraints, exaptations.

3. Population-thinking / selection-optimization explanations  
    Population genetics, behavioural ecology, life-history theory, evolutionary game theory.  
    Explanations here often look like: given variation + heritability + fitness differences + constraints, what traits/strategies are expected? Mechanisms matter, but often as constraints/implementations, not as the primary explanatory target.
    

Typical outputs: allele frequency dynamics, ESS conditions, selection gradients, adaptive landscapes (carefully interpreted).  
Why not just do mechanisms? Because the explanatory punchline is often about _why this design is favoured_ across many possible implementations.


5. Phenomenological / predictive models (“shut up and fit the curve”)  
    A lot of omics-driven biology, biomarker work, some fMRI/EEG decoding, many “signatures”, and increasingly ML biology.  
    Goal is prediction and compression: map inputs to outputs reliably, even if the internal representation is not interpretable as a mechanism.
    

Typical outputs: classifiers, embeddings, signatures, predictive accuracy.  
Why not just do mechanisms? Sometimes because the system is too complex and you need a useful predictor now; sometimes because the field hasn’t earned causal identification yet.



Important caveat: most subfields are mixed  
People often argue past each other because they treat their mode as “real explanation” and the other mode as “mere description”.

Example: in ageing biology, you constantly see clashes between:

- mechanistic explanations of aging (senescence pathways, DNA damage repair, mTOR signalling, proteostasis, etc.),
    
- population/evolutionary explanations of aging (antagonistic pleiotropy, mutation accumulation, life-history trade-offs),
    
- dynamical-systems explanations of aging (tipping points, resilience loss, attractor drift),
    
- and predictive biomarker explanations of aging (clocks, frailty indices).  

All are partly legitimate, but they close different gaps in our understanding.