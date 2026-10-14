---
title: Saturating-removal model of senescence
tags:
  - content/wiki
date: 2026-10-14
draft: true
aliases:
  - Saturating-removal model
  - SR model
  - Karin model
---
# Saturating-removal model of senescence

The **saturating-removal model** is a mathematical model of how [[cellular-senescence|senescent cells]] accumulate with age, proposed in 2019 by Omer Karin, Amit Agrawal, Ziv Porat, Valery Krizhanovsky and Uri Alon. In the model, senescent cells are produced at a rate that rises in proportion to age and removed at a rate that saturates when they are numerous; random fluctuations are added, and an individual dies when its burden of senescent cells first crosses a threshold.[^karin2019] With these assumptions the model gives a mortality rate that rises roughly exponentially with age, as in the [[Mortality rate models#gompertz-law|Gompertz law]], and slows at the oldest ages, and it predicts that senescent cells are removed more slowly in old animals than in young ones.

The model fits one data set well: whole-body measurements of a *p16* reporter in 33 mice, followed from 8 to 80 weeks of age, where it was preferred over fifteen other production-and-removal schemes.[^karin2019] Its other claims rest on weaker ground. The test of slower removal in old mice used two time points; the fits to mortality in mice, humans, flies and nematodes used a separate set of parameters, chosen to match the survival data; and the agreement with experiments that removed senescent cells was obtained by calibrating a parameter to one of those experiments. An independent group fitted a structurally different model to the same reporter data equally well,[^kowald2020] and an independent lineage-tracing study measured half-lives of months, not days, for senescent cells that arise naturally.[^omori2020]

Three questions run through the work on the model. The first is whether, and why, the removal of senescent cells slows as they accumulate. A reviewer of the original paper found it "unlikely that senescent cells may reach such high levels in old mice as to saturate the immune system"; the authors replied that if they do not, "saturation is unlikely and slowdown of removal may be due to other mechanisms such as SASP", and added both possibilities to the paper.[^karin2019peer][^karin2019] The second is whether the burden in the model is senescent cells at all, since the same equation, with the burden read as generic damage, has since been fitted to the survival curves of species from bacteria to humans.[^raz2026] The third is whether fitting survival curves can test the model, given that the threshold for death is an assumption and the parameters are estimated from the same curves they are meant to explain.

## The model

The burden of senescent cells $X$ changes as

$$
\frac{\mathrm{d}X}{\mathrm{d}t} = \eta\,t - \frac{\beta X}{\kappa + X} + \sqrt{2\varepsilon}\,\xi(t).
$$

- **Production**, $\eta t$, rises in proportion to age $t$.
- **Removal**, $\beta X/(\kappa+X)$, is proportional to the burden when the burden is small and approaches a maximum rate $\beta$ when it is large; $\kappa$ is the burden at which removal runs at half its maximum. The authors suggested that senescent cells slow their own removal through the SASP, through disrupting tissue architecture, or by outnumbering the immune cells that remove them, and noted that the last requires senescent cells to become about as abundant as those immune cells, "on the order of 0.1% of the body's cells".[^karin2019]
- **Noise**, $\sqrt{2\varepsilon}\,\xi(t)$, is random variation of strength $\varepsilon$.
- **Death** occurs when $X$ first exceeds a threshold $X_c$. The authors introduced the threshold "to illustrate our approach, because it provides analytically solvable results", and noted that "the precise relationship is currently unknown".[^karin2019]

The burden is measured in units of the average burden of young mice: the reporter signal was divided by 9.63 "to give SnC = 1 for young mice".[^karin2019]

Without noise, the burden settles where production equals removal. Figure 1 shows this balance. Drag the age slider: as production rises, the equilibrium burden rises slowly at first and then steeply, because removal is close to its maximum. Once production exceeds the maximum removal rate $\beta$, at age $\beta/\eta$, there is no equilibrium and the burden grows without limit. With the parameters the authors fitted to mouse mortality, that happens at 21.4 months. Lower $\beta$ and the runaway starts earlier.

```vega-lite
{
  "$schema": "https://vega.github.io/schema/vega-lite/v6.json",
  "description": "Figure 1. The balance between production and removal in the saturating-removal model, without noise. In the first panel, the curved line is the rate at which senescent cells are removed, which rises with the burden X and levels off below the maximum β; the dashed horizontal line is the production rate at the chosen age, and the burden settles where the two cross. The second panel shows that equilibrium burden at each age, with a dot at the chosen age. Once production exceeds β there is no equilibrium. The sliders set the age and β; the other parameters are those Karin and colleagues fitted to C57BL/6J mortality (production slope 0.084 per day per year, half-saturation 0.5, death threshold 17; burden in units of the mean burden of young mice).",
  "params": [
    {
      "name": "age",
      "value": 15,
      "bind": {
        "input": "range",
        "min": 3,
        "max": 30,
        "step": 1,
        "name": "Age, months"
      }
    },
    {
      "name": "beta",
      "value": 0.15,
      "bind": {
        "input": "range",
        "min": 0.12,
        "max": 0.18,
        "step": 0.01,
        "name": "Maximum removal rate β, per day"
      }
    }
  ],
  "hconcat": [
    {
      "width": 300,
      "height": 260,
      "layer": [
        {
          "data": {
            "sequence": {
              "start": 0,
              "stop": 18.01,
              "step": 0.05,
              "as": "X"
            }
          },
          "transform": [
            {
              "calculate": "beta * datum.X / (0.5 + datum.X)",
              "as": "r"
            }
          ],
          "mark": {
            "type": "line",
            "style": "model"
          },
          "encoding": {
            "x": {
              "field": "X",
              "type": "quantitative"
            },
            "y": {
              "field": "r",
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
              "calculate": "0.084 * age / 12",
              "as": "p"
            }
          ],
          "mark": {
            "type": "rule",
            "style": "alt"
          },
          "encoding": {
            "y": {
              "field": "p",
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
              "calculate": "beta",
              "as": "b"
            }
          ],
          "mark": {
            "type": "rule",
            "style": "guide"
          },
          "encoding": {
            "y": {
              "field": "b",
              "type": "quantitative"
            }
          }
        },
        {
          "data": {
            "values": [
              {
                "x": 17
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
          "data": {
            "values": [
              {
                "x": 17,
                "t": "death threshold"
              }
            ]
          },
          "mark": {
            "type": "text",
            "style": "observed-label",
            "angle": 270,
            "dx": -4,
            "align": "left",
            "baseline": "bottom",
            "y": "height",
            "dy": 0
          },
          "encoding": {
            "x": {
              "field": "x",
              "type": "quantitative"
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
                "a": 0
              }
            ]
          },
          "transform": [
            {
              "calculate": "0.084 * age / 12",
              "as": "p"
            },
            {
              "filter": "datum.p < beta"
            },
            {
              "calculate": "0.5 * datum.p / (beta - datum.p)",
              "as": "Xs"
            },
            {
              "filter": "datum.Xs <= 18"
            }
          ],
          "layer": [
            {
              "mark": {
                "type": "point",
                "style": "model-point",
                "filled": true,
                "size": 70
              },
              "encoding": {
                "x": {
                  "field": "Xs",
                  "type": "quantitative"
                },
                "y": {
                  "field": "p",
                  "type": "quantitative"
                }
              }
            },
            {
              "transform": [
                {
                  "calculate": "'equilibrium ' + format(datum.Xs, '.1f')",
                  "as": "t"
                }
              ],
              "mark": {
                "type": "text",
                "style": "model-label",
                "align": "left",
                "dx": 8,
                "dy": 14
              },
              "encoding": {
                "x": {
                  "field": "Xs",
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
            }
          ]
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
              "calculate": "0.084 * age / 12",
              "as": "p"
            },
            {
              "filter": "datum.p >= beta"
            }
          ],
          "mark": {
            "type": "text",
            "style": "alt-label",
            "align": "right",
            "x": "width",
            "dx": -4,
            "dy": -8
          },
          "encoding": {
            "y": {
              "field": "p",
              "type": "quantitative"
            },
            "text": {
              "value": "no equilibrium: burden grows"
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
              "calculate": "0.084 * age / 12",
              "as": "p"
            },
            {
              "filter": "datum.p < beta"
            }
          ],
          "mark": {
            "type": "text",
            "style": "alt-label",
            "align": "right",
            "x": "width",
            "dx": -4,
            "dy": -8
          },
          "encoding": {
            "y": {
              "field": "p",
              "type": "quantitative"
            },
            "text": {
              "value": "production"
            }
          }
        },
        {
          "data": {
            "values": [
              {
                "x": 0.4,
                "t": "maximum removal β"
              }
            ]
          },
          "transform": [
            {
              "calculate": "beta",
              "as": "b"
            }
          ],
          "mark": {
            "type": "text",
            "style": "observed-label",
            "align": "left",
            "dy": -7
          },
          "encoding": {
            "x": {
              "field": "x",
              "type": "quantitative"
            },
            "y": {
              "field": "b",
              "type": "quantitative"
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
                "x": 9,
                "r": 0.03,
                "t": "removal"
              }
            ]
          },
          "mark": {
            "type": "text",
            "style": "model-label"
          },
          "encoding": {
            "x": {
              "field": "x",
              "type": "quantitative"
            },
            "y": {
              "field": "r",
              "type": "quantitative"
            },
            "text": {
              "field": "t"
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
              18
            ],
            "nice": false
          },
          "axis": {
            "title": "Senescent-cell burden X",
            "values": [
              0,
              3,
              6,
              9,
              12,
              15,
              18
            ]
          }
        },
        "y": {
          "type": "quantitative",
          "scale": {
            "domain": [
              0,
              0.22
            ],
            "nice": false
          },
          "axis": {
            "title": "Rate, per day",
            "values": [
              0,
              0.05,
              0.1,
              0.15,
              0.2
            ]
          }
        }
      }
    },
    {
      "width": 300,
      "height": 260,
      "layer": [
        {
          "data": {
            "sequence": {
              "start": 0,
              "stop": 36.01,
              "step": 0.05,
              "as": "m"
            }
          },
          "transform": [
            {
              "calculate": "0.084 * datum.m / 12",
              "as": "p"
            },
            {
              "filter": "datum.p < beta"
            },
            {
              "calculate": "0.5 * datum.p / (beta - datum.p)",
              "as": "Xs"
            },
            {
              "filter": "datum.Xs <= 18"
            }
          ],
          "mark": {
            "type": "line",
            "style": "model"
          },
          "encoding": {
            "x": {
              "field": "m",
              "type": "quantitative"
            },
            "y": {
              "field": "Xs",
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
              "calculate": "12 * beta / 0.084",
              "as": "mc"
            }
          ],
          "layer": [
            {
              "mark": {
                "type": "rule",
                "style": "guide"
              },
              "encoding": {
                "x": {
                  "field": "mc",
                  "type": "quantitative"
                }
              }
            },
            {
              "transform": [
                {
                  "calculate": "'runaway at\\n' + format(datum.mc, '.1f') + ' months'",
                  "as": "t"
                }
              ],
              "mark": {
                "type": "text",
                "style": "observed-label",
                "align": "left",
                "dx": 5,
                "lineBreak": "\n",
                "y": "height",
                "dy": -120
              },
              "encoding": {
                "x": {
                  "field": "mc",
                  "type": "quantitative"
                },
                "text": {
                  "field": "t"
                }
              }
            }
          ]
        },
        {
          "data": {
            "values": [
              {
                "x": 17
              }
            ]
          },
          "mark": {
            "type": "rule",
            "style": "guide"
          },
          "encoding": {
            "y": {
              "field": "x",
              "type": "quantitative"
            }
          }
        },
        {
          "data": {
            "values": [
              {
                "x": 0.5,
                "y": 17,
                "t": "death threshold"
              }
            ]
          },
          "mark": {
            "type": "text",
            "style": "observed-label",
            "align": "left",
            "dy": -7
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
          "data": {
            "values": [
              {
                "a": 0
              }
            ]
          },
          "transform": [
            {
              "calculate": "age",
              "as": "m"
            },
            {
              "calculate": "0.084 * age / 12",
              "as": "p"
            },
            {
              "filter": "datum.p < beta"
            },
            {
              "calculate": "0.5 * datum.p / (beta - datum.p)",
              "as": "Xs"
            },
            {
              "filter": "datum.Xs <= 18"
            }
          ],
          "mark": {
            "type": "point",
            "style": "model-point",
            "filled": true,
            "size": 70
          },
          "encoding": {
            "x": {
              "field": "m",
              "type": "quantitative"
            },
            "y": {
              "field": "Xs",
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
              0,
              36
            ],
            "nice": false
          },
          "axis": {
            "title": "Age, months",
            "values": [
              0,
              6,
              12,
              18,
              24,
              30,
              36
            ]
          }
        },
        "y": {
          "type": "quantitative",
          "scale": {
            "domain": [
              0,
              18
            ],
            "nice": false
          },
          "axis": {
            "title": "Equilibrium burden",
            "values": [
              0,
              3,
              6,
              9,
              12,
              15,
              18
            ]
          }
        }
      }
    }
  ]
}
```

With noise, individuals cross the threshold at different ages. The slower the removal near equilibrium, the more persistent the fluctuations become, which the authors described as a "critical slowing down": in the reporter data, the correlation between successive measurements in the same mouse rose with age (*P* = 0.0047).[^karin2019]

## Fitting

The model has two sets of parameters.

- **Fit to reporter trajectories.** Karin and colleagues fitted sixteen variants, combining production that does or does not rise with age with removal that is or is not saturated, to measurements of total-body luminescence from a *p16* reporter, taken every eight weeks in 33 mice.[^karin2019][^burd2013] Fitted by maximum likelihood to 294 transitions between measurements, the saturating-removal variant had the lowest Bayesian information criterion; variants without saturation fitted worse by more than 44 units. The best-fitting parameters were $\eta$ = 0.15 per day per year, $\beta$ = 0.27 per day, $\kappa$ = 1.1 and $\varepsilon$ = 0.14 per day.[^karin2019]
- **Fit to mortality.** To model death, the authors set the threshold to 17, "the maximal SnC level in the Burd et al. dataset", scanned values of $\beta$ and $\kappa$, and constrained $\eta$ and $\varepsilon$ so that the simulated distribution of ages at death matched the mean and standard deviation of C57BL/6J mice from the Mouse Phenome Database to within 2%. This gave $\eta$ = 0.084, $\beta$ = 0.15, $\kappa$ = 0.5 and $\varepsilon$ = 0.16.[^karin2019] The authors acknowledged that these differ from the parameters fitted to the reporter data, and that "the requirement that death occurs at a critical SnC level may be unrealistic".[^karin2019]

No fitted Gompertz, Gompertz–Makeham or logistic model of mortality, and no mechanistic alternative such as reliability theory, was compared with the model's fit to the survival data; the comparisons were among variants of the same production-and-removal scheme.[^karin2019]

## Predictions and tests

### Slower removal with age

The model predicted that senescent cells induced by injury would be removed with a half-life of "about 5 ± 1 days at 3 months" and "about 25 ± 6 days at 22 months". The authors injured the lungs of mice with bleomycin and counted senescent epithelial cells over the following weeks. In young mice, sampled at 14, 18, 24 and 28 days, the half-life was 4.7 days; in old mice, sampled only at 14 and 38 days, it was about 18 days, with a removal rate of 0.055 ± 0.035 per day (*P* = 0.038 for the difference).[^karin2019] The uncertainty for old mice spans rates close to zero, and the cells measured were induced by acute injury, not the naturally arising cells the model describes.

An independent study traced cells with high *p16* expression in mice using a genetic label and found that they "failed to proliferate and had half-lives ranging from 2.6 to 4.2 months, depending on the tissue examined".[^omori2020] Senescent endothelial cells of the liver, once removed, are not replaced.[^grosse2020] If the naturally arising senescent cells that the reporter measures persist for months, the rapid turnover the model requires does not apply to them.

### The Gompertz law

Treating death as the escape of the burden over the threshold, the authors derived a mortality rate that rises approximately exponentially with age and slows at old ages, because "those with high SnC have already died, whereas those with low SnC retain low SnC levels for long periods of time and avoid death". The approximation becomes inaccurate once production exceeds the maximum removal rate.[^karin2019]

Figure 2 simulates the model with the mortality-fit parameters. With the maximum removal rate of 0.15 a day, the median mouse lives 28.4 months, and the monthly mortality rate rises about tenfold between 15 and 21 months. A 20% change in the maximum removal rate, applied throughout life, shifts the median lifespan by about 14% in either direction. In the simulation the doubling time of mortality lengthens from about 1.7 months at 12 months of age to about 4.4 months at 36, so the rise is roughly, not exactly, exponential.

```vega-lite
{
  "$schema": "https://vega.github.io/schema/vega-lite/v6.json",
  "description": "Figure 2. The saturating-removal model simulated for 20,000 mice. Senescent cells are produced at a rate that rises with age and removed at a rate that saturates when they are numerous; random fluctuations are added, and a mouse dies when its senescent-cell burden first crosses a threshold. The first panel shows the burden among mice still alive (median, with the 10th to 90th percentile shaded) and the threshold. The second shows the resulting mortality rate per month, on a logarithmic scale. The slider sets the maximum removal rate β; the other parameters are those the authors used to fit C57BL/6J mortality (production slope 0.084 per day per year, half-saturation 0.5, noise 0.16 per day, threshold 17; burden in units of the mean burden of young mice).",
  "params": [{"name": "B", "value": 0.15, "bind": {"input": "range", "min": 0.12, "max": 0.18, "step": 0.01, "name": "Maximum removal rate β, per day"}}],
  "hconcat": [
    {
      "width": 290,
      "height": 230,
      "layer": [
        {
          "data": {"url": "/attachments/senescent-cell-model.csv"},
          "transform": [{"filter": "abs(datum.beta - B) < 0.001 && isValid(datum.xmed) && datum.xmed !== ''"}],
          "layer": [
            {"mark": {"type": "area", "style": "observed", "opacity": 0.35}, "encoding": {"y": {"field": "xlo", "type": "quantitative"}, "y2": {"field": "xhi"}}},
            {"mark": {"type": "line", "style": "model"}, "encoding": {"y": {"field": "xmed", "type": "quantitative"}}}
          ],
          "encoding": {"x": {"field": "month", "type": "quantitative"}}
        },
        {"data": {"values": [{}]}, "mark": {"type": "rule", "style": "guide"}, "encoding": {"y": {"datum": 17, "type": "quantitative"}}},
        {
          "data": {"values": [{"month": 1, "y": 17, "label": "threshold"}]},
          "mark": {"type": "text", "style": "observed-label", "align": "left", "dy": -8},
          "encoding": {"x": {"field": "month", "type": "quantitative"}, "y": {"field": "y", "type": "quantitative"}, "text": {"field": "label"}}
        }
      ],
      "encoding": {
        "x": {"type": "quantitative", "scale": {"domain": [0, 45], "nice": false}, "axis": {"title": "Age, months", "values": [0, 6, 12, 18, 24, 30, 36, 42]}},
        "y": {"type": "quantitative", "scale": {"domain": [0, 18], "nice": false}, "axis": {"title": "Senescent-cell burden", "values": [0, 5, 10, 15]}}
      }
    },
    {
      "width": 290,
      "height": 230,
      "layer": [
        {
          "data": {"url": "/attachments/senescent-cell-model.csv"},
          "transform": [{"filter": "abs(datum.beta - B) < 0.001 && isValid(datum.hazard) && datum.hazard !== '' && datum.hazard >= 0.002"}],
          "layer": [
            {"mark": {"type": "line", "style": "model", "strokeWidth": 2}},
            {"mark": {"type": "circle", "style": "model-point", "size": 22}}
          ],
          "encoding": {"x": {"field": "month", "type": "quantitative"}, "y": {"field": "hazard", "type": "quantitative"}}
        },
        {
          "data": {"url": "/attachments/senescent-cell-model.csv"},
          "transform": [
            {"filter": "abs(datum.beta - B) < 0.001"},
            {"aggregate": [{"op": "max", "field": "median", "as": "median"}]},
            {"calculate": "'Median lifespan ' + format(datum.median, '.1f') + ' months'", "as": "label"},
            {"calculate": "1", "as": "lx"},
            {"calculate": "0.8", "as": "ly"}
          ],
          "mark": {"type": "text", "style": "model-label", "align": "left", "baseline": "top"},
          "encoding": {"x": {"field": "lx", "type": "quantitative"}, "y": {"field": "ly", "type": "quantitative"}, "text": {"field": "label"}}
        }
      ],
      "encoding": {
        "x": {"type": "quantitative", "scale": {"domain": [0, 45], "nice": false}, "axis": {"title": "Age, months", "values": [0, 6, 12, 18, 24, 30, 36, 42]}},
        "y": {
          "type": "quantitative",
          "scale": {"type": "log", "domain": [0.001, 1], "nice": false},
          "axis": {"title": "Deaths per month among survivors", "values": [0.001, 0.01, 0.1, 1], "labelExpr": "datum.value >= 1 ? '1' : '1 in ' + format(1 / datum.value, ',')"}
        }
      }
    }
  ]
}
```

### Removing senescent cells

The authors wrote that the model "can describe the observed increase in mean lifespan of mice in experiments in which a fraction of SnCs are continually removed". To do so they split the burden into a part that the treatment can remove and a part it cannot, which "may also represent other forms of damage that impacts aging besides senescent cells", with a fraction $\zeta$ of production and noise going to the removable part. They then set $\zeta$ by requiring that the genetic removal experiment of Baker and colleagues extend mean lifespan by 25%: "This allows calibrating $\zeta$, providing $\zeta$ ≈ 0.25."[^karin2019supp] The agreement is therefore built in rather than predicted. The calibration also modelled removal as daily, at a rate of one per day, whereas Baker's mice were treated twice a week.[^karin2019supp][^baker2016]

Without that split, the model predicts far more than was observed. Simulated with every senescent cell removable and the mortality-fit parameters, removing about 2% of senescent cells twice a week from 12 months matches Baker's 24–27% gain in median lifespan, whereas clearance in the fat of Baker's mice removed nearly nine-tenths of the cells staining for senescence-associated β-galactosidase.[^baker2016] Setting $\zeta$ to 0.25 says, in effect, that three-quarters of what kills mice in the model is not removed by the transgene; that is an assumption chosen to fit, not a finding. (See [[senolytics#dosing|Senolytics]], which simulates other dosing schedules.)

On the same basis the authors proposed that senolytic "treatment should start at old age, and can be as infrequent as the SnC turnover time (~month in old mice) and still be effective".[^karin2019]

In 2021 Karin and Alon fitted the model to experiments joining the circulations of young and old mice, and concluded that "both [production and removal] must vary with age"; they attributed the benefit to old mice to the "transfer of spare removal capacity from the young mouse to the old".[^karin2021]

### Other species and humans

The authors fitted human mortality, from the Swedish period life table of 2009, with "the same parameters as in mice, except for a 60-fold slower increase in SnC production rate"; no measure of fit was reported.[^karin2019] For flies and nematodes they set parameters by hand and stated that "the purpose here is to demonstrate that the SR model can capture the behavior of the data, and not to provide accurate estimates for the parameters".[^karin2019]

Later work by the same group used the equation for other kinds of damage. In starved *Escherichia coli*, membrane damage measured in 635 cells followed dynamics in which "noise is amplified by a rising production of damage that saturates its own removal".[^yang2023] In 2026 Naveh Raz and colleagues fitted the equation, with the burden read as an unspecified damage variable, to the survival curves of bacteria, yeast, nematodes, flies, mice, guinea pigs, cats, dogs and humans, and found that "the model parameter that best predicts lifespan is the damage production rate, which spans seven orders of magnitude". They cautioned that because lifespans and parameters were estimated from the same survival curves, the parameters "are mathematical constructs rather than directly measured biological quantities" and the fits do "not constitute independent validation".[^raz2026]

## Assessment

The model's strongest evidence is its fit to the reporter trajectories, where saturating removal was clearly preferred among the schemes compared. That evidence does not single it out. Axel Kowald, João Passos and Thomas Kirkwood fitted the same data with a model in which production is constant and senescent cells are either removable or not, and reported "an excellent fit, comparable to that shown in Figure 2c of Karin et al."; in their model, too, the turnover rate falls with age, because the removable fraction shrinks. They also noted that in the saturating-removal model "it is not quite clear which biological mechanism is responsible" for production rising in proportion to age.[^kowald2020] Their fit was to the average trajectory only, so it is a weaker test than Karin's.

The model's other claims do not test whether the burden is senescent cells. The mortality fits use parameters chosen to match the survival data, with a threshold for death that the authors chose for convenience; the same equation fits survival curves when the burden is membrane damage in bacteria or an unspecified variable in dogs.[^yang2023][^raz2026] The agreement with removal experiments was calibrated, and the one quantitative test of slower removal rests on two time points in old mice and on injury-induced cells, while naturally arising senescent cells were measured independently to last for months.[^omori2020] The saturating-removal model is a good description of the reporter data and a flexible family of mortality curves. It has not shown that senescent cells, removed ever more slowly as they accumulate, set the pace of mammalian ageing.

## History

Karin and colleagues published the model in 2019, using reporter data published by Christin Burd, Norman Sharpless and colleagues in 2013.[^karin2019][^burd2013] The Alon group extended it to the incidence of age-related diseases, to parabiosis and to bacterial damage in 2021–2023,[^katzir2021][^karin2021][^yang2023] and in 2026 to the survival curves of species from bacteria to humans.[^raz2026] The alternative model of Kowald, Passos and Kirkwood was published in 2020, and the lineage-tracing measurement of Omori and colleagues in the same year.[^kowald2020][^omori2020]

## Data and figures

Figure 1 is computed from the deterministic part of the model, with the mortality-fit parameters $\eta$ = 0.084 per day per year and $\kappa$ = 0.5; the equilibrium burden is $\kappa\eta t/(\beta - \eta t)$. Figure 2 was computed for this article by simulating the model with the mortality-fit parameters for 20,000 mice at each of seven values of the maximum removal rate, with time steps of half a day and the burden reflected at zero. Mortality rates are deaths in each month divided by mice alive at its start, shown where they are at least 0.002; burden percentiles are shown while at least 200 mice remain alive.

[^karin2019]: Karin O, Agrawal A, Porat Z, Krizhanovsky V, Alon U (2019). "Senescent cell turnover slows with age providing an explanation for the Gompertz law". *Nature Communications*. 10: 5495. [doi:10.1038/s41467-019-13192-4](https://doi.org/10.1038/s41467-019-13192-4)

[^kowald2020]: Kowald A, Passos JF, Kirkwood TBL (2020). "On the evolution of cellular senescence". *Aging Cell*. 19 (12): e13270. [doi:10.1111/acel.13270](https://doi.org/10.1111/acel.13270)

[^omori2020]: Omori S, Wang TW, Johmura Y, Kanai T, Nakano Y, et al. (2020). "Generation of a p16 reporter mouse and its use to characterize and target p16high cells in vivo". *Cell Metabolism*. 32 (5): 814–828. [doi:10.1016/j.cmet.2020.09.006](https://doi.org/10.1016/j.cmet.2020.09.006)

[^karin2019peer]: Karin O, Agrawal A, Porat Z, Krizhanovsky V, Alon U (2019). Peer Review File for "Senescent cell turnover slows with age providing an explanation for the Gompertz law". *Nature Communications*. 10: 5495. [doi:10.1038/s41467-019-13192-4](https://doi.org/10.1038/s41467-019-13192-4)

[^raz2026]: Raz N, Yang Y, Pridham G, Shenhar B, Frenkel S, et al. (2026). "A damage accumulation model identifies distinct aging regimes across species". *Nature Aging*. 6 (6): 1330–1340. [doi:10.1038/s43587-026-01138-7](https://doi.org/10.1038/s43587-026-01138-7)

[^burd2013]: Burd CE, Sorrentino JA, Clark KS, Darr DB, Krishnamurthy J, et al. (2013). "Monitoring tumorigenesis and senescence in vivo with a p16INK4a-luciferase model". *Cell*. 152 (1–2): 340–351. [doi:10.1016/j.cell.2012.12.010](https://doi.org/10.1016/j.cell.2012.12.010)

[^grosse2020]: Grosse L, Wagner N, Emelyanov A, Molina C, Lacas-Gervais S, et al. (2020). "Defined p16High senescent cell types are indispensable for mouse healthspan". *Cell Metabolism*. 32 (1): 87–99. [doi:10.1016/j.cmet.2020.05.002](https://doi.org/10.1016/j.cmet.2020.05.002)

[^karin2019supp]: Karin O, Agrawal A, Porat Z, Krizhanovsky V, Alon U (2019). Supplementary Information for "Senescent cell turnover slows with age providing an explanation for the Gompertz law", Supplementary Note 6. *Nature Communications*. 10: 5495. [doi:10.1038/s41467-019-13192-4](https://doi.org/10.1038/s41467-019-13192-4)

[^baker2016]: Baker DJ, Childs BG, Durik M, et al. (2016). "Naturally occurring p16Ink4a-positive cells shorten healthy lifespan". *Nature*. 530 (7589): 184–189. [doi:10.1038/nature16932](https://doi.org/10.1038/nature16932)

[^karin2021]: Karin O, Alon U (2021). "Senescent cell accumulation mechanisms inferred from parabiosis". *GeroScience*. 43 (1): 329–341. [doi:10.1007/s11357-020-00286-x](https://doi.org/10.1007/s11357-020-00286-x)

[^yang2023]: Yang Y, Karin O, Mayo A, Song X, Chen P, et al. (2023). "Damage dynamics and the role of chance in the timing of *E. coli* cell death". *Nature Communications*. 14: 2209. [doi:10.1038/s41467-023-37930-x](https://doi.org/10.1038/s41467-023-37930-x)

[^katzir2021]: Katzir I, Adler M, Karin O, Mendelsohn-Cohen N, Mayo A, Alon U (2021). "Senescent cells and the incidence of age-related diseases". *Aging Cell*. 20 (3): e13314. [doi:10.1111/acel.13314](https://doi.org/10.1111/acel.13314)
