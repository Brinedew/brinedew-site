---
title: Taxonomy of non-mechanistic and causal models in biology
tags:
  - content/wiki
  - taxonomy
date: 2026-08-17
draft: true
vital_level: 4
class: C
aliases:
  - Causal inference frameworks in biology
  - Taxonomy of non mechanistic models in biology
  - New mechanism in biology
---
# Taxonomy of non-mechanistic and causal models in biology

A **mechanistic model** in molecular and cellular biology explains a phenomenon—such as nutrient sensing, [[apoptosis]], or mitotic entry—by decomposing it into component entities (receptors, kinases, membranes, transcription factors) and the organized physical activities through which they produce the outcome (dimerization, phosphorylation, conformational change, proteolytic cleavage).[^mdc2000] In contrast, **non-mechanistic models** and **statistical causal-inference frameworks** deliberately abstract away from individual molecules and physical contact chains—either because the underlying biochemistry is unresolved or because higher-level regularities (mortality hazards, dose–response surfaces, fitness landscapes, or intervention effect sizes) are invariant across lower-level molecular realizations.[^levy2013][^potochnik2017]

Distinguishing what belongs inside a molecular mechanism from what belongs in a phenomenological or evolutionary model prevents two recurring errors in quantitative biology and biogerontology: treating a predictive curve fit (such as an epigenetic aging clock or a [[Mortality rate models|Gompertz hazard parameter]]) as if it named a physical lesion, and confusing proximate physiological control circuits with the evolutionary selection pressures that shaped them.[^craver2007][^garson2023]

## Non-mechanistic abstractions across biological scales

Where molecular wiring diagrams trace physical parts and interactions, non-mechanistic models replace the interior of a pathway with a mathematical operator, latent coordinate, or state-transition rule:

| Biological problem                                  | Modeled abstraction                       | Modeling method                                               | What is inferred                                        | Why it is non-mechanistic                                                                              |
| --------------------------------------------------- | ----------------------------------------- | ------------------------------------------------------------- | ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| Ligand changes cellular response                    | Input-output transfer function            | Hill curve, spline, Gaussian process                          | EC50, response ceiling, response steepness              | Does not specify receptor, kinase, transcription-factor, or feedback machinery                         |
| Protein disappears after synthesis is blocked       | Effective abundance-decay process         | Exponential or biexponential decay                            | Apparent half-life, decay rates                         | Collapses degradation pathways, compartments, binding states, and synthesis history                    |
| Cells increase in number                            | Effective population growth rate          | Exponential, [[Four-parameter logistic model\|logistic]], Gompertz model | Growth rate, carrying capacity-like parameter  | Does not represent the cell-cycle control network producing division                                   |
| Drug combinations alter viability                   | Drug-response surface                     | Bliss, Loewe, ZIP, response-surface regression                | Synergy or antagonism                                   | Represents interaction at the phenotype level rather than molecular interaction                        |
| Sequence variants have different activities         | Sequence-to-fitness function              | Linear model, Gaussian process, random forest, neural network | Predicted activity of unseen variants                   | Can predict function without representing structure or molecular chemistry                             |
| Enhancers produce different expression levels       | Sequence-to-expression function           | Regression, CNN, transformer                                  | Regulatory activity from sequence                       | Leaves transcription-factor binding, nucleosome dynamics, looping, and transcription kinetics implicit |
| Thousands of genes covary across cells              | Low-dimensional cell state                | PCA, factor analysis, variational latent-variable model       | Latent axes such as activation or differentiation state | State dimensions summarize many causal molecular processes                                             |
| Cells form recognizable transcriptional groups      | Discrete cell-state classes               | Mixture model, graph clustering, classifier                   | Cell type or state assignment                           | Classification can work without identifying what generates each state                                  |
| Cell states seem ordered through differentiation    | Position along a developmental trajectory | Principal curve, diffusion pseudotime, graph trajectory       | Relative progression through a state transition         | Ordering cells does not specify what molecular network drives progression                              |
| Perturbing genes changes a phenotype                | Gene-to-phenotype effect                  | Regression, generalized linear model, hierarchical model      | Effect size of each perturbation                        | Establishes intervention-response relationships without filling in intermediate molecular steps        |
| Pairs of gene perturbations behave unexpectedly     | Genetic interaction function              | Interaction regression, epistasis score                       | Synthetic lethality, suppression, enhancement           | Characterizes causal relations at the gene level without specifying molecular mediation                |
| Many molecular features correlate with age          | Effective biological-age coordinate       | Penalized regression, random forest, neural network           | Predicted chronological or biological age               | Age predictor need not encode any causal theory of aging                                               |
| Cell morphology changes under perturbation          | Morphological phenotype space             | Embedding model, classifier, nearest-neighbor model           | Phenotypic similarity or class                          | Images are mapped to phenotype without reconstructing molecular causes                                 |
| Expression profiles predict treatment response      | Molecular-state-to-outcome function       | Logistic regression, random forest, neural network            | Drug response, survival, subtype                        | Correlational or predictive mapping can succeed with causal pathway structure unresolved               |
| Cells fluctuate between recurrent phenotypic states | Effective state-transition process        | Markov model, hidden Markov model                             | Transition probabilities and dwell times                | Specifies state dynamics without specifying the molecular circuitry generating transitions             |
| A signaling output oscillates                       | Effective oscillator                      | Sinusoidal fit, autoregressive model, state-space model       | Period, phase, damping, coherence                       | Describes temporal behavior without representing the feedback loop producing it                        |

## Causal inference frameworks

When epidemiologists, geneticists, and computer scientists evaluate biological causes, their claims typically take the form of counterfactual dependencies or intervention effect sizes ("this allele raises disease odds by 40%"). Philosophers of science and quantitative biologists distinguish several causal frameworks:

| Framework | Main idea | Typical use in biology |
| --- | --- | --- |
| Interventionism (Woodward) | $X$ causes $Y$ if manipulating $X$ under an ideal intervention changes $Y$ | Knockouts, CRISPR perturbations, pharmacological blockades |
| Manipulationist causation (Pearl/Woodward tradition) | Causation defined through invariance under intervention rather than observational correlation | Functional genomics, perturbation screens |
| Potential Outcomes Framework (Rubin Causal Model) | Compare outcome under treatment vs. control for the same unit | Randomized clinical trials, Mendelian randomization |
| Structural Causal Models (Pearl) | Directed acyclic graphs (DAGs) and structural equations with `do`-calculus | Genetic epidemiology, mediation analysis |
| INUS conditions (Mackie) | A cause is an **i**nsufficient but **n**ecessary part of an **u**nnecessary but **s**ufficient complex | Multifactorial disease and gene–environment interactions |
| Mechanistic causation (New Mechanism) | Explain causal production by identifying organized entities and activities connecting start to finish | Molecular and cellular biology, neurobiology |
| Probabilistic causation (Suppes) | Causes shift the probability distribution of outcomes | Cancer risk factors, stochastic gene expression |
| Counterfactual causation (Lewis) | Had $X$ not occurred, $Y$ would not have occurred | Historical and evolutionary explanations |
| Dynamical systems causation | Causation as trajectory constraint and attractor structure in phase space | [[Novak–Tyson model]], [[Hopf bifurcation]], developmental patterning |
| Information-theoretic causality | Causal influence quantified via directed information transfer (Granger, transfer entropy) | Neural spike trains, time-series signaling reconstruction |

## Boundaries of a mechanism: physiology, pathology, and evolutionary history

A central problem in philosophy of biology—developed since 2000 by the **New Mechanism** movement (Peter Machamer, Lindley Darden, Carl Craver, William Bechtel, and Stuart Glennan)—is where a molecular mechanism stops and an evolutionary or ecological explanation begins.[^mdc2000][^glennan2017]

Consider maternal death in the California two-spot octopus (*Octopus bimaculoides*). After laying a single clutch of eggs, a female stops eating, guards and aerates her clutch, undergoes rapid tissue catabolism and dermal lesions, and dies around the time the hatchlings emerge. Surgically removing both **optic glands** after spawning reverses the behavior: the female resumes feeding, grows, and lives for months. Transcriptomic and metabolomic profiling shows that the post-spawning optic gland activates steroidogenic pathways—producing pregnane steroids, 7-dehydrocholesterol, and maternal bile-acid intermediates—that shut down feeding circuits and mobilize somatic reserves.[^wang2018]

Whether the optic-gland steroid cascade by itself counts as a complete explanation of octopus semelparity exposes four distinct positions on how molecular mechanisms relate to evolution:

### 1. Constitutive sufficiency and ahistorical function
Mainstream New Mechanists hold that **the boundaries of a mechanism are fixed strictly by the phenomenon being explained** (the *explanandum*).[^craver2007][^kaplan2020] Drawing on Wesley Salmon's causal-mechanical framework, Craver separates three explanatory questions:[^craver2007][^craver2013]

1. **Constitutive explanation:** What organized parts and activities *inside* the organism realize the phenomenon right now? (The optic gland's steroidogenic shift and its downstream neural and metabolic targets.)
2. **Contextual explanation:** How does that subsystem sit inside a wider system? (How maternal fasting and brooding aerate and protect the egg clutch.)
3. **Etiological explanation:** What prior causal history brought the mechanism into existence? (The demographic and ecological selection pressures—such as high adult predation, cannibalism, or low post-brooding survival—that favored semelparity over iteroparity.)

Under this division, if the question is *how* an individual octopus self-destructs after spawning, the neuroendocrine cascade is constitutively complete; inserting ancestral ecological niche pressures into the molecular diagram commits a category mistake by mixing constitutive components with evolutionary history.[^craver2013][^kaplan2020] To keep physiology autonomous from evolutionary history, this camp defines biological function ahistorically—either through Robert Cummins's **causal-role** analysis (where a part's "function" is simply whatever causal contribution it makes to a system capacity the researcher chooses to analyze)[^cummins1975][^craver2001] or through **teleological goal-contribution** accounts that ground function strictly in an organism's present-day survival and inclusive fitness, treating evolutionary history as causally inert in the present.[^maley2017] William Bechtel similarly models organisms as autonomous control architectures: evolution built the neuroendocrine feedback loop over deep time, but explaining how the control loop operates requires only its current wiring.[^bechtel2024]

### 2. The pathology problem and selected-effects history
The purely ahistorical view faces a sharp counterexample pressed by Justin Garson: **without evolutionary selection history, a molecular causal chain cannot be distinguished from a reproducible pathology**.[^garson2013][^garson2023]

Suppose an octopus develops a spontaneous endocrine tumor that secretes a metabolic toxin right after egg-laying, causing her to stop feeding and die on the exact same schedule. At the purely molecular, causal-role level, the tumorous gland and its toxin form a lawful constitutive chain producing post-spawning death. Yet no biologist calls a random tumor a *mechanism for semelparity*; it is a fatal lesion. What makes the wild-type optic-gland steroid surge a *mechanism for semelparity*—capable of functioning normally or malfunctioning when ablated—is that the circuit was **retained by natural selection** because its proximal effect (suppressing predatory feeding and enforcing clutch guarding) raised maternal reproductive success in the species' ancestral niche.[^garson2023][^fagerberg2024]

This distinction carries direct weight in aging biology. When a molecular pathway in an old animal destroys tissue or halts regeneration, an ahistorical circle-and-arrow diagram cannot tell whether the pathway is:
- **Passive mechanical or transcriptional breakage** (such as bulky DNA lesions physically stalling RNA Polymerase II on long genes), which has no selected function;
- **Unselected developmental run-on** (a growth program such as [[mtor-mtor-p42345|mTOR]] continuing to fire past reproductive maturity because selection in the [[selection-shadow-theory|selection shadow]] was too weak to install an off-switch); or
- **An evolved defensive constraint** (such as [[p16ink4a-cdkn2a|p16]]/[[p53-tp53|p53]]-mediated [[cellular-senescence|Cellular senescence]] or stem-cell dormancy under the [[tumor-suppressor-theory-of-aging|tumor suppressor theory of aging]]), where the tissue cost is the price of an actively maintained anti-cheater firewall ([[Clonal governance]]).

Individuating a pathway as a *mechanism for* tumor suppression or programmed death rather than a disease process implicitly appeals to its selective etiology.[^garson2023]

### 3. Is natural selection itself a mechanism?
Even when the question shifts explicitly to evolution (*why* semelparity evolved), philosophers disagree over whether natural selection is a mechanism at all:

- **Structural skeptics** (Robert Skipper and Roberta Millstein) argue that natural selection violates the defining criteria of a biological mechanism: unlike a ribosome or the optic gland, a selective environment has no fixed physical boundaries, no stable spatial arrangement of parts, and no deterministic production arrow from one step to the next.[^skipper2005]
- **Minimalists and two-level theorists** (D. Benjamin Barros; Phyllis Illari and Jon Williamson) widen the definition of mechanism to any multilevel system of entities and activities organized to produce a phenomenon, allowing stochastic population-level selection to count alongside intracellular signaling.[^barros2008][^illari2012]
- **System versus ephemeral mechanisms:** Stuart Glennan resolves the standoff by separating **system mechanisms**—stable, repeatable, spatially organized machines such as the optic-gland steroid pathway—from **ephemeral mechanisms**, which are contingent, historical causal sequences of interactions across populations and environments.[^glennan2017]

### 4. Lineage explanations and reciprocal niche coupling
In evolutionary developmental biology (evo-devo) and behavioral ecology, researchers often ask a question that neither a static molecular chart nor an ecological life-history payoff matrix can answer alone: *how did an iteroparous cephalopod ancestor (such as Nautilus, or iteroparous octopuses such as Octopus chierchiae) rewire its neuroendocrine circuitry into obligatory semelparity without dying before reproducing at intermediate steps?*

Brett Calcott terms the required structure a **lineage explanation**: a continuous series of mechanistic models showing how incremental genetic or regulatory changes modified the developmental or physiological control architecture step by step across generations.[^calcott2009][^calcott2013] Meanwhile, ecological mechanists such as Marie Kaiser and Rose Trappes model **$NC^3$ mechanisms** (niche construction, niche choice, and niche conformance), tracing how the proximate neuroendocrine switch (maternal den sealing, fasting, and clutch aeration) physically alters the ecological selection pressures acting on both mother and offspring.[^kaiser2023]

| Philosophical position | Primary proponents | What goes inside the "mechanism"? | How evolutionary / ecological history is treated | Diagnostic test on octopus optic-gland death |
| :--- | :--- | :--- | :--- | :--- |
| **Constitutive orthodoxy (Causal-role)** | Craver, Darden, Kaplan, Bechtel, Maley & Piccinini[^craver2007][^maley2017][^bechtel2024] | Only the organized molecules, cells, and activities constitutively producing the outcome now | Kept strictly outside as a separate *etiological* question; function defined ahistorically | Steroid cascade is a complete mechanism for post-spawning death; ecological niche belongs to a different question |
| **Selected-effects functionalism** | Garson, Fagerberg[^garson2023][^fagerberg2024] | Present-day molecular parts and activities, *individuated* by their selected proper function | Required to distinguish a functional mechanism from a fatal lesion or tumor | Steroid cascade specifies *how* it works, but selection history is needed to classify it as a mechanism rather than a pathology |
| **System vs. ephemeral pluralism** | Glennan, Illari & Williamson[^illari2012][^glennan2017] | Stable intracellular machines (*system mechanisms*) vs. historical population trajectories (*ephemeral mechanisms*) | Treated as a second, population-level stochastic mechanism operating over evolutionary time | Both the optic-gland hormone cascade and the historical ecological selection sequence are mechanisms of different classes |
| **Evo-devo lineage & $NC^3$ integration** | Calcott, Brigandt, Kaiser & Trappes[^calcott2009][^brigandt2015][^kaiser2023] | Coupled series of circuit states across generations (*lineage explanation*) or organism–environment loops | Co-modeled with physiology to show how regulatory wiring evolves and reshapes its own niche | Explains how iteroparous neuroendocrine control was incrementally rewired into semelparous brooding |

## See also

- [[Mortality rate models]]
- [[Empirical constraints on longevity models]]
- [[Non-technical language in longevity]]
- [[Novak–Tyson model]]
- [[Goldbeter–Koshland module]]
- [[tumor-suppressor-theory-of-aging|Tumor Suppressor Theory of Aging]]

## References

[^mdc2000]: Machamer P, Darden L, Craver CF (2000). "Thinking about mechanisms". *Philosophy of Science*. 67 (1): 1–25. [doi:10.1086/392759](https://doi.org/10.1086/392759)
[^levy2013]: Levy A (2013). "Three kinds of new mechanism". *Biology & Philosophy*. 28 (1): 99–114. [doi:10.1007/s10539-012-9337-z](https://doi.org/10.1007/s10539-012-9337-z)
[^potochnik2017]: Potochnik A (2017). *Idealization and the Aims of Science*. Chicago: University of Chicago Press. [doi:10.7208/chicago/9780226507194.001.0001](https://doi.org/10.7208/chicago/9780226507194.001.0001)
[^craver2007]: Craver CF (2007). *Explaining the Brain: Mechanisms and the Mosaic Unity of Neuroscience*. Oxford: Oxford University Press. [doi:10.1093/acprof:oso/9780199299317.001.0001](https://doi.org/10.1093/acprof:oso/9780199299317.001.0001)
[^craver2013]: Craver CF, Darden L (2013). *In Search of Mechanisms: Discoveries across the Life Sciences*. Chicago: University of Chicago Press. [doi:10.7208/chicago/9780226039824.001.0001](https://doi.org/10.7208/chicago/9780226039824.001.0001)
[^kaplan2020]: Craver CF, Kaplan DM (2020). "Are more details better? On the norms of completeness for mechanistic explanations". *The British Journal for the Philosophy of Science*. 71 (1): 287–319. [doi:10.1093/bjps/axy015](https://doi.org/10.1093/bjps/axy015)
[^cummins1975]: Cummins R (1975). "Functional analysis". *The Journal of Philosophy*. 72 (20): 741–765. [doi:10.2307/2024640](https://doi.org/10.2307/2024640)
[^craver2001]: Craver CF (2001). "Role functions, mechanisms, and hierarchy". *Philosophy of Science*. 68 (1): 53–74. [doi:10.1086/392866](https://doi.org/10.1086/392866)
[^maley2017]: Maley CJ, Piccinini G (2017). "A unified mechanistic account of teleological functions for psychology and neuroscience". In Kaplan DM (ed.), *Explanation and Integration in Mind and Brain Science*, pp. 236–256. Oxford: Oxford University Press. [doi:10.1093/oso/9780199685509.003.0011](https://doi.org/10.1093/oso/9780199685509.003.0011)
[^bechtel2024]: Bechtel W, Bich L (2024). "Autonomy, control, and biological mechanisms". *Philosophy of Science*. 91 (2): 403–422. [doi:10.1017/psa.2023.125](https://doi.org/10.1017/psa.2023.125)
[^wang2018]: Wang ZY, Ragsdale CW (2018). "Multiple optic gland signaling pathways implicated in octopus maternal behaviors and death". *Journal of Experimental Biology*. 221 (19): jeb185751. [doi:10.1242/jeb.185751](https://doi.org/10.1242/jeb.185751)
[^garson2013]: Garson J (2013). "The functional sense of mechanism". *Philosophy of Science*. 80 (3): 317–333. [doi:10.1086/671173](https://doi.org/10.1086/671173)
[^garson2023]: Garson J (2023). "Putting history back into mechanisms". *The British Journal for the Philosophy of Science*. 74 (4): 1065–1085. [doi:10.1086/714816](https://doi.org/10.1086/714816)
[^fagerberg2024]: Fagerberg H, Garson J (2024). "Proper functions are proximal functions". *Biology & Philosophy*. 39 (2): 8. [doi:10.1007/s10539-024-09945-3](https://doi.org/10.1007/s10539-024-09945-3)
[^skipper2005]: Skipper RA Jr, Millstein RL (2005). "Thinking about evolutionary mechanisms: natural selection". *Studies in History and Philosophy of Biological and Biomedical Sciences*. 36 (2): 327–347. [doi:10.1016/j.shpsc.2005.03.006](https://doi.org/10.1016/j.shpsc.2005.03.006)
[^barros2008]: Barros DB (2008). "Natural selection as a mechanism". *Philosophy of Science*. 75 (3): 306–322. [doi:10.1086/593075](https://doi.org/10.1086/593075)
[^illari2012]: Illari PM, Williamson J (2012). "What is a mechanism? Thinking about mechanisms across the sciences". *European Journal for Philosophy of Science*. 2 (1): 119–135. [doi:10.1007/s13194-011-0038-2](https://doi.org/10.1007/s13194-011-0038-2)
[^glennan2017]: Glennan S (2017). *The New Mechanical Philosophy*. Oxford: Oxford University Press. [doi:10.1093/oso/9780198779711.001.0001](https://doi.org/10.1093/oso/9780198779711.001.0001)
[^calcott2009]: Calcott B (2009). "Lineage explanations: explaining how biological mechanisms change". *The British Journal for the Philosophy of Science*. 60 (1): 51–78. [doi:10.1093/bjps/axn047](https://doi.org/10.1093/bjps/axn047)
[^calcott2013]: Calcott B (2013). "Why how and why aren't enough: more problems with Mayr's proximate-ultimate distinction". *Biology & Philosophy*. 28 (5): 767–780. [doi:10.1007/s10539-013-9367-1](https://doi.org/10.1007/s10539-013-9367-1)
[^brigandt2015]: Brigandt I (2015). "Evolutionary developmental biology and the limits of philosophical accounts of mechanistic explanation". In Braillard P-A, Malaterre C (eds.), *Explanation in Biology*, pp. 135–173. Dordrecht: Springer. [doi:10.1007/978-94-017-9822-8_7](https://doi.org/10.1007/978-94-017-9822-8_7)
[^kaiser2023]: Kaiser MI, Trappes R (2023). "Broadening the scope of mechanisms in behavioral ecology: niche construction, niche choice, and niche conformance". *Synthese*. 202: 112. [doi:10.1007/s11229-023-04327-2](https://doi.org/10.1007/s11229-023-04327-2)
