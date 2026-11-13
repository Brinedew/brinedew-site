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

**Adaptive therapy** is a cancer treatment strategy that modulates drug dosing to maintain a controllable tumor burden rather than attempting complete eradication, preserving drug-sensitive cells so that they competitively suppress drug-resistant clones.[^1] Originally formulated by [Robert Gatenby](robert-gatenby.md) and collaborators, it applies [cancer ecology](cancer-ecology.md) and evolutionary game theory directly to clinical scheduling.

## Evolutionary and game-theoretic basis

Continuous maximum-tolerated-dose (MTD) chemotherapy imposes intense selection for resistant subclones while eliminating the sensitive populations that normally compete with them for oxygen, glucose, and space—an ecological process known as *competitive release*.[^1] Adaptive dosing withdraws treatment once tumor burden falls below a target threshold and resumes only when sensitive cells regrow, keeping resistant cells under resource competition rather than driving them to fixation.[^1]

Formalizations with evolutionary ecologist Joel Brown frame the clinician–tumor interaction as a **Stackelberg evolutionary game**, an asymmetric leader–follower contest:[^2][^3]

- **The physician acts as leader**, dynamically adjusting dosing schedules in response to real-time tumor burden metrics (such as serum PSA or imaging).
- **Tumor clones act as followers**, adapting their phenotypic frequencies along Lotka–Volterra competitive dynamics under the drug-imposed fitness landscape.

Because fixed continuous regimens ignore the follower response, they cede strategic initiative to clonal selection. By altering dosing over time, the physician exploits competitive asymmetry between sensitive and resistant cells to prolong control without needing to prevent every resistance mutation.[^2][^3]

## Clinical evidence

The first clinical trial of this strategy tested intermittent abiraterone acetate in patients with metastatic castration-resistant prostate cancer using serum prostate-specific antigen (PSA) thresholds.[^4] Dosing paused when PSA fell below 50% of baseline and restarted when PSA returned to baseline. In that pilot cohort, median time to progression reached at least 27 months—substantially longer than matched continuous-dosing controls—while cutting cumulative drug exposure to 47% of standard dosing.[^4] Follow-up mathematical analyses and protocols in melanoma, sarcoma, and endocrine tumors further test how biomarker cadence and clone competition shape outcomes.[^3]

## Limits of the approach

Adaptive dosing depends on ecological assumptions that do not hold in all tumors:

1. **No resistance fitness cost.** Competitive suppression requires resistant cells to carry a metabolic or proliferative penalty when drug is absent. If resistance is cost-free, pausing therapy simply allows both sensitive and resistant populations to expand together.
2. **Pre-existing pan-resistance or extensive branching.** If a tumor already harbors spatially separated lineages with diverse, uncoupled resistance traits, retaining sensitive clones cannot restrain every escaping branch.
3. **Spatial partitioning.** Lotka–Volterra suppression assumes sensitive and resistant cells share local limiting resources. Resistant cells isolated in poorly perfused or distant sanctuaries feel weak competitive pressure from sensitive populations elsewhere.
4. **Inadequate real-time biomarkers.** Safe cycling requires a fast, reliable proxy of tumor burden (such as PSA in prostate cancer) so disease progression does not occur unnoticed between treatment pauses.

## See also

- [[cancer-ecology|Cancer ecology]]
- [[clonal-evolution|Clonal evolution]]
- [[robert-gatenby|Robert Gatenby]]

## References

[^1]: Gatenby RA, Silva AS, Gillies RJ, Frieden BR. Adaptive therapy. *Cancer Research*. 2009. [doi:10.1158/0008-5472.CAN-08-3658](https://doi.org/10.1158/0008-5472.CAN-08-3658).
[^2]: Staňková K, Brown JS, Gatenby RA. Optimizing cancer treatment using game theory: A review. *JAMA Oncology*. 2019. [doi:10.1001/jamaoncol.2018.3395](https://doi.org/10.1001/jamaoncol.2018.3395).
[^3]: Gatenby RA, Brown JS. Integrating evolutionary dynamics into cancer therapy. *Nature Reviews Clinical Oncology*. 2020. [doi:10.1038/s41571-020-0411-1](https://doi.org/10.1038/s41571-020-0411-1).
[^4]: Zhang J, Cunningham JJ, Brown JS, Gatenby RA. Integrating evolutionary dynamics into treatment of metastatic castrate-resistant prostate cancer. *Nature Communications*. 2017;8:1816. [doi:10.1038/s41467-017-01968-5](https://doi.org/10.1038/s41467-017-01968-5).
