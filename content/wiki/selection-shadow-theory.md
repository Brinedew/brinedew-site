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

The **selection shadow** is the range of ages at which natural selection acts only weakly on survival and reproduction, because little of an individual's expected reproduction still lies ahead. The idea goes back to J. B. S. Haldane and Peter Medawar in the 1940s, building on R. A. Fisher's concept of reproductive value,[^charlesworth2000] and was given its mathematical form by [[wd-hamilton|W. D. Hamilton]] in 1966.[^hamilton1966] Its main consequence is **mutation accumulation**: alleles whose harmful effects appear only late in life are opposed so weakly that mutation keeps them in the population at much higher frequencies than alleles acting early. Together with [[antagonistic-pleiotropy-theory|antagonistic pleiotropy]], in which selection actively favours alleles with early benefits and late costs, the declining force of selection is the basis of the evolutionary theory of ageing.

The shadow arises even in a population whose members never age. If every individual has the same chance of dying each year, from predators, accidents or disease, fewer survive to each successive age, and a gene acting at a late age affects fewer carriers, with less of their reproduction remaining. Medawar made this point with a population of test tubes broken at random.[^medawar1952] Hamilton showed that the force of selection on survival is constant until the age of first reproduction and falls from there to zero at the last.[^hamilton1966]

The theory explains why organisms that reproduce early in life are not built to last indefinitely. It explains less than is often claimed. How deep the shadow is depends on the life history, which itself evolves. In a population that is free to grow or shrink, mortality that falls equally on all ages leaves the shadow unchanged.[^abrams1993][^caswell2007] Senescence is common in wild animals, contrary to the premise that few live long enough to show it.[^nussey2013] And not all species senesce: in some, mortality is flat or falls with age.[^jones2014]

## Terminology

- The **force of selection** at age $x$ is how much a small change in survival or fecundity at that age changes fitness. Hamilton measured it as the change in the population growth rate $r$.[^hamilton1966] For survival it is proportional to the share of expected lifetime reproduction that is still ahead at $x$; for fecundity, to the probability of surviving to $x$, discounted by population growth.
- The **selection shadow** is the range of ages over which the force of selection is small. The term is now standard in reviews; its first use is not well documented.
- **Mutation accumulation** is the theory that ageing results, at least in part, from deleterious alleles with late-acting effects that persist at mutation–selection balance because selection against them is weak.[^charlesworth2000]
- **Antagonistic pleiotropy** is the theory that ageing results, at least in part, from alleles that selection favours for their early benefits despite their late costs.[^williams1957] It relies on the same declining force of selection but on a different genetic mechanism. (See [[antagonistic-pleiotropy-theory]].)
- **Extrinsic mortality** is mortality from causes that would kill an individual regardless of its condition, such as predation or accidents. The distinction from intrinsic mortality is a simplification: frailer individuals are also more likely to be caught by predators.

## Medawar's argument

### Background

August Weismann proposed in 1891 that natural selection had designed a mechanism to remove old individuals for the good of the species. George C. Williams later summarised the main objections: individuals old enough to die by such a mechanism are extremely rare in nature, decades of research had found no such mechanism, and it was hard to see how selection on individuals could produce one.[^williams1957]

R. A. Fisher introduced **reproductive value** in 1930: the expected future reproduction of an individual of a given age, discounted by the growth rate of the population. Reproductive value declines after the ages of peak reproduction.[^fisher1930][^charlesworth2000] In 1941 J. B. S. Haldane used the same idea to explain why Huntington's disease, caused by a dominant allele that is invariably fatal, is not rarer than it is: its symptoms usually begin after most reproduction is complete, so selection against it is weak.[^haldane1941]

### Old age and natural death

Medawar developed the argument in an essay in 1946 and in his inaugural lecture at University College London in December 1951, published as *An Unsolved Problem of Biology* in 1952.[^medawar1946][^medawar1952] His central illustration was a stock of test tubes, broken at random at a constant rate and replaced as they break. The tubes do not become more fragile with age, yet old tubes are rare, because an old tube has had to escape breakage many times. In any population exposed to hazards, therefore, the force of natural selection weakens with increasing age, even if its members do not deteriorate.

From this Medawar drew two consequences. A mutation whose harmful effect appears late enough in life is almost invisible to selection, so such mutations accumulate. And selection should favour modifier alleles that postpone the onset of harmful gene effects to later ages, where they matter less.[^rosecharlesworth1980] Both treat ageing as a by-product of selection on younger individuals, not as an adaptation.

Figure 1 is a version of Medawar's population. Every individual faces the same risk of death $h$ each year, matures at age $\alpha$, and then reproduces at a constant rate. Nobody ages. The force of selection on survival is nevertheless constant up to maturity and falls exponentially after it.

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

The switch below the chart shows a result that the verbal argument misses. If the population is kept constant by births falling as deaths rise, a higher risk of death steepens the decline: the shadow deepens. If the population is instead free to grow or shrink, the risk of death cancels out. A higher $h$ makes the population shrink faster, and the shrinkage exactly offsets the loss of old individuals, so the age structure and the force of selection do not change. Peter Abrams and Hal Caswell showed that this holds in general: mortality that falls equally on all ages changes selection on ageing only through the way the population is regulated.[^abrams1993][^caswell2007] (See [The extrinsic-mortality prediction](#the-extrinsic-mortality-prediction).)

> [!note]- Formal definitions
> With constant mortality $h$, survival is $l(x) = e^{-hx}$. With fecundity $m$ from age $\alpha$ onwards, the Euler–Lotka equation for the growth rate $r$ is
>
> $$
> \int_\alpha^\infty e^{-rx}\,e^{-hx}\,m\,\mathrm{d}x = \frac{m\,e^{-(r+h)\alpha}}{r + h} = 1.
> $$
>
> Hamilton's force of selection on survival at age $x$ is proportional to $s(x) = \int_x^\infty e^{-ry}\,l(y)\,m(y)\,\mathrm{d}y$, the discounted reproduction still ahead.[^hamilton1966] Here $s(x) = 1$ for $x \le \alpha$ and $s(x) = e^{-(r+h)(x - \alpha)}$ after maturity, so it halves every $\ln 2/(r+h)$ years.
>
> Only the sum $r + h$ appears. If fecundity $m$ is fixed, the Euler–Lotka equation fixes $r + h$, and any change in $h$ is absorbed by $r$. If density dependence instead lowers $m$ until $r = 0$, then $r + h = h$, and the decline steepens with $h$. Figure 1 uses $h = 0.1$ a year to fix $m$ in the first case.

## Hamilton's formalisation

Hamilton asked how the population growth rate $r$ responds to a small change in survival or fecundity at one age, and called the answers indicators of the force of selection.[^hamilton1966] The indicator for survival at age $x$ is the discounted reproduction still expected after $x$, divided by the generation time; the indicator for fecundity is the discounted probability of surviving to $x$. The survival indicator is constant from birth to maturity, declines through the reproductive years and reaches zero at the last age of reproduction; the fecundity indicator falls with survivorship at all ages. Hamilton concluded that senescence is inevitable for any organism whose force of selection declines in this way.[^baudisch2005] The [[antagonistic-pleiotropy-theory#the-force-of-selection|antagonistic pleiotropy article]] computes the indicator from the 2023 American life table and birth rates.

Later work has qualified each part of the conclusion.

- **Parameterisation.** Hamilton measured changes in the logarithm of survival. Annette Baudisch showed that "alternative parameterizations of mutational effects lead to indicators that can increase with age"; if a mutation multiplies the mortality rate by a constant factor, the indicator is multiplied by the mortality rate itself.[^baudisch2005]
- **Growth.** In species that keep growing after maturity, fecundity rises with age. James Vaupel and colleagues showed that **negative senescence**, mortality that falls with age after maturity, is then theoretically possible, and argued that it may be widespread in species with [[Indeterminate growth|indeterminate growth]].[^vaupel2004] Baudisch developed the argument into a general critique of the inevitability of senescence.[^baudisch2008]
- **Transfers.** In social species, old individuals contribute to the survival and reproduction of their kin. Ronald Lee showed that the force of selection on mortality is then a weighted average of remaining fertility and remaining transfers to the young, which explains survival after the end of reproduction.[^lee2003] Kristen Hawkes and colleagues proposed that grandmothers' provisioning of their grandchildren selected for the long human post-reproductive lifespan.[^hawkes1998]
- **Linearity.** Hamilton's indicators describe the effect of one small change at a time. In a nonlinear model of mutation accumulation, Kenneth Wachter, Steven Evans and David Steinsaltz found that interactions between mutations cause "the collapse of Hamilton-style predictions in the most commonly studied case".[^wachter2013][^wachter2014]

## Mutation accumulation

### Mutation–selection balance

New deleterious mutations arise continually and are removed by selection at a rate proportional to the harm they do to fitness. At equilibrium the frequency of each deleterious allele is roughly the mutation rate divided by the strength of selection against it. For an allele that raises the mortality rate at one age, the strength of selection is proportional to the force of selection at that age. The weaker the force, the higher the equilibrium frequency, and the more mortality the population carries at that age. The excess mortality maintained at age $x$ is inversely proportional to the force of selection there, and independent of how harmful each allele is: an allele with a larger effect is held at a proportionally lower frequency.

Figure 2 applies this to the force of selection of American women in 2023. Where the force is near its maximum, before about 25, the predicted excess is flat. It is more than two hundred times higher at 45 and has no finite value after 49, the last age of reproduction in the data. Hamilton's model therefore predicts a "wall of death" at the end of reproduction.[^wachter2013] Human mortality shows no such wall, which is one reason why transfers to kin, and not only reproduction, must enter the calculation.[^lee2003]

```vega-lite
{
  "$schema": "https://vega.github.io/schema/vega-lite/v6.json",
  "description": "Figure 2. The excess mortality that mutation accumulation alone would maintain at each age at mutation–selection balance, 2U/s(x), if the force of selection s(x) were that of American women in 2023. U is the rate at which new mutations that raise the mortality rate at one year of age arise per genome per generation; its value is not known, and the slider moves the curve up or down without changing its shape. Grey points are the observed mortality rates, for comparison. The predicted excess rises far faster than the observed rate and has no finite value after the last age of reproduction.",
  "params": [
    {
      "name": "logU",
      "value": -3.5,
      "bind": {
        "input": "range",
        "min": -5,
        "max": -2,
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
            "y": 0.0003,
            "label": "no births"
          },
          {
            "age": 50.3,
            "y": 0.00013,
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
          0.0001,
          10
        ],
        "nice": false
      },
      "axis": {
        "title": "Mortality rate, per year",
        "values": [
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
> Let a mutation raise the mortality rate by $\delta$ for one year at age $x$, with dominance $d$, and arise at rate $u$ per generation. By Hamilton's sensitivity, carriers' growth rate is lower by $d\,\delta\,s(x)/T$ a year, where $T$ is the generation time; new copies arise at $u/T$ a year. Mutation and selection balance when the allele's frequency is
>
> $$
> q \approx \frac{u}{d\,\delta\,s(x)}.
> $$
>
> Almost all copies are in heterozygotes, so the excess mortality at age $x$ is $2q\,d\,\delta = 2u/s(x)$, independent of $\delta$ and $d$. Summed over all loci with effects at age $x$, the excess is $2U/s(x)$, where $U$ is the genomic mutation rate to such alleles. This assumes selection much stronger than mutation and no interactions between loci.[^charlesworth2001][^wachter2013]

### Predictions and tests

Mutation accumulation makes predictions about genetic variation that antagonistic pleiotropy does not. Because late-acting alleles are maintained at higher frequencies, genetic variance in mortality and fecundity, and the harm done by inbreeding, should increase with age.[^charlesworthhughes1996] Mutations with effects at late ages must also exist, and their effects must be at least partly confined to those ages.

- **Inbreeding and genetic variance.** Kimberly Hughes and Brian Charlesworth found that genetic variance in the mortality of male *Drosophila melanogaster* "increases greatly at very late ages, as predicted by the mutation accumulation hypothesis".[^hughescharlesworth1994] Hughes and colleagues later found that inbreeding depression and genetic variance in age-specific reproductive success rose sharply with age, and described their results as the strongest support yet for the mutation theory.[^hughes2002] In a larger study of 65,134 flies, Daniel Promislow and colleagues found that additive genetic variance in female mortality rose from 0.007 in the first week of life to 0.325 by the third, then fell to 0.002 by the seventh, against the prediction.[^promislow1996]
- **What the tests can tell apart.** Jacob Moorad and Promislow argued that antagonistic pleiotropy can also make inbreeding depression and dominance variance rise with age, so that these variance tests are likely to be "too conservative to be of strong diagnostic use".[^mooradpromislow2009]
- **New mutations.** Scott Pletcher, David Houle and James Curtsinger measured the effects of spontaneous mutations accumulated over 19 generations. Mutations raised mortality significantly in early life, up to about 30 days, but their variance at older ages did not differ from zero. Effects at nearby ages were positively correlated, while effects early in life were essentially uncorrelated with effects late.[^pletcher1998] After 47 generations the correlations between ages tended to increase, with "little age-specific mutational bias".[^pletcher1999] New mutations can have age-specific effects, but late-acting ones were not detected.
- **Selection experiments.** In populations of *Drosophila* bred only at young ages for more than 120 generations, Laurence Mueller found that late fecundity fell by 47–83% relative to populations allowed to breed throughout life, with no difference in the first week.[^mueller1987] Daniel Borash, Michael Rose and Mueller found that crosses between replicate short-lived populations improved male reproductive performance at later ages relative to their parents, and concluded that mutation accumulation "has been at least partly responsible" for its decline.[^borash2007]
- **Humans.** J. A. Rodríguez and colleagues reported that risk alleles for late-onset diseases have higher frequencies and larger effects than those for early-onset diseases, as mutation accumulation predicts.[^rodriguez2017] Erping Long and Jianzhi Zhang's reanalysis found the result not robust, and pointed out that the test assumes a mutation–selection balance that recent demographic change may have disturbed.[^longzhang2019]

### Late-life plateaus

Hamilton's model predicts that mortality should rise ever faster towards the end of reproduction. Large insect cohorts instead show mortality rates that level off at old ages. (See [[Mortality rate models#late-life-deceleration-and-the-plateau-debate|Mortality rate models]].) Mueller and Rose argued that the evolutionary theory predicts such plateaus once enough late-life data are collected.[^muellerrose1996] Charlesworth showed that a mutation-accumulation model in which alleles act over more than one age class predicts late-life plateaus.[^charlesworth2001] Wachter and colleagues showed that whether a model produces plateaus or walls of death depends on how the effects of mutations interact.[^wachter2013][^wachter2014]

## Limitations and misreadings

### Ageing in the wild

The verbal argument is often given as: wild animals rarely live long enough to grow old, so selection never sees old age. The premise is false. Daniel Nussey and colleagues reviewed 340 studies documenting senescence in 175 wild animal species, mostly birds and mammals but including other vertebrates and insects.[^nussey2013] The formal theory does not need it either. The force of selection declines from the age of maturity, not from the age at which most individuals die. Senescence beginning within the ages that wild animals commonly reach is what the theory predicts.

### The extrinsic-mortality prediction

Williams predicted in 1957 that populations with higher adult mortality should evolve faster senescence.[^williams1957] This is the most widely repeated application of the selection shadow, and the least secure. In a population that is not density-regulated, mortality that falls equally on all ages does not change selection on ageing, because the population's decline offsets it, as in Figure 1.[^caswell2007] With density dependence, the outcome depends on which ages and which vital rates the regulation acts on. Higher mortality can speed senescence, slow it, or have mixed effects. Williams's prediction is most likely when density dependence acts mainly on fertility and does not reduce the fertility of older individuals more than that of younger ones.[^abrams1993]

The debate is unresolved. Jacob Moorad, Promislow and Jonathan Silvertown called the hypothesis wrong as a general statement.[^moorad2019] Troy Day and Abrams replied that density dependence can make age-independent mortality speed up senescence.[^dayabrams2020] Jean-Baptiste André and François Rousset argued that the intuition is wrong, but for a different reason than the critics gave.[^andrerousset2020]

### Lifespan evolves

The comparative evidence nonetheless associates safer ways of life with longer lives and slower ageing:

- Bats live on average at least three times as long as non-flying placental mammals of the same body size.[^austadfischer1991]
- Across 1,368 species of birds and mammals, the ability to fly was the most important factor associated with longer lifespan after body mass. Among species that do not fly, lifespan was longer in tree-dwelling and burrowing species.[^healy2014]
- Tree-dwelling mammals live longer than ground-dwelling mammals of the same body size.[^shattuck2010]
- Eusociality is associated with a roughly hundredfold increase in insect lifespan: ant queens live in sheltered, defended colonies.[^kellergenoud1997]
- Virginia opossums on a predator-free island had higher survival and slower acceleration of mortality than mainland opossums.[^austad1993]
- In birds and mammals, the rate of ageing is related to mortality early in adult life, independently of body size and taxonomic group.[^ricklefs1998]
- Fruit flies kept under high adult mortality, at constant density, evolved shorter lives.[^stearns2000]

Mice descended from wild-caught ancestors lived 24% longer on average than a stock derived from laboratory strains in the same conditions, and matured more slowly.[^miller2002] Taken together, these results suggest that how fast a species ages is a property of its whole life history: the age at which it matures, its exposure to hazards, its social structure and its investment in each offspring. The shadow is computed from that life history. It does not set it.

### Ageing is not universal

The theory predicts that senescence must evolve wherever the force of selection declines with age. Owen Jones and colleagues compared mortality and fertility across 46 species of animals and plants, and found mortality that increased, stayed constant, or fell with age after maturity, in both long- and short-lived species.[^jones2014] In more than 3,000 records, the mortality rate of naked mole-rats did not increase with age, even at ages 25 times their age at sexual maturity.[^ruby2018] They are compatible with the extensions of Hamilton's theory for growth and parameterisation, but not with his original conclusion that senescence is inevitable.[^vaupel2004][^baudisch2008]

## Relationship to other theories

- **Antagonistic pleiotropy.** Shares the declining force of selection. It differs in proposing that the late-acting alleles are favoured for their early effects rather than merely tolerated, and so predicts negative genetic correlations between early and late fitness rather than genetic variance that rises with age.[^mooradpromislow2009] (See [[antagonistic-pleiotropy-theory]].)
- **Disposable soma.** A physiological version of antagonistic pleiotropy: limited resources are divided between reproduction and maintenance of the body. (See [[disposable-soma-theory]].)
- **Mortality rate models.** The declining force of selection explains why the mortality rate rises with age, but not its exponential form. (See [[Mortality rate models]].)
- **Tumour suppression.** Some age-related decline may be the cost of anti-cancer mechanisms that stay beneficial at all ages, a constraint rather than an effect of the shadow. (See [[tumor-suppressor-theory-of-aging]].)

## History

- **1891.** Weismann proposes that ageing is an adaptation that removes worn-out individuals.[^williams1957]
- **1930.** Fisher defines reproductive value, which declines after the age of peak reproduction.[^fisher1930]
- **1941.** Haldane explains the persistence of Huntington's disease by its late onset.[^haldane1941]
- **1946–1952.** Medawar argues that the force of selection declines with age even in a population that does not age, and that late-acting deleterious mutations accumulate.[^medawar1946][^medawar1952]
- **1957.** Williams proposes antagonistic pleiotropy and predicts that higher adult mortality selects for faster senescence.[^williams1957]
- **1966.** Hamilton derives the age-specific force of selection.[^hamilton1966]
- **1987–1998.** Selection experiments and quantitative-genetic studies in *Drosophila* test mutation accumulation, with mixed results.[^mueller1987][^hughescharlesworth1994][^promislow1996][^pletcher1998]
- **1993–2007.** Abrams and Caswell show that the effect of extrinsic mortality depends on density dependence.[^abrams1993][^caswell2007]
- **2003–2008.** Lee adds intergenerational transfers to the force of selection; Vaupel and Baudisch argue that senescence is not inevitable.[^lee2003][^vaupel2004][^baudisch2008]
- **2013–2014.** Nussey and colleagues document senescence across wild animals; Jones and colleagues document species that do not senesce.[^nussey2013][^jones2014]

## Data and figures

Figure 1 is computed from the formulas in the note above; it uses no data. Figure 2 uses the force of selection for American women in 2023, computed for the [[antagonistic-pleiotropy-theory|antagonistic pleiotropy article]] from the Social Security Administration's 2023 period life table and the National Center for Health Statistics' final 2023 birth rates, and the observed mortality rates from the same life table. The predicted excess mortality is $2U/s(x)$ for each age up to 49, the last age with births in the data.

[^hamilton1966]: Hamilton WD (1966). "The moulding of senescence by natural selection". *Journal of Theoretical Biology*. 12 (1): 12–45. [doi:10.1016/0022-5193(66)90184-6](https://doi.org/10.1016/0022-5193(66)90184-6)

[^charlesworth2000]: Charlesworth B (2000). "Fisher, Medawar, Hamilton and the evolution of aging". *Genetics*. 156 (3): 927–931. [doi:10.1093/genetics/156.3.927](https://doi.org/10.1093/genetics/156.3.927)

[^fisher1930]: Fisher RA (1930). *The Genetical Theory of Natural Selection*. Oxford: Clarendon Press.

[^haldane1941]: Haldane JBS (1941). *New Paths in Genetics*. London: George Allen & Unwin. [Digitised copy](https://wellcomecollection.org/works/emdccyzd)

[^medawar1946]: Medawar PB (1946). "Old age and natural death". *Modern Quarterly*. 1: 30–56. Reprinted in Medawar PB (1957), *The Uniqueness of the Individual*. London: Methuen.

[^medawar1952]: Medawar PB (1952). *An Unsolved Problem of Biology*. London: H. K. Lewis. Reprinted in Medawar PB (1957), *The Uniqueness of the Individual*. London: Methuen.

[^rosecharlesworth1980]: Rose MR, Charlesworth B (1980). "A test of evolutionary theories of senescence". *Nature*. 287: 141–142.

[^williams1957]: Williams GC (1957). "Pleiotropy, natural selection, and the evolution of senescence". *Evolution*. 11 (4): 398–411. [doi:10.1111/j.1558-5646.1957.tb02911.x](https://doi.org/10.1111/j.1558-5646.1957.tb02911.x)

[^baudisch2005]: Baudisch A (2005). "Hamilton's indicators of the force of selection". *PNAS*. 102 (23): 8263–8268. [doi:10.1073/pnas.0502155102](https://doi.org/10.1073/pnas.0502155102)

[^baudisch2008]: Baudisch A (2008). *Inevitable Aging? Contributions to Evolutionary-Demographic Theory*. Demographic Research Monographs. Berlin: Springer. [doi:10.1007/978-3-540-76656-8](https://doi.org/10.1007/978-3-540-76656-8)

[^vaupel2004]: Vaupel JW, Baudisch A, Dölling M, Roach DA, Gampe J (2004). "The case for negative senescence". *Theoretical Population Biology*. 65 (4): 339–351.

[^lee2003]: Lee RD (2003). "Rethinking the evolutionary theory of aging: transfers, not births, shape senescence in social species". *PNAS*. 100 (16): 9637–9642. [doi:10.1073/pnas.1530303100](https://doi.org/10.1073/pnas.1530303100)

[^hawkes1998]: Hawkes K, O'Connell JF, Blurton Jones NG, Alvarez H, Charnov EL (1998). "Grandmothering, menopause, and the evolution of human life histories". *PNAS*. 95 (3): 1336–1339.

[^wachter2013]: Wachter KW, Evans SN, Steinsaltz D (2013). "The age-specific force of natural selection and biodemographic walls of death". *PNAS*. 110 (25): 10141–10146. [doi:10.1073/pnas.1306656110](https://doi.org/10.1073/pnas.1306656110)

[^wachter2014]: Wachter KW, Steinsaltz D, Evans SN (2014). "Evolutionary shaping of demographic schedules". *PNAS*. 111 (Suppl 3): 10846–10853.

[^charlesworth2001]: Charlesworth B (2001). "Patterns of age-specific means and genetic variances of mortality rates predicted by the mutation-accumulation theory of ageing". *Journal of Theoretical Biology*. 210 (1): 47–65. [doi:10.1006/jtbi.2001.2296](https://doi.org/10.1006/jtbi.2001.2296)

[^charlesworthhughes1996]: Charlesworth B, Hughes KA (1996). "Age-specific inbreeding depression and components of genetic variance in relation to the evolution of senescence". *PNAS*. 93 (12): 6140–6145. [doi:10.1073/pnas.93.12.6140](https://doi.org/10.1073/pnas.93.12.6140)

[^hughescharlesworth1994]: Hughes KA, Charlesworth B (1994). "A genetic analysis of senescence in *Drosophila*". *Nature*. 367: 64–66. [doi:10.1038/367064a0](https://doi.org/10.1038/367064a0)

[^hughes2002]: Hughes KA, Alipaz JA, Drnevich JM, Reynolds RM (2002). "A test of evolutionary theories of aging". *PNAS*. 99 (22): 14286–14291. [doi:10.1073/pnas.222326199](https://doi.org/10.1073/pnas.222326199)

[^promislow1996]: Promislow DEL, Tatar M, Khazaeli AA, Curtsinger JW (1996). "Age-specific patterns of genetic variance in *Drosophila melanogaster*. I. Mortality". *Genetics*. 143 (2): 839–848. [doi:10.1093/genetics/143.2.839](https://doi.org/10.1093/genetics/143.2.839)

[^mooradpromislow2009]: Moorad JA, Promislow DEL (2009). "What can genetic variation tell us about the evolution of senescence?". *Proceedings of the Royal Society B*. 276 (1665): 2271–2278. [doi:10.1098/rspb.2009.0183](https://doi.org/10.1098/rspb.2009.0183)

[^pletcher1998]: Pletcher SD, Houle D, Curtsinger JW (1998). "Age-specific properties of spontaneous mutations affecting mortality in *Drosophila melanogaster*". *Genetics*. 148 (1): 287–303. [doi:10.1093/genetics/148.1.287](https://doi.org/10.1093/genetics/148.1.287)

[^pletcher1999]: Pletcher SD, Houle D, Curtsinger JW (1999). "The evolution of age-specific mortality rates in *Drosophila melanogaster*: genetic divergence among unselected lines". *Genetics*. 153 (2): 813–823.

[^mueller1987]: Mueller LD (1987). "Evolution of accelerated senescence in laboratory populations of *Drosophila*". *PNAS*. 84 (7): 1974–1977. [doi:10.1073/pnas.84.7.1974](https://doi.org/10.1073/pnas.84.7.1974)

[^borash2007]: Borash DJ, Rose MR, Mueller LD (2007). "Mutation accumulation affects male virility in *Drosophila* selected for later reproduction". *Physiological and Biochemical Zoology*. 80 (5): 461–472. [doi:10.1086/520127](https://doi.org/10.1086/520127)

[^rodriguez2017]: Rodríguez JA, Marigorta UM, Hughes DA, Spataro N, Bosch E, Navarro A (2017). "Antagonistic pleiotropy and mutation accumulation influence human senescence and disease". *Nature Ecology & Evolution*. 1: 0055. [doi:10.1038/s41559-016-0055](https://doi.org/10.1038/s41559-016-0055)

[^longzhang2019]: Long E, Zhang J (2019). "Retesting the influences of mutation accumulation and antagonistic pleiotropy on human senescence and disease". *Nature Ecology & Evolution*. 3. [doi:10.1038/s41559-019-0925-z](https://doi.org/10.1038/s41559-019-0925-z)

[^muellerrose1996]: Mueller LD, Rose MR (1996). "Evolutionary theory predicts late-life mortality plateaus". *PNAS*. 93 (26): 15249–15253.

[^nussey2013]: Nussey DH, Froy H, Lemaître J-F, Gaillard J-M, Austad SN (2013). "Senescence in natural populations of animals: widespread evidence and its implications for bio-gerontology". *Ageing Research Reviews*. 12 (1): 214–225. [doi:10.1016/j.arr.2012.07.004](https://doi.org/10.1016/j.arr.2012.07.004)

[^abrams1993]: Abrams PA (1993). "Does increased mortality favor the evolution of more rapid senescence?". *Evolution*. 47 (3): 877–887. [doi:10.2307/2410191](https://doi.org/10.2307/2410191)

[^caswell2007]: Caswell H (2007). "Extrinsic mortality and the evolution of senescence". *Trends in Ecology & Evolution*. 22 (4): 173–174. [doi:10.1016/j.tree.2007.01.006](https://doi.org/10.1016/j.tree.2007.01.006)

[^moorad2019]: Moorad J, Promislow D, Silvertown J (2019). "Evolutionary ecology of senescence and a reassessment of Williams' 'extrinsic mortality' hypothesis". *Trends in Ecology & Evolution*. 34 (6): 519–530. [doi:10.1016/j.tree.2019.02.006](https://doi.org/10.1016/j.tree.2019.02.006)

[^dayabrams2020]: Day T, Abrams PA (2020). "Density dependence, senescence, and Williams' hypothesis". *Trends in Ecology & Evolution*. 35 (4): 300–302. [doi:10.1016/j.tree.2019.11.005](https://doi.org/10.1016/j.tree.2019.11.005)

[^andrerousset2020]: André J-B, Rousset F (2020). "Does extrinsic mortality accelerate the pace of life? A bare-bones approach". *Evolution and Human Behavior*. 41 (6): 486–492. [doi:10.1016/j.evolhumbehav.2020.03.002](https://doi.org/10.1016/j.evolhumbehav.2020.03.002)

[^austadfischer1991]: Austad SN, Fischer KE (1991). "Mammalian aging, metabolism, and ecology: evidence from the bats and marsupials". *Journal of Gerontology*. 46 (2): B47–B53.

[^healy2014]: Healy K, Guillerme T, Finlay S, Kane A, Kelly SBA, et al. (2014). "Ecology and mode-of-life explain lifespan variation in birds and mammals". *Proceedings of the Royal Society B*. 281 (1784): 20140298. [doi:10.1098/rspb.2014.0298](https://doi.org/10.1098/rspb.2014.0298)

[^shattuck2010]: Shattuck MR, Williams SA (2010). "Arboreality has allowed for the evolution of increased longevity in mammals". *PNAS*. 107 (10): 4635–4639. [doi:10.1073/pnas.0911439107](https://doi.org/10.1073/pnas.0911439107)

[^kellergenoud1997]: Keller L, Genoud M (1997). "Extraordinary lifespans in ants: a test of evolutionary theories of ageing". *Nature*. 389: 958–960. [doi:10.1038/40130](https://doi.org/10.1038/40130)

[^austad1993]: Austad SN (1993). "Retarded senescence in an insular population of Virginia opossums (*Didelphis virginiana*)". *Journal of Zoology*. 229: 695–708. [doi:10.1111/j.1469-7998.1993.tb02665.x](https://doi.org/10.1111/j.1469-7998.1993.tb02665.x)

[^ricklefs1998]: Ricklefs RE (1998). "Evolutionary theories of aging: confirmation of a fundamental prediction, with implications for the genetic basis and evolution of life span". *The American Naturalist*. 152 (1): 24–44. [doi:10.1086/286147](https://doi.org/10.1086/286147)

[^stearns2000]: Stearns SC, Ackermann M, Doebeli M, Kaiser M (2000). "Experimental evolution of aging, growth, and reproduction in fruitflies". *PNAS*. 97 (7): 3309–3313. [doi:10.1073/pnas.97.7.3309](https://doi.org/10.1073/pnas.97.7.3309)

[^miller2002]: Miller RA, Harper JM, Dysko RC, Durkee SJ, Austad SN (2002). "Longer life spans and delayed maturation in wild-derived mice". *Experimental Biology and Medicine*. 227 (7): 500–508. [doi:10.1177/153537020222700715](https://doi.org/10.1177/153537020222700715)

[^jones2014]: Jones OR, Scheuerlein A, Salguero-Gómez R, Camarda CG, Schaible R, et al. (2014). "Diversity of ageing across the tree of life". *Nature*. 505 (7482): 169–173. [doi:10.1038/nature12789](https://doi.org/10.1038/nature12789)

[^ruby2018]: Ruby JG, Smith M, Buffenstein R (2018). "Naked mole-rat mortality rates defy Gompertzian laws by not increasing with age". *eLife*. 7: e31157. [doi:10.7554/eLife.31157](https://doi.org/10.7554/eLife.31157)
