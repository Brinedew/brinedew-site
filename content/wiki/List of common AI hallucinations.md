---
title: List of common AI hallucinations
tags:
  - content/wiki
date: 2026-08-04
draft: false
---

# List of common AI hallucinations

This is a list of dubious claims, hallucinations, or regurgitated urban legends I often stumble upon when I work with LLMs. I add entries to this list continuously as I encounter them. 
## AIs cite Bartke's 2003 GHR-KO 11C mouse as if it was a published lifespan record

When asked for the mouse lifespan records, LLMs often repeat that a mouse from Andrzej Bartke's laboratory lived for **1,819 days**, the maximum mouse lifespan ever reported. They cite this number even when asked to compare mouse lifespan records in scientific literature.
![[image-57.png|A mundane data collation request I gave to ChatGPT]]![[image-59.png|The response - note the "high confidence", "cleanest row" claims.]]
This lifespan record was indeed celebrated by the [Methuselah Foundation](https://www.mfoundation.org/) in 2003 as Methuselah Mouse Prize, but it was never reported in a scientific publication. The 1,819-day figure comes from **personal communication**, not a paper documenting the animal cohort and its survival record. 

This is not by itself an attack on scientific integrity of MPrize participants - lifespan prize design is a hard problem. However, when making comparative maximum lifespan databases (as I do), it's not correct to include Bartke's result on the same level of evidentiary support as the lifespan results from published mouse cohorts.

Why can't we just include every mouse lifespan claimed by a scientist, whether it's mentioned in a publication or not? 

This practice would lose important quality control checks on data. A research paper provides supporting data that help validate the record against the possibility of a singular mix-up. For example, when authors provide a survival curve for all the individuals in a cohort, you can now judge: 
* how much was the winning animal an outlier against its cohort mates?
* how good were the animal facility conditions based on the control group survival?
And so on.

Additionally, a policy including off-journal results would be very vulnerable to fabrication: it's very easy to fabricate a single animal's lifespan, but fabricating an entire cohort makes it possible for data sleuths to discover statistical irregularities in the dataset.

LLMs, however, fail to draw this distinction and include Bartke's mouse on equal grounds with all the others. But when you point out the lack of publication, they happily throw Bartke's mouse away.

In that case, they still can't decide on a singular record. If you use ChatGPT 5.6 Extra High thinking ($20 subscription), it finds the mouse lifespan record of 1,628 days.

![[image-56.png]]

This is taken from Turturro et al (2009) [^1]:

> The oldest male mouse, B6D2F1, lived to 1,628 days.

![[image-53.png|From Turturro et al., 1999]]
But if you ask ChatGPT 5.6 Pro ($100 subscription!!! please support your local scientist) it will dig up Weindruch et al. (1986)[^2], with 54.6 months equaling around 1,660 days, plus-minus a week, depending on month conversion.

> The longest-lived individual mouse was from group N/R40 that lived 54.6 mo.

![[image-55.png|From Weindruch et al., 1986]]

ChatGPT Pro also brings up Harrison-Archer study from 1987.[^3] In a later secondary work, the same authors describe the study as producing:
> “1742 days, a new record for Mus”

In short, the more you pay for your AI, the longer it extends the mouse lifespan winter.

[^1]: Turturro A, Witt WW, Lewis S, Hass BS, Lipman RD, Hart RW. Growth Curves and Survival Characteristics of the Animals Used in the Biomarkers of Aging Program. *Journal of Gerontology: Biological Sciences.* 1999;54(11):B492–B501. [doi:10.1093/gerona/54.11.B492](https://doi.org/10.1093/gerona/54.11.B492).

[^2]: R. Weindruch, R. L. Walford, S. Fligiel and D. Guthrie. “The Retardation of Aging in Mice by Dietary Restriction: Longevity, Cancer, Immunity and Lifetime Energy Intake.” _Journal of Nutrition_. 1986;116(4):641–654. [doi:10.1093/jn/116.4.641](https://doi.org/10.1093/jn/116.4.641)

[^3]: D. E. Harrison and J. R. Archer. “Genetic Differences in Effects of Food Restriction on Aging in Mice.” _Journal of Nutrition_. 1987;117(2):376–382. [doi:10.1093/jn/117.2.376](https://doi.org/10.1093/jn/117.2.376)
