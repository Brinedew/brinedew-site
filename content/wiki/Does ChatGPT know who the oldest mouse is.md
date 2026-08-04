---
title: Does ChatGPT know who the oldest mouse is?
tags:
date: 2026-08-04
draft: true
---

# Does ChatGPT know who the oldest mouse is?

AIs are in the [news](https://www.telegraph.co.uk/business/2026/08/03/unreleased-ai-model-solves-decades-old-maths-problems/) this [week](https://mashable.com/tech/anthropic-fable-5-disproves-jacobian-conjecture) for supposedly getting research mathematicians out of a job. If any of you are looking for a new career, consider pivoting to areas AIs can't touch in the near future - like reading longevity papers.

Let's say you're interested in benchmarking lifespan extension communities against each other, based on which animal they work on. It's 2026, so for many of us the natural first step to just turn to ChatGPT, or any other AI assistant, and ask it to make a table of lifespan records by species. 

In response, AIs invariably repeat that a mouse from Andrzej Bartke's laboratory lived for **1,819 days**, the maximum mouse lifespan ever reported.

But are they right to do that?
![[image-57.png|A mundane data collation request I gave to ChatGPT]]![[image-59.png|The response - note the "high confidence", "cleanest row" claims.]]
Bartke's lifespan record was indeed celebrated by the [Methuselah Foundation](https://www.mfoundation.org/) in 2003 as Methuselah Mouse Prize. But this specific mouse was never actually recorded in any research publication! The 1,819-day figure comes from **personal communication**, not a paper documenting the animal cohort and its survival record. 

To be clear, the 

This is not by itself an attack on scientific integrity of MPrize participants - lifespan prize design is a hard problem. However, when making comparative maximum lifespan tables (as I do), it's not an accepted practice to include Bartke's result on the same level of evidentiary support as the lifespan results from published mouse cohorts.

**Why can't we just include every mouse lifespan claimed by a researcher**, whether it's mentioned in a publication or not? 

This lax practice would lose important quality control checks on data. A research paper provides supporting data that help validate the record against the possibility of a singular mix-up. For example, when authors provide a survival curve for all the individuals in a cohort, you can now judge: 
* is the shape of survival curve compatible with the numbers in the text of the paper?
* was the winning animal a suspicious outlier among its cohort mates?
* how good were the animal facility conditions based on the control group survival shape?
And so on.

**Are mouse mix-ups a common concern in longevity research?** 

Surprisingly, yes. Earlier this year ChatGPT helped me spot one mix-up myself.

Long story short:
1. I downloaded raw datasets from https://phenome.jax.org/ and pointed ChatGPT at it to analyze. 
2. It quickly found an outlier mouse that had a recorded age of 1,644 days in the raw dataset - easily in top 3 of mouse lifespans of all time, but not remarked about anywhere. 
3. Sure enough, after I reached out to the lab responsible for the animal, they explained that this mouse's outstanding longevity was just a data entry mistake.

**How do lifespan mix-ups happen?** 

In this case, the mouse was last seen at Nov 1, 2021, at the age of 18 months. During the next scheduled weighing, 6 months later, the mouse was gone. It wasn't anything out of the ordinary: during routine colony maintenance, dead mice not reserved for dissection are normally removed by animal facility technicians, not researchers.

What went wrong is that the researcher, when recording the mouse's uncertain-but-unimpressive lifespan, made a typo in the records table. When inputting the date last seen at, instead of typing 2021, they typed 2024 - numbers 1 and 4 are close together on the keypad. This added 36 months to mouse's 18-month lifespan, adding up to 1,644 days.

Why did an outlier this large go unnoticed until dataset publication? As it was explained to me, the mystery mouse was marked "removed" for data analysis purposes. It's a common practice that mice removed for fighting, technical accidents, training, or other aging-unrelated causes would be treated as "last seen alive" at removal date. This accounting practice helps to keep a five-year longevity experiment on track even if a few mice accidentally flood during the first year because of a compromised pipe.

Consider an analysis that uses a hybrid analysis structure: 
* Kaplan–Meier curves and log-rank tests use the partial information from removed ("censored") mice.
* Their separately reported “median longevity” and 90th-percentile age are calculated from animals with known death ages, after dropping “removed” records.

Whether that second step is a good idea or not, to me is unclear. Regardless, as a result, removed entries aren't included in the experimental summary statistics that the researcher reports on (median survival, 90th percentile survival).

Another concern entirely is deliberate fabrication. A policy of including off-journal records into lifespan tables would be very vulnerable to fabrication: it's stupid simple to fabricate a single animal's lifespan, but fabricating an entire cohort makes it possible for data sleuths to discover statistical irregularities in the dataset.

LLMs, however, fail to draw this distinction and include Bartke's mouse on equal grounds with all the actual studies. But when you point out the lack of publication, they happily throw Bartke's mouse away.

In that case, they still can't decide on a singular record. If you use ChatGPT 5.6 Extra High thinking ($20 subscription), it finds the mouse lifespan record of 1,628 days.

![[image-56.png]]

This is taken from Turturro et al (2009) [^1]:

> The oldest male mouse, B6D2F1, lived to 1,628 days.

![[image-53.png|From Turturro et al., 1999]]
But if you ask ChatGPT 5.6 Pro ($100 subscription!!! please support your local scientist) it will dig up Weindruch et al. (1986)[^2], with 54.6 months equaling around 1,660 days, plus-minus a few days, depending on month conversion.

> The longest-lived individual mouse was from group N/R40 that lived 54.6 mo.

![[image-55.png|From Weindruch et al., 1986]]

ChatGPT Pro also brings up Harrison-Archer study from 1987.[^3] In a later secondary work, the same authors describe the study as producing:
> “1742 days, a new record for Mus”

But I couldn't actually access the paper, and the later curve digitization efforts by Schmauck-Medina et al. didn't provide curves for this study either, despite mentioning it by name as the record-holder.



So is AI good at unstructured data collation and meta-analysis? 

For a longevity enthusiast, as of 2026, it seems like the answer is definitely no - it's way too easy to mislead by pop-science content and it can't really assess the data critically without the user's help. 

For a researcher who knows how to formulate a right prompt, it can dig up something worth following up on. This is perhaps a mirror of AIs as a knowledge multiplier that people [called out](https://x.com/connerdelights/status/2079687509077073977) when reading Terence Tao's ChatGPT transcripts.

![[image-60.png]]

[^1]: Turturro A, Witt WW, Lewis S, Hass BS, Lipman RD, Hart RW. Growth Curves and Survival Characteristics of the Animals Used in the Biomarkers of Aging Program. *Journal of Gerontology: Biological Sciences.* 1999;54(11):B492–B501. [doi:10.1093/gerona/54.11.B492](https://doi.org/10.1093/gerona/54.11.B492).

[^2]: R. Weindruch, R. L. Walford, S. Fligiel and D. Guthrie. “The Retardation of Aging in Mice by Dietary Restriction: Longevity, Cancer, Immunity and Lifetime Energy Intake.” _Journal of Nutrition_. 1986;116(4):641–654. [doi:10.1093/jn/116.4.641](https://doi.org/10.1093/jn/116.4.641)

[^3]: D. E. Harrison and J. R. Archer. “Genetic Differences in Effects of Food Restriction on Aging in Mice.” _Journal of Nutrition_. 1987;117(2):376–382. [doi:10.1093/jn/117.2.376](https://doi.org/10.1093/jn/117.2.376)
