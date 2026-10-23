---
title: First-passage models of mortality
tags:
  - content/wiki
date: 2026-10-14
draft: true
aliases:
  - First-passage model of mortality
  - First-hitting-time models
  - Threshold models of mortality
  - Vitality models
  - Inverse Gaussian mortality model
---
# First-passage models of mortality

In a **first-passage model of mortality**, each individual carries a hidden state, such as "vitality", accumulated damage or a physiological variable, that changes randomly over time, and death occurs when the state first crosses a threshold. The lifespan is the first-passage time of a stochastic process. Models of this kind go back to Sacher and Trucco in 1962 and include the vitality models of Joshua Weitz and Hunter Fraser and of James Anderson and Ting Li, the stochastic process models of Anatoliy Yashin and colleagues, the [[saturating-removal-model-of-senescence|saturating-removal model]] of senescent cells and, in a closely related form, the [[strehler-mildvan-theory|Strehler–Mildvan theory]].[^sacher1962][^weitz2001][^li2015][^karin2019]

Four results hold across the family. A state that drifts towards the threshold at a constant rate gives a mortality rate that rises to a single peak and then falls to a plateau; it never follows the [[Mortality rate models#gompertz-law|Gompertz law]].[^weitz2001] The plateau is a generic property of any such process whose rules do not change with age, because the survivors' states settle into a fixed distribution; but models of fixed differences between individuals produce a plateau too, so a plateau in data does not favour either.[^steinsaltz2004] The Gompertz law appears only when the drift or the threshold changes with age in a particular way, which has to be assumed.[^raz2026] And survival data alone cannot identify the process: almost any distribution of lifespans can be produced by choosing where individuals start.[^steinsaltz2004] What distinguishes these models is measurements of the state itself.

## The framework

A first-hitting-time model has "two basic components: (1) a parent stochastic process … and (2) a boundary set", and the lifespan is the first time the process enters the boundary.[^lee2006] In most applications "the process is latent (i.e., unobservable)".[^lee2006] The threshold may be fixed or move with age, and death may be a hard crossing or a rate that rises with the state; David Steinsaltz and Steven Evans treated all of these as "markov mortality models", in which a process is killed at a time that depends on its state.[^steinsaltz2004]

## Constant drift: the inverse Gaussian

In the simplest model, vitality starts at $v_0$, declines at a constant rate $\varepsilon$ and fluctuates with noise of strength $\sigma$, and death occurs when vitality reaches zero:

$$
v(t) = v_0 - \varepsilon t + \sigma W(t).
$$

The lifespan then has an inverse Gaussian distribution, with mean $v_0/\varepsilon$ and squared coefficient of variation $\sigma^2/(v_0\varepsilon)$.[^weitz2001][^aalen2001] Measured in units of the mean lifespan, the shape of the mortality curve depends on a single number, $\rho = v_0\varepsilon/\sigma^2$, the inverse of the squared coefficient of variation: the larger $\rho$, the more regular the lifespans. The mortality rate rises to a single maximum and then declines to a plateau of $\varepsilon^2/(2\sigma^2)$, which equals

$$
\text{plateau} = \frac{1}{2 \cdot \mathrm{CV}^2 \cdot \text{mean lifespan}}.
$$

Figure 1 shows the whole family. While the mortality rate rises, its exponential slope falls continuously, so no part of the curve follows the Gompertz law. Weitz and Fraser, who proposed the model to explain mortality plateaus, wrote that "the rapid increase of hazard rate in all cases is slower than exponential. As it stands, the model is insufficient to explain mortality curves that have sustained Gompertz-type behavior at intermediate times."[^weitz2001] Fitted to 1.2 million Mediterranean fruit flies, the model gave $\hat\varepsilon$ = 0.0448 and $\hat\sigma$ = 0.0975, a mean lifespan of 22.3 days and $\rho$ = 4.7.[^weitz2001][^carey1992] At these values the mortality rate peaks at 0.116 a day at day 64, when about 1 in 250 flies is still alive, and then falls by about 10% to its plateau of 0.106.

```vega-lite
{
  "$schema": "https://vega.github.io/schema/vega-lite/v6.json",
  "description": "Figure 1. Mortality in the simplest first-passage model, a state drifting towards a threshold at a constant rate with random fluctuations (the inverse Gaussian). Age and mortality are measured in units of the mean lifespan, so a single number ρ, the inverse of the squared coefficient of variation of lifespan, sets the shape. The mortality rate rises to a peak and falls to a plateau of ρ/2 (dashed); the faint part of the curve is where fewer than 1 in 1,000 are still alive. Drag the slider: small ρ gives an early peak and a long decline, large ρ a slow rise whose peak is barely visible. No setting gives a straight line, which the Gompertz law would be on this logarithmic scale. The fit to Mediterranean fruit flies corresponds to ρ = 4.7, slider position 13.",
  "params": [
    {
      "name": "ri",
      "value": 9,
      "bind": {
        "input": "range",
        "min": 0,
        "max": 30,
        "step": 1,
        "name": "Regularity of lifespan (ρ, on a log scale)"
      }
    }
  ],
  "data": {
    "url": "/attachments/first-passage-hazard-shapes.csv"
  },
  "transform": [
    {
      "filter": "datum.rho_index == ri"
    }
  ],
  "width": 560,
  "height": 300,
  "layer": [
    {
      "transform": [
        {
          "filter": "datum.log10_survival >= -3"
        }
      ],
      "mark": {
        "type": "line",
        "style": "model",
        "clip": true
      },
      "encoding": {
        "x": {
          "field": "t",
          "type": "quantitative",
          "scale": {
            "domain": [
              0,
              8
            ],
            "nice": false
          },
          "axis": {
            "title": "Age, in units of the mean lifespan",
            "values": [
              0,
              1,
              2,
              3,
              4,
              5,
              6,
              7,
              8
            ]
          }
        },
        "y": {
          "field": "hazard",
          "type": "quantitative",
          "scale": {
            "type": "log",
            "domain": [
              0.01,
              200
            ]
          },
          "axis": {
            "title": "Mortality rate × mean lifespan",
            "values": [
              0.01,
              0.1,
              1,
              10,
              100
            ],
            "format": "~g"
          }
        }
      }
    },
    {
      "transform": [
        {
          "filter": "datum.log10_survival < -3"
        }
      ],
      "mark": {
        "type": "line",
        "style": "model",
        "opacity": 0.3,
        "clip": true
      },
      "encoding": {
        "x": {
          "field": "t",
          "type": "quantitative"
        },
        "y": {
          "field": "hazard",
          "type": "quantitative"
        }
      }
    },
    {
      "transform": [
        {
          "aggregate": [
            {
              "op": "max",
              "field": "plateau",
              "as": "p"
            }
          ]
        }
      ],
      "mark": {
        "type": "rule",
        "style": "guide"
      },
      "encoding": {
        "y": {
          "field": "p",
          "type": "quantitative"
        }
      }
    },
    {
      "transform": [
        {
          "aggregate": [
            {
              "op": "max",
              "field": "plateau",
              "as": "p"
            },
            {
              "op": "max",
              "field": "rho",
              "as": "rho"
            }
          ]
        },
        {
          "calculate": "8",
          "as": "x"
        },
        {
          "calculate": "'plateau ρ/2 = ' + format(datum.p, '.3~g')",
          "as": "t"
        }
      ],
      "mark": {
        "type": "text",
        "style": "observed-label",
        "align": "right",
        "dy": -8
      },
      "encoding": {
        "x": {
          "field": "x",
          "type": "quantitative"
        },
        "y": {
          "field": "p",
          "type": "quantitative"
        },
        "text": {
          "field": "t"
        }
      }
    },
    {
      "transform": [
        {
          "aggregate": [
            {
              "op": "max",
              "field": "rho",
              "as": "rho"
            }
          ]
        },
        {
          "calculate": "'ρ = ' + format(datum.rho, '.3~g') + ', coefficient of variation of lifespan ' + format(1 / sqrt(datum.rho), '.2f')",
          "as": "t"
        }
      ],
      "mark": {
        "type": "text",
        "style": "label",
        "align": "left",
        "x": 6,
        "y": 10
      },
      "encoding": {
        "text": {
          "field": "t"
        }
      }
    },
    {
      "transform": [
        {
          "filter": "datum.log10_survival < -3"
        },
        {
          "aggregate": [
            {
              "op": "min",
              "field": "t",
              "as": "t0"
            }
          ]
        },
        {
          "calculate": "'faint: fewer than 1 in 1,000 still alive'",
          "as": "t"
        }
      ],
      "mark": {
        "type": "text",
        "style": "observed-label",
        "align": "left",
        "dx": 4,
        "y": {
          "expr": "height - 12"
        }
      },
      "encoding": {
        "x": {
          "field": "t0",
          "type": "quantitative"
        },
        "text": {
          "field": "t"
        }
      }
    }
  ]
}
```

## Why survivors' mortality levels off

Steinsaltz and Evans showed that the plateau is not a peculiarity of particular models: "the convergence to a 'mortality plateau' — is, in fact, a generic consequence of the convergence to a 'quasistationary distribution'".[^steinsaltz2004] As time passes, the states of the survivors settle into a fixed distribution, the quasistationary distribution, determined by the balance between random motion, which spreads them out, and the threshold, which removes those that come close to it. Once the survivors' distribution stops changing, so does their mortality rate. The survivors are not an exceptional subset selected at birth; they are typical members of a homogeneous population whose current state reflects the fact that they have survived. The authors called this "an evolving heterogeneity theory of mortality tapering", and wrote that "a markov process would need to be fairly pathological to escape such behavior".[^steinsaltz2004] For the inverse Gaussian, the hazard at any time is proportional to the slope of the survivors' density at the threshold, which first steepens as the population moves towards it and then flattens as the survivors spread into the quasistationary distribution.[^aalen2001]

The plateau is generic only when the rules of the process do not change with age. When the drift keeps growing, as in the saturating-removal model, mortality keeps rising; when individuals differ in drift and some drift away from the threshold, mortality eventually falls towards zero.[^aalen2001] And the plateau is reached only when very few are left: in the fruit-fly fit, mortality comes within 10% of its plateau only when about 1 in 400 flies is alive. Weitz and Fraser noted that "small cohorts essentially veil the presence of mortality plateaus".[^weitz2001]

A plateau also arises from fixed differences between individuals. If each individual's mortality follows the Gompertz law but individuals differ by a gamma-distributed frailty factor, the frailest die first and the population's mortality rate levels off at the Gompertz slope divided by the variance of frailty.[^vaupel1979] Elisabetta Barbi and colleagues reported a plateau of 0.645 a year in Italians aged over 105, after a slope of 0.103 a year at ages 65–80;[^barbi2018] a gamma-Gompertz model with frailty variance 0.16 reproduces both numbers, and so could a first-passage model. Both mechanisms produce plateaus, so the existence of a plateau cannot decide between them. (See [[Mortality rate models#late-life-deceleration-and-the-plateau-debate|Mortality rate models]].)

## Where individuals start

The shape of the mortality curve depends as much on where individuals start as on the process. For a state drifting towards the threshold at a constant rate, a start spread out as $x^k e^{-x}$ gives a lifespan with a gamma distribution, whose mortality rate falls with age if $k$ < 1, is constant if $k$ = 1 and rises if $k$ > 1; a start at a single point gives the inverse Gaussian, whose rate rises to a peak or falls, depending on the distance to the threshold. All of these approach the same plateau (Figure 2).[^aalen2001] Steinsaltz and Evans proved that an appropriate choice of starting distribution lets a constant-drift model approximate almost any distribution of lifespans, and concluded: "This illustrates how precarious it can be to read a model's vindication from the consilience with a favored hazard-rate function, such as the Gompertz exponential."[^steinsaltz2004]

```vega-lite
{
  "$schema": "https://vega.github.io/schema/vega-lite/v6.json",
  "description": "Figure 2. One process, different starting distributions. The state drifts towards a threshold at unit rate with unit noise; only where individuals start differs. A start spread out as x^k e^(−x) gives mortality that falls (k < 1), stays constant (k = 1) or rises (k > 1); a start at a single distance c gives mortality that falls, or rises to a peak, depending on c. All curves approach the same plateau of 0.5. Choose the kind of start.",
  "params": [
    {
      "name": "fam",
      "value": "spread-out start",
      "bind": {
        "input": "select",
        "options": [
          "spread-out start",
          "single starting point"
        ],
        "name": "Starting distribution"
      }
    }
  ],
  "data": {
    "url": "/attachments/first-passage-starts.csv"
  },
  "transform": [
    {
      "filter": "datum.family == fam"
    },
    {
      "filter": "indexof(['0','1','2','4','8','0.2','5'], toString(datum.param)) >= 0 || (datum.family == 'single starting point' && toString(datum.param) == '2')"
    }
  ],
  "width": 560,
  "height": 300,
  "encoding": {
    "x": {
      "field": "t",
      "type": "quantitative",
      "scale": {
        "domain": [
          0,
          10
        ],
        "nice": false
      },
      "axis": {
        "title": "Time",
        "values": [
          0,
          2,
          4,
          6,
          8,
          10
        ]
      }
    },
    "y": {
      "field": "hazard",
      "type": "quantitative",
      "scale": {
        "type": "log",
        "domain": [
          0.01,
          10
        ]
      },
      "axis": {
        "title": "Mortality rate",
        "values": [
          0.01,
          0.1,
          0.5,
          1,
          10
        ],
        "format": "~g"
      }
    }
  },
  "layer": [
    {
      "data": {
        "values": [
          {
            "y": 0.5
          }
        ]
      },
      "mark": {
        "type": "rule",
        "style": "guide"
      },
      "encoding": {
        "y": {
          "field": "y",
          "type": "quantitative"
        },
        "x": null
      }
    },
    {
      "data": {
        "values": [
          {
            "x": 10,
            "y": 0.5,
            "t": "plateau 0.5"
          }
        ]
      },
      "mark": {
        "type": "text",
        "style": "observed-label",
        "align": "right",
        "dy": -8
      },
      "encoding": {
        "x": {
          "field": "x",
          "type": "quantitative"
        },
        "y": {
          "field": "y",
          "type": "quantitative"
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
        "strokeWidth": 1.6,
        "clip": true
      },
      "encoding": {
        "detail": {
          "field": "param"
        },
        "tooltip": [
          {
            "field": "family"
          },
          {
            "field": "param",
            "title": "k or c"
          },
          {
            "field": "t",
            "format": ".2f"
          },
          {
            "field": "hazard",
            "format": ".3~g"
          }
        ]
      }
    },
    {
      "transform": [
        {
          "filter": "abs(datum.t - 0.6) < 0.021 && datum.hazard > 0.012"
        },
        {
          "calculate": "fam == 'spread-out start' ? 'k = ' + datum.param : 'c = ' + datum.param",
          "as": "lab"
        }
      ],
      "mark": {
        "type": "text",
        "style": "label",
        "align": "left",
        "dx": 4,
        "fontSize": 12
      },
      "encoding": {
        "text": {
          "field": "lab"
        }
      }
    },
    {
      "transform": [
        {
          "filter": "fam == 'spread-out start' && toString(datum.param) == '8' && abs(datum.t - 4) < 0.021"
        }
      ],
      "mark": {
        "type": "text",
        "style": "label",
        "align": "left",
        "dx": 4,
        "dy": -8,
        "fontSize": 12
      },
      "encoding": {
        "text": {
          "value": "k = 8"
        }
      }
    },
    {
      "transform": [
        {
          "filter": "fam == 'single starting point' && toString(datum.param) == '5' && abs(datum.t - 4) < 0.021"
        }
      ],
      "mark": {
        "type": "text",
        "style": "label",
        "align": "left",
        "dx": 4,
        "dy": -8,
        "fontSize": 12
      },
      "encoding": {
        "text": {
          "value": "c = 5"
        }
      }
    }
  ]
}
```

## Getting the Gompertz law

To produce the Gompertz law, a first-passage model needs structure that changes with age. When noise must carry the state over a barrier, the escape rate is approximately proportional to $e^{-\Delta U(t)/\varepsilon}$, where $\Delta U(t)$ is the height of the barrier and $\varepsilon$ the strength of the noise. The slope of log mortality is then $-(1/\varepsilon)\,\mathrm{d}\Delta U/\mathrm{d}t$, so mortality follows the Gompertz law only if the barrier falls linearly with age. The Strehler–Mildvan theory has the same structure: there, mortality is proportional to $e^{-V(t)/D}$, where vitality $V$ falls linearly and $D$ is the mean size of random challenges.

In the [[saturating-removal-model-of-senescence|saturating-removal model]], damage is produced at a rate $\eta t$ that rises in proportion to age and removed at a rate that saturates, and death occurs when damage crosses a threshold.[^karin2019] The authors who fitted it to the survival curves of many species stated that "The linear rise of damage with age is required in the model to produce the Gompertz law, in which mortality hazard grows exponentially with time exp(αt). If one changes the linear rise ηt to, say, a quadratic rise ηt², one would get h ~ exp(αt²) instead of the Gompertz law."[^raz2026] The Gompertz shape is therefore an input, not an output. Saturation is not needed for it either: a model in which damage is removed at a rate proportional to its level, with production rising in proportion to age, gives a slope of log mortality that varies less with age than the saturating-removal fits do (Figure 3). The evidence for saturating removal is the measured slowing of senescent-cell turnover in old mice, not the shape of the mortality curve.[^karin2019]

```vega-lite
{
  "$schema": "https://vega.github.io/schema/vega-lite/v6.json",
  "description": "Figure 3. The rate of ageing, measured as the slope of log mortality, at human ages in several models. The Gompertz law (dashed) has a constant slope. Choose a model to highlight it; the others are shown faintly. Saturating removal falls gently and keeps mortality rising at 110; linear removal with production rising in proportion to age is closer to the Gompertz law; the inverse Gaussian, fitted to the same deaths as the Gompertz law, falls steeply after 50; reliability theory's series-parallel model and gamma frailty fall towards zero. Parameters are listed under Data and figures.",
  "params": [
    {
      "name": "m",
      "value": "Saturating removal (Karin 2019)",
      "bind": {
        "input": "select",
        "options": [
          "Saturating removal (Karin 2019)",
          "Saturating removal (Raz 2026, men)",
          "Linear removal, rising production",
          "Constant drift (inverse Gaussian)",
          "Series-parallel reliability",
          "Gompertz law with gamma frailty"
        ],
        "name": "Model"
      }
    }
  ],
  "data": {
    "url": "/attachments/first-passage-ageing-rate.csv"
  },
  "width": 560,
  "height": 300,
  "encoding": {
    "x": {
      "field": "age",
      "type": "quantitative",
      "scale": {
        "domain": [
          30,
          110
        ],
        "nice": false
      },
      "axis": {
        "title": "Age, years",
        "values": [
          30,
          40,
          50,
          60,
          70,
          80,
          90,
          100,
          110
        ]
      }
    },
    "y": {
      "field": "rate",
      "type": "quantitative",
      "scale": {
        "domain": [
          0,
          0.2
        ],
        "nice": false,
        "clamp": true
      },
      "axis": {
        "title": "Rate of ageing (slope of log mortality), per year",
        "values": [
          0,
          0.05,
          0.1,
          0.15,
          0.2
        ]
      }
    }
  },
  "layer": [
    {
      "transform": [
        {
          "filter": "datum.model != m && datum.model != 'Gompertz law'"
        }
      ],
      "mark": {
        "type": "line",
        "style": "observed",
        "opacity": 0.25,
        "strokeWidth": 1,
        "clip": true
      },
      "encoding": {
        "detail": {
          "field": "model"
        }
      }
    },
    {
      "transform": [
        {
          "filter": "datum.model == 'Gompertz law'"
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
          "filter": "datum.model == m"
        }
      ],
      "mark": {
        "type": "line",
        "style": "model",
        "clip": true
      },
      "encoding": {
        "tooltip": [
          {
            "field": "model"
          },
          {
            "field": "age"
          },
          {
            "field": "rate",
            "format": ".3f",
            "title": "rate of ageing"
          },
          {
            "field": "hazard",
            "format": ".3~g",
            "title": "mortality rate"
          }
        ]
      }
    },
    {
      "transform": [
        {
          "filter": "datum.model == 'Gompertz law' && datum.age == 110"
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
          "filter": "datum.model == m"
        },
        {
          "filter": "datum.rate >= 0 && datum.rate <= 0.2"
        },
        {
          "joinaggregate": [
            {
              "op": "max",
              "field": "age",
              "as": "amax"
            }
          ]
        },
        {
          "filter": "datum.age == datum.amax"
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
          "field": "model"
        }
      }
    }
  ]
}
```

Figure 3 compares the rate of ageing, the slope of log mortality, across models at human ages. The Gompertz law is a horizontal line. The saturating-removal fits fall gently from about 0.13–0.17 a year at 30 to 0.06–0.07 at 110 and do not level off; at 105 the fit of Naveh Raz and colleagues to Danish and Swedish men predicts a mortality rate of 2.3 a year and rising, against Barbi's 0.645.[^raz2026][^barbi2018] The inverse Gaussian fitted to the same deaths as the Gompertz law falls steeply after 50. The series-parallel model of [[reliability-theory-of-ageing|reliability theory]] declines throughout.

## Identifiability

Survival data constrain these models far less than their parameters suggest.

- **Inverse Gaussian.** Only the ratios $v_0/\sigma$ and $\varepsilon/\sigma$ affect the distribution of lifespans, so one of the three parameters can be set arbitrarily.[^aalen2001]
- **Saturating removal.** Rescaling the damage variable by a factor $c$, with $\eta$, $\beta$, $\kappa$ and the threshold divided by $c$ and the noise by $c^2$, leaves survival exactly unchanged; the unit of damage is arbitrary. Raz and colleagues fixed $\kappa$ at 0.5 and reported that "The parameter sets with the best-fit scores formed elongated valleys in parameter space", and that their parameters are "mathematical constructs rather than directly measured biological quantities".[^raz2026]
- **Strehler–Mildvan.** The model has three parameters but a Gompertz curve has two degrees of freedom, so "it is impossible to specify all the parameters for a single mortality curve".[^li2015]
- **Starting distribution.** As above, almost any lifespan distribution can be obtained by choosing it.[^steinsaltz2004]

The remedy is to measure the state. Mei-Ling Ting Lee and George Whitmore proposed using marker processes: "A marker process refers to an external process that covaries with the parent process. It assists in tracking progress of the parent process if the parent process is latent or only infrequently observed."[^lee2006] Few systems have such measurements. Whole-body reporters of senescent cells in mice provided the data for the saturating-removal model,[^karin2019] and in starved *Escherichia coli* membrane damage was tracked in 635 single cells until death, although the threshold for death was set from the data: "The value of Xc is determined by the maximal X(t) observed before cells reach previously established lifespans."[^yang2023] In humans, recovery times of blood-count indices have been measured but not linked to individual deaths (see [[critical-point-model-of-ageing|Critical-point model of ageing]]).

## Models in the family

- **Sacher and Trucco (1962)** introduced a stochastic theory of mortality in which a physiological state diffuses towards a lethal boundary.[^sacher1962]
- **Weitz and Fraser (2001)** used the inverse Gaussian to explain mortality plateaus in fruit flies.[^weitz2001]
- **Odd Aalen and Håkon Gjessing (2001)** explained the shapes of hazard rates in general through first passage and quasistationarity.[^aalen2001]
- **Lee and Whitmore (2006)** developed threshold regression, in which covariates act on the starting point and drift of a latent process.[^lee2006]
- **Anderson, Li and colleagues** combined an inverse-Gaussian intrinsic process with Strehler–Mildvan extrinsic challenges acting on vitality, and fitted the model to national life tables.[^li2015]
- **Stochastic process models**, from Max Woodbury and Kenneth Manton's random-walk model of 1977 to the work of Yashin and colleagues, make the mortality rate a function of a fluctuating physiological state.[^woodbury1977]
- **The saturating-removal model** of Omer Karin, Uri Alon and colleagues (2019) adds rising production and saturating removal to obtain the Gompertz law, and has been fitted to survival curves from bacteria to humans.[^karin2019][^raz2026]
- **The critical-point model** of Peter Fedichev and colleagues describes ageing as the loss of the restoring force that keeps the state near equilibrium. (See [[critical-point-model-of-ageing|Critical-point model of ageing]].)

## Assessment

First-passage models are a natural way to think about death: an organism's condition fluctuates, worsens and eventually fails. They explain why individuals with the same starting conditions die at different ages, and they make mortality plateaus unsurprising. As explanations of the age pattern of mortality, they are weaker than they appear. The plateau they predict is shared with models of fixed heterogeneity; the Gompertz law they reproduce has to be built in through an assumed drift or barrier; and the starting distribution, the units of the state and several combinations of parameters cannot be recovered from survival curves. A first-passage model becomes a theory of ageing only when its state is measured in individuals and its dynamics are tested by perturbation, as in the senescent-cell turnover experiments of the saturating-removal model.

## Data and figures

All three figures show model calculations, not data. Figure 1 shows the inverse-Gaussian mortality rate in units of the mean lifespan for 31 values of $\rho$ from 0.25 to 256, spaced evenly on a log scale; the default, $\rho$ = 5.0, is the grid value nearest the fruit-fly fit. Figure 3 shows the slope of log mortality for: the Gompertz law with slope 0.103 a year and mortality 0.015 a year at 65; the same with gamma frailty of variance 0.16; an inverse Gaussian fitted by maximum likelihood to the Gompertz deaths after age 30; the saturating-removal model with the human parameters of Karin and colleagues ($\eta$ = 0.00135 per day per year, $\beta$ = 0.15 per day, $\kappa$ = 0.5, $\varepsilon$ = 0.142 per day, threshold 17) and with the posterior modes of Raz and colleagues for men; a model with linear removal at 1.32 a day, production rising in proportion to age and threshold 2.9, tuned to a median lifespan of 75 years; and the series-parallel model with 20,000 blocks, element failure rate 0.5% a year and 15 elements per block, the example of Steinsaltz and Evans. The saturating-removal and linear-removal curves were computed by solving the Fokker–Planck equation numerically; the solver agrees with the exact inverse-Gaussian result to within 1% except at the very first deaths. Figure 2 shows a state drifting towards the threshold at unit rate with unit noise. The rescaling symmetry of the saturating-removal model was checked by solving the model for the original and rescaled parameters. These calculations were made for this article.

[^sacher1962]: Sacher GA, Trucco E (1962). "The stochastic theory of mortality". *Annals of the New York Academy of Sciences*. 96 (4): 985–1007. [doi:10.1111/j.1749-6632.1962.tb54116.x](https://doi.org/10.1111/j.1749-6632.1962.tb54116.x)

[^weitz2001]: Weitz JS, Fraser HB (2001). "Explaining mortality rate plateaus". *Proceedings of the National Academy of Sciences*. 98 (26): 15383–15386. [doi:10.1073/pnas.261228098](https://doi.org/10.1073/pnas.261228098)

[^li2015]: Li T, Anderson JJ (2015). "The Strehler–Mildvan correlation from the perspective of a two-process vitality model". *Population Studies*. 69 (1): 91–104. [doi:10.1080/00324728.2014.992358](https://doi.org/10.1080/00324728.2014.992358)

[^karin2019]: Karin O, Agrawal A, Porat Z, Krizhanovsky V, Alon U (2019). "Senescent cell turnover slows with age providing an explanation for the Gompertz law". *Nature Communications*. 10: 5495. [doi:10.1038/s41467-019-13192-4](https://doi.org/10.1038/s41467-019-13192-4)

[^steinsaltz2004]: Steinsaltz D, Evans SN (2004). "Markov mortality models: implications of quasistationarity and varying initial distributions". *Theoretical Population Biology*. 65 (4): 319–337. [doi:10.1016/j.tpb.2003.10.007](https://doi.org/10.1016/j.tpb.2003.10.007)

[^raz2026]: Raz N, Yang Y, Pridham G, Shenhar B, Frenkel S, et al. (2026). "A damage accumulation model identifies distinct aging regimes across species". *Nature Aging*. 6 (6): 1330–1340. [doi:10.1038/s43587-026-01138-7](https://doi.org/10.1038/s43587-026-01138-7)

[^lee2006]: Lee MLT, Whitmore GA (2006). "Threshold regression for survival analysis: modeling event times by a stochastic process reaching a boundary". *Statistical Science*. 21 (4): 501–513. [doi:10.1214/088342306000000330](https://doi.org/10.1214/088342306000000330)

[^aalen2001]: Aalen OO, Gjessing HK (2001). "Understanding the shape of the hazard rate: a process point of view". *Statistical Science*. 16 (1): 1–22. [doi:10.1214/ss/998929473](https://doi.org/10.1214/ss/998929473)

[^carey1992]: Carey JR, Liedo P, Orozco D, Vaupel JW (1992). "Slowing of mortality rates at older ages in large medfly cohorts". *Science*. 258 (5081): 457–461. [doi:10.1126/science.1411540](https://doi.org/10.1126/science.1411540)

[^vaupel1979]: Vaupel JW, Manton KG, Stallard E (1979). "The impact of heterogeneity in individual frailty on the dynamics of mortality". *Demography*. 16 (3): 439–454. [doi:10.2307/2061224](https://doi.org/10.2307/2061224)

[^barbi2018]: Barbi E, Lagona F, Marsili M, Vaupel JW, Wachter KW (2018). "The plateau of human mortality: demography of longevity pioneers". *Science*. 360 (6396): 1459–1461. [doi:10.1126/science.aat3119](https://doi.org/10.1126/science.aat3119)

[^yang2023]: Yang Y, Karin O, Mayo A, Song X, Chen P, et al. (2023). "Damage dynamics and the role of chance in the timing of *E. coli* cell death". *Nature Communications*. 14: 2209. [doi:10.1038/s41467-023-37930-x](https://doi.org/10.1038/s41467-023-37930-x)

[^woodbury1977]: Woodbury MA, Manton KG (1977). "A random-walk model of human mortality and aging". *Theoretical Population Biology*. 11 (1): 37–48. [doi:10.1016/0040-5809(77)90005-3](https://doi.org/10.1016/0040-5809(77)90005-3)
