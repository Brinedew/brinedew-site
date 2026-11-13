---
title: Adaptive therapy
tags:
- content/wiki
date: 2026-08-26
draft: true
vital_level: 3
class: C
aliases:
- adaptive dosing
- evolutionary therapy
---
# Adaptive therapy

Adaptive therapy is a treatment strategy that adjusts drug dosing to maintain a controllable tumor burden rather than attempting eradication, preserving drug-sensitive cells so they competitively suppress drug-resistant clones.

## Evolutionary and game-theoretic basis

Standard maximum-tolerated-dose (MTD) regimens apply the strongest possible positive selection for resistant cells while eliminating the drug-sensitive competitors that kept them in check — an ecological outcome called *competitive release*. [Robert Gatenby](robert-gatenby.md) and colleagues formulated the alternative in *Cancer Research* (Gatenby et al., 2009): treat to stabilize tumor volume rather than cure, withdrawing drug once tumor burden drops below a target threshold and resuming only when sensitive cells regrow.

Together with Joel Brown (Staňková et al., 2019; Gatenby & Brown, 2020), Gatenby formalized this protocol as a **Stackelberg evolutionary game**. Unlike symmetric population games, physician and tumor play an asymmetric leader–follower game:

- **The physician acts as leader**, committing to a dynamic dosing schedule based on measurable tumor burden (such as serum PSA or imaging).
- **Tumor clones act as followers**, adapting their phenotypic frequency and resistance traits in response to the drug-imposed fitness landscape along Lotka–Volterra competitive dynamics.

Crucially, because continuous MTD ignores this follower response, it drives the system rapidly to a fixed point of untreatable resistant disease. By modulating dosing in real time, a Stackelberg leader exploits the ecological asymmetry between sensitive and resistant populations — steering the tumor away from resistant fixation without needing to out-mutate it.

## Clinical evidence

The landmark first clinical test targeted metastatic castration-resistant prostate cancer (mCRPC) using abiraterone acetate on an adaptive on/off schedule triggered by prostate-specific antigen (PSA) thresholds (Zhang et al., 2017, *Nature Communications*). When PSA dropped to <50% of baseline, abiraterone was suspended until PSA returned to baseline. In that pilot cohort, adaptive therapy maintained androgen-pathway sensitivity with a median time to progression of at least 27 months — markedly longer than matched historical controls on continuous MTD — while cutting average cumulative drug exposure to **47%** of standard continuous dosing.

Subsequent trials and mathematical follow-ups (e.g., intermittent androgen deprivation re-analyses, melanoma, and thyroid/sarcoma protocols) reinforced both the potential of evolutionary scheduling and its dependence on underlying clone ecology. Adaptive therapy is the clinical expression of [cancer ecology](cancer-ecology.md): treating a tumor as an ecosystem managed over time rather than a uniform mass to be eradicated.

## Limits of the approach

Adaptive dosing is not universally applicable and can fail when its core ecological assumptions break down:

1. **Absence of a resistance fitness cost.** Competitive suppression requires resistant cells to pay a metabolic or proliferative penalty when drug is absent. If resistance is cost-free — or confers equal growth rates off-therapy — withholding drug simply allows both resistant and sensitive clones to expand in parallel.
2. **High intratumoral heterogeneity and multi-drug resistance.** When a tumor already harbors numerous spatially segregated subclones with diverse, uncoupled resistance mechanisms or pre-existing pan-resistant lineages, modest sensitive-cell retention cannot suppress all escaping branches.
3. **Spatial partitioning and sanctuary niches.** Lotka–Volterra suppression assumes sensitive and resistant cells share local resources (oxygen, glucose, space). If resistant cells occupy distinct, physically separated microenvironments or poorly perfused niches, sensitive cells elsewhere exert little competitive pressure on them.
4. **Lack of reliable real-time biomarkers.** Safe cycling requires an accurate, rapidly updated proxy of tumor burden (like PSA in prostate cancer) so resistance or symptomatic progression does not advance undetected between monitoring points.

## References

- Gatenby, R. A., Silva, A. S., Gillies, R. J., & Frieden, B. R. (2009). Adaptive therapy. *Cancer Research*.
- Zhang, J., Cunningham, J. J., Brown, J. S., & Gatenby, R. A. (2017). Integrating evolutionary dynamics into treatment of metastatic castrate-resistant prostate cancer. *Nature Communications*, 8, 1816.
- Staňková, K., Brown, J. S., & Gatenby, R. A. (2019). Optimizing cancer treatment using game theory: A review. *JAMA Oncology*.
- Gatenby, R. A., & Brown, J. S. (2020). Integrating evolutionary dynamics into cancer therapy. *Nature Reviews Clinical Oncology*.
