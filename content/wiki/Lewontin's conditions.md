---
title: Lewontin's conditions
tags:
  - content/wiki
date: 2025-09-20
draft: true
aliases:
  -
---
# Lewontin's Conditions for Natural Selection

**Lewontin's conditions** (also known as **Lewontin's recipe**) are a formulation of the three minimal, necessary, and sufficient requirements for a population of entities to undergo evolution by natural selection. Outlined by evolutionary biologist Richard C. Lewontin, these principles provide an abstract and universally applicable framework for Darwinian evolution, stripping the process down to its logical core.The framework is a foundational concept in modern evolutionary theory because its generality allows it to be applied to any system where entities vary, reproduce, and inherit traits—including cultural, computational, and immunological systems.

## The Three Conditions

In his seminal 1970 paper "The Units of Selection," Lewontin articulated that evolution by natural selection is the inevitable consequence whenever a population exhibits three properties:1) **Phenotypic Variation:** There are differences among individuals within the population in some attribute or trait (e.g., in morphology, physiology, or behavior).

2) **Differential Fitness:** The different variants of the trait are associated with different rates of survival and/or reproduction. This variation leads to some individuals leaving more offspring (or copies) than others.

3) **Heritability of Fitness-Related Variation:** The variation is heritable, meaning that offspring tend to resemble their parents in that trait. The traits that confer a fitness advantage must be passed down through generations.If these three conditions are met, the population will necessarily evolve, with the frequency of the traits that confer greater fitness increasing over time. Lewontin's original phrasing was:> "As seen by present‑day evolutionists, Darwin’s scheme embodies three principles: (1) Different individuals in a population have different morphologies, physiologies, and behaviors (phenotypic variation). (2) Different phenotypes have different rates of survival and reproduction in different environments (differential fitness). (3) There is a correlation between parents and offspring in the contribution of each to future generations (fitness is heritable)." — Richard C. Lewontin, _The Units of Selection_ (1970)

## Origins and Canonical Sources

While the ideas are Darwin's, Lewontin's 1970 formulation provided a concise and rigorous summary that became standard. He emphasized its generality: "any entities in nature that have variation, reproduction, and heritability may evolve."In a 1978 _Scientific American_ article, he reiterated the triad and added a crucial clarification: the conditions predict **change**, but not necessarily **adaptation** (an improved fit to an environment). Selection can be stabilizing, or trade-offs can prevent a trait from reaching a local optimum.

## Formal and Mathematical Equivalents

Lewontin's verbal "recipe" maps directly onto the core formalisms of evolutionary biology.* **The Price Equation:** This covariance equation provides a formal decomposition of evolutionary change. The equation is Δzˉ=wˉCov(w,z)​+wˉE(wΔz)​. The first term, Cov(w,z), represents the change due to selection and directly captures Lewontin's first two conditions: it requires both variation in a trait (z) and an association between that trait and fitness (w). The second term, E(wΔz), represents transmission fidelity and maps onto Lewontin's heritability condition.

* **The Breeder's Equation:** Used in quantitative genetics, the equation R=h2S is a specialized application of Lewontin's principles. The selection differential (S) quantifies differential fitness with respect to a trait, and the narrow-sense heritability () quantifies the degree to which offspring resemble parents due to additive genetic effects.

* **Replicator Dynamics:** In evolutionary game theory, these equations model frequency changes in a population of strategies. Differential fitness is represented by the growth rates of different types, and heritability is assumed to be perfect, thus directly instantiating Lewontin's conditions.

## Key Clarifications and Practical Considerations

Subsequent work, notably by Peter Godfrey-Smith, has refined the practical application of the conditions.* **Trait-Specific Reading:** The conditions should be applied to a specific, measurable trait, not to a population in general. This prevents vague claims and focuses analysis.

* **Causation vs. Correlation:** The triad can be satisfied for a trait that is merely correlated with the true target of selection (a phenomenon known as "hitchhiking"). For example, if a gene for red pigment is linked to a gene for toxin resistance, selection for resistance will cause the frequency of red pigment to increase, even if the color itself has no effect on fitness. Causal analysis is often required to identify the true target of selection.
  
* **Time and Generation Structure:** The simple notion of "leaving more offspring" assumes discrete, non-overlapping generations. In populations with overlapping generations or varying generation times, selection can favor variants that reproduce _faster_, even if they produce the same number of offspring over a lifetime. Fitness must be measured as a per-capita growth rate over time.
  
* **Transmission Bias:** The conditions describe the force of selection, but the net evolutionary change can be zero if transmission is biased. Factors like meiotic drive, mutation pressure, or biased cultural transmission can counteract or mask the effects of selection.
  
* **Level-neutrality**. The "individuals" in the population can be genes, cells, organisms, colonies, or even species, so long as they meet the three conditions. This generality makes the framework a central tool in debates about the **units of selection** and in understanding major evolutionary transitions, where new, higher-level individuals emerge from collectives of lower-level ones ([[De-Darwinization]])

## See Also

- Breeder's equation

- Darwinian population

- [[De‑Darwinization]]

- Heritability

- Major evolutionary transition

- Price equation

- Replicator dynamics

- Unit of selection

## References and Further Reading

 - **Godfrey-Smith, P.** (2007). "Conditions for evolution by natural selection." _Journal of Philosophy_, 104(10), 489–516. (A key paper clarifying trait-specific readings and edge cases).

- **Godfrey-Smith, P.** (2009). _Darwinian Populations and Natural Selection_. Oxford University Press.

- **Lewontin, R. C.** (1970). "The Units of Selection." _Annual Review of Ecology and Systematics_, 1, 1–18. (The canonical source for the three conditions).

- **Lewontin, R. C.** (1978). “Adaptation.” _Scientific American_, 239(3), 156–169. (Reiterates the triad and distinguishes selection from adaptation).

- **Okasha, S.** (2006). _Evolution and the Levels of Selection_. Oxford University Press. (Provides a thorough philosophical analysis using the conditions as a level-neutral framework).

- **Papale, F.** (2021). "Evolution by means of natural selection without reproduction: revamping Lewontin’s account." _Synthese_, 199, 13739–13755.
