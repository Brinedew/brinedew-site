---
title: Multilevel selection
tags:
- content/wiki
date: 2026-08-26
draft: true
vital_level: 2
class: C
aliases:
- group selection
- MLS
---
# Multilevel selection

**Multilevel selection** (**MLS**) is the evolutionary framework in which natural selection acts simultaneously across nested levels of biological organization—genes, cells, organisms, and groups—allowing traits disfavored within lower-level collectives to spread when selection between collectives is sufficiently strong.

## The Price equation partition

Following George R. Price's covariance decomposition, total evolutionary change in a group-structured population separates into two additive terms (assuming faithful transmission within lineages):[^1][^2]

$$\bar{w}\,\Delta\bar{z} = \underbrace{\operatorname{Cov}_g(W_g, Z_g)}_{\text{between-group selection}} + \underbrace{\operatorname{E}_g\!\left[\operatorname{Cov}_i(w_{gi}, z_{gi})\right]}_{\text{within-group selection}}$$

Here $Z_g$ and $W_g$ represent group-mean trait value and group fitness, while $z_{gi}$ and $w_{gi}$ denote the trait value and fitness of particle $i$ inside group $g$. An altruistic or cooperative trait imposes negative within-group covariance ($\operatorname{Cov}_i < 0$) because defectors out-reproduce cooperators inside mixed groups, yet increases globally ($\Delta\bar{z} > 0$) whenever positive between-group covariance ($\operatorname{Cov}_g > 0$, groups rich in cooperators out-producing cooperator-poor groups) outweighs within-group loss.[^1][^2]

## MLS1 and MLS2

Drawing on [David Sloan Wilson](david-sloan-wilson.md)'s trait-group models, Elliott Sober and Wilson argued in *Unto Others: The Evolution and Psychology of Unselfish Behavior* (1998) that controversy following [George C. Williams](george-c-williams.md)'s critique of naive group selection conflated biological reality with causal bookkeeping.[^3] They showed that [kin selection](wd-hamilton.md) and trait-group multilevel selection frequently partition the same population genetics—indexing clusters by relatedness rather than trait-group interaction—summarized in the maxim: *"Selfishness beats altruism within groups; altruistic groups beat selfish groups."*[^3]

Philosopher of biology Samir Okasha resolved persistent ambiguities in *Evolution and the Levels of Selection* (2006) by distinguishing two forms of multilevel selection:[^4]

| Mode | Focal unit of fitness | Role of the group | Evolutionary relevance |
| --- | --- | --- | --- |
| **MLS1** | Particles (e.g., individual cells or organisms) | Local selective environment setting particle fitness ($W_g$ defined as mean particle fitness) | Explains individual altruism inside ephemeral trait groups or structured demes |
| **MLS2** | Collectives themselves (e.g., organisms, colonies) | True evolutionary individuals producing offspring collectives ($W_g$ not reducible to particle average) | Captures full [evolutionary transitions in individuality](evolutionary-transitions-in-individuality.md) after conflict mediation |

Early stages of cooperation typically operate under **MLS1**, whereas an evolutionary transition succeeds when conflict suppression mechanisms (such as single-cell bottlenecks and policing) convert collective dynamics into **MLS2**, decoupling collective reproductive success from single-cell proliferation rates.[^4]

## Relation to transitions, aging, and cancer

The [major transitions](evolutionary-transitions-in-individuality.md) framework and [de-Darwinization](de-darwinization.md) supply the developmental and cellular mechanisms translating Price-equation theory into anatomy. Within multicellular bodies, somatic cancer exemplifies a breakdown of conflict suppression: an oncogenic cell clone achieves positive within-group selection ($\operatorname{Cov}_i > 0$) at the expense of host survival, whereas long-lived species rely on [tumor-suppressive constraints](tumor-suppressor-theory-of-aging.md)—checkpoints, apoptosis, senescence, and stem-cell niche competition—to preserve between-organism selection dominance.

Ongoing debates between inclusive-fitness theorists and multilevel-selection theorists center on whether Price-equation group partitions provide distinct causal explanations or represent mathematically equivalent reformulations of neighborhood-structured individual selection.[^5]

## References

[^1]: Price GR. Selection and covariance. *Nature*. 1970. [doi:10.1038/227520a0](https://doi.org/10.1038/227520a0).
[^2]: Price GR. Extension of covariance selection mathematics. *Annals of Human Genetics*. 1972;35(4):485–490. [doi:10.1111/j.1469-1809.1957.tb01874.x](https://doi.org/10.1111/j.1469-1809.1957.tb01874.x).
[^3]: Sober E, Wilson DS. *Unto Others: The Evolution and Psychology of Unselfish Behavior*. Harvard University Press, 1998.
[^4]: Okasha S. *Evolution and the Levels of Selection*. Oxford University Press, 2006.
[^5]: West SA, Griffin AS, Gardner A. Social semantics: altruism, cooperation, mutualism, strong reciprocity and group selection. *Journal of Evolutionary Biology*. 2007;20(2):415–432. [doi:10.1111/j.1420-9101.2006.01258.x](https://doi.org/10.1111/j.1420-9101.2006.01258.x).
