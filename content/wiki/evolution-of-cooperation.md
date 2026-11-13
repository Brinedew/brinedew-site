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

The evolution of cooperation studies how natural selection favors costly actions that benefit recipients despite vulnerability to free-riders and defectors. [Martin Nowak](martin-nowak.md) synthesized the theoretical literature into five formal rules in a landmark 2006 *Science* review, later expanded for broader readers in *SuperCooperators* (Nowak & Highfield, 2011).

## The five mechanisms

1. **Kin selection.** Cooperation spreads among relatives when the fitness benefit to the recipient, weighted by genetic relatedness, exceeds the cost to the actor — [Hamilton's rule](wd-hamilton.md) ($rb > c$, or $r > c/b$).
2. **Direct reciprocity.** Repeated encounters between the same two partners allow conditional strategies ("I help you if you help me"), such as Tit-for-Tat or Win-Stay, Lose-Shift, when the probability of another encounter exceeds the cost-to-benefit ratio ($w > c/b$).
3. **Indirect reciprocity.** Helping builds reputation in a population of observers: individuals cooperate with partners in good standing (*"I help you and somebody else helps me"*). In *Nature* (1998), Nowak and Karl Sigmund modeled **image scoring**, showing how first-order reputation tracking promotes cooperation when observation probability exceeds cost/benefit ratios ($q > c/b$), and expanded this framework in a 2005 *Nature* synthesis (*"Evolution of indirect reciprocity"*).
4. **Network reciprocity.** When interactions are localized rather than well-mixed, cooperators form clusters that share benefits primarily with neighbors. Analyzing evolutionary games on graphs, Ohtsuki, Hauert, Lieberman & Nowak (*Nature*, 2006) derived a simple condition under weak selection: natural selection favors cooperators whenever the benefit-to-cost ratio exceeds the average degree (number of neighbors) $k$:
   $$\frac{b}{c} > k$$
   Sparse local neighborhoods (low $k$) and spatial viscosity shield cooperative patches from systemic invasion by defectors.
5. **Group ([multilevel](multilevel-selection.md)) selection.** When populations partition into competing groups or collectives, groups rich in cooperators out-reproduce cooperator-poor groups when between-group selection outweighs within-group cheating ($b/c > 1 + n/m$ in Nowak's idealized group-size $n$, group-count $m$ model).

In *SuperCooperators* (2011), Nowak and Highfield framed cooperation alongside mutation and selection as a third generative engine of evolutionary complexity—showing how the five rules recur from prebiotic replicators to multicellular tissues and human institutions.

## Application to multicellularity

These mechanisms supply the mathematical backbone of [multicellular cooperation](multicellular-cooperation.md) and [evolutionary transitions in individuality](evolutionary-transitions-in-individuality.md). A metazoan body relies heavily on kin selection (clonal descent through a single-cell zygote bottleneck, $r \approx 1$), reinforced by spatial tissue architecture (epithelial topology limiting effective neighbor access, akin to network reciprocity) and internal policing ([p53](p53-tp53.md) checkpoints, [apoptosis](apoptosis.md), [immune surveillance](immune-surveillance.md)). When somatic cells mutate to evade arrest or leave their spatial niche, kin and spatial restraints weaken and defection emerges as neoplasia.

## References

- Nowak, M. A., & Sigmund, K. (1998). Evolution of indirect reciprocity by image scoring. *Nature*.
- Nowak, M. A., & Sigmund, K. (2005). Evolution of indirect reciprocity. *Nature*, 437, 1291–1298.
- Ohtsuki, H., Hauert, C., Lieberman, E., & Nowak, M. A. (2006). A simple rule for the evolution of cooperation on graphs and social networks. *Nature*, 441, 502–505.
- Nowak, M. A. (2006). Five rules for the evolution of cooperation. *Science*.
- Nowak, M. A., & Highfield, R. (2011). *SuperCooperators: Altruism, Evolution, and Why We Need Each Other to Succeed*.
