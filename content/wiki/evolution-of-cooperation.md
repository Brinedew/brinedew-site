---
title: Evolution of cooperation
tags:
- content/wiki
date: 2026-08-26
draft: true
vital_level: 3
class: C
aliases:
- five rules for the evolution of cooperation
---
# Evolution of cooperation

The **evolution of cooperation** examines how natural selection favors costly acts that benefit recipients despite vulnerability to free-riders and defectors. [Martin Nowak](martin-nowak.md) consolidated the mathematical literature into five formal mechanisms showing when selection favors cooperators over defectors.[^4][^5]

## The five mechanisms

1. **Kin selection.** Cooperation spreads among genetic relatives when the benefit to the recipient, weighted by relatedness, exceeds the cost to the actor—[Hamilton's rule](wd-hamilton.md) ($rb > c$, or $r > c/b$).[^4]
2. **Direct reciprocity.** Repeated encounters between the same partners support conditional strategies (*Tit-for-Tat*, *Win-Stay, Lose-Shift*) whenever the probability $w$ of another round with the same individual exceeds the cost-to-benefit ratio ($w > c/b$).[^4]
3. **Indirect reciprocity.** Helping builds social reputation so that third-party observers preferentially cooperate with individuals in good standing (*image scoring*). Theoretical models developed by Nowak and Karl Sigmund show that reputation promotes cooperation when the probability $q$ of knowing another's past standing exceeds the cost-to-benefit ratio ($q > c/b$).[^1][^2]
4. **Network reciprocity.** In spatially structured populations where individuals interact only with local neighbors rather than mixing uniformly, cooperators form protective clusters. On regular graphs under weak selection, cooperation is favored when the benefit-to-cost ratio exceeds the average number of neighbors $k$:[^3]
   $$\frac{b}{c} > k$$
   Sparse local neighborhoods limit exposure to invading defectors.[^3]
5. **Group ([multilevel](multilevel-selection.md)) selection.** In populations structured into competing groups, selection among groups favors cooperation over within-group cheating when between-group variance is sufficient—exceeding $b/c > 1 + n/m$ in Nowak's idealized model of $m$ groups of size $n$.[^4]

Together with mutation and natural selection, cooperation operates as a primary organizer of biological hierarchy from molecular replicators to social groups.[^5]

## Relevance to multicellularity

These mechanisms form the mathematical foundation of [multicellular cooperation](multicellular-cooperation.md) and [evolutionary transitions in individuality](evolutionary-transitions-in-individuality.md). Animal tissues combine near-clonal genetic relatedness from a single-cell bottleneck ($r \approx 1$), restricted spatial neighborhood structure analogous to low-$k$ graph topology, and internal enforcement ([p53](p53-tp53.md) checkpoints, [apoptosis](apoptosis.md), [immune surveillance](immune-surveillance.md)). When somatic mutations erode spatial constraints or damage checkpoints, lower-level defection re-emerges as neoplasia.

## See also

- [[martin-nowak|Martin Nowak]]
- [[multicellular-cooperation|Multicellular cooperation]]
- [[wd-hamilton|W. D. Hamilton]]
- [[multilevel-selection|Multilevel selection]]

## References

[^1]: Nowak MA, Sigmund K. Evolution of indirect reciprocity by image scoring. *Nature*. 1998. [doi:10.1038/31225](https://doi.org/10.1038/31225).
[^2]: Nowak MA, Sigmund K. Evolution of indirect reciprocity. *Nature*. 2005;437:1291–1298. [doi:10.1038/nature04131](https://doi.org/10.1038/nature04131).
[^3]: Ohtsuki H, Hauert C, Lieberman E, Nowak MA. A simple rule for the evolution of cooperation on graphs and social networks. *Nature*. 2006;441:502–505. [doi:10.1038/nature04605](https://doi.org/10.1038/nature04605).
[^4]: Nowak MA. Five rules for the evolution of cooperation. *Science*. 2006. [doi:10.1126/science.1133755](https://doi.org/10.1126/science.1133755).
[^5]: Nowak MA, Highfield R. *SuperCooperators: Altruism, Evolution, and Why We Need Each Other to Succeed*. Free Press, 2011.
