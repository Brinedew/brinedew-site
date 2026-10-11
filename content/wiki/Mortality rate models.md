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

**Mortality rate models**, also called **laws of mortality**, are mathematical functions that describe how the risk of death changes with age. Most of them specify the *force of mortality*, or hazard, $\mu(x)$: the instantaneous rate at which members of a population who have survived to age $x$ die. Everything else in a life table, from the probability of surviving to a given birthday to life expectancy, follows from that one curve. The models are used to price annuities and life insurance, to smooth and extend life tables, to forecast population ageing, to compare the pace of ageing across species, and to test what an intervention against ageing actually changes.

The founding observation is the **Gompertz law**, published by the actuary Benjamin Gompertz in 1825: across adulthood, the death rate rises exponentially with age.[^gompertz1825] In people the rate doubles roughly every eight years,[^finch1990] so the annual risk of death grows two- to two-and-a-half-fold with each decade of adult life. Later work added terms for what the exponential misses. William Makeham added a constant, age-independent risk in 1860.[^makeham1860] Multi-component models add a separate term for each stage of life. Human mortality has a "bathtub" shape: high risk in infancy, a minimum around age ten, a hump in early adulthood, and the senescent rise. William Siler's 1979 model captures the infant decline and the senescent rise, and the models of Thorvald Thiele (1871) and of Larry Heligman and John Pollard (1980) also capture the hump.[^thiele1871][^siler1979][^heligman1980] Power-law (Weibull) and logistic models offer different shapes with different biological readings.[^weibull1951][^perks1932] The models are fitted to counts of deaths and person-years by maximum likelihood, and a model that fits well inside the data can still extrapolate badly outside it.

Two questions run through the field. The first is whether the exponential rise continues to the end of life or slows into a *mortality plateau* at extreme ages. Plateaus are well documented in large laboratory cohorts of insects,[^carey1992][^curtsinger1992] but in humans the evidence is contested, because a small rate of age-misreporting can manufacture a plateau.[^barbi2018][^newman2018][^gavrilov2011] The second is why mortality takes this shape at all. Explanations range from the declining force of natural selection with age,[^hamilton1966] through the reliability of redundant systems,[^gavrilov2001] to the selective survival of robust individuals in heterogeneous populations.[^vaupel1979] Mortality patterns also differ widely between species: some animals and plants show no increase in mortality with age, or a decrease.[^jones2014] Since Ronald Lee and Lawrence Carter's 1992 model, a second family of *stochastic* models has described how mortality at each age changes over calendar time; these are the standard tools of mortality forecasting.[^leecarter1992]

![[mortality-us-2023-gompertz.png|Figure 1. Annual death rates by age in the United States, 2023 (Social Security Administration period life table). The vertical axis is logarithmic, so an exponential rise appears as a straight line. Dashed lines are Gompertz curves fitted to ages 35 to 85; fitted death rates double every 9.5 years for men and 8.5 years for women. The Gompertz line misses infancy, childhood and the young-adult hump.]]

## Terminology and notation

Let $T$ be the age at death of a newborn, treated as a random variable. Three equivalent functions describe its distribution: the survival function $S(x) = \Pr(T > x)$, which demographers write as $l_x / l_0$; the probability density of age at death, $f(x)$; and the hazard, which actuaries call the *force of mortality*:

$$
\mu(x) = \lim_{\Delta x \to 0} \frac{\Pr(x < T \le x + \Delta x \mid T > x)}{\Delta x} = \frac{f(x)}{S(x)} = -\frac{\mathrm{d}}{\mathrm{d}x} \ln S(x).
$$

Integrating the last identity gives survival from the hazard,

$$
S(x) = \exp\!\left(-\int_0^x \mu(t)\,\mathrm{d}t\right),
$$

and life expectancy at birth is the area under the survival curve, $e_0 = \int_0^\infty S(x)\,\mathrm{d}x$. A model for $\mu(x)$ is therefore a model for the entire life table.

Published tables usually report one of two discrete quantities rather than $\mu(x)$ itself. The **death probability**, written $q_x$, is the chance that someone alive at exact age $x$ dies before age $x + 1$:

$$
q_x = 1 - \frac{S(x+1)}{S(x)} = 1 - \exp\!\left(-\int_x^{x+1} \mu(t)\,\mathrm{d}t\right).
$$

The **central death rate**, written $m_x$, is the number of deaths at age $x$ divided by the person-years lived at that age. If the hazard is constant within each year of age, $m_x = \mu$ and $q_x = 1 - e^{-m_x}$. At low mortality the three quantities are nearly equal; they diverge at the oldest ages, where $q_x$ can never exceed 1 but $\mu(x)$ can.

Mortality is almost always plotted on a logarithmic scale. On that scale an exponential hazard is a straight line, and its slope $b$ sets the **mortality rate doubling time** (MRDT), $\ln 2 / b$. The MRDT is the most widely quoted single number for the pace of demographic ageing.[^finch1990]

A model may describe a *period* (the death rates observed in one calendar year, applied to a hypothetical cohort) or a *cohort* (people born in the same year, followed until all have died). The two can differ substantially when mortality is falling, and mixing cohorts is one of the main sources of artefacts at old ages.[^gavrilov2011]

## History

### Life tables before laws

John Graunt's *Natural and Political Observations … upon the Bills of Mortality* (1662) tabulated London's weekly burial records and estimated, crudely, how many of every hundred births survived to each decade of life.[^graunt1662] Edmond Halley's 1693 table for the city of Breslau, built from births and funerals in a population with little migration, was the first life table accurate enough to price an annuity.[^halley1693] Neither proposed a formula.

The first law of mortality was Abraham de Moivre's, in *Annuities upon Lives* (1725). To make annuity arithmetic tractable, he assumed that the number of survivors falls in a straight line to zero at a maximum age of 86.[^demoivre1725] In modern notation $l_x \propto \omega - x$, and the hazard is $\mu(x) = 1/(\omega - x)$. The assumption was a computational convenience, not a description: it implies a hazard that rises only fourfold between birth and age 64 and then increases without limit as the maximum age approaches.

### Gompertz and Makeham

![[benjamin-gompertz-portrait.png|Benjamin Gompertz, the actuary who proposed the exponential law of mortality. Public domain, via Wikimedia Commons.|260]]

Benjamin Gompertz (1779–1865) was a largely self-taught mathematician and a London actuary. In a paper read to the Royal Society in 1825, he proposed that a person's "power to oppose destruction" wears away so that, in equal small intervals of time, a person "lost equal portions of his remaining power to oppose destruction."[^gompertz1825] If death rates are inversely proportional to that power, they rise in geometric progression with age. Gompertz tested the idea against several life tables of his day and found that, over long stretches of adult life, the logarithms of the death rates did increase in nearly equal steps.[^gompertz1825] He also recognised that death has two co-existing causes, chance and "an increased inability to withstand destruction," and that his formula described only the second.[^kirkwood2015]

William Makeham supplied the first in 1860 by adding a constant term to the hazard, representing causes of death that do not depend on age.[^makeham1860] The resulting Gompertz–Makeham law dominated the graduation (smoothing) of actuarial tables for the next century.

### Whole-life and logistic formulae

The Danish astronomer and actuary Thorvald Thiele published the first formula for the whole of life in 1871. It sums three terms: a declining exponential for childhood, a bell-shaped bump for early adulthood, and a Gompertz exponential for old age.[^thiele1871] Wilfred Perks introduced logistic formulae in 1932, in which the exponential rise flattens at the oldest ages.[^perks1932] In 1959 Robert Beard showed how such flattening could arise. Suppose individuals differ in *frailty*, a fixed multiplier of their personal risk of death, and each individual's Gompertz hazard is scaled by it. The frailest die first, and if frailty follows a gamma distribution the hazard of the surviving population takes a logistic form.[^beard1959]

### Reliability, frailty and multi-component models

Waloddi Weibull, a Swedish engineer studying the strength and fatigue of materials, published the distribution that bears his name in 1939 and popularised it in English in 1951.[^weibull1939][^weibull1951] Its hazard is a power of age rather than an exponential, and it became the standard model of failure in reliability engineering before biologists applied it to organisms.[^ricklefs2002]

In 1960 Bernard Strehler and Albert Mildvan proposed the first mechanistic theory of the Gompertz law (described [below](#strehlermildvan-theory)).[^strehler1960] In 1979 James Vaupel, Kenneth Manton and Eric Stallard formalised frailty as a random multiplier of each individual's hazard and showed how it bends the population curve.[^vaupel1979] In the same year the ecologist William Siler proposed a five-parameter competing-risk model for animal populations,[^siler1979] and in 1980 Heligman and Pollard published an eight-parameter model that captured the young-adult hump in human data.[^heligman1980]

### Forecasting and the plateau debate

Ronald Lee and Lawrence Carter's 1992 model shifted attention from the age pattern of mortality to its trend over calendar time.[^leecarter1992] In the same issue of *Science* that year, two studies of very large insect cohorts reported that death rates stop rising at advanced ages, contrary to the Gompertz law:[^carey1992][^curtsinger1992] James Carey and colleagues followed 1.2 million Mediterranean fruit flies, and James Curtsinger and colleagues followed *Drosophila*. Väinö Kannisto, Roger Thatcher and Vaupel then showed that human mortality above age 80 is better described by a logistic curve than by an exponential.[^thatcher1998] The question of whether human mortality reaches a true plateau has been argued since, with large studies on both sides.[^barbi2018][^newman2018][^gavrilov2011]

## The age pattern of human mortality

Human mortality follows the same broad shape in every well-recorded population. Figure 1 shows it for the United States in 2023:

1. **Infancy and childhood.** Risk is highest in the first year of life (a death probability of 6.0 per 1,000 for boys and 5.1 for girls in 2023) and falls steeply to a minimum around ages 8 to 10, when it is about 1 in 10,000 per year.
2. **The young-adult hump.** From puberty, death rates rise faster than the senescent trend predicts, mostly from external causes such as accidents and violence. The hump is much larger in men. At age 22, a man's death probability in 2023 was 1.4 per 1,000, about 11 times his childhood minimum and 2.7 times that of a woman of the same age.
3. **Senescence.** From about age 30, the rise becomes close to exponential. Fitted over ages 35 to 85, the 2023 rates double every 9.5 years for men and every 8.5 years for women. By age 100 the annual death probability is about 37% for men and 33% for women.

These three components correspond to three biological regimes: the fragility of a developing organism, the risks of behaviour in young adulthood, and the accumulating damage of ageing. Every model discussed below can be read as a choice about which of these components to represent and how.

## Models of the age pattern

The models below describe mortality by age within a single population and time. They are ordered roughly by date and grouped by the shape they produce. Figure 2 compares five of them on the same data.

![[mortality-model-fits-us-men-2023.png|Figure 2. The same data fitted with five laws: annual death rates of American men in 2023, on a log scale. (A) One-process laws fitted to adult ages and extrapolated (dashed) to younger ages. (B) Multi-component laws fitted to all ages. Over each model's own fitting range, the fitted rate misses the observed one on a typical age by about 26% for Gompertz, 20% for Gompertz–Makeham, 61% for Weibull, 42% for Siler and 11% for Heligman–Pollard. Panels A and B use different age ranges, so their errors are not directly comparable.]]

### De Moivre's law

$$
\mu(x) = \frac{1}{\omega - x}, \qquad 0 \le x < \omega.
$$

De Moivre's linear survival curve has a single parameter, the maximum age $\omega$. It is now used mainly in textbook exercises, because it implies a slowly rising adult hazard followed by certain death at a fixed age.[^demoivre1725]

### Gompertz law

$$
\mu(x) = a\,e^{bx}, \qquad S(x) = \exp\!\left[-\frac{a}{b}\left(e^{bx} - 1\right)\right].
$$

The parameter $a$ (often written $\alpha$, $\mu_0$ or $R_0$) is the extrapolated hazard at age zero and sets the overall level of mortality. The parameter $b$ (often $\beta$ or $\gamma$) is the exponential rate of increase and sets the pace of ageing. In humans $b$ is close to 0.08 per year, which gives a doubling time of about eight years.[^finch1990] The fits in Figure 1 give $b = 0.073$ for American men and $b = 0.081$ for American women in 2023.

Because $a$ is an extrapolation to an age at which nobody follows the law, it is hard to interpret and strongly correlated with $b$ in any fit. A widely used alternative parameterisation replaces it with the modal age at death $M$, the age at which the density $f(x)$ peaks:[^missov2015]

$$
\mu(x) = b\,e^{b(x - M)}, \qquad M = \frac{1}{b}\ln\frac{b}{a}.
$$

The Gompertz curves fitted to American data for 2023 place $M$ at about 85 years for men and 90 for women. The ages at which most deaths actually occur in the 2023 table are 87 and 89; the fitted values differ because the curve is fitted to ages 35 to 85 and the real hazard steepens above that range.

The Gompertz law describes adult mortality in people and in many laboratory animals with two parameters. Its weaknesses are just as clear. It cannot represent the decline of mortality in childhood or the young-adult hump, and it predicts a hazard that grows without limit. Whether that unbounded growth is real at the highest ages is the subject of the [plateau debate](#late-life-deceleration-and-the-plateau-debate).

### Gompertz–Makeham law

$$
\mu(x) = a\,e^{bx} + c, \qquad S(x) = \exp\!\left[-cx - \frac{a}{b}\left(e^{bx} - 1\right)\right].
$$

Makeham's constant $c$ represents deaths whose risk does not depend on age, which he attributed to chance.[^makeham1860] Adding it lets the law follow mortality down into the late teens, where senescent risk is negligible but deaths are not. Fitted to American men aged 15 to 100 in 2023, $c$ is about 0.0009 per year (Figure 2A). In modern low-mortality populations the constant is small and hard to estimate. It also absorbs part of the young-adult hump, so it should not be read as a pure measure of "extrinsic" mortality; the division of deaths into senescent and background components is itself a simplification.[^horiuchi1998]

### Weibull model

$$
\mu(x) = \frac{\beta}{\alpha}\left(\frac{x}{\alpha}\right)^{\beta - 1}, \qquad S(x) = \exp\!\left[-\left(\frac{x}{\alpha}\right)^{\beta}\right].
$$

In the Weibull model the hazard rises as a power of age: $\alpha$ is a characteristic life and $\beta$ is the shape. A shape $\beta > 1$ gives an increasing hazard, $\beta = 1$ a constant one and $\beta < 1$ a declining one. On a log–log plot the hazard is a straight line, so on the usual log–linear mortality plot it is concave, rising steeply at first and then more slowly (Figure 2A).

Reliability engineering derives the Weibull law from systems that fail when any of many components fails, or when damage accumulates in several independent steps. In epidemiology the same power law describes the incidence of many cancers, which rises roughly as the fifth or sixth power of age; the [[Armitage–Doll model]] explains this as the need for several sequential mutations in one cell lineage. For all-cause human mortality, the Gompertz law usually fits better. A comparison of the two functions found the Gompertz law the better descriptor of all-cause mortality, and the Weibull law the better descriptor of single causes of death.[^juckett1993] In the 2023 American data, the best Weibull fit to men aged 30 to 100 ($\beta \approx 5.6$) misses observed death rates by about 61% on a typical age, against 26% for the Gompertz law over the same range.

Robert Ricklefs and Alex Scheuerlein argued that the choice between the two models has biological content.[^ricklefs2002] In the forms they compared, both of which include a constant baseline mortality, the Gompertz ageing term multiplies baseline risk, which suits ageing as rising vulnerability to external hazards. The Weibull ageing term is added to baseline risk, which suits ageing as the growth of internal causes of death. They proposed comparing wild and captive populations of the same species to tell the two apart, and found that the comparison favoured the intrinsic-causes (Weibull) reading for birds but gave mixed results for mammals.

### Logistic models

Logistic models bend the Gompertz exponential so that the hazard rises ever more slowly and approaches a ceiling. They take their name from the logistic (S-shaped) curve of population growth, which has the same mathematical form: near-exponential growth that saturates. The general Perks form is[^perks1932]

$$
\mu(x) = \frac{c + a\,e^{bx}}{1 + d\,e^{bx}},
$$

which approaches $a/d$ at the oldest ages. Several special cases are in common use:

- **The Kannisto model** sets $c = 0$ and $d = a$, giving a two-parameter curve whose ceiling is a hazard of 1 per year:[^thatcher1998]

$$
\mu(x) = \frac{a\,e^{bx}}{1 + a\,e^{bx}}.
$$

  The Human Mortality Database, the main open archive of national life tables, fits this model by maximum likelihood to smooth death rates above age 80.[^hmd2025]

- **The gamma-Gompertz model** assumes that each individual's hazard is a Gompertz curve multiplied by a frailty $Z$ drawn from a gamma distribution (a flexible distribution of positive numbers) with mean 1 and variance $\gamma$. The frailest die first, so the survivors are increasingly robust and the population hazard bends:[^vaupel1979][^beard1959]

$$
\mu(x) = \frac{a\,e^{bx}}{1 + \dfrac{a\gamma}{b}\left(e^{bx} - 1\right)} \;\longrightarrow\; \frac{b}{\gamma} \quad \text{as } x \to \infty.
$$

  Adding Makeham's constant outside the frailty term gives the gamma-Gompertz–Makeham model, which Beard derived in 1959.[^beard1959]

Logistic models have no term for childhood or the young-adult hump. They are applied to adult and old-age mortality, where they usually fit at least as well as the Gompertz law and extrapolate more conservatively.[^thatcher1998]

### Multi-component models

Multi-component models add a separate term for each regime of the human age pattern, at the cost of more parameters.

**Thiele (1871)** used three terms:[^thiele1871]

$$
\mu(x) = a_1 e^{-b_1 x} + a_2 \exp\!\left[-\tfrac{1}{2} b_2 (x - c)^2\right] + a_3 e^{b_3 x}.
$$

**Siler (1979)** replaced Thiele's bump with Makeham's constant, giving five parameters for a juvenile decline, a constant background and a senescent rise.[^siler1979]

$$
\mu(x) = a_1 e^{-b_1 x} + a_2 + a_3 e^{b_3 x}.
$$

The Siler model was designed for animal populations, in which juvenile mortality is high and the young-adult hump is absent. It fits such data well, and it remains one of the standard models in comparative demography.[^jones2014] In human data with a pronounced hump it cuts straight through the excess (Figure 2B).

**Heligman and Pollard (1980)** modelled the odds of death rather than the hazard, with eight parameters in three terms:[^heligman1980]

$$
\frac{q_x}{1 - q_x} = A^{(x + B)^C} + D\,\exp\!\left[-E\left(\ln x - \ln F\right)^2\right] + G\,H^x.
$$

The first term describes the fall in childhood mortality. $A$ is close to the death probability at age 1, $B$ is an age offset that sets infant mortality, and $C$ is the rate of decline. The second term is the accident hump: $D$ is its height, $E$ its narrowness and $F$ the age at which it peaks. The third term is a Gompertz curve written in odds. The model fits national life tables closely across the whole age range: in Figure 2B its typical error is about 11%. For American men in 2023 the fitted hump term is broad and centred in the late thirties rather than in the early twenties, where the hump peaked in mid-twentieth-century tables. This is a property of the fit rather than a direct observation, because the hump and senescent terms trade off against each other. Its parameters are strongly intercorrelated, so they can be unstable from one year or population to the next, and its senescent term inherits the Gompertz law's behaviour at the oldest ages. Software implementations often use variants that model $q_x$ directly rather than the odds.

### Weon–Je model

Byung Mook Weon and Jung Ho Je generalised the Weibull survival function by letting its shape exponent change with age:[^weon2009]

$$
S(x) = \exp\!\left[-\left(\frac{x}{\alpha}\right)^{\beta(x)}\right],
$$

where $\alpha$ is a characteristic life and $\beta(x)$ is usually a low-order polynomial in age. A constant $\beta$ recovers the ordinary Weibull model. A rising $\beta(x)$ makes the survival curve more *rectangular*: nearly flat until old age and then dropping steeply, as when most deaths fall in a narrow band of old ages. Modern populations have been moving in that direction. Differentiating the cumulative hazard gives

$$
\mu(x) = \left(\frac{x}{\alpha}\right)^{\beta(x)}\left[\frac{\beta(x)}{x} + \beta'(x)\ln\frac{x}{\alpha}\right].
$$

If $\beta(x)$ falls at advanced ages, the bracket shrinks. The hazard first decelerates and would eventually reach zero, which is impossible for a real hazard. Weon and Je used that mathematical boundary to estimate a maximum human lifespan of about 126 years from Swedish women's period life tables for 1950 to 2005.[^weon2009] The estimate rests on extrapolating the fitted $\beta(x)$ beyond the ages where data exist. In this model the same falling exponent that reproduces late-life deceleration also produces the hard limit, so the limit is partly a property of the chosen functional form.

### Comparison

| Law (year) | Hazard $\mu(x)$ | Parameters | Describes well | Misses |
| --- | --- | :---: | --- | --- |
| de Moivre (1725) | $1/(\omega - x)$ | 1 | Simple annuity arithmetic | The shape of every real population |
| Gompertz (1825) | $a e^{bx}$ | 2 | Adult mortality, about 30 to 90 | Childhood, the young-adult hump, any old-age deceleration |
| Gompertz–Makeham (1860) | $a e^{bx} + c$ | 3 | Adults, down to the late teens | Childhood; the hump only in part |
| Thiele (1871) | Three terms: childhood, hump, senescence | 7 | The whole life span | Stability: many parameters for its era's data |
| Perks (1932), Beard (1959) | $\frac{c + a e^{bx}}{1 + d e^{bx}}$ | 3–4 | Adult and old-age deceleration | Childhood and the hump |
| Weibull (1939, 1951) | $\frac{\beta}{\alpha}\left(\frac{x}{\alpha}\right)^{\beta-1}$ | 2 | Single causes of death, cancer incidence, machine failure | The shape of all-cause human mortality |
| Gamma-Gompertz (1979) | $\frac{a e^{bx}}{1 + (a\gamma/b)(e^{bx} - 1)}$ | 3 | Deceleration explained by selective survival | Childhood and the hump |
| Siler (1979) | $a_1 e^{-b_1 x} + a_2 + a_3 e^{b_3 x}$ | 5 | Animal populations; human childhood and adulthood | The young-adult hump |
| Heligman–Pollard (1980) | Odds: $A^{(x+B)^C} + D e^{-E(\ln x - \ln F)^2} + G H^x$ | 8 | The whole human life span, including the hump | Parameter stability; old-age deceleration |
| Kannisto (1990s) | $\frac{a e^{bx}}{1 + a e^{bx}}$ | 2 | Ages 80 and over | Younger ages, by design |
| Weon–Je (2009) | $S(x) = e^{-(x/\alpha)^{\beta(x)}}$ | 4 or more | Rectangularising survival curves | Extrapolating $\beta(x)$ forces a hard maximum age |

## Explanations of the Gompertz law

That the death rate of adult humans rises by a nearly constant percentage each year is one of the most regular findings in biology. Several theories explain it; they are not mutually exclusive.

### Strehler–Mildvan theory

Strehler and Mildvan proposed that each organism has a "vitality", its capacity to restore its physiological state after a disturbance, which declines linearly with age. The organism is exposed to random challenges whose magnitudes follow an exponential (Maxwell–Boltzmann) distribution, so large challenges are exponentially rarer than small ones.[^strehler1960] Death occurs when a challenge exceeds the remaining vitality. The probability of such a challenge then rises exponentially as vitality falls, which gives the Gompertz law. The theory also predicted the **Strehler–Mildvan correlation**: across populations, a lower Gompertz intercept $a$ goes with a steeper slope $b$. The correlation is observed. Leonid and Natalia Gavrilov describe the same pattern as the *compensation effect of mortality*: death rates of different populations of a species converge at old ages.[^gavrilov2001] Its interpretation is complicated by estimation: fitted values of $a$ and $b$ are strongly correlated even within a single data set, and David Juckett and Barnett Rosenberg traced part of the regression of $\ln a$ on $b$ to where mortality curves intersect and to errors in fitted parameters.[^juckett1993]

### Reliability theory

Leonid and Natalia Gavrilov modelled organisms as systems built from many redundant components that do not themselves age.[^gavrilov2001] Such a system fails more often as its redundant parts are used up. If the system starts life already carrying many defects, as organisms built by development rather than assembly do, the failure rate rises exponentially, following the Gompertz law. A system built nearly free of initial defects, as engineered devices are, fails according to the Weibull law instead. The same theory predicts that the rise must slow and level off once redundancy is exhausted, and that mortality curves of different populations converge with age.[^gavrilov2001]

### Heterogeneity and selection

A population is a mixture of individuals of different frailty. Even if every individual's hazard rose exponentially forever, the frailest would die first, and the survivors at each age would be an increasingly select group. The population hazard would then rise more slowly than any individual's.[^vaupel1979][^beard1959] This mechanism explains late-life deceleration without any change in individual ageing. It also predicts that deceleration should start earlier for causes of death that select more strongly, and later as overall mortality falls, a pattern seen in Swedish and Japanese data.[^horiuchi1998]

### Evolutionary theory

Evolutionary theory explains why mortality rises with age, but not the exact exponential form. Peter Medawar argued that natural selection weakens with age, because few individuals in the wild survive long enough for late-acting genes to matter.[^medawar1952] [[wd-hamilton|W. D. Hamilton]] formalised this in 1966: the force of selection on age-specific survival declines from the age at first reproduction, because a gene that kills its carrier after much of that carrier's reproduction is done has already been passed on.[^hamilton1966] Mutations whose harm appears only late in life are therefore barely opposed by selection and accumulate in a [[selection-shadow-theory|selection shadow]]. Genes that help early in life and harm late in life can even be favoured, a mechanism called [[antagonistic-pleiotropy-theory|antagonistic pleiotropy]]. Physiological versions of the argument appear in the [[disposable-soma-theory|disposable soma theory]]. Hamilton's model predicted that mortality would rise steeply once reproduction ends. Plateaus in laboratory cohorts and the diversity of mortality patterns across species have since forced refinements.[^jones2014]

### Cellular and physiological models

Recent work links the Gompertz law to measurable physiological variables. Omer Karin, Uri Alon and colleagues measured the turnover of senescent cells in mice. These cells are removed with a half-life of days in young animals but weeks in old ones, and the slowing creates fluctuations whose growth with age can be modelled. A model in which death occurs when the senescent-cell burden crosses a threshold reproduces the Gompertz law in mice and humans, as well as the rapid effects of dietary shifts on mortality in flies.[^karin2019] (See [[cellular-senescence]] and [[sasp]].)

In the nematode *Caenorhabditis elegans*, Nicholas Stroustrup and colleagues collected high-precision survival data from large populations. They found that interventions as diverse as temperature, diet, oxidative stress and mutations in the insulin/IGF-1 pathway (see [[kenyon-daf-2-experiment]]) all stretch or compress the survival curve in time without changing its shape. This *temporal scaling* suggests that, in the worm, the risk of death is governed by a physiological state that decays at a single effective rate, which these interventions speed up or slow down.[^stroustrup2016]

## Late-life deceleration and the plateau debate

![[mortality-late-life-shapes.png|Figure 3. Three models that agree on the data and disagree beyond it. Each curve is fitted to American women aged 60 to 100 in 2023 and extended to 120. Within the data the three are almost indistinguishable; at age 110 they predict annual hazards of 1.1 (Gompertz), 0.6 (Kannisto) and 0.5 (gamma-Gompertz with its ceiling set at 0.7). The dashed line marks the plateau estimated for Italians aged 105 and over.]]

If the Gompertz law held at all ages, the hazard would keep doubling every eight years or so and survival beyond about 120 would become vanishingly rare. A *mortality plateau* would instead leave a constant, if high, annual risk of death and no fixed maximum age.

### Evidence from other species

In 1992 Carey and colleagues followed about 1.2 million medflies and found that death rates decelerated and then declined at older ages.[^carey1992] Curtsinger and colleagues found the same in genetically uniform lines of *Drosophila*, which ruled out genetic heterogeneity as the sole explanation.[^curtsinger1992] Plateaus have since been reported in many laboratory invertebrates.[^vaupel1998]

### Evidence in humans

In national statistics, the rate of increase of human mortality slows after about age 80.[^horiuchi1998][^thatcher1998] Two kinds of data suggest that it stops altogether at extreme ages:

- **Validated supercentenarians.** Using the International Database on Longevity, Jutta Gampe found that the annual probability of death after age 110 is flat at about 50%, equivalent to a hazard of about 0.7 per year, with no difference between the sexes and no trend across birth cohorts.[^gampe2010]
- **The Italian 105+ cohort.** Elisabetta Barbi and colleagues analysed all 3,836 Italians aged 105 and over between 2009 and 2015, born between 1896 and 1910, using individually validated ages. Hazards were essentially constant beyond age 105, at about the same level.[^barbi2018]

Two lines of evidence point the other way:

- **Single-year cohorts.** Studying single-year American birth cohorts in the Social Security Death Master File, the Gavrilovs found that mortality follows the Gompertz law up to ages 102 to 105 without noticeable deceleration.[^gavrilov2011] They argued that earlier reports of deceleration below age 100 were artefacts of mixing birth cohorts with different mortality levels, of using cross-sectional data, and of age exaggeration.
- **Error models.** Saul Newman showed that age-estimation and cohort-blending errors at rates below 1 in 10,000 are enough to produce late-life deceleration and plateaus. Correcting for such errors removed the plateaus in his analysis, and he concluded that human ageing does not slow at old ages. The Italian estimates, by contrast, rest on individually validated ages.[^newman2018][^barbi2018]

The disagreement is hard to resolve with data, because the models agree wherever data are plentiful. Figure 3 illustrates the problem. Fitted to American women aged 60 to 100, the Gompertz, Kannisto and gamma-Gompertz curves differ by less than their typical error. At age 110 they differ by a factor of two. In the 2023 American period table there is no sign of deceleration up to age 100. If anything the slope steepens: women's death rates double every 8.0 years between ages 60 and 80 and every 6.0 years between 80 and 100. Rates at these ages in a national period table depend partly on how the producing agency smooths sparse data, so this is weak evidence either way. The behaviour of mortality above 105 must therefore be measured, not extrapolated, and such measurements rest on a few thousand deaths in which small age errors matter. As of the mid-2020s the existence of a human plateau remains contested. It bears on whether human lifespan has a fixed limit, a question argued in the same years from trends in maximum reported age at death.[^dong2016][^lenart2017]

## Mortality across species

The Gompertz law is not universal. Caleb Finch, Malcolm Pike and Matthew Witten compared mortality rate doubling times across species and found that humans and rhesus monkeys share a doubling time of about eight years, despite large differences in lifespan.[^finch1990] Owen Jones and colleagues compared standardised mortality and fertility trajectories for 46 species: 11 mammals, 12 other vertebrates, 10 invertebrates, 12 vascular plants and a green alga.[^jones2014] Mortality after maturity rose steeply in some species, was constant in others, and declined in yet others, including both long- and short-lived species. Among the species with declining adult mortality is the desert tortoise, which keeps growing after maturity (see [[Indeterminate growth|indeterminate growth]]).

The naked mole-rat (*Heterocephalus glaber*) is the best-documented mammalian exception. In a compendium of more than 3,000 lifespan records, its hazard did not increase with age, even at ages 25 times its age at sexual maturity.[^ruby2018]

## Changes over time and forecasting

The models above describe one age pattern. Forecasting requires a model of how the pattern changes from year to year, and the field has moved from deterministic laws to statistical time-series models.

### Lee–Carter and its extensions

The Lee–Carter model writes the log central death rate at age $x$ in year $t$ as[^leecarter1992]

$$
\ln m_{x,t} = a_x + b_x k_t + \varepsilon_{x,t},
$$

where $a_x$ is the average age pattern, $k_t$ is a single index of the overall level of mortality, and $b_x$ is how strongly each age responds to changes in $k_t$. Without further conditions the parameters are not unique (multiplying every $b_x$ by 2 and halving every $k_t$ gives the same fit), so constraints such as $\sum_x b_x = 1$ and $\sum_t k_t = 0$ fix them. Lee and Carter estimated them with a singular value decomposition, a standard matrix factorisation; Natacha Brouhns and colleagues later recast the model as a Poisson regression on death counts.[^brouhns2002] To forecast, the index $k_t$ is projected as a *random walk with drift*: each year it moves by a fixed average amount plus random noise, which yields forecasts with prediction intervals. Nan Li and Lee extended the model to forecast several related populations, such as the two sexes or neighbouring countries, without letting their projections diverge implausibly.[^lilee2005] The model makes no assumption about the shape of $a_x$. It assumes instead that the improvement at each age stays in fixed proportion over time.

Extensions address its main weaknesses. The Renshaw–Haberman model adds a term for each year of birth, to capture cohort effects: generations whose mortality is persistently higher or lower than their neighbours'.[^renshaw2006] The Cairns–Blake–Dowd model, designed for pension liabilities at older ages, models the logit of $q_{x,t}$, that is $\ln[q/(1-q)]$, as a straight line in age whose intercept and slope both evolve as random walks:[^cbd2006]

$$
\operatorname{logit} q_{x,t} = \kappa_t^{(1)} + \kappa_t^{(2)}\,(x - \bar{x}).
$$

Iain Currie, María Durbán and Paul Eilers showed that penalised B-splines (P-splines) can smooth mortality surfaces over age and time and extrapolate them without any parametric law.[^currie2004]

### Relational models

Relational models express a population's mortality as a transformation of a standard schedule. In William Brass's logit system, the logit of a population's survival function is a linear function of the logit of a standard:[^brass1971]

$$
Y_x = \alpha + \beta\,Y_x^{(s)}, \qquad Y_x = \tfrac{1}{2}\ln\frac{1 - l_x}{l_x}.
$$

With two parameters, this lets demographers build complete life tables for populations with incomplete registration. Families of *model life tables*, such as Ansley Coale and Paul Demeny's regional tables, serve the same purpose by tabulating typical schedules indexed by level of mortality.[^coale1966]

### Rectangularisation and the shifting mode

Over the twentieth century, mortality fell first in infancy and childhood and, since about 1970 in industrialised countries, mainly at older ages. Survival curves became more rectangular, and both average and maximum lifespans rose steadily.[^wilmoth2000] Vaupel summarised the evidence as a delay of human senescence by about a decade, with the rate of deterioration with age roughly constant across individuals and over time.[^vaupel2010] In Gompertz terms that is a fall in the level parameter $a$ with little change in the slope $b$, which appears as a rising modal age at death $M$.[^missov2015]

## Estimation

### Data and likelihood

Mortality models are fitted to counts of deaths $D_x$ and *exposures* $E_x$ by age. The exposure is the total time that members of the population spent alive at that age, in person-years. If each person-year carries the same small risk independently, the number of deaths is approximately Poisson-distributed with mean equal to exposure times hazard,

$$
D_x \sim \operatorname{Poisson}\!\big(E_x\,\mu(x + \tfrac{1}{2})\big), \qquad \ln L = \sum_x \big[D_x \ln \mu(x + \tfrac{1}{2}) - E_x\,\mu(x + \tfrac{1}{2})\big] + \text{const},
$$

and estimates parameters by maximum likelihood. The Human Mortality Database uses exactly this approach to fit the Kannisto model at ages above 80.[^hmd2025] An older and still common shortcut is least squares on the logarithm of observed rates. It is simple, but it handles ages with zero deaths poorly and weights noisy old-age estimates as heavily as precise middle-age ones. (The fits in Figures 2 and 3 use least squares on log rates because a published life table supplies rates, not deaths and exposures.)

For laboratory cohorts, Scott Pletcher's WinModest software uses maximum likelihood to fit Gompertz, Gompertz–Makeham, logistic and logistic–Makeham models. Each of these is a special case of the next, so likelihood-ratio tests can ask whether an extra parameter is justified.[^pletcher1999] For wild animals, whose ages at death are usually known only through incomplete capture–recapture records, the BaSTA package estimates Gompertz, Weibull, logistic and Siler models by Bayesian inference.[^colchero2012] Tiffany Tai and Andrew Noymer compared methods of estimating the Gompertz slope from empirical data.[^tai2018]

### Practical difficulties

- **Parameter correlation.** Estimates of level and slope parameters ($a$ and $b$ in the Gompertz law) are strongly negatively correlated. An apparent difference in the rate of ageing between two small cohorts can be a difference in level, or noise, and needs a formal test.[^pletcher1999]
- **Sample size.** Distinguishing a Gompertz from a Weibull or logistic hazard, or detecting a plateau, needs very large cohorts or very long follow-up. The medfly study that established insect plateaus used more than a million animals.[^carey1992]
- **Age misreporting.** At the oldest ages a small number of exaggerated ages can dominate the estimates. Validated data are therefore essential, and even validated data may contain errors.[^newman2018][^gavrilov2011]
- **Period versus cohort.** Period data blend cohorts with different histories. Old-age patterns in period tables can reflect cohort composition rather than ageing.[^gavrilov2011]
- **Model choice.** Information criteria such as Akaike's, which reward fit and penalise extra parameters, are used to choose between models. With the data typical of animal studies, several models often fit equally well, and the choice should then rest on what the parameters are meant to measure.[^ricklefs2002]

## Applications

- **Actuarial science.** Laws of mortality were invented to price annuities and remain central to graduating (smoothing) insurance and pension tables, closing tables at the oldest ages, and pricing longevity risk. Stochastic models such as Lee–Carter and Cairns–Blake–Dowd are used to forecast pension liabilities.[^cbd2006]
- **Demography.** National statistical agencies and the Human Mortality Database use parametric laws to smooth unreliable death rates at advanced ages.[^hmd2025] Relational and stochastic models are used to estimate mortality where registration is incomplete and to project populations.[^brass1971][^leecarter1992]
- **Biogerontology.** Mortality models reveal *how* an intervention extends life. Dietary restriction in *Drosophila* lowers the short-term risk of death within two days of being imposed at any age, without changing the slope of the mortality curve.[^mair2003] In nematodes, by contrast, many interventions rescale the whole curve.[^stroustrup2016] Whether a therapy lowers the level of mortality or slows its rise is one of the main questions a survival study can answer, provided the cohort is large enough to separate the two parameters.[^pletcher1999] (See [[hallmarks-of-aging]] and [[History of biogerontology]].)
- **Evolutionary and comparative biology.** Standardised mortality trajectories let researchers compare ageing across species and test evolutionary theories of senescence.[^jones2014][^colchero2012]
- **Epidemiology.** Age-specific incidence of diseases is often modelled with the same functions. Power-law cancer incidence is the classic case.[^juckett1993]

## See also

- [[Armitage–Doll model]]: a multistage model of carcinogenesis whose power-law incidence is a Weibull hazard
- [[selection-shadow-theory]], [[antagonistic-pleiotropy-theory]] and [[disposable-soma-theory]]: evolutionary explanations of senescence
- [[Indeterminate growth]]: a life history associated with flat or declining adult mortality
- [[History of biogerontology]]
- [[Taxonomy of non mechanistic models in biology]]

## Further reading

- Olshansky SJ, Carnes BA (1997). "Ever since Gompertz". *Demography*. 34 (1): 1–15. [doi:10.2307/2061656](https://doi.org/10.2307/2061656). A review of the Gompertz law's history and its use in demography.
- Kirkwood TBL (2015). "Deciphering death: a commentary on Gompertz (1825)". *Philosophical Transactions of the Royal Society B*. 370 (1666): 20140379. [doi:10.1098/rstb.2014.0379](https://doi.org/10.1098/rstb.2014.0379). A short, readable guide to the original paper.
- Thatcher AR, Kannisto V, Vaupel JW (1998). *The Force of Mortality at Ages 80 to 120*. Odense University Press. [Full text](https://www.demogr.mpg.de/books/odense/5/). The standard comparison of models at the oldest ages.
- Bebbington M, Lai CD, Zitikis R (2007). "Modeling human mortality using mixtures of bathtub shaped failure distributions". *Journal of Theoretical Biology*. 245 (3): 528–538. [doi:10.1016/j.jtbi.2006.11.011](https://doi.org/10.1016/j.jtbi.2006.11.011). The reliability-engineering view of whole-life mortality.

## Data and figures

Figures 1 to 3 were drawn for this article from the Social Security Administration's [Period Life Table, 2023](https://www.ssa.gov/oact/STATS/table4c6.html), as used in the 2026 Trustees Report. Hazards were computed as $\mu = -\ln(1 - q_x)$ and placed at mid-year. The fitted curves minimise squared error in log hazard. The "typical miss" in Figure 2 is the root-mean-square error on the log scale, converted to a percentage, $e^{\text{RMSE}} - 1$. The portrait of Gompertz is in the public domain ([Wikimedia Commons](https://commons.wikimedia.org/wiki/File:Gompertz.png)).

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
