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

Multilevel selection (MLS) is the evolutionary framework in which natural selection acts simultaneously across nested tiers of biological organization—genes, cells, organisms, and groups—such that traits disfavored within lower-level collectives can still spread if between-collective selection is strong enough.

## The Price equation partition

Following George Price's covariance decomposition (1970, 1972), total evolutionary change across a group-structured population separates into two additive terms (assuming faithful transmission within lineages):

$$\bar{w}\,\Delta\bar{z} = \underbrace{\operatorname{Cov}_g(W_g, Z_g)}_{\text{between-group selection}} + \underbrace{\operatorname{E}_g\!\left[\operatorname{Cov}_i(w_{gi}, z_{gi})\right]}_{\text{within-group selection}}$$

Here $Z_g$ and $W_g$ represent group-mean trait value and group fitness, while $z_{gi}$ and $w_{gi}$ denote the trait value and fitness of particle $i$ inside group $g$. An altruistic or cooperative trait imposes a negative within-group covariance ($\operatorname{Cov}_i < 0$ because defectors out-reproduce cooperators inside mixed groups), yet spreads globally ($\Delta\bar{z} > 0$) whenever the positive between-group covariance ($\operatorname{Cov}_g > 0$, groups rich in cooperators out-producing cooperator-poor groups) exceeds the within-group loss.

## Sober–Wilson and Okasha's MLS1 vs. MLS2 distinction

In *Unto Others: The Evolution and Psychology of Unselfish Behavior* (1998), Elliott Sober and [David Sloan Wilson](david-sloan-wilson.md) drew on Wilson's 1970s trait-group models to argue that the decades-long controversy after [George C. Williams](george-c-williams.md) (1966) conflated two questions: whether group selection is biologically real, and how causal selection variance should be bookkept. They showed that [kin selection](wd-hamilton.md) and trait-group MLS often partition the exact same population genetics—kin selection simply indexes clusters by relatedness rather than trait-group interaction—summarized in their heuristic: *"Selfishness beats altruism within groups; altruistic groups beat selfish groups."*

In ***Evolution and the Levels of Selection* (2006)**, philosopher of biology **Samir Okasha** resolved persistent ambiguities in the levels-of-selection literature by sharply distinguishing two modes of multilevel selection:

| Mode | Focal unit of fitness | Role of the group | Evolutionary relevance |
| --- | --- | --- | --- |
| **MLS1** | Particles (e.g., individual cells or organisms) | Local selective environment setting particle fitness ($W_g$ defined as mean particle fitness) | Explains individual altruism inside ephemeral trait groups or structured demes |
| **MLS2** | Collectives themselves (e.g., organisms, colonies) | True evolutionary individuals producing offspring collectives ($W_g$ not reducible to particle average) | Captures full [evolutionary transitions in individuality](evolutionary-transitions-in-individuality.md) after conflict mediation |

Okasha showed that early stages of cooperation operate predominantly under **MLS1**, whereas an evolutionary transition succeeds when internal conflict suppression (bottlenecks, policing) converts collective dynamics into **MLS2**, decoupling collective reproductive success from single-cell proliferation rates.

## Relation to transitions, aging, and cancer

The [major transitions](evolutionary-transitions-in-individuality.md) framework and [de-Darwinization](de-darwinization.md) supply the biological mechanisms turning Price-equation theory into anatomy. Within multicellular bodies, somatic cancer is the canonical breakdown of MLS conflict suppression: an oncogenic cell clone achieves positive within-group selection ($\operatorname{Cov}_i > 0$) at the expense of host integrity, while long-lived host species rely on [[tumor-suppressor-theory-of-aging|tumor-suppressive constraints]] (checkpoints, apoptosis, senescence, niche competition) to keep between-organism selection dominant. Debates continue between inclusive-fitness theorists (such as Stuart West and Andy Gardner) and MLS theorists over whether Price-equation group partitions add causal insight or merely re-express neighborhood-level individual selection (see also [[Lewontin's conditions]]).

## References

- Sober, E., & Wilson, D. S. (1998). *Unto Others: The Evolution and Psychology of Unselfish Behavior*.
- Okasha, S. (2006). *Evolution and the Levels of Selection*. Oxford University Press.
