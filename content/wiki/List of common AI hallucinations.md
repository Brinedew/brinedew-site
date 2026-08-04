---
title: List of common AI hallucinations
tags:
  - content/wiki
date: 2026-08-04
draft: true
---

# List of common AI hallucinations

This is a list of dubious claims, hallucinations, or urban legends I often stumble upon when I work with LLMs. I add entries to this list continuously as I encounter them. 
## AIs cite Bartke (2003) mouse lifespan record together with published lifespan records

When asked for the mouse lifespan records, LLMs often repeat that a mouse from Andrzej Bartke's laboratory lived for **1,819 days**, the maximum reported mouse lifespan. They cite this number even when asked to compare mouse lifespan records.

This lifespan record was indeed celebrated by the [Methuselah Foundation](https://www.mfoundation.org/) in 2003 as Methuselah Mouse Prize, but it was never reported in a scientific publication. The 1,819-day figure comes from **personal communication**, not a paper documenting the animal cohort and its survival record. 

This is not by itself an attack on scientific integrity of MPrize participants - lifespan prize design is a hard problem. However, when making comparative maximum lifespan databases (as I do), it's not correct to include Bartke's result on the same level of evidentiary support as the lifespan results from published mouse cohorts.

Why can't we just include every mouse claimed by a scientist, whether in a publication or not? It's because a lifespan paper includes additional data that help support and validate the record against the possibility of a singular mix-up. For example, when you have a Kaplan-Meier curve of all the animals in a cohort, you can judge how much the winning mouse is an outlier against its peers, how good were the animal facility conditions based on the control group lifespan curve, and so on.

LLMs, however, fail to draw this distinction and include Bartke's mouse on equal grounds with all the others. But when chastised, they happily throw Bartke's mouse away.

The published *Mus musculus* record I can verify for myself is 1,628 days[^1]. Turturro and colleagues reported in 1999:

> The oldest male mouse, B6D2F1, lived to 1,628 days.

![[image-53.png|From Turturro et al., 1999]]
Other notable reports include Weindruch et al. from 1986[^2], with 53 months equaling 1,612 days.

> The longest lived 10% of mice from group 6 averaged 53.0 mo which, to our knowledge, exceeds reported values for any mice of any strain.

And the Harrison-Archer study from 1987.[^3]

[^1]: Turturro A, Witt WW, Lewis S, Hass BS, Lipman RD, Hart RW. Growth Curves and Survival Characteristics of the Animals Used in the Biomarkers of Aging Program. *Journal of Gerontology: Biological Sciences.* 1999;54(11):B492–B501. [doi:10.1093/gerona/54.11.B492](https://doi.org/10.1093/gerona/54.11.B492).

[^2]: 

[^3]: Harrison DE, Archer JR. Genetic differences in effects of food restriction on aging in mice. J-Nutr. 1987 Feb; 117(2):376-82. [doi:10.1093/jn/117.2.376](https://doi.org/10.1093/jn/117.2.376)
