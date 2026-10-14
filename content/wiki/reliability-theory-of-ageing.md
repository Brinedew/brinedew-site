---
title: Reliability theory of ageing
tags:
  - content/wiki
date: 2026-10-14
draft: true
aliases:
  - Reliability theory of aging
  - Reliability theory of aging and longevity
  - Redundancy model of ageing
  - Series-parallel model of ageing
---
# Reliability theory of ageing

The **reliability theory of ageing** is an explanation of the age pattern of mortality, developed mainly by Leonid and Natalia Gavrilov, that applies the engineering theory of system failure to organisms. An organism is modelled as a set of vital blocks connected in series, so that the failure of any one kills it, each made of redundant elements connected in parallel, so that a block fails only when all its elements have failed. The elements themselves do not age: each fails at a constant rate. The organism nevertheless fails more often as it gets older, because its redundancy is used up. In the authors' words, "Aging, therefore, is a direct consequence of systems redundancy."[^gavrilov2001]

The theory claims to explain four regularities: the exponential rise of mortality with age (the [[Mortality rate models#gompertz-law|Gompertz law]]) in organisms, as against the power-law rise (the Weibull law) usual in machines; the slowing of that rise at the oldest ages and a final mortality plateau; the convergence of the mortality curves of different populations of a species, known as the *compensation effect of mortality*; and lasting effects of conditions in early life.[^gavrilov2001][^gavrilov2024] The exponential rise is obtained by assuming that organisms, unlike machines, start life with many of their elements already defective, an assumption later named the *high initial damage load* hypothesis.[^gavrilov2004][^gavrilov2024]

The derivation of the Gompertz law in the theory's main paper was shown in 2004 to rest on an approximation used outside its range of validity.[^steinsaltz2004] Computed exactly, the model gives a mortality rate whose exponential slope falls at every age. In American birth cohorts the slope rises between ages 60 and 90, a pattern the Gavrilovs have themselves reported, and the model fits these data as well as the Gompertz law only in the limit where it needs more than 10¹⁵ vital blocks. The mortality plateau the theory predicts is a property of almost any model in which death is the end of a random process, and so does not support this one in particular.[^steinsaltz2004]

## The model

Reliability theory describes how the failure rate of a system depends on the failure rates of its components and on how they are connected.[^gavrilov2001] In the series-parallel model, an organism consists of $k$ vital blocks, standing for organs or other irreplaceable subsystems, and each block consists of elements, standing for cells or other units, that fail independently at a constant rate $\lambda$ and are never replaced. The Gavrilovs justified the two kinds of connection with examples: "human organs like heart, brain or liver can be considered as vital components connected in series because failure of any of these organs leads to organism's death", while "functional cells in each vital organ can be considered as components connected in parallel".[^gavrilov2024]

A single block that starts with $n$ working elements survives to age $t$ with probability $1 - (1 - e^{-\lambda t})^n$, and its failure rate is

$$
h_n(t) = \frac{n\lambda e^{-\lambda t}(1 - e^{-\lambda t})^{n-1}}{1 - (1 - e^{-\lambda t})^n}.
$$

At young ages this is close to $n\lambda^n t^{n-1}$, a power of age as in the Weibull law; at old ages it approaches $\lambda$, because a surviving block has usually lost all but one of its elements.[^gavrilov2024] The organism's failure rate is the sum of the failure rates of its blocks, so it levels off at $k\lambda$. Figure 1 follows one simulated organism through life.

```vega-lite
{
  "$schema": "https://vega.github.io/schema/vega-lite/v6.json",
  "description": "Figure 1. One simulated organism in the series-parallel model. Each row is a vital block, and each square an element of that block that was working at birth; the rows differ in length because the number of working elements was drawn from a Poisson distribution with mean 7. Elements fail at random, at a constant rate of 2% a year, and are never replaced; a failed element is shown as an outline. A block fails when its last element fails, and the organism dies when its first block fails. Drag the slider to age the organism. The parameters are chosen for illustration, not fitted to data.",
  "params": [
    {
      "name": "age",
      "value": 40,
      "bind": {
        "input": "range",
        "min": 0,
        "max": 100,
        "step": 1,
        "name": "Age, years"
      }
    }
  ],
  "data": {
    "url": "/attachments/reliability-organism.csv"
  },
  "transform": [
    {
      "calculate": "min(age, datum.death)",
      "as": "now"
    },
    {
      "calculate": "datum.fail > datum.now",
      "as": "working"
    }
  ],
  "width": 560,
  "height": 330,
  "encoding": {
    "x": {
      "field": "element",
      "type": "quantitative",
      "scale": {
        "domain": [
          0.4,
          17.2
        ],
        "nice": false
      },
      "axis": null
    },
    "y": {
      "field": "block",
      "type": "ordinal",
      "axis": {
        "title": null,
        "labelExpr": "'block ' + datum.value",
        "ticks": false,
        "domain": false,
        "minExtent": 60,
        "maxExtent": 60
      }
    }
  },
  "layer": [
    {
      "transform": [
        {
          "filter": "datum.working"
        }
      ],
      "mark": {
        "type": "square",
        "style": "model-point",
        "size": 150,
        "filled": true
      },
      "encoding": {
        "tooltip": [
          {
            "field": "block"
          },
          {
            "field": "fail",
            "title": "element fails at age"
          }
        ]
      }
    },
    {
      "transform": [
        {
          "filter": "!datum.working"
        }
      ],
      "mark": {
        "type": "square",
        "style": "observed",
        "size": 150,
        "filled": false,
        "opacity": 0.55
      }
    },
    {
      "transform": [
        {
          "filter": "datum.working"
        },
        {
          "aggregate": [
            {
              "op": "count",
              "as": "left"
            }
          ],
          "groupby": [
            "block"
          ]
        },
        {
          "calculate": "datum.left + ' working'",
          "as": "t"
        },
        {
          "calculate": "14.3",
          "as": "lx"
        }
      ],
      "mark": {
        "type": "text",
        "style": "observed-label",
        "align": "left",
        "dx": 4
      },
      "encoding": {
        "text": {
          "field": "t"
        },
        "x": {
          "field": "lx",
          "type": "quantitative"
        }
      }
    },
    {
      "transform": [
        {
          "filter": "age >= datum.death && datum.block == datum.killer && datum.element == 1"
        },
        {
          "calculate": "14.3",
          "as": "lx"
        }
      ],
      "mark": {
        "type": "text",
        "style": "alt-label",
        "align": "left",
        "dx": 4
      },
      "encoding": {
        "text": {
          "value": "failed"
        },
        "x": {
          "field": "lx",
          "type": "quantitative"
        }
      }
    },
    {
      "data": {
        "values": [
          {
            "a": 0
          }
        ]
      },
      "transform": [
        {
          "calculate": "age >= 74.6 ? 'Died at 74.6: block 11 lost its last working element' : 'Alive at ' + age",
          "as": "t"
        }
      ],
      "mark": {
        "type": "text",
        "style": "label",
        "align": "left",
        "baseline": "bottom"
      },
      "encoding": {
        "text": {
          "field": "t"
        },
        "x": {
          "value": 0
        },
        "y": {
          "value": -10
        }
      }
    }
  ],
  "usermeta": {
    "axisAllowance": 70
  }
}
```

A block built with all its elements working gives a Weibull law, not a Gompertz law. To obtain the Gompertz law the Gavrilovs assumed that development leaves most elements defective, so that the number of working elements in a block follows a Poisson distribution with mean $\mu$, and argued that "early developmental processes in living organisms generate an exceptionally high load of initial damage, comparable in magnitude to the subsequent accumulation of age-related deterioration throughout the entire adult lifespan".[^gavrilov2024] They identified $\lambda$, which they call the *true aging rate*, with the inverse of a constant obtained from the compensation effect, and estimated it at "approximately equal to 1% per year".[^gavrilov2024]

A second version of the model treats a population that is heterogeneous: each organism has a single block whose elements are each working at birth with probability $q$. Its mortality rate grows at first as a power of age measured from a negative origin, $(x_0 + x)^{n-1}$, which the Gavrilovs called the *binomial law of mortality*, and then approaches $\lambda$.[^gavrilov2024]

## The derivation of the Gompertz law

In their 2001 paper the Gavrilovs derived the Gompertz law by taking the Weibull approximation for each block, $n\lambda^n t^{n-1}$, and averaging it over a Poisson distribution of $n$, which gives

$$
h(t) \approx k\lambda\mu\, e^{-\mu} e^{\mu\lambda t},
$$

an exponential rise with constant slope $\mu\lambda$.[^gavrilov2001][^steinsaltz2004] David Steinsaltz and Steven Evans wrote that "this depends on two significant errors". The Weibull approximation "is accurate only very close to $t = 0$", and averaging the blocks' failure rates is not the same as taking the failure rate of the average block, which is what the population's mortality is. They computed the exact mortality rate, conditioned on every block having at least one working element at birth:[^steinsaltz2004]

$$
h(t) = \frac{k\mu\lambda e^{-\lambda t}}{e^{\mu e^{-\lambda t}} - 1}.
$$

They described the result as "very different from an exponentially increasing function" and showed that a Gompertz-like curve could still be obtained with suitable parameters, for example $\lambda$ = 0.005, $k$ = 20,000 and $\mu$ = 15, but added that "it is a frail defense for a model, to say that it can be compelled to approximate a line by skillful manipulation".[^steinsaltz2004] They also noted that the series structure does nothing but multiply the hazard by $k$.[^steinsaltz2004]

The Gavrilovs replied in 2024 that "the authors failed to acknowledge that this model was designed for a homogeneous population and improperly recommended the use of a formula tailored to a heterogeneous population".[^gavrilov2024] Their reply concerns the second error only. If each organism carries many blocks in fixed Poisson proportions, the organism's failure rate is indeed the average of its blocks' rates; and at the parameters needed to fit human mortality, the average of the rates and the rate of the average agree to within 1% between ages 40 and 100 (see Data and figures). The first error is the one that matters. When $\mu e^{-\lambda t}$, the expected number of surviving elements in a block, is large, the exact formula becomes

$$
\ln h(t) \approx \text{constant} - \lambda t - \mu e^{-\lambda t},
$$

whose slope, $\lambda(\mu e^{-\lambda t} - 1)$, is not constant but decays exponentially with age at rate $\lambda$. More generally, the slope of the log mortality rate in the series-parallel model is $\lambda\left(z/(1 - e^{-z}) - 1\right)$ with $z = \mu e^{-\lambda t}$; since $z$ falls with age and $z/(1 - e^{-z})$ rises with $z$, the slope falls at every age, from its largest value at birth towards zero at the plateau. The binomial model behaves in the same way: its slope also falls at every age, for any number of elements and any probability of initial damage (see Data and figures). In both versions, mortality decelerates throughout life. The Gompertz law is approached only when $\lambda$ is so small that the slope barely changes within a lifespan.

## Tests against human mortality

### The rate of ageing

If the model is right, the slope of log mortality against age, also called the life-table ageing rate, should fall steadily through adult life, by about 1% a year if $\lambda$ is the 1% a year the Gavrilovs estimated. In American cohorts it rises. Figure 2 shows the slopes for people born in 1910, 1915 and 1920, from the cohort life tables of the Social Security Administration.[^ssa2026] For women, the slope averages 0.072 a year at age 65 and 0.106 at 90; for men, 0.065 and 0.092. The Gavrilovs have reported the same pattern: "Recently acceleration of LAR after age 60 was found for both men and women and for period and cohort mortality using contemporary data."[^gavrilov2024] Fitted to the same ages with $\lambda$ = 1% a year, the model's slope instead falls, from 0.105 to 0.080 for women.

```vega-lite
{
  "$schema": "https://vega.github.io/schema/vega-lite/v6.json",
  "description": "Figure 2. The rate of ageing, measured as the slope of log mortality against age, in American birth cohorts and in two models. Dots are the observed slopes for people born in 1910, 1915 and 1920, each computed over an 11-year window centred on the age shown, from the Social Security Administration's cohort life tables. The Gompertz law fitted to ages 60–95 has a constant slope. The series-parallel model fitted to the same ages, for the chosen element failure rate λ, has a slope that falls with age whatever λ is; the Gavrilovs estimated λ at about 1% a year. Choose the sex and λ.",
  "params": [
    {
      "name": "sex",
      "value": "women",
      "bind": {
        "input": "select",
        "options": [
          "women",
          "men"
        ],
        "name": "Sex"
      }
    },
    {
      "name": "lam",
      "value": 0.01,
      "bind": {
        "input": "select",
        "options": [
          0.002,
          0.003,
          0.004,
          0.005,
          0.006,
          0.008,
          0.01,
          0.012,
          0.015,
          0.02,
          0.025,
          0.03
        ],
        "labels": [
          "0.2% a year",
          "0.3% a year",
          "0.4% a year",
          "0.5% a year",
          "0.6% a year",
          "0.8% a year",
          "1% a year",
          "1.2% a year",
          "1.5% a year",
          "2% a year",
          "2.5% a year",
          "3% a year"
        ],
        "name": "Rate at which elements fail, λ"
      }
    }
  ],
  "data": {
    "url": "/attachments/reliability-ageing-rate.csv"
  },
  "transform": [
    {
      "filter": "datum.sex == sex"
    }
  ],
  "width": 560,
  "height": 320,
  "encoding": {
    "x": {
      "field": "age",
      "type": "quantitative",
      "scale": {
        "domain": [
          60,
          95
        ],
        "nice": false
      },
      "axis": {
        "title": "Age, years",
        "values": [
          60,
          65,
          70,
          75,
          80,
          85,
          90,
          95
        ]
      }
    },
    "y": {
      "field": "rate",
      "type": "quantitative",
      "scale": {
        "domain": [
          0.03,
          0.17
        ],
        "nice": false
      },
      "axis": {
        "title": "Rate of ageing (slope of log mortality), per year",
        "values": [
          0.04,
          0.06,
          0.08,
          0.1,
          0.12,
          0.14,
          0.16
        ]
      }
    }
  },
  "layer": [
    {
      "transform": [
        {
          "filter": "datum.series == 'data'"
        }
      ],
      "mark": {
        "type": "point",
        "style": "observed",
        "filled": true,
        "size": 28
      },
      "encoding": {
        "tooltip": [
          {
            "field": "cohort",
            "title": "born"
          },
          {
            "field": "age"
          },
          {
            "field": "rate",
            "format": ".3f",
            "title": "rate of ageing"
          }
        ]
      }
    },
    {
      "transform": [
        {
          "filter": "datum.series == 'gompertz'"
        }
      ],
      "mark": {
        "type": "line",
        "style": "alt"
      }
    },
    {
      "transform": [
        {
          "filter": "datum.series == 'reliability' && abs(toNumber(datum.lambda) - lam) < 1e-9"
        }
      ],
      "mark": {
        "type": "line",
        "style": "model"
      }
    },
    {
      "transform": [
        {
          "filter": "datum.series == 'gompertz' && datum.age == 95"
        }
      ],
      "mark": {
        "type": "text",
        "style": "alt-label",
        "align": "right",
        "dy": -10
      },
      "encoding": {
        "text": {
          "value": "Gompertz law"
        }
      }
    },
    {
      "transform": [
        {
          "filter": "datum.series == 'reliability' && abs(toNumber(datum.lambda) - lam) < 1e-9 && datum.age == 95"
        }
      ],
      "mark": {
        "type": "text",
        "style": "model-label",
        "align": "right",
        "dy": 16
      },
      "encoding": {
        "text": {
          "value": "reliability model"
        }
      }
    },
    {
      "data": {
        "values": [
          {
            "age": 61,
            "rate": 0.045,
            "t": "observed, cohorts born 1910, 1915 and 1920"
          }
        ]
      },
      "mark": {
        "type": "text",
        "style": "observed-label",
        "align": "left"
      },
      "encoding": {
        "text": {
          "field": "t"
        }
      }
    }
  ]
}
```

A constant term added to the mortality rate, for deaths unrelated to age, can make the total slope rise in either model. Fitted to these cohorts at ages 55–95, however, the constant has to be 0.0044 a year for women in the Gompertz–Makeham fit and 0.0063 in the series-parallel fit with $\lambda$ = 1%, which is 60% and 85% of their whole mortality rate at age 55. Such a term would mean that most deaths in late middle age have nothing to do with age.

### The number of blocks

The model can be brought close to the Gompertz law by making $\lambda$ small, as Steinsaltz and Evans noted, but the number of blocks then grows without limit, because a small $\lambda$ makes each block very unlikely to fail within a lifetime. Figure 3 shows the trade-off for the same cohorts. At $\lambda$ = 1% a year the best fit for women needs about 12,000 blocks with a mean of 22 working elements each, and its error is 1.7 times that of the Gompertz law; for men it needs about 5,000 blocks, with 1.8 times the error. Its error falls to within 15% of the Gompertz law's only at $\lambda$ = 0.2% a year, with about $10^{20}$ blocks for women and $10^{17}$ for men.

```vega-lite
{
  "$schema": "https://vega.github.io/schema/vega-lite/v6.json",
  "description": "Figure 3. How well the series-parallel model fits the mortality of American cohorts born in 1910–1920 at ages 60–95, against the number of vital blocks the fit requires. Each point is the best fit for one element failure rate λ, labelled in percent a year; the vertical axis is the root-mean-square error in log mortality, relative to that of the Gompertz law. The model approaches the Gompertz fit only as λ approaches zero and the number of blocks passes 10¹⁵. Hover over a point for the fitted values and the mortality plateau each fit implies.",
  "params": [
    {
      "name": "sex3",
      "value": "women",
      "bind": {
        "input": "select",
        "options": [
          "women",
          "men"
        ],
        "name": "Sex"
      }
    }
  ],
  "data": {
    "url": "/attachments/reliability-fit-frontier.csv"
  },
  "transform": [
    {
      "filter": "datum.sex == sex3"
    },
    {
      "calculate": "datum.rms / datum.gompertz_rms",
      "as": "rel"
    },
    {
      "calculate": "format(datum.lambda * 100, '.1~f') + '%'",
      "as": "lab"
    }
  ],
  "width": 560,
  "height": 300,
  "layer": [
    {
      "data": {
        "values": [
          {
            "x0": 10,
            "x1": 1e+21,
            "y": 1
          }
        ]
      },
      "mark": {
        "type": "rule",
        "style": "guide"
      },
      "encoding": {
        "x": {
          "field": "x0",
          "type": "quantitative",
          "scale": {
            "type": "log",
            "domain": [
              10,
              1e+21
            ]
          },
          "axis": {
            "title": "Number of vital blocks needed",
            "values": [
              10,
              100000.0,
              10000000000.0,
              1000000000000000.0,
              1e+20
            ],
            "labels": false,
            "titlePadding": 22
          }
        },
        "y": {
          "field": "y",
          "type": "quantitative",
          "scale": {
            "domain": [
              0.8,
              3.6
            ],
            "nice": false
          },
          "axis": {
            "title": "Fit error, relative to the Gompertz law",
            "values": [
              1,
              1.5,
              2,
              2.5,
              3,
              3.5
            ],
            "labelExpr": "format(datum.value, '.1f') + '×'"
          }
        },
        "x2": {
          "field": "x1"
        }
      }
    },
    {
      "data": {
        "values": [
          {
            "x": 1e+19,
            "y": 1,
            "t": "Gompertz law"
          }
        ]
      },
      "mark": {
        "type": "text",
        "style": "observed-label",
        "align": "right",
        "dy": 14
      },
      "encoding": {
        "x": {
          "field": "x",
          "type": "quantitative",
          "scale": {
            "type": "log",
            "domain": [
              10,
              1e+21
            ]
          },
          "axis": {
            "title": "Number of vital blocks needed",
            "values": [
              10,
              100000.0,
              10000000000.0,
              1000000000000000.0,
              1e+20
            ],
            "labels": false,
            "titlePadding": 22
          }
        },
        "y": {
          "field": "y",
          "type": "quantitative",
          "scale": {
            "domain": [
              0.8,
              3.6
            ],
            "nice": false
          },
          "axis": {
            "title": "Fit error, relative to the Gompertz law",
            "values": [
              1,
              1.5,
              2,
              2.5,
              3,
              3.5
            ],
            "labelExpr": "format(datum.value, '.1f') + '×'"
          }
        },
        "text": {
          "field": "t"
        }
      }
    },
    {
      "mark": {
        "type": "line",
        "style": "model",
        "strokeWidth": 1.5
      },
      "encoding": {
        "x": {
          "field": "blocks",
          "type": "quantitative",
          "scale": {
            "type": "log",
            "domain": [
              10,
              1e+21
            ]
          },
          "axis": {
            "title": "Number of vital blocks needed",
            "values": [
              10,
              100000.0,
              10000000000.0,
              1000000000000000.0,
              1e+20
            ],
            "labels": false,
            "titlePadding": 22
          }
        },
        "y": {
          "field": "rel",
          "type": "quantitative",
          "scale": {
            "domain": [
              0.8,
              3.6
            ],
            "nice": false
          },
          "axis": {
            "title": "Fit error, relative to the Gompertz law",
            "values": [
              1,
              1.5,
              2,
              2.5,
              3,
              3.5
            ],
            "labelExpr": "format(datum.value, '.1f') + '×'"
          }
        }
      }
    },
    {
      "mark": {
        "type": "point",
        "style": "model-point",
        "filled": true,
        "size": 60
      },
      "encoding": {
        "tooltip": [
          {
            "field": "lambda",
            "title": "λ, per year"
          },
          {
            "field": "blocks",
            "format": ".2~e",
            "title": "blocks"
          },
          {
            "field": "elements",
            "title": "mean elements per block"
          },
          {
            "field": "plateau",
            "format": ".3~g",
            "title": "plateau hazard, per year"
          },
          {
            "field": "rel",
            "format": ".2f",
            "title": "error vs Gompertz"
          }
        ],
        "x": {
          "field": "blocks",
          "type": "quantitative",
          "scale": {
            "type": "log",
            "domain": [
              10,
              1e+21
            ]
          },
          "axis": {
            "title": "Number of vital blocks needed",
            "values": [
              10,
              100000.0,
              10000000000.0,
              1000000000000000.0,
              1e+20
            ],
            "labels": false,
            "titlePadding": 22
          }
        },
        "y": {
          "field": "rel",
          "type": "quantitative",
          "scale": {
            "domain": [
              0.8,
              3.6
            ],
            "nice": false
          },
          "axis": {
            "title": "Fit error, relative to the Gompertz law",
            "values": [
              1,
              1.5,
              2,
              2.5,
              3,
              3.5
            ],
            "labelExpr": "format(datum.value, '.1f') + '×'"
          }
        }
      }
    },
    {
      "mark": {
        "type": "text",
        "style": "label",
        "align": "left",
        "dx": 7,
        "dy": -7
      },
      "encoding": {
        "text": {
          "field": "lab"
        },
        "x": {
          "field": "blocks",
          "type": "quantitative",
          "scale": {
            "type": "log",
            "domain": [
              10,
              1e+21
            ]
          },
          "axis": {
            "title": "Number of vital blocks needed",
            "values": [
              10,
              100000.0,
              10000000000.0,
              1000000000000000.0,
              1e+20
            ],
            "labels": false,
            "titlePadding": 22
          }
        },
        "y": {
          "field": "rel",
          "type": "quantitative",
          "scale": {
            "domain": [
              0.8,
              3.6
            ],
            "nice": false
          },
          "axis": {
            "title": "Fit error, relative to the Gompertz law",
            "values": [
              1,
              1.5,
              2,
              2.5,
              3,
              3.5
            ],
            "labelExpr": "format(datum.value, '.1f') + '×'"
          }
        }
      }
    },
    {
      "data": {
        "values": [
          {
            "v": 10,
            "e": ""
          },
          {
            "v": 100000.0,
            "e": "5"
          },
          {
            "v": 10000000000.0,
            "e": "10"
          },
          {
            "v": 1000000000000000.0,
            "e": "15"
          },
          {
            "v": 1e+20,
            "e": "20"
          }
        ]
      },
      "mark": {
        "type": "text",
        "style": "label",
        "align": "right",
        "baseline": "top",
        "y": {
          "expr": "height + 7"
        },
        "dx": {
          "expr": "datum.e == '' ? 7 : 3"
        }
      },
      "encoding": {
        "x": {
          "field": "v",
          "type": "quantitative",
          "scale": {
            "type": "log",
            "domain": [
              10,
              1e+21
            ]
          },
          "axis": {
            "title": "Number of vital blocks needed",
            "values": [
              10,
              100000.0,
              10000000000.0,
              1000000000000000.0,
              1e+20
            ],
            "labels": false,
            "titlePadding": 22
          }
        },
        "text": {
          "value": "10"
        }
      }
    },
    {
      "data": {
        "values": [
          {
            "v": 100000.0,
            "e": "5"
          },
          {
            "v": 10000000000.0,
            "e": "10"
          },
          {
            "v": 1000000000000000.0,
            "e": "15"
          },
          {
            "v": 1e+20,
            "e": "20"
          }
        ]
      },
      "mark": {
        "type": "text",
        "style": "label",
        "fontSize": 9,
        "align": "left",
        "baseline": "top",
        "y": {
          "expr": "height + 4"
        },
        "dx": 3
      },
      "encoding": {
        "x": {
          "field": "v",
          "type": "quantitative",
          "scale": {
            "type": "log",
            "domain": [
              10,
              1e+21
            ]
          },
          "axis": {
            "title": "Number of vital blocks needed",
            "values": [
              10,
              100000.0,
              10000000000.0,
              1000000000000000.0,
              1e+20
            ],
            "labels": false,
            "titlePadding": 22
          }
        },
        "text": {
          "field": "e"
        }
      }
    }
  ]
}
```

The fitted models also place the mortality plateau, $k\lambda$, far beyond any observed mortality rate: at about 124 deaths per person per year for women at $\lambda$ = 1%, and higher still at smaller $\lambda$. In the parameter range where the model fits human mortality, redundancy exhaustion does not produce the levelling-off the theory is meant to explain.

### Dietary restriction

In fruit flies, "Two days after the application of DR at any age for the first time, previously fully fed flies are no more likely to die than flies of the same age that have been subjected to long-term DR."[^mair2003] In a model in which ageing is the irreversible loss of elements, a diet that slowed the loss would leave late-switched flies with fewer elements than flies restricted throughout, and so with higher mortality. Jelle Boonekamp, Michael Briga and Simon Verhulst fitted a redundancy model to these data and reported that "after adjusting model parameters the redundancy model describes both effects well";[^boonekamp2015] the fit therefore requires dietary restriction to act on something other than the rate of element loss.

## Mortality plateaus

The 2001 paper presented late-life deceleration and plateaus as "an inevitable consequence of redundancy exhaustion at extreme old ages".[^gavrilov2001] Steinsaltz and Evans showed that this feature is not specific to redundancy: "the convergence to a 'mortality plateau' — is, in fact, a generic consequence of the convergence to a 'quasistationary distribution'", which occurs in a wide class of models where death is the end of a random process.[^steinsaltz2004] A plateau in data therefore cannot distinguish the reliability model from its competitors. Whether human mortality reaches a plateau is itself disputed. The Gavrilovs found that American single-year birth cohorts follow the Gompertz law up to ages 102–105, and attributed earlier reports of deceleration to the mixing of cohorts and to errors in reported ages.[^gavrilov2011] (See [[Mortality rate models#late-life-deceleration-and-the-plateau-debate|Mortality rate models]].)

## Early-life conditions

The high initial damage load implies that conditions before and soon after birth should affect survival in old age. The Gavrilovs have cited associations of longevity with month of birth and parental age at conception as support.[^gavrilov2024] In their case-control study of Americans born in 1890–1891, being born in the second half of the year was associated with reaching 100 with an odds ratio of 1.36 (95% confidence interval 1.00–1.84, *P* = 0.050) among 723 men, and 1.18 (0.89–1.58, *P* = 0.256) among 815 women.[^gavrilov2015] Effects of early-life conditions on late-life mortality are predicted by many theories of ageing and by epidemiological models of fetal and childhood origins of disease, so even a robust association would not single out the reliability model.

## Assessment

Reliability theory makes a correct and useful point: a system can deteriorate even when none of its parts ages, if it depends on redundancy that is used up. That idea, and the series-parallel picture of organs made of cells, has informed later models, including network models in which subsystem failures trigger one another.[^nielsen2024][^laird2009]

The theory's specific quantitative claims have not held up. The 2001 derivation of the Gompertz law used a short-time approximation where it does not apply; the exact model predicts that the rate of ageing falls throughout life; the American cohort data, and the Gavrilovs' own later analyses, show it rising after 60; and the model matches the Gompertz law only when its redundancy is effectively never exhausted, with numbers of blocks that bear no relation to the organs of a body. The late-life plateau it predicts is generic to models of its kind, and the early-life associations offered as tests are weak and not specific. The theory is best read as a demonstration that non-ageing parts can produce an ageing whole, not as an explanation of the Gompertz law.

## History

Leonid Gavrilov proposed a mathematical model of animal ageing in 1978, and in the same year he, Natalia Gavrilova and Lev Yaguzhinsky described the main regularities of animal ageing and death in terms of reliability theory.[^gavrilov2024] The Gavrilovs developed the approach in *The Biology of Life Span*, published in English in 1991, where they also proposed that development leaves organisms with a high load of initial damage.[^gavrilov1991][^gavrilov2024] Their 2001 paper in the *Journal of Theoretical Biology* became the theory's standard reference.[^gavrilov2001] In 2004 they named that idea the high initial damage load hypothesis,[^gavrilov2004] and Steinsaltz and Evans published their critique of the derivation and their general account of mortality plateaus.[^steinsaltz2004] Later work extended the approach to the evolution of redundancy,[^laird2009] fitted redundancy models to experimental data,[^boonekamp2015] and replaced independent blocks with networks of interdependent subsystems.[^nielsen2024] The Gavrilovs restated the theory, and their reply to Steinsaltz and Evans, in 2024.[^gavrilov2024]

## Data and figures

Figure 1 simulates one organism with 12 blocks, numbers of working elements drawn from a Poisson distribution with mean 7 (conditioned on at least one) and element failure rate 2% a year; the organism shown was chosen so that its death falls between ages 70 and 80.

Figures 2 and 3 use the cohort life tables of the Social Security Administration (Alternative 2, 2026 Trustees Report) for people born in 1910, 1915 and 1920.[^ssa2026] Mortality rates were computed from the death probabilities $q$ as $-\ln(1 - q)$ and averaged on a log scale over the three cohorts. The Gompertz law and the series-parallel model were fitted by least squares on log mortality at ages 60–95, without a constant term; for the series-parallel model, $\lambda$ was fixed at each of 12 values from 0.2% to 3% a year and $k$ and $\mu$ were fitted. Observed slopes are least-squares slopes of log mortality over 11-year windows; the model's slope is computed from the formula above. The constant term discussed under "The rate of ageing" comes from a fit with an added age-independent term at ages 55–95. The comparison of the average of block failure rates with the failure rate of the average block used a fit to the 2023 United States period life table for women, with $\lambda$ = 1%, $\mu$ = 26.6 and $k$ = 61,500. The monotone decline of the slope in the binomial model was checked numerically for numbers of elements from 2 to 1,000.

[^gavrilov2001]: Gavrilov LA, Gavrilova NS (2001). "The reliability theory of aging and longevity". *Journal of Theoretical Biology*. 213 (4): 527–545. [doi:10.1006/jtbi.2001.2430](https://doi.org/10.1006/jtbi.2001.2430)

[^gavrilov2024]: Gavrilov LA, Gavrilova NS (2024). "Exploring patterns of human mortality and aging: a reliability theory viewpoint". *Biochemistry (Moscow)*. 89 (2): 341–355. [doi:10.1134/S0006297924020123](https://doi.org/10.1134/S0006297924020123)

[^gavrilov2004]: Gavrilov LA, Gavrilova NS (2004). "Early-life programming of aging and longevity: the idea of high initial damage load (the HIDL hypothesis)". *Annals of the New York Academy of Sciences*. 1019: 496–501. [doi:10.1196/annals.1297.091](https://doi.org/10.1196/annals.1297.091)

[^steinsaltz2004]: Steinsaltz D, Evans SN (2004). "Markov mortality models: implications of quasistationarity and varying initial distributions". *Theoretical Population Biology*. 65 (4): 319–337. [doi:10.1016/j.tpb.2003.10.007](https://doi.org/10.1016/j.tpb.2003.10.007)

[^ssa2026]: Social Security Administration, Office of the Chief Actuary (2026). "Cohort life tables, Alternative 2, 2026 Trustees Report". [ssa.gov](https://www.ssa.gov/oact/HistEst/CohLifeTablesHome.html)

[^mair2003]: Mair W, Goymer P, Pletcher SD, Partridge L (2003). "Demography of dietary restriction and death in *Drosophila*". *Science*. 301 (5640): 1731–1733. [doi:10.1126/science.1086016](https://doi.org/10.1126/science.1086016)

[^boonekamp2015]: Boonekamp JJ, Briga M, Verhulst S (2015). "The heuristic value of redundancy models of aging". *Experimental Gerontology*. 71: 95–102. [doi:10.1016/j.exger.2015.09.005](https://doi.org/10.1016/j.exger.2015.09.005)

[^gavrilov2011]: Gavrilov LA, Gavrilova NS (2011). "Mortality measurement at advanced ages: a study of the Social Security Administration Death Master File". *North American Actuarial Journal*. 15 (3): 432–447. [doi:10.1080/10920277.2011.10597629](https://doi.org/10.1080/10920277.2011.10597629)

[^gavrilov2015]: Gavrilov LA, Gavrilova NS (2015). "Predictors of exceptional longevity: effects of early-life and midlife conditions, and familial longevity". *North American Actuarial Journal*. 19 (3): 174–186. [doi:10.1080/10920277.2015.1018390](https://doi.org/10.1080/10920277.2015.1018390)

[^nielsen2024]: Nielsen PY, Jensen MK, Mitarai N, Bhatt S (2024). "The Gompertz law emerges naturally from the inter-dependencies between sub-components in complex organisms". *Scientific Reports*. 14: 1196. [doi:10.1038/s41598-024-51669-5](https://doi.org/10.1038/s41598-024-51669-5)

[^laird2009]: Laird RA, Sherratt TN (2009). "The evolution of senescence through decelerating selection for system reliability". *Journal of Evolutionary Biology*. 22 (5): 974–982. [doi:10.1111/j.1420-9101.2009.01709.x](https://doi.org/10.1111/j.1420-9101.2009.01709.x)

[^gavrilov1991]: Gavrilov LA, Gavrilova NS (1991). *The Biology of Life Span: A Quantitative Approach*. New York: Harwood Academic Publishers.
