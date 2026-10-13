---
title: Selection shadow
date: 2026-10-13
draft: true
tags:
  - content/wiki
aliases:
  - Selection shadow theory
  - Mutation accumulation
  - Mutation accumulation theory
  - Force of selection
  - Declining force of selection
---
# Selection shadow

The **selection shadow** is the range of ages at which natural selection acts only weakly, because little of an individual's expected reproduction still lies ahead of it. A gene that harms its carrier at such an age has, in most carriers, already been passed on. The idea goes back to J. B. S. Haldane and Peter Medawar in the 1940s, building on R. A. Fisher's concept of reproductive value,[^charlesworth2000] and was given its mathematical form by [[wd-hamilton|W. D. Hamilton]] in 1966.[^hamilton1966] It is the starting point of the evolutionary theory of ageing.

The shadow arises even in a population whose members never age. Older age classes are smaller than younger ones, both because their members have been exposed to hazards for longer and, in a growing population, because they were born when the population was smaller. A gene acting at a late age therefore affects a smaller share of the population's reproduction.[^wensink2017] Medawar illustrated this with a stock of test tubes broken at random.[^medawar1952] Hamilton showed that the force of selection on survival stays constant until the age of first reproduction and falls from there to zero at the last.[^hamilton1966] Two genetic mechanisms turn the shadow into ageing. In **mutation accumulation**, harmful alleles that act only late in life are removed so slowly that new mutations keep them at higher frequencies than early-acting alleles. In [[antagonistic-pleiotropy-theory|antagonistic pleiotropy]], selection favours alleles whose early benefits outweigh their late costs.

Three questions run through the field. The first is how much of ageing each mechanism explains; genetic studies in fruit flies support both, and the tests that should tell them apart have proved hard to interpret.[^mooradpromislow2009] The second is whether populations exposed to more deaths from external causes evolve faster ageing, as Williams predicted in 1957. The answer depends on how the population is regulated.[^abrams1993][^caswell2007] The third is why some species do not age at all: in some animals and plants, mortality is flat or falls with age.[^jones2014]

## Terminology

The **force of selection** at an age is how much a small change in survival or reproduction at that age changes an individual's genetic contribution to future generations. Hamilton measured it as the change in the growth rate of the population.[^hamilton1966] For survival, it is proportional to the share of an individual's expected lifetime reproduction that is still ahead at that age. For American women in 2023, half of a newborn girl's expected reproduction is still ahead of her at 30, less than 5% at 40, and none after 49 (see [[antagonistic-pleiotropy-theory#the-force-of-selection|the computation]]).

- The **selection shadow** is the range of ages over which the force of selection is small.
- **Mutation accumulation** is the theory that ageing results, at least in part, from harmful alleles whose effects appear late in life. New mutations create them faster than selection removes them, so they persist at a balance between the two, called *mutation–selection balance*.[^charlesworth2000]
- **Antagonistic pleiotropy** is the theory that ageing results, at least in part, from alleles that selection favours for their early benefits despite their late costs.[^williams1957] (See [[antagonistic-pleiotropy-theory]].)
- **Extrinsic mortality** is mortality from causes that would kill an individual regardless of its condition, such as predation or accidents. The distinction is a simplification: frailer individuals are also more likely to be caught by predators.
- **Density dependence** is the slowing of population growth as a population becomes crowded, through fewer births, lower survival or both. Which of these it acts on matters for how extrinsic mortality affects the shadow.[^abrams1993]

## Medawar's argument

### Background

August Weismann proposed in the early 1880s that natural selection had designed a mechanism to remove old individuals for the good of the species. George C. Williams later summarised four objections: it confused senescence with mechanical wear, individuals old enough to die by such a mechanism are extremely rare in nature, decades of research had found no such mechanism, and it was hard to see how selection on individuals could produce one.[^williams1957]

R. A. Fisher introduced **reproductive value** in 1930: the number of offspring an individual of a given age can still expect to have, with offspring born later counted for less when the population is growing. Reproductive value peaks near the start of reproduction and declines over much of adult life.[^fisher1930][^charlesworth2000] In 1941 J. B. S. Haldane noted that the onset of Huntington's chorea, a dominant disease, averages 35.5 years and varies with modifier genes. He suggested that selection would favour modifiers that postpone onset, and that onset might lie where it does because "primitive men and women seldom lived much beyond forty, so postponement of onset beyond this age had no selective advantage".[^haldane1941]

### Old age and natural death

Medawar developed the argument in an essay in 1946 and in his inaugural lecture at University College London in December 1951, published as *An Unsolved Problem of Biology* in 1952.[^medawar1946][^medawar1952] His central illustration was a stock of test tubes, broken at random at a constant rate and replaced as they break. The tubes do not become more fragile with age, yet old tubes are rare, because an old tube has had to escape breakage many times. In any population exposed to hazards, the force of natural selection therefore weakens with age, even if its members do not deteriorate. Hamilton's formulation later showed that what matters is the stable age distribution, which reflects population growth as well as deaths.[^hamilton1966][^wensink2017]

Medawar drew two consequences. A mutation whose harmful effect appears late enough in life is almost invisible to selection, so such mutations accumulate. And selection should favour *modifier* alleles that postpone the effects of harmful alleles to later ages, an idea Haldane had raised in 1941.[^haldane1941][^medawar1952] Charlesworth later pointed out that selection for such modifiers is only of the order of the mutation rate, so postponement is unlikely to have contributed much to senescence.[^charlesworth2000] Both treat ageing as a by-product of selection on younger individuals, not as an adaptation.

Figure 1 is a version of Medawar's population. Every individual faces the same risk of death $h$ each year, matures at age $\alpha$, and then reproduces at a constant rate. Nobody ages. The force of selection on survival is nevertheless constant up to maturity and falls exponentially after it. With a risk of death of 0.1 a year, it halves every 6.9 years after maturity. Drag $h$ to 0.3 and it halves every 2.3 years: more deaths from external causes deepen the shadow. Then switch the population to "free to grow or shrink" and drag $h$ again.

```vega-lite
{
  "$schema": "https://vega.github.io/schema/vega-lite/v6.json",
  "description": "Figure 1. Medawar's population of individuals that never age. Every individual faces the same risk of death h each year, matures at age α and then reproduces at a constant rate. Top: the share of the population older than each age. Bottom: the force of selection on survival, the share of a newborn's expected reproduction still ahead at each age (scaled to 1 at birth). The switch sets how the population is kept from growing without limit: by fewer births, so that it stays constant, or not at all, with birth rates fixed at the level that holds it constant when h is 0.1 a year, so that it grows or shrinks.",
  "params": [
    {
      "name": "h",
      "value": 0.1,
      "bind": {
        "input": "range",
        "min": 0.02,
        "max": 0.5,
        "step": 0.01,
        "name": "Risk of death h, per year"
      }
    },
    {
      "name": "alpha",
      "value": 3,
      "bind": {
        "input": "range",
        "min": 1,
        "max": 10,
        "step": 0.5,
        "name": "Age at maturity α"
      }
    },
    {
      "name": "mode",
      "value": "births",
      "bind": {
        "input": "radio",
        "options": [
          "births",
          "growth"
        ],
        "labels": [
          "held steady by fewer births",
          "free to grow or shrink"
        ],
        "name": "Population "
      }
    }
  ],
  "spacing": 14,
  "vconcat": [
    {
      "height": 110,
      "data": {
        "sequence": {
          "start": 0,
          "stop": 40.25,
          "step": 0.25,
          "as": "age"
        }
      },
      "transform": [
        {
          "calculate": "mode == 'births' ? h : 0.1",
          "as": "k"
        },
        {
          "calculate": "exp(-datum.k * datum.age)",
          "as": "share"
        }
      ],
      "mark": {
        "type": "area",
        "style": "observed",
        "opacity": 0.45
      },
      "encoding": {
        "x": {
          "field": "age",
          "type": "quantitative",
          "scale": {
            "domain": [
              0,
              40
            ],
            "nice": false
          },
          "axis": {
            "title": null,
            "values": [
              0,
              10,
              20,
              30,
              40
            ],
            "labels": false,
            "ticks": false,
            "domain": false
          }
        },
        "y": {
          "field": "share",
          "type": "quantitative",
          "scale": {
            "domain": [
              0,
              1
            ]
          },
          "axis": {
            "title": "Older than age",
            "values": [
              0,
              0.5,
              1
            ],
            "format": ".0%"
          }
        }
      }
    },
    {
      "height": 230,
      "layer": [
        {
          "data": {
            "sequence": {
              "start": 0,
              "stop": 40.25,
              "step": 0.25,
              "as": "age"
            }
          },
          "transform": [
            {
              "calculate": "mode == 'births' ? h : 0.1",
              "as": "k"
            },
            {
              "calculate": "datum.age <= alpha ? 1 : exp(-datum.k * (datum.age - alpha))",
              "as": "force"
            }
          ],
          "mark": {
            "type": "line",
            "style": "model"
          },
          "encoding": {
            "x": {
              "field": "age",
              "type": "quantitative"
            },
            "y": {
              "field": "force",
              "type": "quantitative"
            }
          }
        },
        {
          "data": {
            "values": [
              {}
            ]
          },
          "mark": {
            "type": "rule",
            "style": "guide"
          },
          "encoding": {
            "x": {
              "datum": {
                "expr": "alpha"
              },
              "type": "quantitative"
            }
          }
        },
        {
          "data": {
            "values": [
              {
                "line": 0
              },
              {
                "line": 1
              },
              {
                "line": 2
              }
            ]
          },
          "transform": [
            {
              "calculate": "mode == 'births' ? h : 0.1",
              "as": "k"
            },
            {
              "calculate": "log(2) / datum.k",
              "as": "half"
            },
            {
              "calculate": "datum.line == 0 ? 'After maturity, selection on' : datum.line == 1 ? 'survival halves every ' + format(datum.half, '.1f') + ' years' : (mode == 'births' ? 'Population constant' : (abs(0.1 - h) < 0.0005 ? 'Population constant' : 'Population ' + (h < 0.1 ? 'grows ' : 'shrinks ') + format(abs(0.1 - h) * 100, '.0f') + '% a year'))",
              "as": "label"
            },
            {
              "calculate": "39",
              "as": "lx"
            },
            {
              "calculate": "datum.line == 2 ? 0.74 : 1.0 - 0.085 * datum.line",
              "as": "ly"
            }
          ],
          "mark": {
            "type": "text",
            "style": "model-label",
            "align": "right",
            "baseline": "top"
          },
          "encoding": {
            "x": {
              "field": "lx",
              "type": "quantitative"
            },
            "y": {
              "field": "ly",
              "type": "quantitative"
            },
            "text": {
              "field": "label"
            }
          }
        }
      ],
      "encoding": {
        "x": {
          "type": "quantitative",
          "scale": {
            "domain": [
              0,
              40
            ],
            "nice": false
          },
          "axis": {
            "title": "Age",
            "values": [
              0,
              10,
              20,
              30,
              40
            ]
          }
        },
        "y": {
          "type": "quantitative",
          "scale": {
            "domain": [
              0,
              1.05
            ],
            "nice": false
          },
          "axis": {
            "title": "Force of selection s(x)",
            "values": [
              0,
              0.25,
              0.5,
              0.75,
              1
            ],
            "format": ".2~f"
          }
        }
      }
    }
  ]
}
```

In the second setting the risk of death has no effect on the force of selection. Birth rates are fixed, so a higher $h$ makes the population shrink, at a rate of 20% a year at $h = 0.3$. A shrinking population has relatively more old individuals, and this exactly offsets the extra deaths. In the first setting, births fall as deaths rise, keeping the population constant, and nothing offsets the extra deaths. Peter Abrams and Hal Caswell showed that this holds in general: mortality that falls equally on all ages changes the force of selection only through density dependence, and the direction of the change depends on which ages and which of births or survival the density dependence acts on.[^abrams1993][^caswell2007] (See [Extrinsic mortality and the pace of ageing](#extrinsic-mortality-and-the-pace-of-ageing).)

> [!note]- Formal definitions
> With a constant risk of death $h$, the share surviving to age $x$ is $l(x) = e^{-hx}$. With $m$ offspring a year from age $\alpha$ onwards, the population's growth rate $r$ solves the Euler–Lotka equation, which states that a newborn's lifetime reproduction, discounted by population growth, is exactly one:
>
> $$
> \int_\alpha^\infty e^{-rx}\,e^{-hx}\,m\,\mathrm{d}x = \frac{m\,e^{-(r+h)\alpha}}{r + h} = 1.
> $$
>
> Hamilton's force of selection on survival at age $x$ is proportional to $s(x) = \int_x^\infty e^{-ry}\,l(y)\,m(y)\,\mathrm{d}y$, the discounted reproduction still ahead.[^hamilton1966] Here $s(x) = 1$ for $x \le \alpha$ and $s(x) = e^{-(r+h)(x - \alpha)}$ after maturity, so it halves every $\ln 2/(r+h)$ years.
>
> Only the sum $r + h$ appears. If $m$ is fixed, the Euler–Lotka equation fixes $r + h$, and any change in $h$ is absorbed by $r$. If density dependence instead lowers $m$ until $r = 0$, then $r + h = h$, and the decline steepens with $h$. Figure 1 fixes $m$ at the value that gives $r = 0$ when $h = 0.1$ a year.

## Hamilton's formalisation

Hamilton asked how the population growth rate responds to a small change in survival or reproduction at one age, and called the answers *indicators* of the force of selection.[^hamilton1966] The indicator for survival at an age is the reproduction still expected after it; the indicator for reproduction at an age is the probability of surviving to it. Both are discounted for population growth. The survival indicator is constant from birth to maturity, declines through the reproductive years and reaches zero at the last age of reproduction. The reproduction indicator falls with survival at all ages. Hamilton concluded that senescence is inevitable for any organism whose force of selection declines in this way.[^baudisch2005] The [[antagonistic-pleiotropy-theory#the-force-of-selection|antagonistic pleiotropy article]] computes the survival indicator from the 2023 American life table and birth rates.

Four later results concern the scope of that conclusion.

- **How a mutation's effect is measured.** Hamilton measured changes in the logarithm of survival. Annette Baudisch showed that "alternative parameterizations of mutational effects lead to indicators that can increase with age". If a mutation multiplies the mortality rate by a constant factor rather than adding to it, the indicator is multiplied by the mortality rate itself, and can therefore rise with age where mortality does. For mutation accumulation the choice makes no difference to first order, because it cancels out of mutation–selection balance.[^baudisch2005]
- **Growth after maturity.** In species that keep growing after maturity, the number of offspring rises with age. James Vaupel and colleagues showed that **negative senescence**, mortality that falls with age after maturity, is then theoretically possible, and argued that it may be widespread in species with [[Indeterminate growth|indeterminate growth]].[^vaupel2004] Baudisch developed the argument into a general case against the inevitability of senescence.[^baudisch2008]
- **Help to kin.** In social species, old individuals contribute to the survival and reproduction of their relatives. Ronald Lee showed that the force of selection on mortality is then a weighted average of remaining fertility and the remaining food, care and other resources transferred to the young, which explains survival after the end of reproduction.[^lee2003] Kristen Hawkes and colleagues proposed that grandmothers' provisioning of their grandchildren selected for the long human post-reproductive lifespan.[^hawkes1998]
- **Many mutations at once.** Hamilton's indicators describe the effect of one small change at a time. In a model of mutation accumulation that lets the effects of many mutations interact, Kenneth Wachter, Steven Evans and David Steinsaltz found "the collapse of Hamilton-style predictions in the most commonly studied case".[^wachter2013][^wachter2014]

## Mutation accumulation

### Mutation–selection balance

Harmful mutations arise continually, and selection removes them at a rate proportional to the harm they do. At equilibrium, the frequency of each harmful allele is roughly its mutation rate divided by the strength of selection against it. For an allele that raises the mortality rate at one age, the strength of selection is proportional to the force of selection at that age. The weaker the force, the more common the allele, and the more deaths it causes at that age. The excess mortality maintained at an age is therefore inversely proportional to the force of selection there. It does not depend on how harmful each allele is, because an allele with a larger effect is held at a proportionally lower frequency.

Figure 2 applies this to the force of selection of American women in 2023. At the default setting the excess mortality is about 1 in 48,000 a year at 20 and 1 in 26,000 at 30, small fractions of the observed rates (1 in 2,300 and 1 in 1,100). It reaches 1 in 2,300 at 40, against 1 in 600 observed, and 1 in 190 at 45, overtaking the observed 1 in 460. At mutation rates much above the default the predicted excess would exceed total observed mortality even in youth, so U cannot be much larger. After 49, the last age with births in the data, the force of selection is zero and the predicted excess has no finite value. Hamilton's model therefore predicts a "wall of death" at the end of reproduction.[^wachter2013] Human mortality shows no such wall. Lee proposed that help to kin extends the force of selection beyond the end of reproduction.[^lee2003] Wachter and colleagues doubted that transfers can reshape selection on individual mutations, and showed that small early-age effects of late-acting mutations can remove walls of death.[^wachter2013] The slider sets the mutation rate, which is not known; it moves the curve up or down without changing its shape.

```vega-lite
{
  "$schema": "https://vega.github.io/schema/vega-lite/v6.json",
  "description": "Figure 2. The excess mortality that mutation accumulation alone would maintain at each age at mutation–selection balance, 2U/s(x), if the force of selection s(x) were that of American women in 2023. U is the rate at which new mutations that raise the mortality rate at one year of age arise per haploid genome per generation; its value is not known, and the slider moves the curve up or down without changing its shape. Grey points are the observed mortality rates, for comparison. The predicted excess rises far faster than the observed rate and has no finite value after the last age of reproduction.",
  "params": [
    {
      "name": "logU",
      "value": -5,
      "bind": {
        "input": "range",
        "min": -6,
        "max": -3,
        "step": 0.1,
        "name": "Mutation rate U (log₁₀)"
      }
    }
  ],
  "width": 560,
  "height": 280,
  "layer": [
    {
      "data": {
        "url": "/attachments/us-life-table-2023.csv"
      },
      "transform": [
        {
          "filter": "datum.sex == 'women' && datum.age >= 10 && datum.age <= 60"
        }
      ],
      "mark": {
        "type": "circle",
        "style": "observed",
        "size": 16
      },
      "encoding": {
        "x": {
          "field": "age",
          "type": "quantitative"
        },
        "y": {
          "field": "hazard",
          "type": "quantitative"
        }
      }
    },
    {
      "data": {
        "url": "/attachments/us-force-of-selection-2023.csv"
      },
      "transform": [
        {
          "filter": "datum.age >= 10 && datum.force > 0"
        },
        {
          "calculate": "2 * pow(10, logU) / datum.force",
          "as": "excess"
        }
      ],
      "mark": {
        "type": "line",
        "style": "model",
        "clip": true
      },
      "encoding": {
        "x": {
          "field": "age",
          "type": "quantitative"
        },
        "y": {
          "field": "excess",
          "type": "quantitative"
        }
      }
    },
    {
      "data": {
        "values": [
          {}
        ]
      },
      "mark": {
        "type": "rule",
        "style": "guide"
      },
      "encoding": {
        "x": {
          "datum": 49.5,
          "type": "quantitative"
        }
      }
    },
    {
      "data": {
        "values": [
          {
            "age": 50.3,
            "y": 0.00003,
            "label": "no births"
          },
          {
            "age": 50.3,
            "y": 0.000013,
            "label": "after 49"
          }
        ]
      },
      "mark": {
        "type": "text",
        "style": "observed-label",
        "align": "left"
      },
      "encoding": {
        "x": {
          "field": "age",
          "type": "quantitative"
        },
        "y": {
          "field": "y",
          "type": "quantitative"
        },
        "text": {
          "field": "label"
        }
      }
    },
    {
      "data": {
        "values": [
          {
            "age": 11,
            "age2": 14,
            "y": 3,
            "label": "Mutation accumulation alone, 2U/s(x)",
            "kind": "model"
          },
          {
            "age": 11,
            "age2": 14,
            "y": 1.2,
            "label": "Observed, US women 2023",
            "kind": "observed"
          }
        ]
      },
      "layer": [
        {
          "transform": [
            {
              "filter": "datum.kind == 'model'"
            }
          ],
          "mark": {
            "type": "rule",
            "style": "model"
          },
          "encoding": {
            "x2": {
              "field": "age2"
            }
          }
        },
        {
          "transform": [
            {
              "filter": "datum.kind == 'observed'"
            }
          ],
          "mark": {
            "type": "circle",
            "style": "observed",
            "size": 30
          },
          "encoding": {
            "x": {
              "datum": 12.5,
              "type": "quantitative"
            }
          }
        },
        {
          "transform": [
            {
              "filter": "datum.kind == 'model'"
            }
          ],
          "mark": {
            "type": "text",
            "style": "model-label",
            "align": "left",
            "dx": 6
          },
          "encoding": {
            "x": {
              "field": "age2",
              "type": "quantitative"
            },
            "text": {
              "field": "label"
            }
          }
        },
        {
          "transform": [
            {
              "filter": "datum.kind == 'observed'"
            }
          ],
          "mark": {
            "type": "text",
            "style": "observed-label",
            "align": "left",
            "dx": 6
          },
          "encoding": {
            "x": {
              "field": "age2",
              "type": "quantitative"
            },
            "text": {
              "field": "label"
            }
          }
        }
      ],
      "encoding": {
        "x": {
          "field": "age",
          "type": "quantitative"
        },
        "y": {
          "field": "y",
          "type": "quantitative"
        }
      }
    }
  ],
  "encoding": {
    "x": {
      "type": "quantitative",
      "scale": {
        "domain": [
          10,
          60
        ],
        "nice": false
      },
      "axis": {
        "title": "Age",
        "values": [
          10,
          20,
          30,
          40,
          50,
          60
        ]
      }
    },
    "y": {
      "type": "quantitative",
      "scale": {
        "type": "log",
        "domain": [
          0.00001,
          10
        ],
        "nice": false
      },
      "axis": {
        "title": "Mortality rate, per year",
        "values": [
          0.00001,
          0.0001,
          0.001,
          0.01,
          0.1,
          1,
          10
        ],
        "labelExpr": "datum.value >= 1 ? format(datum.value, '~g') + ' a year' : '1 in ' + format(1 / datum.value, ',')"
      }
    }
  }
}
```

> [!note]- Mutation–selection balance at one age
> Let a mutation raise the mortality rate by $\delta$ for one year at age $x$, with dominance $d$ (the fraction of its effect seen in carriers of one copy), and arise at rate $u$ per generation. By Hamilton's sensitivity, carriers' growth rate is lower by $d\,\delta\,s(x)/T$ a year, where $T$ is the generation time; new copies arise at $u/T$ a year. Mutation and selection balance when the allele's frequency is
>
> $$
> q \approx \frac{u}{d\,\delta\,s(x)}.
> $$
>
> Almost all copies are in carriers of one copy, so the excess mortality at age $x$ is $2q\,d\,\delta = 2u/s(x)$, independent of $\delta$ and $d$. Summed over all genes with effects at age $x$, the excess is $2U/s(x)$, where $U$ is the mutation rate per haploid genome (per gamete) to such alleles. This assumes partial dominance with $d\,\delta\,s(x) \gg u$ (for fully recessive alleles the excess is $U/s(x)$), that selection is much stronger than mutation, and that the effects of different genes add up. Baudisch showed that the approximation fails exactly where the predicted excess becomes large.[^charlesworth2001][^wachter2013][^baudisch2005]

### Predictions and tests

Mutation accumulation makes predictions about genetic variation that antagonistic pleiotropy does not. If late-acting harmful alleles are common, inbreeding depression, dominance variance and the variance among inbred lines should rise with age; inbreeding exposes harmful alleles carried in single copies. Additive genetic variance can rise with age under either theory.[^charlesworthhughes1996] Mutations with effects at late ages must exist, and their effects must be at least partly confined to those ages.

- **Genetic variation and inbreeding.** Kimberly Hughes and Brian Charlesworth found that genetic variation in the mortality of male *Drosophila melanogaster* "increases greatly at very late ages, as predicted by the mutation accumulation hypothesis".[^hughescharlesworth1994] Hughes and colleagues later found that the harm done by inbreeding and the genetic variation in reproductive success rose sharply with age, and described their results as the strongest support yet for the mutation theory.[^hughes2002] In a study of 65,134 flies, Daniel Promislow and colleagues found that the additive genetic variance in female mortality rose from 0.007 in the first week of life to 0.325 by the third, then fell to 0.002 by the seventh, against the prediction.[^promislow1996] A joint reanalysis of both data sets found that late-life additive variance rises if mortality is modelled as Gompertzian and falls if it is allowed to level off.[^shaw1999]
- **What the tests can tell apart.** Jacob Moorad and Promislow showed that antagonistic pleiotropy can also make inbreeding more damaging with age, and concluded that tests based on partitioning genetic variance "are likely to be too conservative to be of general value".[^mooradpromislow2009]
- **New mutations.** Scott Pletcher, David Houle and James Curtsinger let spontaneous mutations accumulate in fly lines for 19 generations and measured their effects on mortality at each age. New mutations added significant genetic variance in mortality up to about 30 days of age but none detectably at older ages, and their effects at early and late ages were essentially uncorrelated.[^pletcher1998] With data from 10, 19 and 47 generations, "the input of genetic variance is greater for early life mortality rates than for mortality at older ages", and correlations between ages rose as mutations accumulated.[^pletcher1999] Mutations with age-specific effects exist, but these lines showed few with effects confined to late life.
- **Selection experiments.** Laurence Mueller kept *Drosophila* populations that bred only at young ages for more than 120 generations. By the fourth week of adult life the fecundity of large females was 47–83% lower than in populations allowed to breed throughout life, with no difference in the first week. The populations were small, and Mueller noted that genetic drift alone could account for the increase in these alleles once selection on late fecundity was removed.[^mueller1987] Daniel Borash, Michael Rose and Mueller found that crossing separately evolved short-lived populations improved male reproductive performance at later ages relative to the parent populations, and concluded that mutation accumulation "has been at least partly responsible" for its decline.[^borash2007] The result is equally consistent with deleterious alleles fixed by drift in small populations.
- **Humans.** J. A. Rodríguez and colleagues reported that risk alleles for late-onset diseases are more common, and have larger effects, than those for early-onset diseases, as mutation accumulation predicts.[^rodriguez2017] Erping Long and Jianzhi Zhang's reanalysis found the result not robust, and pointed out that the test assumes a mutation–selection balance that recent demographic change may have disturbed.[^longzhang2019]

### Late-life plateaus

Hamilton's model predicts that mortality should rise ever faster towards the end of reproduction. Large insect cohorts instead show mortality rates that level off at old ages. (See [[Mortality rate models#late-life-deceleration-and-the-plateau-debate|Mortality rate models]].) Mueller and Rose argued that plateaus follow from the theory because, once the force of selection has fallen to zero, selection cannot distinguish between the oldest ages.[^muellerrose1996] Pletcher and Curtsinger showed that this conclusion is very sensitive to assumptions about mutations.[^pletchercurtsinger1998] Charlesworth showed that if mutations also act at earlier ages, the rise in mortality slows late in life and can even stop.[^charlesworth2001] Wachter and colleagues showed that whether a model produces plateaus or walls of death depends on how the effects of mutations interact.[^wachter2013][^wachter2014]

## Natural populations and the comparative evidence

### Ageing in the wild

The verbal argument is often given in the form: wild animals rarely live long enough to grow old, so selection never acts on old age. Field studies do not support the premise. Daniel Nussey and colleagues reviewed 340 studies documenting senescence in 175 wild animal species, mostly birds and mammals but including other vertebrates and insects.[^nussey2013] Hamilton's version of the theory does not depend on it: the force of selection declines from the age of maturity, not from the age by which most individuals have died, so it predicts senescence within the ages that wild animals commonly reach.

### Extrinsic mortality and the pace of ageing

Williams predicted in 1957 that populations with higher adult mortality should evolve faster senescence.[^williams1957] Figure 1 shows why the prediction holds only under some conditions. In a population that is not density-dependent, mortality that falls equally on all ages does not change selection on ageing, because the population's decline offsets it.[^caswell2007] With density dependence, higher mortality can speed senescence, slow it, or have mixed effects. Williams's prediction is most likely when density dependence acts mainly on births and does not reduce the births of older individuals more than those of younger ones.[^abrams1993]

The mathematics is no longer disputed. In a population that is not regulated, or that is regulated through survival equally at all ages, mortality that falls equally on all ages does not change selection on senescence. When density dependence acts through births or the recruitment of juveniles, such mortality favours faster senescence, as Williams predicted; when it acts mainly through the survival of adults, it favours slower senescence.[^abrams1993][^dayabrams2020][^devries2023] Jacob Moorad, Promislow and Jonathan Silvertown argued that only age-dependent mortality can affect senescence and that "formal, mathematical theory shows it is wrong".[^moorad2019] Troy Day and Abrams showed that this misreads the earlier models: "It is a fact, not an opinion, that age-dependency of external mortality is not required."[^dayabrams2020] Jean-Baptiste André and François Rousset reached the same conclusion as Abrams and Caswell from a minimal model of the pace of life.[^andrerousset2020] The open question is empirical: which ages and which vital rates density acts on in natural populations. Mortality that depends on condition adds a further route; if it removes frail old individuals, it can favour slower senescence.[^williamsday2003]

Comparisons between species associate lower exposure to external hazards with longer lives and slower ageing:

- **Flight.** The maximum lifespans of bats are at least three times those of non-flying placental mammals of the same body size.[^austadfischer1991] Across 1,368 species of birds and mammals, the ability to fly was the factor most strongly associated with longer lifespan after body mass.[^healy2014]
- **Trees and burrows.** Among species that do not fly, lifespan was longer in tree-dwelling and burrowing species.[^healy2014] Tree-dwelling mammals live longer than ground-dwelling mammals of the same body size.[^shattuck2010]
- **Colonies.** Queens of eusocial insects, which live in colonies with sterile workers, live roughly a hundred times longer than solitary insects; among ants, queens of species with a single queen per colony live longer than those of species with several.[^kellergenoud1997]
- **Islands.** Virginia opossums on a predator-free island had higher survival and a slower rise in mortality with age than mainland opossums.[^austad1993]
- **Across birds and mammals.** The rate of ageing is related to mortality early in adult life, independently of body size and taxonomic group.[^ricklefs1998]
- **Experiments.** Fruit flies kept under high adult mortality, with population density restored by adding young adults, evolved modestly shorter lives. Restocking makes density dependence act on recruitment, the case in which theory predicts this result.[^stearns2000][^moorad2019] In nematodes, high random mortality shortened lifespan, but high mortality that fell on frail individuals lengthened it.[^chenmaklakov2012]
- **Predation in the wild.** Trinidad guppies from high-predation sites evolved earlier maturity but did not senesce earlier in mortality or reproduction.[^reznick2004]

Most of these comparisons concern adult survival, and Moorad and colleagues argued that each fits Hamilton's theory if the protection lowers adult mortality more than juvenile mortality.[^moorad2019]

One of three stocks of mice descended from wild-caught ancestors lived 24% longer on average than a laboratory-derived stock kept in the same conditions, and matured more slowly; a second differed only in maximum lifespan, and the third not at all. The authors attributed the difference to selection for rapid maturation during adaptation to the laboratory.[^miller2002] In all these comparisons, the rate of ageing changes together with the rest of the life history: the age at maturity, exposure to hazards, social structure and investment in each offspring. The force of selection is calculated from that life history, so the depth of the shadow changes as the life history evolves.

### Species that do not age

Hamilton's original conclusion implies that senescence must evolve wherever the force of selection declines with age. Owen Jones and colleagues compared mortality and fertility across 46 species of animals and plants, and found mortality that increased, stayed constant or fell with age after maturity, in both long- and short-lived species.[^jones2014] The curves stop at the age when 5% of adults survive, and for species described by stage-based models the flat late mortality is partly built into the model.[^jones2014] In a captive colony, the mortality rate of naked mole-rats did not increase with age even at 25 times their age at maturity;[^ruby2018] the finding was questioned because most animals were young,[^dammann2019] but held with twice the data.[^ruby2024] Among 52 species of turtles and tortoises in zoos, about three-quarters showed slow or negligible senescence,[^dasilva2022] and in wild reptiles and amphibians, protective phenotypes such as shells were associated with slower ageing.[^reinke2022] These cases are compatible with the extensions of Hamilton's theory for growth after maturity and for how mutations act, but not with his conclusion that senescence is inevitable.[^vaupel2004][^baudisch2008]

## Relationship to other theories

- **Antagonistic pleiotropy.** Shares the declining force of selection. It differs in proposing that the late-acting alleles are favoured for their early effects rather than merely tolerated, and so predicts negative genetic correlations between early and late fitness; both theories can make additive genetic variance rise with age.[^charlesworthhughes1996][^mooradpromislow2009] (See [[antagonistic-pleiotropy-theory]].)
- **Disposable soma.** A physiological version of antagonistic pleiotropy: limited resources are divided between reproduction and maintenance of the body. (See [[disposable-soma-theory]].)
- **Mortality rate models.** In the simplest mutation-accumulation model the declining force of selection predicts an exponential rise in mortality,[^charlesworth2001] but this prediction does not survive once the effects of mutations are allowed to interact.[^wachter2013] (See [[Mortality rate models]].)
- **Tumour suppression.** Some age-related decline may be the cost of anti-cancer mechanisms that remain beneficial at all ages, a constraint rather than an effect of the shadow. (See [[tumor-suppressor-theory-of-aging]].)

## History

### Before the formal theory

Weismann's proposal of the early 1880s that ageing is an adaptation for removing worn-out individuals was the first evolutionary account of senescence.[^williams1957] Fisher's reproductive value, defined in 1930, supplied the quantity on which the later theory rests,[^fisher1930] and Haldane's 1941 discussion of the age of onset of Huntington's chorea applied a similar argument to a particular disease.[^haldane1941] Medawar's essay of 1946 and lecture of 1951 stated the general argument and the theory of mutation accumulation,[^medawar1946][^medawar1952] Medawar also sketched antagonistic pleiotropy, which Williams developed in 1957, with a list of testable predictions that included the effect of adult mortality.[^williams1957]

### Hamilton and the experiments

Hamilton's 1966 paper turned the verbal argument into the age-specific force of selection.[^hamilton1966] From the late 1980s, experiments in *Drosophila* tested mutation accumulation against antagonistic pleiotropy: selection on age at reproduction, measurements of how genetic variation changes with age, and lines in which spontaneous mutations were allowed to accumulate. They found evidence for both mechanisms and showed that the tests are harder to interpret than first thought.[^mueller1987][^hughescharlesworth1994][^promislow1996][^pletcher1998][^mooradpromislow2009]

### Revisions

From 1993, Abrams and Caswell showed that the effect of extrinsic mortality depends on density dependence.[^abrams1993][^caswell2007] Lee added transfers between generations to the force of selection in 2003,[^lee2003] and Vaupel and Baudisch argued in 2004 and 2008 that senescence is not inevitable.[^vaupel2004][^baudisch2008] In 2013 and 2014, reviews documented senescence across wild animals and the absence of senescence in species from several branches of the tree of life.[^nussey2013][^jones2014]

## Data and figures

Figure 1 is computed from the formulas in the note beneath it and uses no data. Figure 2 uses the force of selection for American women in 2023, computed for the [[antagonistic-pleiotropy-theory|antagonistic pleiotropy article]] from the Social Security Administration's 2023 period life table and the National Center for Health Statistics' final 2023 birth rates, together with the observed mortality rates from the same life table. The predicted excess mortality is $2U/s(x)$ for each age up to 49, the last age with births in the data; the numbers quoted in the text use the slider's default, $U = 10^{-5}$. At $U = 10^{-3.5}$ the predicted excess would exceed total observed mortality at every age from 10 onwards.

[^hamilton1966]: Hamilton WD (1966). "The moulding of senescence by natural selection". *Journal of Theoretical Biology*. 12 (1): 12–45. [doi:10.1016/0022-5193(66)90184-6](https://doi.org/10.1016/0022-5193(66)90184-6)

[^charlesworth2000]: Charlesworth B (2000). "Fisher, Medawar, Hamilton and the evolution of aging". *Genetics*. 156 (3): 927–931. [doi:10.1093/genetics/156.3.927](https://doi.org/10.1093/genetics/156.3.927)

[^fisher1930]: Fisher RA (1930). *The Genetical Theory of Natural Selection*. Oxford: Clarendon Press.

[^haldane1941]: Haldane JBS (1941). *New Paths in Genetics*. London: George Allen & Unwin. [Digitised copy](https://wellcomecollection.org/works/emdccyzd)

[^medawar1946]: Medawar PB (1946). "Old age and natural death". *Modern Quarterly*. 1: 30–56. Reprinted in Medawar PB (1957), *The Uniqueness of the Individual*. London: Methuen.

[^medawar1952]: Medawar PB (1952). *An Unsolved Problem of Biology*. London: H. K. Lewis. Reprinted in Medawar PB (1957), *The Uniqueness of the Individual*. London: Methuen.


[^williams1957]: Williams GC (1957). "Pleiotropy, natural selection, and the evolution of senescence". *Evolution*. 11 (4): 398–411. [doi:10.1111/j.1558-5646.1957.tb02911.x](https://doi.org/10.1111/j.1558-5646.1957.tb02911.x)

[^baudisch2005]: Baudisch A (2005). "Hamilton's indicators of the force of selection". *PNAS*. 102 (23): 8263–8268. [doi:10.1073/pnas.0502155102](https://doi.org/10.1073/pnas.0502155102)

[^baudisch2008]: Baudisch A (2008). *Inevitable Aging? Contributions to Evolutionary-Demographic Theory*. Demographic Research Monographs. Berlin: Springer. [doi:10.1007/978-3-540-76656-8](https://doi.org/10.1007/978-3-540-76656-8)

[^vaupel2004]: Vaupel JW, Baudisch A, Dölling M, Roach DA, Gampe J (2004). "The case for negative senescence". *Theoretical Population Biology*. 65 (4): 339–351. [doi:10.1016/j.tpb.2003.12.003](https://doi.org/10.1016/j.tpb.2003.12.003)

[^lee2003]: Lee RD (2003). "Rethinking the evolutionary theory of aging: transfers, not births, shape senescence in social species". *PNAS*. 100 (16): 9637–9642. [doi:10.1073/pnas.1530303100](https://doi.org/10.1073/pnas.1530303100)

[^hawkes1998]: Hawkes K, O'Connell JF, Blurton Jones NG, Alvarez H, Charnov EL (1998). "Grandmothering, menopause, and the evolution of human life histories". *PNAS*. 95 (3): 1336–1339. [doi:10.1073/pnas.95.3.1336](https://doi.org/10.1073/pnas.95.3.1336)

[^wachter2013]: Wachter KW, Evans SN, Steinsaltz D (2013). "The age-specific force of natural selection and biodemographic walls of death". *PNAS*. 110 (25): 10141–10146. [doi:10.1073/pnas.1306656110](https://doi.org/10.1073/pnas.1306656110)

[^wachter2014]: Wachter KW, Steinsaltz D, Evans SN (2014). "Evolutionary shaping of demographic schedules". *PNAS*. 111 (Suppl 3): 10846–10853. [doi:10.1073/pnas.1400841111](https://doi.org/10.1073/pnas.1400841111)

[^charlesworth2001]: Charlesworth B (2001). "Patterns of age-specific means and genetic variances of mortality rates predicted by the mutation-accumulation theory of ageing". *Journal of Theoretical Biology*. 210 (1): 47–65. [doi:10.1006/jtbi.2001.2296](https://doi.org/10.1006/jtbi.2001.2296)

[^charlesworthhughes1996]: Charlesworth B, Hughes KA (1996). "Age-specific inbreeding depression and components of genetic variance in relation to the evolution of senescence". *PNAS*. 93 (12): 6140–6145. [doi:10.1073/pnas.93.12.6140](https://doi.org/10.1073/pnas.93.12.6140)

[^hughescharlesworth1994]: Hughes KA, Charlesworth B (1994). "A genetic analysis of senescence in *Drosophila*". *Nature*. 367: 64–66. [doi:10.1038/367064a0](https://doi.org/10.1038/367064a0)

[^hughes2002]: Hughes KA, Alipaz JA, Drnevich JM, Reynolds RM (2002). "A test of evolutionary theories of aging". *PNAS*. 99 (22): 14286–14291. [doi:10.1073/pnas.222326199](https://doi.org/10.1073/pnas.222326199)

[^promislow1996]: Promislow DEL, Tatar M, Khazaeli AA, Curtsinger JW (1996). "Age-specific patterns of genetic variance in *Drosophila melanogaster*. I. Mortality". *Genetics*. 143 (2): 839–848. [doi:10.1093/genetics/143.2.839](https://doi.org/10.1093/genetics/143.2.839)

[^mooradpromislow2009]: Moorad JA, Promislow DEL (2009). "What can genetic variation tell us about the evolution of senescence?". *Proceedings of the Royal Society B*. 276 (1665): 2271–2278. [doi:10.1098/rspb.2009.0183](https://doi.org/10.1098/rspb.2009.0183)

[^pletcher1998]: Pletcher SD, Houle D, Curtsinger JW (1998). "Age-specific properties of spontaneous mutations affecting mortality in *Drosophila melanogaster*". *Genetics*. 148 (1): 287–303. [doi:10.1093/genetics/148.1.287](https://doi.org/10.1093/genetics/148.1.287)

[^pletcher1999]: Pletcher SD, Houle D, Curtsinger JW (1999). "The evolution of age-specific mortality rates in *Drosophila melanogaster*: genetic divergence among unselected lines". *Genetics*. 153 (2): 813–823. [doi:10.1093/genetics/153.2.813](https://doi.org/10.1093/genetics/153.2.813)

[^mueller1987]: Mueller LD (1987). "Evolution of accelerated senescence in laboratory populations of *Drosophila*". *PNAS*. 84 (7): 1974–1977. [doi:10.1073/pnas.84.7.1974](https://doi.org/10.1073/pnas.84.7.1974)

[^borash2007]: Borash DJ, Rose MR, Mueller LD (2007). "Mutation accumulation affects male virility in *Drosophila* selected for later reproduction". *Physiological and Biochemical Zoology*. 80 (5): 461–472. [doi:10.1086/520127](https://doi.org/10.1086/520127)

[^rodriguez2017]: Rodríguez JA, Marigorta UM, Hughes DA, Spataro N, Bosch E, Navarro A (2017). "Antagonistic pleiotropy and mutation accumulation influence human senescence and disease". *Nature Ecology & Evolution*. 1: 0055. [doi:10.1038/s41559-016-0055](https://doi.org/10.1038/s41559-016-0055)

[^longzhang2019]: Long E, Zhang J (2019). "Retesting the influences of mutation accumulation and antagonistic pleiotropy on human senescence and disease". *Nature Ecology & Evolution*. 3 (7): 992–993. [doi:10.1038/s41559-019-0925-z](https://doi.org/10.1038/s41559-019-0925-z)

[^muellerrose1996]: Mueller LD, Rose MR (1996). "Evolutionary theory predicts late-life mortality plateaus". *PNAS*. 93 (26): 15249–15253. [doi:10.1073/pnas.93.26.15249](https://doi.org/10.1073/pnas.93.26.15249)

[^nussey2013]: Nussey DH, Froy H, Lemaître J-F, Gaillard J-M, Austad SN (2013). "Senescence in natural populations of animals: widespread evidence and its implications for bio-gerontology". *Ageing Research Reviews*. 12 (1): 214–225. [doi:10.1016/j.arr.2012.07.004](https://doi.org/10.1016/j.arr.2012.07.004)

[^abrams1993]: Abrams PA (1993). "Does increased mortality favor the evolution of more rapid senescence?". *Evolution*. 47 (3): 877–887. [doi:10.2307/2410191](https://doi.org/10.2307/2410191)

[^caswell2007]: Caswell H (2007). "Extrinsic mortality and the evolution of senescence". *Trends in Ecology & Evolution*. 22 (4): 173–174. [doi:10.1016/j.tree.2007.01.006](https://doi.org/10.1016/j.tree.2007.01.006)

[^moorad2019]: Moorad J, Promislow D, Silvertown J (2019). "Evolutionary ecology of senescence and a reassessment of Williams' 'extrinsic mortality' hypothesis". *Trends in Ecology & Evolution*. 34 (6): 519–530. [doi:10.1016/j.tree.2019.02.006](https://doi.org/10.1016/j.tree.2019.02.006)

[^dayabrams2020]: Day T, Abrams PA (2020). "Density dependence, senescence, and Williams' hypothesis". *Trends in Ecology & Evolution*. 35 (4): 300–302. [doi:10.1016/j.tree.2019.11.005](https://doi.org/10.1016/j.tree.2019.11.005)

[^andrerousset2020]: André J-B, Rousset F (2020). "Does extrinsic mortality accelerate the pace of life? A bare-bones approach". *Evolution and Human Behavior*. 41 (6): 486–492. [doi:10.1016/j.evolhumbehav.2020.03.002](https://doi.org/10.1016/j.evolhumbehav.2020.03.002)

[^austadfischer1991]: Austad SN, Fischer KE (1991). "Mammalian aging, metabolism, and ecology: evidence from the bats and marsupials". *Journal of Gerontology*. 46 (2): B47–B53. [doi:10.1093/geronj/46.2.b47](https://doi.org/10.1093/geronj/46.2.b47)

[^healy2014]: Healy K, Guillerme T, Finlay S, Kane A, Kelly SBA, et al. (2014). "Ecology and mode-of-life explain lifespan variation in birds and mammals". *Proceedings of the Royal Society B*. 281 (1784): 20140298. [doi:10.1098/rspb.2014.0298](https://doi.org/10.1098/rspb.2014.0298)

[^shattuck2010]: Shattuck MR, Williams SA (2010). "Arboreality has allowed for the evolution of increased longevity in mammals". *PNAS*. 107 (10): 4635–4639. [doi:10.1073/pnas.0911439107](https://doi.org/10.1073/pnas.0911439107)

[^kellergenoud1997]: Keller L, Genoud M (1997). "Extraordinary lifespans in ants: a test of evolutionary theories of ageing". *Nature*. 389: 958–960. [doi:10.1038/40130](https://doi.org/10.1038/40130)

[^austad1993]: Austad SN (1993). "Retarded senescence in an insular population of Virginia opossums (*Didelphis virginiana*)". *Journal of Zoology*. 229: 695–708. [doi:10.1111/j.1469-7998.1993.tb02665.x](https://doi.org/10.1111/j.1469-7998.1993.tb02665.x)

[^ricklefs1998]: Ricklefs RE (1998). "Evolutionary theories of aging: confirmation of a fundamental prediction, with implications for the genetic basis and evolution of life span". *The American Naturalist*. 152 (1): 24–44. [doi:10.1086/286147](https://doi.org/10.1086/286147)

[^stearns2000]: Stearns SC, Ackermann M, Doebeli M, Kaiser M (2000). "Experimental evolution of aging, growth, and reproduction in fruitflies". *PNAS*. 97 (7): 3309–3313. [doi:10.1073/pnas.97.7.3309](https://doi.org/10.1073/pnas.97.7.3309)

[^miller2002]: Miller RA, Harper JM, Dysko RC, Durkee SJ, Austad SN (2002). "Longer life spans and delayed maturation in wild-derived mice". *Experimental Biology and Medicine*. 227 (7): 500–508. [doi:10.1177/153537020222700715](https://doi.org/10.1177/153537020222700715)

[^jones2014]: Jones OR, Scheuerlein A, Salguero-Gómez R, Camarda CG, Schaible R, et al. (2014). "Diversity of ageing across the tree of life". *Nature*. 505 (7482): 169–173. [doi:10.1038/nature12789](https://doi.org/10.1038/nature12789)

[^ruby2018]: Ruby JG, Smith M, Buffenstein R (2018). "Naked mole-rat mortality rates defy Gompertzian laws by not increasing with age". *eLife*. 7: e31157. [doi:10.7554/eLife.31157](https://doi.org/10.7554/eLife.31157)

[^devries2023]: de Vries C, Galipaud M, Kokko H (2023). "Extrinsic mortality and senescence: a guide for the perplexed". *Peer Community Journal*. 3: e29. [doi:10.24072/pcjournal.253](https://doi.org/10.24072/pcjournal.253)

[^williamsday2003]: Williams PD, Day T (2003). "Antagonistic pleiotropy, mortality source interactions, and the evolutionary theory of senescence". *Evolution*. 57 (7): 1478–1488. [doi:10.1111/j.0014-3820.2003.tb00356.x](https://doi.org/10.1111/j.0014-3820.2003.tb00356.x)

[^wensink2017]: Wensink MJ, Caswell H, Baudisch A (2017). "The rarity of survival to old age does not drive the evolution of senescence". *Evolutionary Biology*. 44 (1): 5–10. [doi:10.1007/s11692-016-9385-4](https://doi.org/10.1007/s11692-016-9385-4)

[^reznick2004]: Reznick DN, Bryant MJ, Roff D, Ghalambor CK, Ghalambor DE (2004). "Effect of extrinsic mortality on the evolution of senescence in guppies". *Nature*. 431 (7012): 1095–1099. [doi:10.1038/nature02936](https://doi.org/10.1038/nature02936)

[^chenmaklakov2012]: Chen HY, Maklakov AA (2012). "Longer life span evolves under high rates of condition-dependent mortality". *Current Biology*. 22 (22): 2140–2143. [doi:10.1016/j.cub.2012.09.021](https://doi.org/10.1016/j.cub.2012.09.021)

[^shaw1999]: Shaw FH, Promislow DEL, Tatar M, Hughes KA, Geyer CJ (1999). "Toward reconciling inferences concerning genetic variation in senescence in *Drosophila melanogaster*". *Genetics*. 152 (2): 553–566. [doi:10.1093/genetics/152.2.553](https://doi.org/10.1093/genetics/152.2.553)

[^pletchercurtsinger1998]: Pletcher SD, Curtsinger JW (1998). "Mortality plateaus and the evolution of senescence: why are old-age mortality rates so low?". *Evolution*. 52 (2): 454–464. [doi:10.1111/j.1558-5646.1998.tb01645.x](https://doi.org/10.1111/j.1558-5646.1998.tb01645.x)

[^dammann2019]: Dammann P, Scherag A, Zak N, Szafranski K, Holtze S, et al. (2019). "Comment on 'Naked mole-rat mortality rates defy Gompertzian laws by not increasing with age'". *eLife*. 8: e45415. [doi:10.7554/eLife.45415](https://doi.org/10.7554/eLife.45415)

[^ruby2024]: Ruby JG, Smith M, Buffenstein R (2024). "Five years later, with double the demographic data, naked mole-rat mortality rates continue to defy Gompertzian laws by not increasing with age". *GeroScience*. 46 (5): 5321–5341. [doi:10.1007/s11357-024-01201-4](https://doi.org/10.1007/s11357-024-01201-4)

[^dasilva2022]: da Silva R, Conde DA, Baudisch A, Colchero F (2022). "Slow and negligible senescence among testudines challenges evolutionary theories of senescence". *Science*. 376 (6600): 1466–1470. [doi:10.1126/science.abl7811](https://doi.org/10.1126/science.abl7811)

[^reinke2022]: Reinke BA, Cayuela H, Janzen FJ, Lemaître J-F, Gaillard J-M, et al. (2022). "Diverse aging rates in ectothermic tetrapods provide insights for the evolution of aging and longevity". *Science*. 376 (6600): 1459–1466. [doi:10.1126/science.abm0151](https://doi.org/10.1126/science.abm0151)
