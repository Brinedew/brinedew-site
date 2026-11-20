---
title: Clonal governance
tags:
  - content/wiki
date: 2026-11-15
draft: true
vital_level: 1
class: C
aliases:
  - somatic clonal governance
  - evolutionary double bind
  - clonal governance
---
# Clonal governance

A multicellular organism is a collective of self-replicating, mutating somatic cells whose survival depends on keeping those cells below their individual reproductive maximum.[^nelson2017] If cell-level selection runs unchecked toward maximal division speed, selfish clones hijack nutrient uptake and growth checkpoints to produce cancer. If the organism goes to the opposite extreme—shutting down somatic replacement and intercellular competition completely—damaged, low-vigor cells persist unpurged and the tissue loses function.[^nelson2017][^michaels2023]

**Clonal governance** denotes the architectural, metabolic, and competitive restraints that hold a tissue in the intermediate corridor between those two failure modes: enough somatic turnover and [[Cell competition|cell competition]] to purge degraded cells, combined with strong enough division brakes and lineage isolation ([[de-darwinization|de-Darwinization]]) to stop cooperative checkpoints from eroding.[^nelson2017][^derényi2017] Whereas [[Compensatory proliferation|compensatory proliferation]] describes transient repair pulses gated to acute cell loss, clonal governance covers the underlying steady-state selection and lineage-architecture trade-offs that shape organismal longevity and cancer risk.

## The intercellular competition double bind

Suppose every somatic cell in an organism carries two evolvable traits that decay over age:[^nelson2017][^michaels2023]

1. **Vigor ($v \in [0, 1]$):** Metabolic competence, organelle quality, and tissue work output. Entropy and somatic damage degrade vigor at rate $\mu_v$.
2. **Cooperation ($c \in [0, 1]$):** Willingness to abide by organismal growth brakes ($G_0$ checkpoints, extracellular matrix synthesis, contact inhibition). Loss-of-function hits erode cooperation at rate $\mu_c$, creating cancer-prone cheater lineages.

Because healthy cooperative cells $(1, 1)$ spend ATP and ribosome time doing tissue work instead of cycling, while selfish cheaters $(1, 0)$ redirect those resources directly into DNA replication, cooperation carries an unavoidable division-rate penalty $k \in (0, 1)$. Setting baseline competitive turnover pressure to $f_0$, the growth rate of a cell with $(v, c)$ follows:

$$f(v, c) = f_0 v \bigl(1 - k\, c\bigr)$$

Working through the failure of both naive extremes makes the constraint transparent:[^michaels2023]

* **Zero competition ($f_0 = 0$):** Cheaters gain zero selective growth advantage, because nobody divides to outcompete neighbors. Yet every cell losing vigor ($\mu_v > 0$) lingers in the tissue unreplaced, causing monotonic tissue degeneration.
* **Infinite competition ($f_0 \to \infty$) with no cost ($k = 0$):** If maintaining tissue work were metabolically free ($k = 0$), cranking division and replacement sky-high would wash out broken $(0, 1)$ cells instantaneously without helping $(1, 0)$ cheaters spread. Because $k > 0$ in real cells, any competitive pressure $f_0 > 0$ needed to purge sluggish $(0, 1)$ cells simultaneously hands $(1, 0)$ cheaters a selective fitness edge $f_c = f_0 k$.

### Exact master-equation dynamics

Under constant total cell population size and binary traits ($v, c \in \{0, 1\}$), Thomas Michaels and L. Mahadevan solved the Nelson–Masel replicator–mutator dynamics analytically.[^michaels2023] Because cellular fitness is linear in $v$ and $c$, the global homeostatic constraint factorizes cell states into two independent binomial probabilities representing the surviving fraction of vigorous cells $p_v(t)$ and cooperative cells $p_c(t)$:

$$p_v(t) = \frac{f_v - \mu_v}{f_v - \mu_v e^{-t/\tau_v}}, \qquad p_c(t) = \frac{f_c + \mu_c}{f_c + \mu_c e^{t/\tau_c}}$$

Here $\tau_v = 1/(f_v - \mu_v)$ and $\tau_c = 1/(f_c + \mu_c)$ are the relaxation timescales of senescence purging and cheater takeover, with vigor advantage $f_v = f_0(1-k)$ and cheater edge $f_c = f_0 k$. Rescaling time by the vigor-decay clock $\tau = \mu_v t$ gives dimensionless turnover $\tilde{f}_0 = f_0/\mu_v$, mutation ratio $r = \mu_c/\mu_v$ (about $10^{-2}$ in humans because roughly 1% of human genes act as cancer drivers), and organismal vitality $\tilde{V}(\tau) = p_v(\tau)\,p_c(\tau)$:[^michaels2023]

$$p_v(\tau) = \frac{\tilde{f}_v - 1}{\tilde{f}_v - e^{-(\tilde{f}_v - 1)\tau}}, \qquad p_c(\tau) = \frac{\tilde{f}_c + r}{\tilde{f}_c + r\,e^{(\tilde{f}_c + r)\tau}}$$

The two factors move in opposite directions under $\tilde{f}_0$: raising turnover $\tilde{f}_0$ holds vigorous fraction $p_v(\tau)$ higher by purging sluggish $v = 0$ cells, while forcing cooperative fraction $p_c(\tau)$ down exponentially at rate $\tilde{f}_c + r$ by multiplying cheater expansion. No positive constant value of $\tilde{f}_0$ prevents $\lim_{\tau \to \infty} p_c(\tau) = 0$.

Maximizing vitality $\tilde{V}(T)$ over an organism's evolutionary time horizon $T$ therefore sets a unique internal optimum $\tilde{f}_0^*(k, r, T)$:[^michaels2023]

* Longer evolutionary target horizons demand tighter restraint. At baseline human $r = 0.01$ and $k = 0.5$, maximizing $\tilde{V}(T)$ puts optimal turnover near $\tilde{f}_0^* = 3.968$ at $T = 2\,\mu_v^{-1}$, shifts downward to $2.810$ at $T = 3\,\mu_v^{-1}$, and drops further to $2.014$ at $T = 4.6\,\mu_v^{-1}$.
* At the lower cooperation penalty $k = 0.3$ (shown across Fig. 1b, Fig. 2a, and Fig. 3a of Michaels & Mahadevan), optimal competition sits higher—at $\tilde{f}_0^*(0.3, 0.01, 3) = 3.870$—because weaker cheater growth edge allows tissues to tolerate stronger vigor purging.[^michaels2023][^horizonNote]

### Attempts to escape the double bind

Three literatures have challenged whether the competition–cancer double bind strictly prevents indefinite multicellular persistence:

* **Organismal life-history scheduling (`Mitteldorf & Fahy, 2018` vs. `Nelson & Masel, 2018a`):** Mitteldorf and Fahy argued that tissue-wide apoptosis and replacement can be regulated by organism-level senescence programs and eliminated if selection clears slow-growing senescent cells before they harm host fitness.[^mitteldorf2018] Nelson and Masel replied that organismal programs cannot eliminate somatic mutation inflow ($\mu_v, \mu_c > 0$); any selective rule strong enough to outpace continuous $(1, 1) \to (0, 1)$ vigor decay still awards any $(1, 0)$ cheater that skips cooperative work an intrinsic replication advantage over $(1, 1)$ cooperators.[^nelson2018a]
* **Periodic and stochastic switching (`Cheong et al., 2018` and `Wen et al., 2022` vs. `Nelson & Masel, 2018b`):** Cheong, Koh, and Jones reframed the bind as an instance of Parrondo's paradox, suggesting alternation between competitive culling ($p > 0$) and cooperative growth ($p = 0$) could outperform permanent strategies.[^cheong2018] Nelson and Masel countered that non-competing tissue states ($p = 0$) only delay selection without purging mutations, leaving the paradox closed when total cell budget and non-negative death rates apply.[^nelson2018b] Later, Wen et al. modeled explicit periodic ($p \in \{0, 0.005\}$ over period $T$) and stochastic switching under discrete growth steps with background expansion ($r = 1.001$ even when $p = 0$), defining lifespan $\kappa$ as the time until functional cell fraction drops below $\gamma = 1\%$.[^wen2022] Switched schedules ($\kappa_\xi, \kappa_\zeta$) substantially outlasted both unswitched extremes in their main figure—permanent full competition ($p = 0.005$) and permanent zero competition ($p = 0$, which lets $r = 1.001$ growth proceed without purifying competition). However, those main-text comparisons pitted switching only against the two fixed boundary strategies ($p = 0$ and $p = 0.005$), rather than proving whether alternating beats the best constant intermediate competition rate $p^*$.[^wen2022]
* **Selective fitness landscapes (`[[adaptive-oncogenesis|Adaptive oncogenesis]]`):** Empirically, wild-type stem cells actively suppress oncogenic mutants inside young, intact niches; selection flips in favor of cheaters when chronic inflammation, irradiation, or matrix deterioration degrades the wild-type compartment rather than purely from intrinsic competition pressure.[^degregori] Our clonal-governance perspective treats both frameworks as complementary halves of the same constraint: protecting niche integrity reduces the selective edge of defectors ($k_{\text{eff}}$), while strict anti-cheater policing limits how much somatic competition a tissue can safely run without empowering escape clones ([[tumor-suppressor-theory-of-aging]]).

## Hierarchical tissue architecture and compartment size

Tissues do not leave every cell competing in a single well-mixed pool. Self-renewing organs organize into **hierarchical lineages** (stem cells dividing slowly at the apex, feeding transiently amplifying progenitors, which supply terminally differentiated postmitotic cells) and **small physical compartments** (such as intestinal crypts). Three mathematical results isolate what those structural defenses actually solve—and where cell death and repair break them.

### Division conservation along differentiation trees

Imre Derényi and Gergely Szöllősi asked how a hierarchical tissue can supply $N$ terminally differentiated cells over a lifetime while minimizing the maximum number of somatic cell divisions $D^*$ accumulated along any cell lineage.[^derényi2017] At level $k$ of an $n$-level hierarchy feeding downward differentiation rate $\delta_k$ with asymmetric/symmetric probability balance $p_k q_k$:

$$\delta_{k-1} = \delta_k \frac{p_k q_k}{2}$$

Setting $p_k q_k = 2$ with hierarchy depth $n^* \approx \log_2(N)$ reduces lifelong lineage division depth from linear scaling ($\sim N$) down to logarithmic scaling:

$$D^* \approx \log_2(N) + 1 + \log_2(\ln 2) + \frac{1}{\ln 2} \approx \log_2(N) + 1.914$$

This result carries two critical boundaries often misread in summaries:[^derényi2017]

1. **Zero non-terminal cell death assumption.** Equation (1) explicitly prohibits cell death anywhere upstream of terminal expenditure, because any premature loss within stem or progenitor tiers forces extra compensatory divisions to refill the pipeline (death occurring at a fixed fraction of divisions simply multiplies divisional load proportionally). Whenever injury or chronic cell loss triggers [[Compensatory proliferation|compensatory proliferation]] in stem or progenitor pools, achieved divisional load climbs above $D^*$.
2. **Empirical scaling target vs. theoretical derivation.** In citing Tomasetti and Vogelstein's cross-tissue observation that a $100$-fold jump in total stem-cell divisions across human organs corresponds to roughly a $10$-fold jump in lifetime cancer risk, Derényi and Szöllősi treated that sublinear $10\times$ incidence elasticity as an empirical benchmark motivating hierarchical protection—their recursion itself shifts division counts logarithmically (adding $\log_2(100) \approx 6.64$ lifetime divisions along optimal lineages), rather than deriving the $10$-fold cancer risk factor from first principles.[^derényi2017]

### Crowding potentials and small-niche drift

Feedback from compartment boundaries enforces a second layer of clonal governance even when mutants acquire a proliferative boost:

* **Homeostatic crowding thresholds (`Grajzel et al., 2020`):** When cell division rates inside each hierarchical compartment are coupled to deviations between current compartment count $N_k(t)$ and homeostatic target $N_k^0$—mathematically equivalent to trapping compartment size inside a quadratic restoring potential—weakly advantageous mutants face a compartment-size-dependent selective threshold $S_m^*$ below which they drift to extinction rather than sweeping to fixation.[^grajzel2020] Shrinking compartment size raises $S_m^*$, culling marginal cheaters early.
* **Stem-cell attrition vs. neutral washout (`Cannataro et al., 2017`):** Modeling an empirical yeast distribution of mutational fitness effects (`5.75%` beneficial, `94.25%` deleterious) in intestinal crypt niches uncovers a subtle tension between purging and drift.[^cannataro2017] When total differentiated crypt output is held strictly invariant across architectures, niche size $N$ cancels out of lifetime tumor risk (`Section 3.3`). Yet when overall putative crypt cell count is held fixed around ~36 cells while varying how many occupy the quiescent stem niche (`N = 6` vs. `N = 20`), per-stem differentiation rate shifts from $0.172\text{ day}^{-1}$ (`N = 6`) to $0.321\text{ day}^{-1}$ (`N = 20`), causing small 6-cell human niches to suffer substantially worse age-dependent tissue attrition under genetic drift (`>10%` under division-rate mutations and `>20%` under differentiation-rate mutations at 75 years post-adulthood, versus `~5%` in 20-cell niches).[^cannataro2017] Optimizing renewal rates jointly with niche compartment count confirms that low stem self-renewal paired with rapid progenitor flushing minimizes mutant retention unless injury repeatedly breaks compartmental quiescence.[^alvarado2018]

## Boundary with adaptive repair

Steady-state clonal governance sets the baseline ceiling ($f_{\text{base}}$) and architectural shielding ($D^*, S_m^*$) under quiet homeostasis. Acute trauma, toxic ablation, or localized ischemia temporarily breaks those ceilings by injecting a transient turnover pulse $f_0(t) = f_{\text{base}} + \delta_{\text{injury}}(t)$—or, where replication hazard outweighs cell replacement, switching into non-mitotic volume expansion or chromatin arrest. How tissues trigger, cap, and terminate those acute repair responses, and why chronic inflammation or failed braking converts wound repair into neoplasia, is the subject of [[Compensatory proliferation]].

## See also

* [[Compensatory proliferation]]
* [[Cell competition]]
* [[de-darwinization|De-Darwinization]]
* [[tumor-suppressor-theory-of-aging|Tumor Suppressor Theory of Aging]]
* [[adaptive-oncogenesis|Adaptive oncogenesis]]
* [[Conflict between development and tumor suppression]]
* [[Non-technical language in longevity]]

## References

[^nelson2017]: Nelson P, Masel J. Intercellular competition and the inevitability of multicellular aging. *Proc Natl Acad Sci U S A*. 2017;114(49):12982–12987. [doi:10.1073/pnas.1618854114](https://doi.org/10.1073/pnas.1618854114).

    > [!info]- Primary source excerpt — Significance statement, p. 12982
    > ![[comp-prolif-nelson2017-significance.png]]
    >
    > *"Current understanding of the evolution of aging holds that aging is due to the weakness of selection to remove alleles that increase mortality only late in life. Our model, while fully compatible with current theory, makes a stronger statement: Multicellular organisms would age even if selection were perfect."*

[^michaels2023]: Michaels TCT, Mahadevan L. Optimal intercellular competition in senescence and cancer. *Proc R Soc A*. 2023;479:20230204. [doi:10.1098/rspa.2023.0204](https://doi.org/10.1098/rspa.2023.0204).[^signtypo]

    > [!info]- Primary source excerpt — Eqs. 5b–5c, p. 4
    > ![[comp-prolif-michaels2023-eq5bc.png]]
    >
    > *"The analytical solution reveals that $\rho(t, v, c)$ is the product of two independent binomial distributions in vigor and cooperation spaces, with $p_v(t)$ and $p_c(t)$ representing the (time-dependent) probabilities of cells having one unit of vigor or cooperation, respectively."*
[^signtypo]: For consistency across Eq. (3), Eq. (5c), and the fitness boundaries $f(1,1) = f_0(1-k)$ and $f(1,0) = f_0$, cheater selective edge is $f_c = +f_0 k / m > 0$; the prose summary on p. 4 of Michaels and Mahadevan prints a typographical minus sign on $f_c$.
[^horizonNote]: The caption to Fig. 3a in Michaels and Mahadevan (2023) prints $T = 3\,\mu_c^{-1}$ while the curve itself and its Fig. 2a counterpart (`"same parameters as in Fig. 2(a)"`, $k = 0.3, r = 0.01$) correspond to $T = 3\,\mu_v^{-1}$ ($\tau = 3$).
[^mitteldorf2018]: Mitteldorf J, Fahy GM. Questioning the inevitability of aging. *Proc Natl Acad Sci U S A*. 2018;115(4):E558. [doi:10.1073/pnas.1720331115](https://doi.org/10.1073/pnas.1720331115).
[^nelson2018a]: Nelson P, Masel J. Reply to Mitteldorf and Fahy: Aging is still inevitable. *Proc Natl Acad Sci U S A*. 2018;115(4):E559. [doi:10.1073/pnas.1720890115](https://doi.org/10.1073/pnas.1720890115).
[^cheong2018]: Cheong KH, Koh JM, Jones MC. Multicellular survival as a consequence of Parrondo's paradox. *Proc Natl Acad Sci U S A*. 2018;115(23):E5258–E5259. [doi:10.1073/pnas.1806485115](https://doi.org/10.1073/pnas.1806485115).
[^nelson2018b]: Nelson P, Masel J. Reply to Cheong et al.: Unicellular survival precludes Parrondo's paradox. *Proc Natl Acad Sci U S A*. 2018;115(23):E5260. [doi:10.1073/pnas.1806709115](https://doi.org/10.1073/pnas.1806709115).
[^wen2022]: Wen T, Cheong KH, Lai JW, Koh JM, Koonin EV. Extending the lifespan of multicellular organisms via periodic and stochastic intercellular competition. *Phys Rev Lett*. 2022;128(21):218101. [doi:10.1103/PhysRevLett.128.218101](https://doi.org/10.1103/PhysRevLett.128.218101).
[^degregori]: DeGregori J. *Adaptive Oncogenesis: A New Understanding of How Cancer Evolves Inside Us*. Harvard University Press; 2017.
[^derényi2017]: Derényi I, Szöllősi GJ. Hierarchical tissue organization as a general mechanism to limit the accumulation of somatic mutations. *Nat Commun*. 2017;8:14545. [doi:10.1038/ncomms14545](https://doi.org/10.1038/ncomms14545).
[^grajzel2020]: Grajzel D, Derényi I, Szöllősi GJ. A compartment size-dependent selective threshold limits mutation accumulation in hierarchical tissues. *Proc Natl Acad Sci U S A*. 2020;117(3):1606–1611. [doi:10.1073/pnas.1913104117](https://doi.org/10.1073/pnas.1913104117).
[^cannataro2017]: Cannataro VL, McKinley SA, St. Mary CM. The evolutionary trade-off between stem cell niche size, aging, and tumorigenesis. *Evol Appl*. 2017;10(6):590–602. [doi:10.1111/eva.12476](https://doi.org/10.1111/eva.12476).

    > [!info]- Primary source excerpt — Section 4.1.1, p. 11
    > ![[comp-prolif-cannataro2017-attrition.png]]
    >
    > *"If the true stem cell niche size in humans is closer to the lower estimate of six cells, we calculate a much higher rate of tissue attrition, with the epithelium decreasing over 10% and over 20% in the division and differentiation scenarios, respectively. This is due to the much stronger influence of deleterious mutations drifting to fixation at smaller population sizes."*
[^alvarado2018]: Alvarado C, Fider NA, Wearing HJ, Komarova NL. Optimizing homeostatic cell renewal in hierarchical tissues. *PLoS Comput Biol*. 2018;14(2):e1005967. [doi:10.1371/journal.pcbi.1005967](https://doi.org/10.1371/journal.pcbi.1005967).
