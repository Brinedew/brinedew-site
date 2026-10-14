---
title: Critical-point model of ageing
tags:
  - content/wiki
date: 2026-10-14
draft: true
aliases:
  - Critical-point model of aging
  - Dynamic resilience model of ageing
  - Loss of resilience
  - Dynamic organism state indicator
  - DOSI
  - Dynamic frailty indicator
---
# Critical-point model of ageing

The **critical-point model of ageing** is a family of models, developed by Peter Fedichev and colleagues at the company Gero, in which ageing is the progressive loss of an organism's ability to recover from perturbations, and death follows the approach to a critical point at which that ability vanishes. Its best-known claim, from a 2021 study of blood counts and step counts, is that the time humans take to recover from fluctuations lengthens with age and would become infinite at 120–150 years, which the authors called "a fundamental or absolute limit of human lifespan".[^pyrkov2021] In mice the group described ageing instead as an instability present from early adulthood.[^avchaciov2022]

That recovery slows with age is supported by independent work in mice and humans.[^farrell2022][^karin2019] The lifespan limit is not. It comes from extending straight lines through five or six age-group averages for 40 to 80 years beyond the oldest data; the uncertainty on where the line reaches zero runs to about 240 years; curves of other shapes fit the same points as well and put the limit anywhere from below the oldest recorded human age to infinity; and a model with no limit, in which people simply age at different rates, fits the variance data as well as the critical one. In their reply to the reviewers, the authors wrote that "we do not claim (and no available data lets us state) that there is the actual divergence".[^pyrkov2021review]

The model belongs to the same family as the [[saturating-removal-model-of-senescence|saturating-removal model]] of senescent cells, which also explains the [[Mortality rate models#gompertz-law|Gompertz law]] through a loss of restoring force with age, and both descend from the vitality model of Strehler and Mildvan.[^raz2026][^pyrkov2021]

## The model

The group's models describe the state of an organism by a single variable $z$, an "order parameter" assumed to capture the slowest, organism-wide mode of change, estimated in practice as the first principal component of blood counts or activity data, or as a mortality-risk score. In mice, $z$ obeys

$$
\frac{\mathrm{d}z}{\mathrm{d}t} = \alpha z + g z^2 + f(t),
$$

where $f(t)$ is random noise. "Depending on the sign of the stiffness coefficient, α, the organism state may be dynamically stable (if α < 0) or unstable (if α > 0)."[^avchaciov2022] Two regimes follow.

- **Unstable (α > 0), proposed for mice, flies and nematodes.** Deviations of $z$ grow exponentially from early adulthood, and mortality rises as in the Gompertz law with slope close to α, levelling off at a plateau of about α.[^avchaciov2022]
- **Stable but eroding (α < 0), proposed for humans.** Fluctuations of $z$ decay at a recovery rate $\varepsilon = -\alpha$, so that their autocorrelation decays as $e^{-\varepsilon \Delta t}$ and their variance is $\sigma^2 \sim B/\varepsilon$, where $B$ is the noise strength. If $\varepsilon$ falls linearly with age, recovery time and variance diverge together at the age where $\varepsilon$ reaches zero.[^pyrkov2021]

The Gompertz law in humans is attributed to escape over a protective barrier: "in a reasonably smooth potential energy landscape forming the basin of attraction, the activation energy required for crossing the protective barrier (B) decreases along with the curvature at the same pace, that is, linearly with age."[^pyrkov2021] The authors identified the critical point with the end of the Strehler–Mildvan vitality scale: "such a state of 'zero-resilience' at the critical point corresponds to the absolute zero on the vitality scale in the Strehler–Mildvan theory of aging".[^pyrkov2021]

The assumption that barrier and curvature fall "at the same pace" is a special case. In the generic way a stable state loses stability, a fold bifurcation, the barrier scales as the cube of the curvature: for $\mathrm{d}x/\mathrm{d}t = r - x^2$ the barrier is $\tfrac{4}{3}r^{3/2}$ and the curvature $2r^{1/2}$. If the curvature fell linearly to zero at 125 years, the slope of log mortality would then fall about sixfold between ages 40 and 90, which human mortality does not do (see Data and figures).

## Evidence in humans

### Blood counts and step counts

Timothy Pyrkov and colleagues trained a Cox model on complete blood counts in the US National Health and Nutrition Examination Survey (NHANES), and used its output, which they called the *dynamic organism state indicator* (DOSI), as the order parameter. For the longitudinal analysis they used blood tests from a Russian commercial laboratory, "388 male and 694 female subjects aged 30–90 with complete CBC analyses that were sampled 10–20 times within a period of more than 3 years (up to 42 months)", and step counts from a smartphone app.[^pyrkov2021] They measured how quickly each person's deviations from their own mean decayed, averaged by age group, and found that the recovery rate fell with age. The abstract stated that "extrapolation of this trend suggested that DOSI recovery time and variance would simultaneously diverge at a critical point of 120 − 150 years of age", and concluded that the criticality "is an intrinsic biological property of an organism that is independent of stress factors and signifies a fundamental or absolute limit of human lifespan".[^pyrkov2021]

### The extrapolation

The recovery rates in the paper are averages for five age groups of blood tests (mid-ages 45 to 85) and six of step counts (25 to 75). Refitted to values read from the published figure, straight lines reach zero at 125 years for blood counts and 148 for step counts, as in the paper; the 95% confidence intervals on those ages are 101–234 and 115–248 years. The paper's own figure caption gives "~110–170 y.o.", and its Discussion "100–150 years".[^pyrkov2021]

The straight line is an assumption. Figure 1 fits curves of other shapes to the same points. A square-root decline, the shape expected when a stable state is lost through a generic fold bifurcation, reaches zero at 97 years for blood counts, below the oldest recorded human age of 122 years;[^robine2019] a quadratic decline reaches zero at 187; an exponential decline never reaches zero. With five or six points, these fits are about equally good (Figure 2). The data do not determine the limit; the choice of curve does.

```vega-lite
{
  "$schema": "https://vega.github.io/schema/vega-lite/v6.json",
  "description": "Figure 1. Where the recovery rate of human blood counts and step counts reaches zero depends on the shape assumed for its decline. Dots are recovery rates for age groups, read from Figure 3C of Pyrkov and colleagues (2021); the shaded band marks the ages with data. The line is the best fit of the chosen shape, extended to the age at which it reaches zero, and the vertical rule marks 122 years, the oldest recorded human age. Choose the measure and the shape.",
  "params": [
    {
      "name": "sig",
      "value": "blood counts",
      "bind": {
        "input": "select",
        "options": [
          "blood counts",
          "step counts"
        ],
        "name": "Measure"
      }
    },
    {
      "name": "form",
      "value": "straight line",
      "bind": {
        "input": "select",
        "options": [
          "straight line",
          "square root",
          "square",
          "exponential"
        ],
        "labels": [
          "straight line (the paper's choice)",
          "square root",
          "square",
          "exponential decline"
        ],
        "name": "Shape of the decline"
      }
    }
  ],
  "width": 560,
  "height": 300,
  "layer": [
    {
      "data": {
        "values": [
          {
            "x": 122
          }
        ]
      },
      "mark": {
        "type": "rule",
        "style": "guide"
      },
      "encoding": {
        "x": {
          "field": "x",
          "type": "quantitative",
          "scale": {
            "domain": [
              20,
              260
            ],
            "nice": false
          },
          "axis": {
            "title": "Age, years",
            "values": [
              20,
              50,
              100,
              150,
              200,
              250
            ]
          }
        }
      }
    },
    {
      "data": {
        "values": [
          {
            "x": 122,
            "t": "oldest recorded human, 122"
          }
        ]
      },
      "mark": {
        "type": "text",
        "style": "observed-label",
        "align": "left",
        "dx": 5,
        "y": 12
      },
      "encoding": {
        "x": {
          "field": "x",
          "type": "quantitative",
          "axis": {
            "title": "Age, years",
            "values": [
              20,
              50,
              100,
              150,
              200,
              250
            ]
          }
        },
        "text": {
          "field": "t"
        }
      }
    },
    {
      "data": {
        "values": [
          {
            "k": 0
          }
        ]
      },
      "mark": {
        "type": "rect",
        "style": "observed",
        "opacity": 0.08
      },
      "encoding": {
        "x": {
          "field": "a",
          "type": "quantitative",
          "axis": {
            "title": "Age, years",
            "values": [
              20,
              50,
              100,
              150,
              200,
              250
            ]
          }
        },
        "x2": {
          "field": "b"
        }
      },
      "transform": [
        {
          "calculate": "sig == 'blood counts' ? 40 : 20",
          "as": "a"
        },
        {
          "calculate": "sig == 'blood counts' ? 90 : 80",
          "as": "b"
        }
      ]
    },
    {
      "data": {
        "values": [
          {
            "k": 0
          }
        ]
      },
      "mark": {
        "type": "text",
        "style": "observed-label",
        "y": {
          "expr": "height - 10"
        }
      },
      "encoding": {
        "x": {
          "field": "x",
          "type": "quantitative",
          "axis": {
            "title": "Age, years",
            "values": [
              20,
              50,
              100,
              150,
              200,
              250
            ]
          }
        },
        "text": {
          "field": "t"
        }
      },
      "transform": [
        {
          "calculate": "sig == 'blood counts' ? 65 : 50",
          "as": "x"
        },
        {
          "calculate": "'ages with data'",
          "as": "t"
        }
      ]
    },
    {
      "data": {
        "url": "/attachments/resilience-recovery-rate.csv"
      },
      "transform": [
        {
          "filter": "datum.signal == sig && datum.kind == 'fit' && datum.form == form"
        }
      ],
      "mark": {
        "type": "line",
        "style": "model"
      },
      "encoding": {
        "x": {
          "field": "age",
          "type": "quantitative",
          "axis": {
            "title": "Age, years",
            "values": [
              20,
              50,
              100,
              150,
              200,
              250
            ]
          }
        },
        "y": {
          "field": "rate",
          "type": "quantitative"
        }
      }
    },
    {
      "data": {
        "url": "/attachments/resilience-recovery-rate.csv"
      },
      "transform": [
        {
          "filter": "datum.signal == sig && datum.kind == 'data'"
        }
      ],
      "mark": {
        "type": "point",
        "style": "observed",
        "filled": true,
        "size": 70,
        "opacity": 1
      },
      "encoding": {
        "x": {
          "field": "age",
          "type": "quantitative",
          "scale": {
            "domain": [
              20,
              260
            ],
            "nice": false
          },
          "axis": {
            "title": "Age, years",
            "values": [
              20,
              50,
              100,
              150,
              200,
              250
            ]
          }
        },
        "y": {
          "field": "rate",
          "type": "quantitative",
          "scale": {
            "domain": [
              0,
              0.5
            ],
            "nice": false
          },
          "axis": {
            "title": "Recovery rate, per week",
            "values": [
              0,
              0.1,
              0.2,
              0.3,
              0.4,
              0.5
            ]
          }
        },
        "tooltip": [
          {
            "field": "age",
            "title": "cohort mid-age"
          },
          {
            "field": "rate",
            "title": "recovery rate, per week",
            "format": ".3f"
          }
        ]
      }
    },
    {
      "data": {
        "url": "/attachments/resilience-critical-age.csv"
      },
      "transform": [
        {
          "filter": "datum.signal == sig && datum.form == form"
        },
        {
          "calculate": "isValid(datum.critical_age) && datum.critical_age != '' ? 'reaches zero at ' + format(datum.critical_age, '.0f') : 'never reaches zero'",
          "as": "t"
        },
        {
          "calculate": "isValid(datum.critical_age) && datum.critical_age != '' ? datum.critical_age : 250",
          "as": "x"
        },
        {
          "calculate": "0",
          "as": "y0"
        }
      ],
      "mark": {
        "type": "text",
        "style": "model-label",
        "align": "left",
        "dx": 6,
        "dy": -12
      },
      "encoding": {
        "x": {
          "field": "x",
          "type": "quantitative",
          "axis": {
            "title": "Age, years",
            "values": [
              20,
              50,
              100,
              150,
              200,
              250
            ]
          }
        },
        "y": {
          "field": "y0",
          "type": "quantitative"
        },
        "text": {
          "field": "t"
        }
      }
    }
  ],
  "encoding": {},
  "resolve": {
    "scale": {
      "x": "shared",
      "y": "shared"
    }
  }
}
```

```vega-lite
{
  "$schema": "https://vega.github.io/schema/vega-lite/v6.json",
  "description": "Figure 2. The age at which recovery would stop, for each assumed shape of decline, from the fits in Figure 1. Circles are blood counts and squares step counts; the horizontal bars on the straight-line fits are 95% confidence intervals, and the vertical rule marks 122 years. With five or six points the four shapes fit about equally well, so the data do not choose between these ages. An exponential decline never reaches zero.",
  "data": {
    "url": "/attachments/resilience-critical-age.csv"
  },
  "transform": [
    {
      "calculate": "datum.form == 'straight line' ? 'straight line (paper)' : datum.form == 'exponential' ? 'exponential decline' : datum.form",
      "as": "shape"
    },
    {
      "calculate": "isValid(datum.critical_age) && datum.critical_age != '' ? toNumber(datum.critical_age) : 262",
      "as": "x"
    },
    {
      "calculate": "isValid(datum.critical_age) && datum.critical_age != '' ? format(datum.critical_age, '.0f') : 'never'",
      "as": "lab"
    }
  ],
  "width": 560,
  "height": 230,
  "layer": [
    {
      "data": {
        "values": [
          {
            "x": 122
          }
        ]
      },
      "mark": {
        "type": "rule",
        "style": "guide"
      },
      "encoding": {
        "x": {
          "field": "x",
          "type": "quantitative"
        }
      }
    },
    {
      "transform": [
        {
          "filter": "isValid(toNumber(datum.lower)) && datum.lower != ''"
        }
      ],
      "mark": {
        "type": "rule",
        "style": "observed",
        "strokeWidth": 2
      },
      "encoding": {
        "x": {
          "field": "lower",
          "type": "quantitative"
        },
        "x2": {
          "field": "upper"
        },
        "y": {
          "field": "shape",
          "type": "nominal",
          "sort": [
            "straight line (paper)",
            "square root",
            "square",
            "exponential decline"
          ],
          "axis": {
            "title": null,
            "ticks": false,
            "domain": false,
            "minExtent": 140,
            "maxExtent": 140
          }
        },
        "yOffset": {
          "field": "signal",
          "type": "nominal",
          "sort": [
            "blood counts",
            "step counts"
          ],
          "scale": {
            "paddingInner": 0.3
          }
        }
      }
    },
    {
      "transform": [
        {
          "filter": "datum.signal == 'blood counts'"
        }
      ],
      "mark": {
        "type": "point",
        "style": "model-point",
        "filled": true,
        "size": 80
      },
      "encoding": {
        "x": {
          "field": "x",
          "type": "quantitative",
          "scale": {
            "domain": [
              80,
              270
            ],
            "nice": false
          },
          "axis": {
            "title": "Age at which recovery would stop, years",
            "values": [
              80,
              100,
              122,
              150,
              200,
              250
            ]
          }
        },
        "tooltip": [
          {
            "field": "signal"
          },
          {
            "field": "shape",
            "title": "shape"
          },
          {
            "field": "lab",
            "title": "critical age"
          }
        ],
        "y": {
          "field": "shape",
          "type": "nominal",
          "sort": [
            "straight line (paper)",
            "square root",
            "square",
            "exponential decline"
          ],
          "axis": {
            "title": null,
            "ticks": false,
            "domain": false,
            "minExtent": 140,
            "maxExtent": 140
          }
        },
        "yOffset": {
          "field": "signal",
          "type": "nominal",
          "sort": [
            "blood counts",
            "step counts"
          ],
          "scale": {
            "paddingInner": 0.3
          }
        }
      }
    },
    {
      "transform": [
        {
          "filter": "datum.signal == 'step counts'"
        }
      ],
      "mark": {
        "type": "point",
        "style": "alt",
        "shape": "square",
        "filled": true,
        "size": 70
      },
      "encoding": {
        "x": {
          "field": "x",
          "type": "quantitative"
        },
        "tooltip": [
          {
            "field": "signal"
          },
          {
            "field": "shape",
            "title": "shape"
          },
          {
            "field": "lab",
            "title": "critical age"
          }
        ],
        "y": {
          "field": "shape",
          "type": "nominal",
          "sort": [
            "straight line (paper)",
            "square root",
            "square",
            "exponential decline"
          ],
          "axis": {
            "title": null,
            "ticks": false,
            "domain": false,
            "minExtent": 140,
            "maxExtent": 140
          }
        },
        "yOffset": {
          "field": "signal",
          "type": "nominal",
          "sort": [
            "blood counts",
            "step counts"
          ],
          "scale": {
            "paddingInner": 0.3
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
        "fontSize": 12,
        "dy": -9
      },
      "encoding": {
        "x": {
          "field": "x",
          "type": "quantitative"
        },
        "text": {
          "field": "lab2"
        },
        "y": {
          "field": "shape",
          "type": "nominal",
          "sort": [
            "straight line (paper)",
            "square root",
            "square",
            "exponential decline"
          ],
          "axis": {
            "title": null,
            "ticks": false,
            "domain": false,
            "minExtent": 140,
            "maxExtent": 140
          }
        },
        "yOffset": {
          "field": "signal",
          "type": "nominal",
          "sort": [
            "blood counts",
            "step counts"
          ],
          "scale": {
            "paddingInner": 0.3
          }
        }
      },
      "transform": [
        {
          "calculate": "datum.form == 'straight line' ? datum.lab + ' ' + datum.signal : datum.lab",
          "as": "lab2"
        }
      ]
    }
  ],
  "usermeta": {
    "axisAllowance": 150
  }
}
```

### Variance and heterogeneity

The second line of evidence is that the variance of DOSI across people of the same age rises with age, so that its inverse falls roughly linearly between 40 and 73, the oldest age with data.[^pyrkov2021] A rising variance across people is also what is expected if people simply age at different rates. A model in which each person's state drifts at its own constant rate, with no critical point, gives a variance $v_0 + s^2(t - 20)^2$. Fitted to the same points, with the same number of parameters, it fits the NHANES blood-count data slightly better than the critical model and the other two data sets about as well (Figure 3). The two models agree where there are data and diverge only beyond them.

```vega-lite
{
  "$schema": "https://vega.github.io/schema/vega-lite/v6.json",
  "description": "Figure 3. Two explanations for the rising variance of a mortality-risk score across people of the same age. Dots are the inverse of the variance in each age group, read from Figure 3D of Pyrkov and colleagues (2021). The critical-point model is a straight line that reaches zero, where variance becomes infinite. The alternative assumes no critical point: each person's score drifts at its own constant rate, and the rates differ between people. Both models have two parameters and fit the data about equally well. Drag the slider to extend them beyond the oldest age with data.",
  "params": [
    {
      "name": "ds",
      "value": "NHANES blood counts",
      "bind": {
        "input": "select",
        "options": [
          "NHANES blood counts",
          "GEROLONG blood counts",
          "NHANES physical activity"
        ],
        "name": "Data set"
      }
    },
    {
      "name": "horizon",
      "value": 140,
      "bind": {
        "input": "range",
        "min": 75,
        "max": 200,
        "step": 1,
        "name": "Extend the models to age"
      }
    }
  ],
  "data": {
    "url": "/attachments/resilience-variance.csv"
  },
  "transform": [
    {
      "filter": "datum.dataset == ds"
    }
  ],
  "width": 560,
  "height": 300,
  "encoding": {
    "x": {
      "field": "age",
      "type": "quantitative",
      "scale": {
        "domain": [
          35,
          200
        ],
        "nice": false
      },
      "axis": {
        "title": "Age, years",
        "values": [
          40,
          60,
          80,
          100,
          120,
          140,
          160,
          180,
          200
        ]
      }
    },
    "y": {
      "field": "inverse_variance",
      "type": "quantitative",
      "scale": {
        "domain": [
          0,
          5
        ],
        "nice": false
      },
      "axis": {
        "title": "1 / variance (higher = more stable)",
        "values": [
          0,
          1,
          2,
          3,
          4,
          5
        ]
      }
    }
  },
  "layer": [
    {
      "transform": [
        {
          "filter": "datum.series == 'critical' && datum.age <= horizon"
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
          "filter": "datum.series == 'heterogeneity' && datum.age <= horizon"
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
          "filter": "datum.series == 'data'"
        }
      ],
      "mark": {
        "type": "point",
        "style": "observed",
        "filled": true,
        "size": 40,
        "opacity": 1
      },
      "encoding": {
        "tooltip": [
          {
            "field": "age",
            "format": ".0f"
          },
          {
            "field": "inverse_variance",
            "format": ".2f",
            "title": "1 / variance"
          }
        ]
      }
    },
    {
      "transform": [
        {
          "filter": "datum.series == 'critical' && datum.age <= horizon"
        },
        {
          "joinaggregate": [
            {
              "op": "max",
              "field": "age",
              "as": "m"
            }
          ]
        },
        {
          "filter": "datum.age == datum.m"
        }
      ],
      "mark": {
        "type": "text",
        "style": "model-label",
        "align": "left",
        "dx": 6,
        "dy": -8
      },
      "encoding": {
        "text": {
          "value": "critical point"
        }
      }
    },
    {
      "transform": [
        {
          "filter": "datum.series == 'heterogeneity' && datum.age <= horizon"
        },
        {
          "joinaggregate": [
            {
              "op": "max",
              "field": "age",
              "as": "m"
            }
          ]
        },
        {
          "filter": "datum.age == datum.m"
        }
      ],
      "mark": {
        "type": "text",
        "style": "alt-label",
        "align": "left",
        "dx": 6,
        "dy": 12
      },
      "encoding": {
        "text": {
          "value": "different ageing rates"
        }
      }
    }
  ]
}
```

Blood counts in particular vary between people far more than within them: in a study of thousands of patients, "setpoints are patient-specific, with the typical healthy adult's 9 CBC setpoints distinguishable as a group from those of 98% of other healthy adults, and differences persist for at least 20 years".[^foy2025] Most of the variance across people therefore reflects stable differences between them, not the fluctuations within one person that the relation $\sigma^2 \sim B/\varepsilon$ describes.

### What the recovery rate measures

The decay of a person's fluctuations measures the restoring force $\varepsilon$ only if the perturbations themselves are brief and random. The blood tests were not collected for research: the authors noted "an enrollment bias: many of the GEROLONG blood samples were obtained from patients visiting clinic centers, presumably due to health issues".[^pyrkov2021] Illnesses, investigations and treatments last weeks, and if they last longer in older patients, fluctuations decay more slowly without any change in resilience. Each person's mean was estimated from 10–20 irregular samples, individual trends over the 42 months were not removed, and the analysed subset was selected by thresholding DOSI itself.[^pyrkov2021] None of these effects was estimated. No analysis linked an individual's recovery time to that individual's later mortality; asked about this, the authors replied that "The data is indeed scarce and it is hard to make a solid statement."[^pyrkov2021review]

### Review and consistency

One reviewer, Karen Bandeen-Roche, wrote in the first round that "The data analytic findings are insufficiently justified because they are very highly model dependent", and that "In Figure 3A, such an extrapolation relies on only a few data points"; in the second, that "Very substantial extrapolation remains in Figure 3."[^pyrkov2021review] The published paper kept the extrapolation and the limit in its abstract. The paper describes the range of recovery times as "from about 2 weeks to over 8 weeks" in the Introduction and "3–6 weeks" in the Discussion, and gives the step-count cohort as "3032 females, 1783 males" in the Results and "4532 users ... (1601 male and 2892 female)" in the Methods, which sum to 4,815 and 4,493.[^pyrkov2021] The authors told the reviewers that "We are planning to make the data available for everyone once the manuscript is accepted"; the published data statement offers additional data "on reasonable request".[^pyrkov2021review][^pyrkov2021] No independent group has measured recovery times of blood counts by age.

## Evidence in mice

Konstantin Avchaciov and colleagues trained a neural network on blood counts from the Mouse Phenome Database to produce a *dynamic frailty indicator* (dFI), and reported that it grew exponentially with age at "α = 0.02 per week", consistent with the unstable regime.[^avchaciov2022] The group's prediction that mortality levels off at a value close to α was checked by eye, and the paper conceded that in humans the observed levelling-off occurs when mortality "is already well beyond the theoretical limit corresponding to the mortality rate doubling rate by almost an order of magnitude".[^avchaciov2022]

Two of the paper's tests of the indicator are weaker than reported. Its claim that rapamycin slowed the indicator, "significantly lower under treatment (p = 0.05, Student's two-tailed t test)", treated 36 and 204 successive changes from 12 treated and 48 control mice as independent; with each mouse counted once, the same released data give *P* = 0.065 (Welch's test) or 0.156 (Student's) (see Data and figures).[^avchaciov2022] The Results also state that "48 animals (the treatment group) were treated with rapamycin", whereas the released data have 12. An independent analysis of five data sets, using a related stochastic model, reported: "we have now failed to observe an instability in 5 data sets using the SF model, using either BAs or health biomarkers", and added that "a slow instability is indistinguishable from linear drift until advanced ages—where data are sparse".[^pridham2024]

## Independent evidence on resilience

Spencer Farrell and colleagues measured how often binary health deficits appear and disappear in three mouse data sets and an English cohort, and found "a conserved decline with age in robustness and resilience in mice and humans".[^farrell2022] Their resilience is a repair rate, measured longitudinally, and it declined; it did not approach zero. In mice, senescent cells induced by lung injury were cleared with a half-life of 4.7 days at 3 months and about 18 days at 22 months.[^karin2019] These results support the general claim that recovery slows with age, which is also the most robust part of the critical-point model. They do not bear on the existence of a critical point or its timing.

## Relation to other models

The [[saturating-removal-model-of-senescence|saturating-removal model]] of Omer Karin, Uri Alon and colleagues makes the same qualitative argument with a named variable: senescent cells are produced faster with age, their removal saturates, and fluctuations become more persistent as production approaches the maximum removal rate.[^karin2019] Its critical age is the age at which production equals maximum removal. Fitted to human survival curves, it lies at 3.96 × 10⁴ days (108 years) for men and 4.08 × 10⁴ days (112 years) for women; mice, flies, nematodes and yeast fall in a "ballistic" regime in which production outpaces removal over most of life, and humans, dogs, cats and guinea pigs in a "quasi-steady-state" regime in which damage tracks a balance between production and removal.[^raz2026] Raz and colleagues noted the parallel: "Recently Fedichev et al. proposed a stochastic ODE model derived from expansion of modes in an interacting system, with similarities to the SR model, and noted that mice and humans have quasi-stable versus stable dynamics."[^raz2026] Pyrkov and colleagues do not cite the saturating-removal model.[^pyrkov2021] Both models rely partly on correlations between successive measurements across individuals, which also rise with age when individuals differ in their rates of change; in the saturating-removal model's own data the rise is significant on a linear scale but not on a logarithmic one (see [[saturating-removal-model-of-senescence#the-model|Saturating-removal model]]).

Both are first-passage models in the sense of Strehler and Mildvan, in which death occurs when a declining capacity is first exceeded; the critical point corresponds to the vanishing of that capacity.[^pyrkov2021] (See [[Mortality rate models#explanations-of-the-gompertz-law|Mortality rate models]] and [[reliability-theory-of-ageing|Reliability theory of ageing]].)

## Assessment

The model's qualitative picture, that physiological recovery slows with age and that the slowing reflects an organism-wide loss of stability, is plausible and partly supported. Its quantitative claims are not. The 120–150-year limit rests on a straight line through five or six points, extended far beyond them; the shape of the line is an assumption on which the limit depends entirely; the variance data are equally consistent with differences between people in their rate of ageing; the recovery-time estimates come from clinic blood tests whose perturbations were not controlled; and the data have not been released. The claim that the limit is "independent of stress factors" was not tested. The mouse instability rests on an indicator whose intervention test, analysed per animal, is not significant, and an independent analysis of five data sets found no instability. The authors' own statement to reviewers, that no available data show an actual divergence, is the most accurate summary of the evidence.

## History

Valeria Kogan, Fedichev and colleagues analysed the stability of gene-regulatory networks in 2015, and in a preprint the same year Podolskiy and colleagues proposed that the critical dynamics of such networks explain the Gompertz law.[^kogan2015][^podolskiy2015] Pyrkov and colleagues introduced biological-age measures from physical activity in 2018, and the human recovery-time analysis and its 120–150-year limit in 2021.[^pyrkov2018][^pyrkov2021] Avchaciov and colleagues published the mouse dynamic frailty indicator in 2022.[^avchaciov2022] In 2024 Andrei Tarkhov, Kirill Denisov and Fedichev attributed the linear decline of resilience to the accumulation of "entropic" damage, writing that "there is no way to measure the recovery rate in cross-sectional data".[^tarkhov2024]

## Data and figures

Figures 1 and 2 use recovery rates read from Figure 3C of Pyrkov and colleagues (2021) by colour segmentation of the published image, accurate to about ±0.005 per week; the straight-line fits reproduce the paper's zero crossings of 125 and 148 years. Curves of the form $\varepsilon = A(t_c - t)^p$ with $p$ = ½, 1 and 2, and an exponential decline, were fitted by least squares; the 95% interval for the straight line's zero crossing is Fieller's. Figure 3 uses inverse variances read from Figure 3D of the same paper; both models have two parameters, and the difference in Akaike information criterion is 1.5 in favour of the heterogeneity model for NHANES blood counts, −0.5 for GEROLONG and 0.6 for NHANES activity. The sixfold change in the Gompertz slope follows from a barrier proportional to $(t_c - t)^3$ with $t_c$ = 125: the slope is proportional to $(t_c - t)^2$, which is $(85/35)^2 \approx 5.9$ times larger at 40 than at 90. The rapamycin reanalysis uses the file `rapamycin_data.csv` released with Avchaciov and colleagues (2022), comparing the change in dFI between weeks 67 and 75 for each mouse. These reanalyses were made for this article.

[^pyrkov2021]: Pyrkov TV, Avchaciov K, Tarkhov AE, Menshikov LI, Gudkov AV, et al. (2021). "Longitudinal analysis of blood markers reveals progressive loss of resilience and predicts human lifespan limit". *Nature Communications*. 12: 2765. [doi:10.1038/s41467-021-23014-1](https://doi.org/10.1038/s41467-021-23014-1)

[^pyrkov2021review]: Pyrkov TV, Avchaciov K, Tarkhov AE, Menshikov LI, Gudkov AV, et al. (2021). Peer Review File for "Longitudinal analysis of blood markers reveals progressive loss of resilience and predicts human lifespan limit". *Nature Communications*. 12: 2765. [doi:10.1038/s41467-021-23014-1](https://doi.org/10.1038/s41467-021-23014-1)

[^avchaciov2022]: Avchaciov K, Antoch MP, Andrianova EL, Tarkhov AE, Menshikov LI, et al. (2022). "Unsupervised learning of aging principles from longitudinal data". *Nature Communications*. 13: 6529. [doi:10.1038/s41467-022-34051-9](https://doi.org/10.1038/s41467-022-34051-9)

[^farrell2022]: Farrell S, Kane AE, Bisset E, Howlett SE, Rutenberg AD (2022). "Measurements of damage and repair of binary health attributes in aging mice and humans reveal that robustness and resilience decrease with age, operate over broad timescales, and are affected differently by interventions". *eLife*. 11: e77632. [doi:10.7554/eLife.77632](https://doi.org/10.7554/eLife.77632)

[^karin2019]: Karin O, Agrawal A, Porat Z, Krizhanovsky V, Alon U (2019). "Senescent cell turnover slows with age providing an explanation for the Gompertz law". *Nature Communications*. 10: 5495. [doi:10.1038/s41467-019-13192-4](https://doi.org/10.1038/s41467-019-13192-4)

[^raz2026]: Raz N, Yang Y, Pridham G, Shenhar B, Frenkel S, et al. (2026). "A damage accumulation model identifies distinct aging regimes across species". *Nature Aging*. 6 (6): 1330–1340. [doi:10.1038/s43587-026-01138-7](https://doi.org/10.1038/s43587-026-01138-7)

[^robine2019]: Robine JM, Allard M, Herrmann FR, Jeune B (2019). "The real facts supporting Jeanne Calment as the oldest ever human". *The Journals of Gerontology: Series A*. 74 (Suppl 1): S13–S20. [doi:10.1093/gerona/glz198](https://doi.org/10.1093/gerona/glz198)

[^foy2025]: Foy BH, Petherbridge R, Roth MT, Zhang C, De Souza DC, et al. (2025). "Haematological setpoints are a stable and patient-specific deep phenotype". *Nature*. 637 (8045): 430–438. [doi:10.1038/s41586-024-08264-5](https://doi.org/10.1038/s41586-024-08264-5)

[^pridham2024]: Pridham G, Rutenberg AD (2024). "Dynamical network stability analysis of multiple biological ages provides a framework for understanding the aging process". *The Journals of Gerontology: Series A*. 79 (10): glae021. [doi:10.1093/gerona/glae021](https://doi.org/10.1093/gerona/glae021)

[^kogan2015]: Kogan V, Molodtsov I, Menshikov LI, Reis RJS, Fedichev P (2015). "Stability analysis of a model gene network links aging, stress resistance, and negligible senescence". *Scientific Reports*. 5: 13589. [doi:10.1038/srep13589](https://doi.org/10.1038/srep13589)

[^podolskiy2015]: Podolskiy D, Molodtsov I, Zenin A, Kogan V, Menshikov LI, et al. (2015). "Critical dynamics of gene networks is a mechanism behind ageing and Gompertz law". *arXiv*. 1502.04307. [doi:10.48550/arXiv.1502.04307](https://doi.org/10.48550/arXiv.1502.04307)

[^pyrkov2018]: Pyrkov TV, Getmantsev E, Zhurov B, Avchaciov K, Pyatnitskiy M, et al. (2018). "Quantitative characterization of biological age and frailty based on locomotor activity records". *Aging*. 10 (10): 2973–2990. [doi:10.18632/aging.101603](https://doi.org/10.18632/aging.101603)

[^tarkhov2024]: Tarkhov AE, Denisov KA, Fedichev PO (2024). "Aging clocks, entropy, and the challenge of age reversal". *Aging Biology*. 2: 20240031. [doi:10.59368/agingbio.20240031](https://doi.org/10.59368/agingbio.20240031)
