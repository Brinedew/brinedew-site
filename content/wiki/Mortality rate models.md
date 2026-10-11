---
title: Mortality rate models
tags:
- content/wiki
date: 2026-10-11
draft: false
aliases:
- Laws of mortality
- Law of mortality
- Parametric mortality models
- Gompertz law
---
# Mortality rate models

**Mortality rate models**, also called **laws of mortality**, are formulas that describe how a person's or animal's risk of dying changes with age. Biologists use them to ask whether a treatment slowed ageing or only lowered risk across the board, and to compare ageing across species. Actuaries and demographers use them to price pensions and life insurance, to fill gaps in national statistics, and to forecast how long people will live.

The central finding is the **Gompertz law**, published in 1825: in adults, the yearly risk of death grows by a roughly constant percentage with each year of age, so it doubles every eight or nine years in humans.[^gompertz1825][^finch1990] A 30-year-old American woman has about a 1 in 1,100 chance of dying in the coming year; a 90-year-old has about a 1 in 8 chance. Most models therefore describe ageing with two numbers: how high risk is (the level) and how fast it compounds (the pace). Other models add what this misses, such as the high risk of infancy. Why risk compounds at all, and whether it stops rising in the very old, are still argued.

## Reading a mortality curve

### From a cohort to a death rate

Picture 100,000 girls born in the United States, all facing the death rates of 2023. A life table follows them year by year. At each birthday it asks one question: of the girls still alive, what fraction die before their next birthday? That fraction is the age's **death rate**, or more precisely its death probability.

| Age | Still alive (of 100,000) | Risk of dying before the next birthday |
| --- | ---: | --- |
| 10 | 99,337 | 1 in 10,000 |
| 30 | 98,513 | 1 in 1,100 |
| 50 | 95,269 | 1 in 330 |
| 70 | 82,374 | 1 in 68 |
| 80 | 64,606 | 1 in 24 |
| 90 | 30,504 | 1 in 8 |
| 100 | 2,758 | 1 in 3 |

The middle column is the familiar **survival curve** of a lifespan study, the fraction of the cohort still alive at each age: 95% at 50, 65% at 80, 3% at 100. The right-hand column is what produces it. While the yearly risk is tiny, almost nobody dies and the survival curve stays nearly flat; once the risk grows large, the curve falls steeply. A mortality model describes the right-hand column, and the survival curve, the commonest age at death and life expectancy all follow from it.

The rate, not the number of deaths, is what matters here. About 2,700 of these women die between their 80th and 81st birthdays, but only about 900 between their 100th and 101st, even though the risk at 100 is eight times higher. Few deaths happen at 100 only because few people are still alive to die. The death rate removes that effect and measures what an individual of that age faces.

### Why the curve is drawn on a logarithmic scale

Across a lifetime the death rate spans more than three powers of ten, from 1 in 10,000 to 1 in 3. On an ordinary graph everything before age 60 would be a flat line along the bottom. Mortality is therefore plotted on a **logarithmic scale**, on which each gridline is ten times the one below it, and every doubling is a step of the same height: 1 in 1,000, 1 in 500 and 1 in 250 are evenly spaced.

That makes a second pattern visible. Something that grows by a fixed percentage per year, like money at compound interest, doubles in a fixed number of years. It therefore climbs the logarithmic axis in equal steps per year and plots as a straight line. Growth of this kind is called **exponential**. Adult death rates come close to it. For American women in 2023 the risk of dying within a year was 1 in 330 at 50, 1 in 144 at 60, 1 in 68 at 70 and 1 in 24 at 80: roughly doubling to tripling with each decade, and close to a straight line on the logarithmic plot (Figure 1). Gompertz noticed this regularity in the life tables of his day, which is why it carries his name.

![[mortality-us-2023-gompertz.png|Figure 1. The risk of dying within a year, by age, in the United States in 2023 (Social Security Administration life table). Each step up the vertical axis is ten times the one below. On this scale a risk that doubles every few years appears as a straight line. The dashed lines are the Gompertz law fitted to ages 35 to 85: risk doubles every 9.5 years for men and every 8.5 years for women. The straight line misses infancy, childhood and the bulge in young adulthood.]]

### Two numbers: level and pace

A straight line is fixed by two numbers, and so is the Gompertz law:

- **The pace of ageing** is the steepness of the line: how fast risk compounds. It is usually quoted as the **mortality rate doubling time**, the number of years it takes the death rate to double. For American women in 2023 it is about 8.5 years, equivalent to risk growing by about 8% per year. Humans and rhesus monkeys share a doubling time of about eight years; mice double their risk roughly every three months.[^finch1990]
- **The level** is how high the whole line sits. Two populations with the same pace but different levels have parallel lines, one above the other.

The distinction is a main reason biologists fit these models. A treatment that lowers the level divides risk by the same factor at every age, so the line moves down but keeps its slope. A treatment that lowers the pace makes risk compound more slowly and flattens the line, which is what "slowing ageing" means in demographic terms. Lowering the level is the same as postponing all risk. Because the line is tilted, sliding it ten years to the right leaves it lower at every age by exactly the amount risk grows in ten years: with an 8.5-year doubling time, delaying all risk by ten years divides every age's risk by about 2.3.

The two effects can look alike in a lifespan experiment, because both make animals live longer. They differ on the mortality plot. When fruit flies are switched to a restricted diet, their risk of death falls within two days, at any age, but keeps rising at the same pace afterwards, so dietary restriction in flies lowers the level, not the pace.[^mair2003] Over the twentieth century, human mortality at older ages behaved the same way: the line slid later by about a decade while its slope barely changed.[^vaupel2010] Telling the two apart needs large cohorts, because random noise in a small study can make a change in level look like a change in pace.[^pletcher1999]

### Rates over a year and rates at an instant

The table gives the probability of dying within a year. The models are usually written for a closely related quantity, the **hazard**: the death rate at a single moment, expressed per year, in the way a car's speed at one instant is expressed in kilometres per hour. While risk is low the two are practically equal: a hazard of 0.004 per year means about 0.4% die within the year. They diverge when risk is high, because a probability cannot exceed 100% but a rate can exceed 1, just as a car can do 100 kilometres per hour for a few seconds without covering 100 kilometres. A hazard of 1 per year means about 63% die within a year, not 100%, because as the year goes on the rate applies to a shrinking group of survivors; 0.7 per year means about half die. Below, "death rate" means the hazard; for most of life the distinction does not matter.

> [!note]- The formal definitions
> Treat the age at death $T$ of a newborn as a random variable. The **survival function** $S(x) = \Pr(T > x)$ is the fraction still alive at age $x$; demographers write it as $l_x / l_0$. The **hazard**, which actuaries call the **force of mortality**, is the death rate over an infinitely short interval:
>
> $$
> \mu(x) = \lim_{\Delta x \to 0} \frac{\Pr(x < T \le x + \Delta x \mid T > x)}{\Delta x} = -\frac{\mathrm{d}}{\mathrm{d}x} \ln S(x).
> $$
>
> Integrating gives survival from the hazard, and life expectancy at birth is the area under the survival curve:
>
> $$
> S(x) = \exp\!\left(-\int_0^x \mu(t)\,\mathrm{d}t\right), \qquad e_0 = \int_0^\infty S(x)\,\mathrm{d}x.
> $$
>
> Life tables report one of two yearly quantities rather than $\mu(x)$. The **death probability** $q_x$ is the chance that someone alive at exact age $x$ dies before age $x + 1$, which is $1 - S(x+1)/S(x)$. The **central death rate** $m_x$ is the deaths at age $x$ divided by the person-years lived at that age. If the hazard is constant within each year of age, $m_x = \mu$ and $q_x = 1 - e^{-m_x}$. The three are nearly equal while risk is low. At the oldest ages they diverge, because $q_x$ cannot exceed 1 but $\mu(x)$ can. The mortality rate doubling time of a hazard that grows as $e^{bx}$ is $\ln 2 / b \approx 0.69/b$.

## The age pattern of human mortality

Human mortality has the same broad shape in every well-recorded population, often called a "bathtub" because it is high at both ends. Figure 1 shows it for the United States in 2023:

1. **Infancy and childhood.** Risk is highest in the first year of life (6.0 deaths per 1,000 boys and 5.1 per 1,000 girls in 2023) and falls steeply to a minimum around ages 8 to 10, about 1 in 10,000 per year.
2. **The young-adult bulge.** From puberty, death rates rise faster than ageing alone would predict, mostly from accidents, violence and other external causes. The bulge is much larger in men. At age 22 a man's risk of dying within the year was 1.4 per 1,000 in 2023, about 11 times his childhood minimum and 2.7 times a woman's of the same age.
3. **Senescence.** From about age 30 the rise becomes close to exponential and follows the Gompertz law. By age 100 the yearly risk of death is about 37% for men and 33% for women.

The three parts correspond to three biological situations: the fragility of a developing body, the risky behaviour of young adults, and the accumulating damage of ageing. Each model below can be read as a decision about which of these parts to describe and how.

## Models of the age pattern

Each model is a recipe for the curve in Figure 1. The simplest describe only adult ageing. Others add a constant floor of risk, a ceiling at the oldest ages, or a separate term for each part of life. More terms fit the data more closely, but their parameters become harder to estimate and to interpret. Figure 2 shows five models fitted to the same data.

![[mortality-model-fits-us-men-2023.png|Figure 2. Five models fitted to the risk of death of American men in 2023, on a logarithmic scale. (A) Models of adult ageing, fitted to adult ages and extended (dashed) to younger ages. (B) Models of the whole life span, fitted to all ages. Over each model's own age range, a typical age's fitted risk differs from the observed one by about 26% for Gompertz, 20% for Gompertz–Makeham, 61% for Weibull, 42% for Siler and 11% for Heligman–Pollard. Panels A and B use different age ranges, so their errors are not directly comparable.]]

### Gompertz law

The Gompertz law says that adult risk of death compounds at a constant rate. Written as a formula, the hazard at age $x$ is

$$
\mu(x) = a\,e^{bx},
$$

where:

- $a$ is the **level**: the risk the line would give at age zero if it were extended that far;
- $b$ is the **pace**: the fraction by which risk grows per year of age, close to 0.08 in humans;
- $e^{bx}$ is the compounding. The number $e \approx 2.718$ is the base mathematicians use for continuous compound growth; with $b = 0.08$, risk multiplies by about 1.08 with each year of age.

The doubling time is $0.69/b$, where 0.69 is the natural logarithm of 2. Finance uses the same rule rounded to 70: at 8% growth, money doubles in about 70/8, or nine years. The fits in Figure 1 give $b = 0.073$ for American men and $b = 0.081$ for American women, so their death rates double every 9.5 and 8.5 years.

The level $a$ is awkward to interpret, because nobody of age zero follows the adult law. In any fit it also trades off against $b$: a slightly steeper line with a lower starting point fits almost as well. Many researchers therefore describe the level by the **modal age at death**, the age at which deaths are most common, which is the peak of the distribution of ages at death.[^missov2015] The 2023 American fits put it at about 85 for men and 90 for women. In the table itself, deaths peak at 87 for men and 89 for women; a straight line fitted to ages 35 to 85 does not follow the real curve exactly above that range.

The Gompertz law describes adult mortality in people and in many laboratory animals with only two numbers. It cannot describe childhood or the young-adult bulge, and it predicts that risk keeps rising without limit. Whether that is true at the very highest ages is the subject of the [plateau debate](#late-life-deceleration-and-the-plateau-debate).

> [!note]- Survival under the Gompertz law, and the modal-age form
> Integrating the hazard gives the survival function
>
> $$
> S(x) = \exp\!\left[-\frac{a}{b}\left(e^{bx} - 1\right)\right].
> $$
>
> The density of deaths, $f(x) = \mu(x)\,S(x)$, peaks at the modal age $M = \tfrac{1}{b}\ln(b/a)$, where $\mu(M) = b$. Replacing $a$ by $M$ gives the widely used form $\mu(x) = b\,e^{b(x - M)}$, whose two parameters are much less correlated than $a$ and $b$.[^missov2015]

### Gompertz–Makeham law

Some deaths have little to do with age: accidents, infections, violence. In 1860 William Makeham added a constant floor of risk to the Gompertz law to represent them:[^makeham1860]

$$
\mu(x) = a\,e^{bx} + c,
$$

where $c$ is the yearly risk that applies equally at every age. The floor lets the law follow mortality down into the late teens, where ageing contributes almost nothing but people still die. Fitted to American men aged 15 to 100 in 2023, $c$ is about 0.0009, or 9 deaths per 10,000 people per year (Figure 2A). In modern populations the floor is small and hard to estimate. It also soaks up part of the young-adult bulge, so it should not be read as a clean measure of "external" deaths; dividing deaths into ageing-related and background causes is itself a simplification.[^horiuchi1998]

### Weibull model

The Weibull model replaces compounding with a power of age. Under the Gompertz law, risk grows by the same percentage with each added *year*. Under the Weibull model, it grows by the same factor each time age *doubles*: if risk multiplies by 24 between ages 40 and 80, it also multiplies by 24 between 50 and 100. As a result, the rise looks steep early and gentler later on the usual mortality plot (Figure 2A). The hazard is

$$
\mu(x) = \frac{\beta}{\alpha}\left(\frac{x}{\alpha}\right)^{\beta - 1},
$$

where $\alpha$ is a characteristic age that sets the scale and $\beta$ is the shape. With $\beta$ above 1 risk rises with age, with $\beta = 1$ it is constant, and with $\beta$ below 1 it falls.

The model comes from engineering, where it describes machines and materials that fail when the first of many parts fails, or after damage builds up in several steps. The same power law describes the incidence of many cancers, which rises roughly as the fifth or sixth power of age; the [[Armitage–Doll model]] explains this as the need for several mutations in one cell lineage. For deaths from all causes, the Gompertz law usually fits better, and the Weibull model better describes single causes of death.[^juckett1993] In the 2023 American data, the best Weibull fit to men aged 30 to 100 misses the observed rates by about 61% at a typical age, against 26% for the Gompertz law over the same ages.

Robert Ricklefs and Alex Scheuerlein argued that the choice between the two models carries biological meaning.[^ricklefs2002] In the versions they compared, both with a constant background term, the Gompertz ageing term *multiplies* the background risk. That suits ageing as growing vulnerability to outside dangers. The Weibull ageing term is *added* to the background, which suits ageing as the growth of internal causes of death. They proposed comparing wild and captive animals of the same species to tell the two apart.

### Logistic models: a ceiling on risk

Several models bend the Gompertz line so that risk rises ever more slowly at the oldest ages and approaches a ceiling. They are called **logistic** because their curve has the same S-shape as the logistic curve of population growth, which also starts out exponential and then levels off. The general form, due to Wilfred Perks in 1932, divides a Gompertz rise by a second term that grows along with it.[^perks1932] At younger ages the divisor is close to 1 and changes nothing, so the model behaves like Gompertz–Makeham. At old ages the divisor grows as fast as the risk itself, so their ratio stops rising and risk levels off at a ceiling. Two special cases are in common use:

- **The Kannisto model** is the simplest version, with a ceiling at a hazard of 1 per year (about 63% of people dying each year).[^thatcher1998] The Human Mortality Database, the main open archive of national life tables, uses it to smooth death rates above age 80, where data are sparse.[^hmd2025]
- **The gamma-Gompertz model** derives the ceiling from differences between people: everyone ages by the Gompertz law, but the frailest die first, so the survivors' death rate rises more slowly than any individual's (see [Differences in frailty](#differences-in-frailty)).[^vaupel1979] The "gamma" names the assumed spread of frailty, a standard statistical distribution chosen because it makes the mathematics simple.

Logistic models say nothing about childhood or the young-adult bulge. They are applied to adult and old-age mortality, where they usually fit at least as well as the Gompertz law and predict lower risks beyond the data.[^thatcher1998]

> [!note]- The Perks, Kannisto and gamma-Gompertz formulas
> Perks:
>
> $$
> \mu(x) = \frac{c + a\,e^{bx}}{1 + d\,e^{bx}},
> $$
>
> which tends to $a/d$ at old ages. The Kannisto model sets $c = 0$ and $d = a$:
>
> $$
> \mu(x) = \frac{a\,e^{bx}}{1 + a\,e^{bx}}.
> $$
>
> In the gamma-Gompertz model each individual's hazard is $Z\,a\,e^{bx}$, where the frailty $Z$ has a gamma distribution with mean 1 and variance $\gamma$. The hazard of the surviving population is
>
> $$
> \mu(x) = \frac{a\,e^{bx}}{1 + \dfrac{a\gamma}{b}\left(e^{bx} - 1\right)} \;\longrightarrow\; \frac{b}{\gamma} \quad \text{as } x \to \infty.
> $$
>
> Adding Makeham's constant outside the frailty term gives the gamma-Gompertz–Makeham model, which Robert Beard derived in 1959.[^beard1959]

### Models of the whole life span

To describe all ages at once, models add a separate term for each part of the bathtub and sum them.

- **Thiele (1871).** The Danish astronomer Thorvald Thiele used three terms: a risk that falls through childhood, a bell-shaped bump for young adults, and a Gompertz rise for ageing.[^thiele1871]
- **Siler (1979).** The ecologist William Siler kept the falling childhood term and the Gompertz rise but replaced the bump with Makeham's constant floor, giving five parameters.[^siler1979] It was designed for animal populations, in which juvenile deaths are common and there is no young-adult bulge. It fits such data well and remains a standard model in comparative biology.[^jones2014] In human data it cuts straight through the bulge (Figure 2B).
- **Heligman–Pollard (1980).** Larry Heligman and John Pollard also used three terms, for childhood, the accident bulge and ageing, with eight parameters in all.[^heligman1980] Each parameter has a reading: one sets the height of the bulge, one its width, one the age of its peak, and so on. The model follows national life tables closely across all ages: in Figure 2B its typical error is about 11%. Its parameters trade off against one another, however, so they can jump from one year or country to the next. For American men in 2023 the fitted bulge is broad and centred in the late thirties rather than in the early twenties, where it peaked in mid-twentieth-century tables. That is a property of the fit rather than a direct observation, because the bulge and ageing terms compete for the same deaths.

> [!note]- The Thiele, Siler and Heligman–Pollard formulas
> Thiele:
>
> $$
> \mu(x) = a_1 e^{-b_1 x} + a_2 \exp\!\left[-\tfrac{1}{2} b_2 (x - c)^2\right] + a_3 e^{b_3 x}.
> $$
>
> Siler:
>
> $$
> \mu(x) = a_1 e^{-b_1 x} + a_2 + a_3 e^{b_3 x}.
> $$
>
> Heligman–Pollard models the odds of death, $q_x/(1 - q_x)$, rather than the hazard:
>
> $$
> \frac{q_x}{1 - q_x} = A^{(x + B)^C} + D\,\exp\!\left[-E\left(\ln x - \ln F\right)^2\right] + G\,H^x.
> $$
>
> $A$ is close to the death probability at age 1, $B$ shifts infant mortality and $C$ sets how fast childhood risk falls. $D$, $E$ and $F$ are the height, narrowness and peak age of the accident bulge. $G\,H^x$ is a Gompertz curve written in odds. Software implementations often model $q_x$ directly instead of the odds.

### Weon–Je model

Byung Mook Weon and Jung Ho Je extended the Weibull model by letting its shape change with age.[^weon2009] The extension can describe survival curves that become more *rectangular*: almost flat until old age and then dropping steeply, as when most people die within a narrow band of old ages. Rich countries have been moving in that direction (see [below](#rectangularisation-and-the-shifting-mode)). If the shape is allowed to decline at the oldest ages, the model's risk eventually turns down towards zero, which is impossible for a real population. Weon and Je treated that turning point as a maximum human lifespan and estimated it at about 126 years from Swedish women's life tables for 1950 to 2005.[^weon2009] The estimate depends on extending the fitted shape beyond the ages with data, and the limit comes from the chosen formula as much as from the data.

> [!note]- The Weon–Je formula
> $$
> S(x) = \exp\!\left[-\left(\frac{x}{\alpha}\right)^{\beta(x)}\right], \qquad \mu(x) = \left(\frac{x}{\alpha}\right)^{\beta(x)}\left[\frac{\beta(x)}{x} + \beta'(x)\ln\frac{x}{\alpha}\right],
> $$
>
> where $\beta(x)$ is usually a low-order polynomial in age. A constant $\beta$ recovers the Weibull model. If $\beta(x)$ falls fast enough at advanced ages, the bracket reaches zero.

### Comparison

| Model (year) | Shape in words | Parameters | Describes well | Misses |
| --- | --- | :---: | --- | --- |
| Gompertz (1825) | Risk compounds at a constant rate | 2 | Adults, about 30 to 90 | Childhood, the young-adult bulge, any slowing at the oldest ages |
| Gompertz–Makeham (1860) | Gompertz plus a constant floor | 3 | Adults, down to the late teens | Childhood; the bulge only in part |
| Thiele (1871) | Falling childhood term + bump + Gompertz | 7 | The whole life span | Stable estimates, given its many parameters |
| Perks (1932), Beard (1959) | Gompertz that levels off at a ceiling | 3–4 | Slowing at the oldest ages | Childhood and the bulge |
| Weibull (1939, 1951) | Risk grows as a power of age | 2 | Single causes of death, cancer incidence, machine failure | The shape of all-cause human mortality |
| Gamma-Gompertz (1979) | Gompertz individuals of differing frailty | 3 | Slowing explained by the frail dying first | Childhood and the bulge |
| Siler (1979) | Falling childhood term + floor + Gompertz | 5 | Animal populations; human childhood and adulthood | The young-adult bulge |
| Heligman–Pollard (1980) | Childhood + accident bulge + Gompertz | 8 | The whole human life span | Stable parameters; slowing at the oldest ages |
| Kannisto (1990s) | Simplest Gompertz with a ceiling | 2 | Ages 80 and over | Younger ages, by design |
| Weon–Je (2009) | Weibull whose shape changes with age | 4 or more | Increasingly rectangular survival curves | Extending it forces a hard maximum age |

## Why risk compounds with age

That adult death rates rise by a nearly constant percentage each year is a strikingly regular pattern across populations and species. Several theories explain it, and they are not mutually exclusive.

### Strehler–Mildvan theory

Bernard Strehler and Albert Mildvan proposed in 1960 that every organism has a "vitality", its capacity to recover from a shock such as an infection, an injury or a cold night, and that vitality declines steadily with age.[^strehler1960] Shocks arrive at random, small ones often and large ones rarely. Strehler and Mildvan assumed that each step up in size makes a shock rarer by the same factor, say ten times rarer for every extra unit of size. Death comes when a shock exceeds the remaining vitality. If vitality drops by the same amount each year, the threshold for a lethal shock moves one step down the size scale each year, and each step down makes lethal shocks more common by the same factor. Risk therefore compounds at a constant rate, which is the Gompertz law.

The theory predicts that populations with a lower level of mortality should age at a faster pace, a pattern called the **Strehler–Mildvan correlation**, and the pattern is observed. Leonid and Natalia Gavrilov describe it as the *compensation effect of mortality*: death rates of different populations of a species converge at old ages.[^gavrilov2001] Because level and pace trade off in any fit, part of the correlation may be a fitting artefact, as David Juckett and Barnett Rosenberg showed.[^juckett1993]

### Reliability theory

The Gavrilovs modelled organisms as systems built from many redundant parts that do not themselves age, like a machine with spares.[^gavrilov2001] Such a system fails more often as its spares are used up. If every copy starts with the same set of intact spares, as engineered devices do, the failure rate grows as a power of age, following the Weibull law. If copies start with different numbers of defects already present, as bodies built by development do, averaging over these starting states turns the rise exponential, following the Gompertz law. The theory also predicts that the rise must slow and level off once the spares are exhausted, and that the curves of different populations converge with age.[^gavrilov2001]

### Differences in frailty

A population mixes people of different frailty. Even if every individual's risk rose exponentially forever, the frailest would die first, and the survivors at each age would be an increasingly robust group. The death rate of the population would then rise more slowly than any individual's.[^vaupel1979][^beard1959] This explains a slowing of mortality at old ages without any change in how individuals age. It also predicts that the slowing should begin earlier for causes of death that weed out the frail more strongly, and later as overall mortality falls, a pattern seen in Swedish and Japanese data.[^horiuchi1998]

### Evolutionary theory

Evolutionary theory explains why risk rises with age, but not why the rise is exponential. Peter Medawar argued that natural selection weakens with age, because few wild animals live long enough for genes acting late in life to matter.[^medawar1952] [[wd-hamilton|W. D. Hamilton]] made this precise in 1966. Selection on survival at a given age weakens once reproduction begins, because a gene that kills its carrier after much of its reproduction is done has already been passed on.[^hamilton1966] Mutations whose harm appears only late in life are therefore barely opposed and accumulate in a [[selection-shadow-theory|selection shadow]]. Genes that help early and harm late can even be favoured, a mechanism called [[antagonistic-pleiotropy-theory|antagonistic pleiotropy]]. The [[disposable-soma-theory|disposable soma theory]] frames the same trade-off in terms of how an organism divides its resources between reproduction and repair. Hamilton's model predicted that mortality would rise steeply once reproduction ends. Plateaus in laboratory animals and the variety of patterns across species have since forced refinements.[^jones2014]

### Cellular and physiological models

Recent work links the Gompertz law to things that can be measured in tissue. Omer Karin, Uri Alon and colleagues measured how quickly mice clear senescent cells, which stop dividing and secrete inflammatory signals. Young mice remove them within days, old mice over weeks. A model in which death occurs when the senescent-cell burden crosses a threshold reproduces the Gompertz law in mice and humans, as well as the rapid effect of diet changes on mortality in flies.[^karin2019] (See [[cellular-senescence]] and [[sasp]].)

In the nematode *Caenorhabditis elegans*, Nicholas Stroustrup and colleagues recorded the deaths of very large populations with automated scanners. Temperature, diet, oxidative stress and mutations in the insulin/IGF-1 pathway (see [[kenyon-daf-2-experiment]]) all stretched or compressed the survival curve in time without changing its shape. This *temporal scaling* suggests that in the worm, risk of death follows a single physiological process whose speed these interventions change.[^stroustrup2016]

## Late-life deceleration and the plateau debate

![[mortality-late-life-shapes.png|Figure 3. Three models that agree on the data and disagree beyond it. Each curve is fitted to American women aged 60 to 100 in 2023 and extended to 120. Within the data the three are almost indistinguishable. At age 110, Gompertz predicts a hazard of 1.1 per year, Kannisto 0.6 and gamma-Gompertz 0.5 (with its ceiling set at 0.7). The dashed line marks the plateau estimated for Italians aged 105 and over.]]

If the Gompertz law held to the end of life, risk would keep doubling every eight years or so, and survival beyond about 120 would become vanishingly rare. A *mortality plateau* would instead leave a constant, if high, yearly risk of death, and no fixed maximum age.

### Evidence from other species

In 1992 James Carey and colleagues followed about 1.2 million Mediterranean fruit flies and found that death rates slowed and then fell at older ages.[^carey1992] James Curtsinger and colleagues found the same in genetically identical lines of *Drosophila*, which ruled out genetic differences as the only explanation.[^curtsinger1992] Plateaus have since been reported in many laboratory invertebrates.[^vaupel1998]

### Evidence in humans

In the national statistics of many countries, the rise of human mortality appears to slow after about age 80.[^horiuchi1998][^thatcher1998] Two kinds of data suggest that it stops altogether at extreme ages:

- **Validated supercentenarians.** Using the International Database on Longevity, Jutta Gampe found that after age 110 about half of people die each year, at every age, with no difference between the sexes and no trend across birth years.[^gampe2010]
- **Italians aged 105 and over.** Elisabetta Barbi and colleagues analysed all 3,836 Italians aged 105 and over between 2009 and 2015, born between 1896 and 1910, with individually checked ages. Their risk of death was essentially constant beyond 105, again with about half dying each year.[^barbi2018]

Two lines of evidence point the other way:

- **Single-year cohorts.** Using American records of people born in the same year, the Gavrilovs found that mortality follows the Gompertz law up to ages 102 to 105 without noticeable slowing.[^gavrilov2011] They argued that earlier reports of slowing below 100 came from mixing people born in different years, from period data, and from exaggerated ages.
- **Error models.** Saul Newman showed that errors in recorded ages, at rates below 1 in 10,000, are enough to produce apparent slowing and plateaus. Correcting for such errors removed the plateaus in his analysis, and he concluded that human ageing does not slow at old ages. The Italian estimates, by contrast, rest on individually checked ages.[^newman2018][^barbi2018]

The disagreement is hard to settle because the models agree wherever there are plenty of data. Figure 3 shows the problem, with hazards per year as explained [above](#rates-over-a-year-and-rates-at-an-instant). Fitted to American women aged 60 to 100, the Gompertz, Kannisto and gamma-Gompertz curves differ by less than their typical error, yet at 110 they differ by a factor of two. The 2023 American table shows no slowing up to age 100. If anything the rise speeds up: women's risk doubles every 8.0 years between 60 and 80 and every 6.0 years between 80 and 100. Rates at these ages in a national table depend partly on how the agency smooths sparse data, so this is weak evidence either way. Mortality above 105 has to be measured rather than extrapolated, and such measurements rest on a few thousand deaths in which small errors in age matter. As of the mid-2020s, whether humans reach a plateau remains contested. The question bears on whether human lifespan has a fixed limit, which has been argued in the same years from trends in the oldest recorded ages at death.[^dong2016][^lenart2017]

## Mortality across species

The Gompertz law is not universal. Caleb Finch, Malcolm Pike and Matthew Witten compared doubling times across species and found that humans and rhesus monkeys share a doubling time of about eight years, despite very different lifespans.[^finch1990] Owen Jones and colleagues compared mortality and fertility by age for 46 species: 11 mammals, 12 other vertebrates, 10 invertebrates, 12 vascular plants and a green alga.[^jones2014] After maturity, risk rose steeply in some species, stayed constant in others and fell in yet others, among both long- and short-lived species. Among those with falling adult risk is the desert tortoise, which keeps growing after maturity (see [[Indeterminate growth|indeterminate growth]]).

The naked mole-rat (*Heterocephalus glaber*) is the best-documented exception among mammals. In more than 3,000 lifespan records, its risk of death did not rise with age, even at 25 times the age of sexual maturity.[^ruby2018]

## Changes over time and forecasting

The models above describe mortality by age in one year. Forecasting needs a model of how those rates change from year to year.

### Lee–Carter and its extensions

In most rich countries, death rates at every age have fallen for decades, but not equally fast: child mortality fell early and steeply, old-age mortality later and more slowly. Ronald Lee and Lawrence Carter's 1992 model captures this with one hidden dial.[^leecarter1992] Each year, a single index of overall mortality moves. Every age responds to it, but each with its own sensitivity: a large move for ages that have been improving quickly, a small move for those that have not. To forecast, the dial is projected forward as a *random walk with drift*: each year it moves by its average past amount plus random noise, which gives a forecast with a range of uncertainty. The model makes no assumption about the shape of mortality by age. It assumes instead that the relative speed of improvement at each age stays fixed.

Natacha Brouhns and colleagues later fitted the model directly to counts of deaths, which handles ages with few deaths better,[^brouhns2002] and Nan Li and Lee extended it to forecast related populations, such as the two sexes or neighbouring countries, without letting their forecasts drift implausibly apart.[^lilee2005] The Renshaw–Haberman model adds a term for each year of birth, to capture generations whose mortality stays higher or lower than their neighbours' throughout life.[^renshaw2006] The Cairns–Blake–Dowd model, designed for pension funds, describes old-age mortality as a straight line in age whose height and slope both drift over time.[^cbd2006] Flexible smoothing curves (P-splines), introduced to mortality by Iain Currie, María Durbán and Paul Eilers, fit and extend death rates by age and year without any formula for the shape.[^currie2004]

> [!note]- The Lee–Carter and Cairns–Blake–Dowd formulas
> Lee–Carter writes the log central death rate at age $x$ in year $t$ as
>
> $$
> \ln m_{x,t} = a_x + b_x k_t + \varepsilon_{x,t},
> $$
>
> where $a_x$ is the average age pattern, $k_t$ the index (the dial), $b_x$ each age's sensitivity to it, and $\varepsilon_{x,t}$ noise. Multiplying every $b_x$ by 2 and halving every $k_t$ gives the same fit, so constraints such as $\sum_x b_x = 1$ and $\sum_t k_t = 0$ make the parameters unique. Lee and Carter estimated them with a singular value decomposition; Brouhns and colleagues with Poisson maximum likelihood.[^brouhns2002]
>
> Cairns–Blake–Dowd models the log-odds of death:
>
> $$
> \ln\frac{q_{x,t}}{1 - q_{x,t}} = \kappa_t^{(1)} + \kappa_t^{(2)}\,(x - \bar{x}),
> $$
>
> where $\kappa_t^{(1)}$ and $\kappa_t^{(2)}$ are the line's height and slope in year $t$, each projected as a random walk, and $\bar{x}$ is the mean age in the data.[^cbd2006]

### Relational models

Many countries lack complete death registration. Relational models build a full life table for them from a few numbers, by describing their mortality as a stretched and shifted version of a standard table. In William Brass's system, two parameters do this: one moves the whole schedule up or down, the other makes it steeper or flatter.[^brass1971] Families of *model life tables*, such as Ansley Coale and Paul Demeny's regional tables, serve the same purpose by listing typical schedules for each level of mortality.[^coale1966]

> [!note]- The Brass logit formula
> With $l_x$ the fraction surviving to age $x$, define $Y_x = \tfrac{1}{2}\ln\big[(1 - l_x)/l_x\big]$. The population's $Y_x$ is a straight-line function of the standard table's $Y_x^{(s)}$:
>
> $$
> Y_x = \alpha + \beta\,Y_x^{(s)}.
> $$

### Rectangularisation and the shifting mode

Over the twentieth century, mortality fell first in infancy and childhood and, since about 1970 in industrialised countries, mainly at older ages. Survival curves became more **rectangular**: flatter for longer and then steeper at the end, as more people survive to old age and deaths crowd into a narrower band of ages. Average and maximum lifespans rose steadily.[^wilmoth2000] In Gompertz terms the level fell while the pace stayed roughly the same (see [Two numbers: level and pace](#two-numbers-level-and-pace)), so the modal age at death rose.[^vaupel2010][^missov2015]

## Fitting models to data

### Data and likelihood

Models are fitted to two counts for each age: the number of deaths, and the **exposure**, the total time people spent alive at that age, in person-years. A town in which 1,000 people live through their 80th year contributes 1,000 person-years at age 80; if 40 of them die, the observed death rate is about 4% per year. The modern standard is **maximum likelihood**: choose the parameters that make the observed death counts most probable, treating each person-year as an independent small chance of death. This weights each age by how much data it has, which matters because rates at the oldest ages rest on few people. The Human Mortality Database fits the Kannisto model this way above age 80.[^hmd2025]

An older and still common shortcut is to fit a straight line to the logarithms of observed rates. It is simple, but it copes badly with ages at which nobody died and gives noisy old-age rates as much weight as precise middle-age ones. (Figures 2 and 3 use this shortcut, because a published life table gives rates, not death counts and exposures.)

For laboratory animals, Scott Pletcher's WinModest software fits the Gompertz, Gompertz–Makeham, logistic and logistic–Makeham models. Each adds one parameter to the one before, so a standard statistical test can ask whether the extra parameter improves the fit by more than chance would.[^pletcher1999] For wild animals, whose ages at death are usually known only from incomplete recapture records, the BaSTA package fits Gompertz, Weibull, logistic and Siler models by Bayesian inference.[^colchero2012] Tiffany Tai and Andrew Noymer compared methods of estimating the Gompertz pace from real data.[^tai2018]

> [!note]- The Poisson likelihood
> With $D_x$ deaths and $E_x$ person-years at age $x$, deaths are approximately Poisson-distributed with mean $E_x\,\mu(x + \tfrac{1}{2})$, and the log-likelihood to maximise is
>
> $$
> \ln L = \sum_x \big[D_x \ln \mu(x + \tfrac{1}{2}) - E_x\,\mu(x + \tfrac{1}{2})\big] + \text{const}.
> $$

### Practical difficulties

- **Level and pace trade off.** As described under the [Gompertz law](#gompertz-law), the two estimates are strongly linked. An apparent difference in the pace of ageing between two small cohorts can be a difference in level, or noise, and needs a formal test.[^pletcher1999]
- **Sample size.** Telling a Gompertz from a Weibull or logistic curve, or detecting a plateau, takes very large cohorts or very long follow-up. The study that established plateaus in insects used more than a million flies.[^carey1992]
- **Errors in age.** At the oldest ages, a handful of exaggerated ages can dominate the estimates. Checked data are essential, and even checked data may contain errors.[^newman2018][^gavrilov2011]
- **Period versus cohort.** Period tables mix generations with different histories, so old-age patterns in them can reflect who is in the mix rather than how people age.[^gavrilov2011]
- **Choosing a model.** Statistical criteria, such as Akaike's information criterion, reward a good fit and penalise extra parameters. With the amount of data typical of animal studies, several models often fit equally well, and the choice should then rest on what the parameters are meant to measure.[^ricklefs2002]

## Applications

- **Actuarial science.** Laws of mortality were invented to price annuities. They remain central to smoothing insurance and pension tables, extending tables to the oldest ages, and pricing the risk that people outlive their pensions. Lee–Carter and Cairns–Blake–Dowd models are used to forecast pension liabilities.[^cbd2006]
- **Demography.** National statistical agencies and the Human Mortality Database use these laws to smooth unreliable death rates at advanced ages.[^hmd2025] Relational and forecasting models estimate mortality where registration is incomplete and project populations.[^brass1971][^leecarter1992]
- **Biogerontology.** Mortality models show *how* an intervention extends life: by lowering the level of risk, as dietary restriction does in flies,[^mair2003] or by stretching the whole curve in time, as many interventions do in worms.[^stroustrup2016] Answering that question requires a cohort large enough to separate level from pace.[^pletcher1999] (See [[hallmarks-of-aging]] and [[History of biogerontology]].)
- **Evolutionary and comparative biology.** Standardised mortality curves let researchers compare ageing across species and test evolutionary theories of senescence.[^jones2014][^colchero2012]
- **Epidemiology.** Disease incidence by age is often modelled with the same formulas. The power-law rise of cancer incidence is the classic case.[^juckett1993]

## History

### Life tables before laws

John Graunt's *Natural and Political Observations … upon the Bills of Mortality* (1662) tabulated London's weekly burial records and estimated, roughly, how many of every hundred births survived to each decade of life.[^graunt1662] Edmond Halley's 1693 table for the city of Breslau, built from births and funerals in a population with little migration, was the first life table accurate enough to price an annuity.[^halley1693] Neither proposed a formula.

The first law of mortality was Abraham de Moivre's, in *Annuities upon Lives* (1725). To make annuity arithmetic manageable by hand, he assumed that the number of survivors falls in a straight line to zero at a maximum age of 86.[^demoivre1725] It was a convenience, not a description: it implies a risk of death that rises only fourfold between birth and 64 and then shoots up as the maximum age approaches.

### Gompertz and Makeham

![[benjamin-gompertz-portrait.png|Benjamin Gompertz, the actuary who proposed the exponential law of mortality. Public domain, via Wikimedia Commons.|260]]

Benjamin Gompertz (1779–1865) was a largely self-taught mathematician and a London actuary. In a paper read to the Royal Society in 1825, he proposed that a person's "power to oppose destruction" wears away so that, in equal small intervals of time, a person "lost equal portions of his remaining power to oppose destruction."[^gompertz1825] If the risk of death is inversely proportional to that power, it rises by a constant percentage each year. Gompertz checked the idea against several life tables of his day and found that, over long stretches of adult life, it held. He also recognised that death has two co-existing causes, chance and "an increased inability to withstand destruction," and that his formula described only the second.[^kirkwood2015] Makeham supplied the first in 1860 with his constant term, and the Gompertz–Makeham law dominated the smoothing of actuarial tables for the next century.[^makeham1860]

### Formulas for the whole of life

Thiele published the first formula for the whole of life in 1871.[^thiele1871] Perks introduced logistic formulas in 1932,[^perks1932] and in 1959 Beard showed that they follow from Gompertz individuals who differ in frailty.[^beard1959] Waloddi Weibull, a Swedish engineer studying the strength and fatigue of materials, published his distribution in 1939 and popularised it in English in 1951.[^weibull1939][^weibull1951] It became the standard model of failure in engineering before biologists applied it to organisms.[^ricklefs2002]

In 1960 Strehler and Mildvan proposed the first mechanistic theory of the Gompertz law.[^strehler1960] In 1979 James Vaupel, Kenneth Manton and Eric Stallard formalised frailty as an individual multiplier of risk and showed how it bends the population curve;[^vaupel1979] the same year Siler proposed his model for animal populations,[^siler1979] and in 1980 Heligman and Pollard published their eight-parameter model of the human life span.[^heligman1980]

### Forecasting and the plateau debate

Lee and Carter's 1992 model shifted attention from the shape of mortality by age to its trend over calendar time.[^leecarter1992] In the same year, two studies of very large insect cohorts in the same issue of *Science* reported that death rates stop rising at advanced ages, contrary to the Gompertz law.[^carey1992][^curtsinger1992] Väinö Kannisto, Roger Thatcher and Vaupel then showed that human mortality above 80 is better described by a logistic curve than by a pure exponential.[^thatcher1998] Whether human mortality reaches a true plateau has been argued since, with large studies on both sides.[^barbi2018][^newman2018][^gavrilov2011]

## Data and figures

Figures 1 to 3 and the tables in this article were made for it from the Social Security Administration's [Period Life Table, 2023](https://www.ssa.gov/oact/STATS/table4c6.html), as used in the 2026 Trustees Report. Hazards were computed from the table's death probabilities as $\mu = -\ln(1 - q_x)$ and placed at mid-year. The fitted curves minimise squared error in the logarithm of the hazard. The "typical miss" in Figure 2 is the root-mean-square error on the logarithmic scale, converted to a percentage. The portrait of Gompertz is in the public domain ([Wikimedia Commons](https://commons.wikimedia.org/wiki/File:Gompertz.png)).

[^gompertz1825]: Gompertz B (1825). "On the nature of the function expressive of the law of human mortality, and on a new mode of determining the value of life contingencies". *Philosophical Transactions of the Royal Society of London*. 115: 513–583. [doi:10.1098/rstl.1825.0026](https://doi.org/10.1098/rstl.1825.0026)

[^makeham1860]: Makeham WM (1860). "On the law of mortality and the construction of annuity tables". *The Assurance Magazine, and Journal of the Institute of Actuaries*. 8 (6): 301–310. [doi:10.1017/S204616580000126X](https://doi.org/10.1017/S204616580000126X)

[^thiele1871]: Thiele TN (1871). "On a mathematical formula to express the rate of mortality throughout the whole of life, tested by a series of observations made use of by the Danish Life Insurance Company of 1871". *Journal of the Institute of Actuaries and Assurance Magazine*. 16 (5): 313–329. [doi:10.1017/S2046167400043688](https://doi.org/10.1017/S2046167400043688)

[^perks1932]: Perks W (1932). "On some experiments in the graduation of mortality statistics". *Journal of the Institute of Actuaries*. 63 (1): 12–57. [doi:10.1017/S0020268100046680](https://doi.org/10.1017/S0020268100046680)

[^beard1959]: Beard RE (1959). "Note on some mathematical mortality models". In Wolstenholme GEW, O'Connor M (eds.), *The Lifespan of Animals*. CIBA Foundation Colloquia on Ageing, vol. 5. pp. 302–311. [doi:10.1002/9780470715253.app1](https://doi.org/10.1002/9780470715253.app1)

[^weibull1939]: Weibull W (1939). "A statistical theory of the strength of materials". *Ingeniörsvetenskapsakademiens Handlingar*. 151. Stockholm.

[^weibull1951]: Weibull W (1951). "A statistical distribution function of wide applicability". *Journal of Applied Mechanics*. 18 (3): 293–297. [doi:10.1115/1.4010337](https://doi.org/10.1115/1.4010337)

[^strehler1960]: Strehler BL, Mildvan AS (1960). "General theory of mortality and aging". *Science*. 132 (3418): 14–21. [doi:10.1126/science.132.3418.14](https://doi.org/10.1126/science.132.3418.14)

[^siler1979]: Siler W (1979). "A competing-risk model for animal mortality". *Ecology*. 60 (4): 750–757. [doi:10.2307/1936612](https://doi.org/10.2307/1936612)

[^heligman1980]: Heligman L, Pollard JH (1980). "The age pattern of mortality". *Journal of the Institute of Actuaries*. 107 (1): 49–80. [doi:10.1017/S0020268100040257](https://doi.org/10.1017/S0020268100040257)

[^vaupel1979]: Vaupel JW, Manton KG, Stallard E (1979). "The impact of heterogeneity in individual frailty on the dynamics of mortality". *Demography*. 16 (3): 439–454. [doi:10.2307/2061224](https://doi.org/10.2307/2061224)

[^leecarter1992]: Lee RD, Carter LR (1992). "Modeling and forecasting U.S. mortality". *Journal of the American Statistical Association*. 87 (419): 659–671. [doi:10.1080/01621459.1992.10475265](https://doi.org/10.1080/01621459.1992.10475265)

[^carey1992]: Carey JR, Liedo P, Orozco D, Vaupel JW (1992). "Slowing of mortality rates at older ages in large medfly cohorts". *Science*. 258 (5081): 457–461. [doi:10.1126/science.1411540](https://doi.org/10.1126/science.1411540)

[^curtsinger1992]: Curtsinger JW, Fukui HH, Townsend DR, Vaupel JW (1992). "Demography of genotypes: failure of the limited life-span paradigm in *Drosophila melanogaster*". *Science*. 258 (5081): 461–463. [doi:10.1126/science.1411541](https://doi.org/10.1126/science.1411541)

[^thatcher1998]: Thatcher AR, Kannisto V, Vaupel JW (1998). *The Force of Mortality at Ages 80 to 120*. Odense Monographs on Population Aging 5. Odense University Press. ISBN 87-7838-381-1. [Full text](https://www.demogr.mpg.de/books/odense/5/)

[^horiuchi1998]: Horiuchi S, Wilmoth JR (1998). "Deceleration in the age pattern of mortality at older ages". *Demography*. 35 (4): 391–412. [doi:10.2307/3004009](https://doi.org/10.2307/3004009)

[^vaupel1998]: Vaupel JW, Carey JR, Christensen K, Johnson TE, Yashin AI, et al. (1998). "Biodemographic trajectories of longevity". *Science*. 280 (5365): 855–860. [doi:10.1126/science.280.5365.855](https://doi.org/10.1126/science.280.5365.855)

[^finch1990]: Finch CE, Pike MC, Witten M (1990). "Slow mortality rate accelerations during aging in some animals approximate that of humans". *Science*. 249 (4971): 902–905. [doi:10.1126/science.2392680](https://doi.org/10.1126/science.2392680)

[^juckett1993]: Juckett DA, Rosenberg B (1993). "Comparison of the Gompertz and Weibull functions as descriptors for human mortality distributions and their intersections". *Mechanisms of Ageing and Development*. 69 (1–2): 1–31. [doi:10.1016/0047-6374(93)90068-3](https://doi.org/10.1016/0047-6374(93)90068-3)

[^pletcher1999]: Pletcher SD (1999). "Model fitting and hypothesis testing for age-specific mortality data". *Journal of Evolutionary Biology*. 12 (3): 430–439. [doi:10.1046/j.1420-9101.1999.00058.x](https://doi.org/10.1046/j.1420-9101.1999.00058.x)

[^wilmoth2000]: Wilmoth JR (2000). "Demography of longevity: past, present, and future trends". *Experimental Gerontology*. 35 (9–10): 1111–1129. [doi:10.1016/S0531-5565(00)00194-7](https://doi.org/10.1016/S0531-5565(00)00194-7)

[^gavrilov2001]: Gavrilov LA, Gavrilova NS (2001). "The reliability theory of aging and longevity". *Journal of Theoretical Biology*. 213 (4): 527–545. [doi:10.1006/jtbi.2001.2430](https://doi.org/10.1006/jtbi.2001.2430)

[^ricklefs2002]: Ricklefs RE, Scheuerlein A (2002). "Biological implications of the Weibull and Gompertz models of aging". *The Journals of Gerontology Series A*. 57 (2): B69–B76. [doi:10.1093/gerona/57.2.B69](https://doi.org/10.1093/gerona/57.2.B69)

[^mair2003]: Mair W, Goymer P, Pletcher SD, Partridge L (2003). "Demography of dietary restriction and death in *Drosophila*". *Science*. 301 (5640): 1731–1733. [doi:10.1126/science.1086016](https://doi.org/10.1126/science.1086016)

[^brouhns2002]: Brouhns N, Denuit M, Vermunt JK (2002). "A Poisson log-bilinear regression approach to the construction of projected lifetables". *Insurance: Mathematics and Economics*. 31 (3): 373–393. [doi:10.1016/S0167-6687(02)00185-3](https://doi.org/10.1016/S0167-6687(02)00185-3)

[^currie2004]: Currie ID, Durban M, Eilers PHC (2004). "Smoothing and forecasting mortality rates". *Statistical Modelling*. 4 (4): 279–298. [doi:10.1191/1471082X04st080oa](https://doi.org/10.1191/1471082X04st080oa)

[^renshaw2006]: Renshaw AE, Haberman S (2006). "A cohort-based extension to the Lee–Carter model for mortality reduction factors". *Insurance: Mathematics and Economics*. 38 (3): 556–570. [doi:10.1016/j.insmatheco.2005.12.001](https://doi.org/10.1016/j.insmatheco.2005.12.001)

[^cbd2006]: Cairns AJG, Blake D, Dowd K (2006). "A two-factor model for stochastic mortality with parameter uncertainty: theory and calibration". *Journal of Risk and Insurance*. 73 (4): 687–718. [doi:10.1111/j.1539-6975.2006.00195.x](https://doi.org/10.1111/j.1539-6975.2006.00195.x)

[^lilee2005]: Li N, Lee R (2005). "Coherent mortality forecasts for a group of populations: an extension of the Lee–Carter method". *Demography*. 42 (3): 575–594. [doi:10.1353/dem.2005.0021](https://doi.org/10.1353/dem.2005.0021)

[^weon2009]: Weon BM, Je JH (2009). "Theoretical estimation of maximum human lifespan". *Biogerontology*. 10 (1): 65–71. [doi:10.1007/s10522-008-9156-4](https://doi.org/10.1007/s10522-008-9156-4)

[^vaupel2010]: Vaupel JW (2010). "Biodemography of human ageing". *Nature*. 464 (7288): 536–542. [doi:10.1038/nature08984](https://doi.org/10.1038/nature08984)

[^gampe2010]: Gampe J (2010). "Human mortality beyond age 110". In Maier H, Gampe J, Jeune B, Robine J-M, Vaupel JW (eds.), *Supercentenarians*. Demographic Research Monographs 7. Springer. pp. 219–230. [doi:10.1007/978-3-642-11520-2_13](https://doi.org/10.1007/978-3-642-11520-2_13)

[^gavrilov2011]: Gavrilov LA, Gavrilova NS (2011). "Mortality measurement at advanced ages: a study of the Social Security Administration Death Master File". *North American Actuarial Journal*. 15 (3): 432–447. [doi:10.1080/10920277.2011.10597629](https://doi.org/10.1080/10920277.2011.10597629)

[^colchero2012]: Colchero F, Jones OR, Rebke M (2012). "BaSTA: an R package for Bayesian estimation of age-specific survival from incomplete mark–recapture/recovery data with covariates". *Methods in Ecology and Evolution*. 3 (3): 466–470. [doi:10.1111/j.2041-210X.2012.00186.x](https://doi.org/10.1111/j.2041-210X.2012.00186.x)

[^jones2014]: Jones OR, Scheuerlein A, Salguero-Gómez R, Camarda CG, Schaible R, et al. (2014). "Diversity of ageing across the tree of life". *Nature*. 505 (7482): 169–173. [doi:10.1038/nature12789](https://doi.org/10.1038/nature12789)

[^kirkwood2015]: Kirkwood TBL (2015). "Deciphering death: a commentary on Gompertz (1825) 'On the nature of the function expressive of the law of human mortality, and on a new mode of determining the value of life contingencies'". *Philosophical Transactions of the Royal Society B*. 370 (1666): 20140379. [doi:10.1098/rstb.2014.0379](https://doi.org/10.1098/rstb.2014.0379)

[^missov2015]: Missov TI, Lenart A, Nemeth L, Canudas-Romo V, Vaupel JW (2015). "The Gompertz force of mortality in terms of the modal age at death". *Demographic Research*. 32 (36): 1031–1048. [doi:10.4054/DemRes.2015.32.36](https://doi.org/10.4054/DemRes.2015.32.36)

[^stroustrup2016]: Stroustrup N, Anthony WE, Nash ZM, Gowda V, Gomez A, et al. (2016). "The temporal scaling of *Caenorhabditis elegans* ageing". *Nature*. 530 (7588): 103–107. [doi:10.1038/nature16550](https://doi.org/10.1038/nature16550)

[^dong2016]: Dong X, Milholland B, Vijg J (2016). "Evidence for a limit to human lifespan". *Nature*. 538 (7624): 257–259. [doi:10.1038/nature19793](https://doi.org/10.1038/nature19793)

[^lenart2017]: Lenart A, Vaupel JW (2017). "Questionable evidence for a limit to human lifespan". *Nature*. 546 (7660): E13–E14. [doi:10.1038/nature22790](https://doi.org/10.1038/nature22790)

[^barbi2018]: Barbi E, Lagona F, Marsili M, Vaupel JW, Wachter KW (2018). "The plateau of human mortality: Demography of longevity pioneers". *Science*. 360 (6396): 1459–1461. [doi:10.1126/science.aat3119](https://doi.org/10.1126/science.aat3119)

[^newman2018]: Newman SJ (2018). "Errors as a primary cause of late-life mortality deceleration and plateaus". *PLOS Biology*. 16 (12): e2006776. [doi:10.1371/journal.pbio.2006776](https://doi.org/10.1371/journal.pbio.2006776)

[^ruby2018]: Ruby JG, Smith M, Buffenstein R (2018). "Naked mole-rat mortality rates defy Gompertzian laws by not increasing with age". *eLife*. 7: e31157. [doi:10.7554/eLife.31157](https://doi.org/10.7554/eLife.31157)

[^tai2018]: Tai TH, Noymer A (2018). "Models for estimating empirical Gompertz mortality: with an application to evolution of the Gompertzian slope". *Population Ecology*. 60 (1–2): 171–184. [doi:10.1007/s10144-018-0609-6](https://doi.org/10.1007/s10144-018-0609-6)

[^karin2019]: Karin O, Agrawal A, Porat Z, Krizhanovsky V, Alon U (2019). "Senescent cell turnover slows with age providing an explanation for the Gompertz law". *Nature Communications*. 10: 5495. [doi:10.1038/s41467-019-13192-4](https://doi.org/10.1038/s41467-019-13192-4)

[^hmd2025]: Wilmoth JR, Andreev K, Jdanov D, Glei DA, Riffe T, et al. (2025). *Methods Protocol for the Human Mortality Database*, version 6. [PDF](https://www.mortality.org/File/GetDocument/Public/Docs/MethodsProtocolV6.pdf)

[^hamilton1966]: Hamilton WD (1966). "The moulding of senescence by natural selection". *Journal of Theoretical Biology*. 12 (1): 12–45. [doi:10.1016/0022-5193(66)90184-6](https://doi.org/10.1016/0022-5193(66)90184-6)

[^medawar1952]: Medawar PB (1952). *An Unsolved Problem of Biology*. London: H. K. Lewis.

[^brass1971]: Brass W (1971). "On the scale of mortality". In Brass W (ed.), *Biological Aspects of Demography*. London: Taylor & Francis. pp. 69–110.

[^coale1966]: Coale AJ, Demeny P (1966). *Regional Model Life Tables and Stable Populations*. Princeton: Princeton University Press.

[^graunt1662]: Graunt J (1662). *Natural and Political Observations Mentioned in a Following Index, and Made upon the Bills of Mortality*. London. [Digitised copy](https://wellcomecollection.org/works/ear22f7e)

[^halley1693]: Halley E (1693). "An estimate of the degrees of the mortality of mankind, drawn from curious tables of the births and funerals at the city of Breslaw; with an attempt to ascertain the price of annuities upon lives". *Philosophical Transactions*. 17 (196): 596–610. [doi:10.1098/rstl.1693.0007](https://doi.org/10.1098/rstl.1693.0007)

[^demoivre1725]: de Moivre A (1725). *Annuities upon Lives*. London. [Digitised copy](https://wellcomecollection.org/works/cgeczbp6)
