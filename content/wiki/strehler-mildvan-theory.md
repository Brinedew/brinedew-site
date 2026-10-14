---
title: Strehler–Mildvan theory
tags:
  - content/wiki
date: 2026-10-14
draft: true
aliases:
  - Strehler-Mildvan theory
  - Strehler–Mildvan correlation
  - Strehler-Mildvan correlation
  - Compensation effect of mortality
  - Species-specific lifespan
  - Vitality model of mortality
---
# Strehler–Mildvan theory

The **Strehler–Mildvan theory** is a model of ageing and mortality published in 1960 by Bernard Strehler and Albert Mildvan. An organism's *vitality*, its capacity to survive challenges, declines linearly with age; the organism meets random challenges whose sizes are exponentially distributed; and it dies when a challenge exceeds its remaining vitality. These assumptions give a mortality rate that rises exponentially with age, as in the [[Mortality rate models#gompertz-law|Gompertz law]].[^sm1960][^finkelstein2012] The theory also predicts the **Strehler–Mildvan correlation**: across populations, those with higher mortality in early adulthood should have a slower exponential rise with age, so that their mortality curves converge at an old age. Leonid and Natalia Gavrilov described the same pattern as the **compensation effect of mortality**, and the age of convergence as the *species-specific lifespan*, about 95 years in humans.[^gavrilov2022]

The pattern is real in human data, and in national populations it is far larger than the noise of fitting. Three things about it are not what the theory says. The exponential distribution of challenges was assumed in order to obtain the Gompertz law, so the derivation explains nothing that was not put into it.[^finkelstein2012] The correlation coefficients usually quoted, −0.9 and beyond, are mostly a consequence of measuring mortality at age 0, decades below the data. And the age at which the curves converge is not a constant of the species: it has moved by decades between eras, fitting windows, sexes and regions, and in low-mortality countries the classical pattern broke down after about 1950.[^yashin2002][^li2015]

## The theory

Strehler and Mildvan made four assumptions:[^finkelstein2012][^li2015]

- challenges arrive at a constant rate $K$;
- their sizes $Y$ are exponentially distributed, $P(Y > y) = e^{-y/D}$, where $D$ is the mean size, standing for the harshness of the environment;
- vitality declines linearly with age, $V(t) = V_0(1 - Bt)$;
- the organism dies when a single challenge exceeds its vitality.

The mortality rate is then

$$
\mu(t) = K e^{-V(t)/D} = K e^{-V_0/D}\, e^{(V_0 B/D)\, t},
$$

a Gompertz law $\mu(t) = a e^{bt}$ with $a = K e^{-V_0/D}$ and $b = V_0 B/D$. Eliminating $V_0/D$ gives

$$
\ln a = \ln K - b/B, \qquad \text{or} \qquad \ln \mu(t) = \ln K + b\,(t - 1/B).
$$

If populations share $K$ and $B$ and differ only in $V_0/D$, all their log-mortality lines pass through one point, at age $1/B$, where vitality reaches zero. Strehler and Mildvan tested this on national life tables from about 1950.[^sm1960][^gavrilov2022]

### Problems with the derivation

- **The exponential is assumed.** "Why exponentially? No real justification is given in the original paper, except for the explanation that the Maxwell-Boltzmann distribution of molecules energies in an ideal gas follows the exponential law".[^finkelstein2012] With a linear decline of vitality, the exponential distribution of challenges is exactly what is needed to produce the Gompertz law; another distribution would produce another law.
- **Challenges must arrive as a Poisson process.** The formula "is true only when the underlying point process {Ti} is the homogeneous Poisson process … This is a rather stringent condition, which was not pointed out in the original and subsequent papers".[^finkelstein2012]
- **Individuals differ.** If vitality varies between individuals, the population's mortality rate is the average of $K e^{-V/D}$, which is not $K e^{-\bar V/D}$, and the exact Gompertz form is lost.[^finkelstein2012]
- **Mortality cannot exceed $K$.** Since death requires a challenge, the mortality rate is at most the rate at which challenges arrive; at age $1/B$ it reaches $K$, not infinity. The age $1/B$ is therefore not a maximum lifespan.
- **The parameters are not identifiable from one population.** The relation "is a linear function with 2 degrees of freedom but is defined by 3 parameters (K, b and B) or (K, D and B), and thus it is impossible to specify all the parameters for a single mortality curve".[^li2015] $K$ and $B$ can be estimated only by assuming that they are shared across populations, which is the relation being tested.

## The correlation in data

Strehler and Mildvan's own data put the convergence age, the slope of the regression of $\ln a$ on $b$, at 68.5 years, an age many people outlived.[^gavrilov2022] Later analyses found convergence at older ages. In annual American life tables from 1900 to 1986, the lines met at 87.4 years for men and 108.7 for women.[^riggs1990] Across 3,662 national period life tables from 1900 to 2014, fitted with a constant term for deaths unrelated to age (the Gompertz–Makeham law), the Gavrilovs found convergence at 84.6 years for men and 89.0 for women over ages 30–80, and 92.1 and 97.2 over ages 60–85.[^gavrilov2022] In United Nations life tables for 1980–2020 they found "95 to 100 years" for industrialized countries and lower values elsewhere.[^gavrilova2025] Within Sweden, France and the Netherlands over two and a half centuries, the lines fitted to five-year periods met at 103, 118 and 107 years.[^dolejs2025]

The pattern does not depend on fitting. In Swedish period life tables, "The ratio of mortality rate at 80 to the mortality rate at 30 increased from 12.9 to 37.0" for women and from 10.6 to 23.4 for men, as mortality fell.[^hawkes2012] As a population's mortality falls, it falls more at young ages than at old, so its curve steepens. The Gavrilovs pointed this out: "it is not necessary to estimate Gompertz parameters to establish the presence of CEM".[^gavrilova2025]

### Why the correlation coefficient means little

Write each population's fitted line as $\ln \mu_i(x) = c_i + b_i x$. Across populations, the variance of log mortality at age $x$ is $\mathrm{Var}(c) + 2x\,\mathrm{Cov}(c, b) + x^2 \mathrm{Var}(b)$, which is smallest at $x^* = -\mathrm{Cov}(c, b)/\mathrm{Var}(b)$; the slope of the regression of $c$ on $b$ is exactly $-x^*$. The convergence age is therefore the age at which the extrapolated differences in log mortality between populations are smallest.

The correlation between the level of mortality at some age $x_0$ and the slope $b$ is near −1 or +1 whenever $x_0$ is far from $x^*$, whatever the relation between populations. Measured at age 0, as in the classical analyses, it is strongly negative even when level and slope are unrelated. Figure 1 shows this for Swedish life tables before 1950. Their correlation at age 0 is −0.99; populations with the same spreads in level and slope but no relation between them would give −0.86. The informative comparison is at ages within the data: at age 60, the Swedish correlation is −0.94, where unrelated populations would give 0.

```vega-lite
{
  "$schema": "https://vega.github.io/schema/vega-lite/v6.json",
  "description": "Figure 1. The correlation between the level of mortality at a chosen age and the Gompertz slope, across Swedish five-year periods from 1751 to 1949 (solid), and for hypothetical populations with the same spreads of level and slope but no relation between them (dashed). The classical Strehler–Mildvan correlation is measured at age 0, where both are strongly negative. Within the ages of the data, the Swedish correlation is still strongly negative and the unrelated populations' is near zero; the Swedish curve crosses zero at the convergence age.",
  "data": {
    "url": "/attachments/strehler-mildvan-reference-age.csv"
  },
  "width": 560,
  "height": 280,
  "encoding": {
    "x": {
      "field": "age",
      "type": "quantitative",
      "scale": {
        "domain": [
          0,
          140
        ],
        "nice": false
      },
      "axis": {
        "title": "Age at which mortality level is measured, years",
        "values": [
          0,
          20,
          40,
          60,
          80,
          100,
          120,
          140
        ]
      }
    },
    "y": {
      "field": "r",
      "type": "quantitative",
      "scale": {
        "domain": [
          -1,
          1
        ],
        "nice": false
      },
      "axis": {
        "title": "Correlation of mortality level with Gompertz slope",
        "values": [
          -1,
          -0.5,
          0,
          0.5,
          1
        ]
      }
    }
  },
  "layer": [
    {
      "data": {
        "values": [
          {
            "y": 0
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
            "x": 0
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
        },
        "y": null
      }
    },
    {
      "transform": [
        {
          "filter": "datum.series == 'Sweden 1751–1949'"
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
          "filter": "datum.series != 'Sweden 1751–1949'"
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
          "filter": "datum.age == 0"
        }
      ],
      "mark": {
        "type": "point",
        "style": "model-point",
        "filled": true,
        "size": 50
      },
      "encoding": {
        "tooltip": [
          {
            "field": "series"
          },
          {
            "field": "r",
            "format": ".2f",
            "title": "correlation"
          }
        ]
      }
    },
    {
      "data": {
        "values": [
          {
            "age": 104,
            "r": 0.55,
            "t": "Sweden, 1751–1949"
          },
          {
            "age": 76,
            "r": 0.62,
            "t": "same spreads, no relation"
          },
          {
            "age": 3,
            "r": -0.52,
            "t": "the classical correlation is"
          },
          {
            "age": 3,
            "r": -0.62,
            "t": "measured at age 0"
          }
        ]
      },
      "layer": [
        {
          "transform": [
            {
              "filter": "datum.t == 'Sweden, 1751–1949'"
            }
          ],
          "mark": {
            "type": "text",
            "style": "model-label",
            "align": "left"
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
              "filter": "datum.t == 'same spreads, no relation'"
            }
          ],
          "mark": {
            "type": "text",
            "style": "alt-label",
            "align": "right"
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
              "filter": "datum.age == 3"
            }
          ],
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
  ]
}
```

The Gavrilovs refitted their data with age measured from 60, found that the correlation fell from −0.93 to −0.57, and concluded: "Thus, 54% of variation can be explained by statistical spurious correlation between the Gompertz parameters."[^gavrilov2022] Measuring age from 60 changes no fitted curve; it replaces the correlation at age 0 with the correlation at age 60, a different statistic, and the convergence age is unchanged, as they also noted. The remaining −0.57 is the evidence of convergence, not a residue of it. Their 2025 paper summarized the same analysis as showing that "statistical interdependence of parameters makes very small contribution to overall variation".[^gavrilova2025]

### Estimation artefacts

Two artefacts can produce the correlation without any underlying relation. The first is noise in fitting. When a survival curve is fitted, errors move the intercept and slope together along a line that keeps the average lifespan roughly constant: "small random variations in the survival records produce large deviations in the identified Gompertz parameters along the line".[^tarkhov2017] For laboratory cohorts this can dominate. For a cohort of 100 animals, the standard error of the fitted slope is about 0.011 a year at human-like parameters, about as large as the spread between Swedish periods; for a national population of a million it is about 0.0001 (see Data and figures). For national data, noise cannot explain the pattern.

The second artefact is fitting the Gompertz law where deaths unrelated to age are numerous. The Gavrilovs showed that "varying the Makeham parameter (A) from 0 to 0.01 per year is sufficient to produce spurious Strehler–Mildvan correlation", and that this spurious correlation agreed closely with the one Strehler and Mildvan published.[^gavrilov2022] Fits with a Makeham term still show convergence, at older ages.[^gavrilov2022] Oskar Burger and Trifon Missov concluded that "the Strehler-Mildvan correlation itself should not be used to diagnose any biological, physiological, or evolutionary process".[^burger2016]

### The convergence age is not a constant

Figure 2 collects published and recomputed convergence ages. They range from 68.5 to about 150 years. Within the Gavrilovs' own data, the estimate rose "from 73 ± 7 years in 1925 to 90 ± 3 years in 2010".[^gavrilov2022] It differs between men and women, between fitting windows, and between regions: 96 years in Europe, North America and Oceania against 82–84 in Africa, western Asia and southern Asia.[^gavrilova2025]

```vega-lite
{
  "$schema": "https://vega.github.io/schema/vega-lite/v6.json",
  "description": "Figure 2. Estimates of the age at which fitted Gompertz lines of different populations or periods converge, the Strehler–Mildvan 1/B or the Gavrilovs' species-specific lifespan. Bars are 95% intervals where standard errors were published; the era estimates for Sweden, France and the Netherlands are from Figure 3. The dashed line marks the 95 years often given as the human species-specific lifespan.",
  "data": {
    "url": "/attachments/strehler-mildvan-convergence-ages.csv"
  },
  "transform": [
    {
      "calculate": "toNumber(datum.age) - 1.96 * toNumber(datum.se)",
      "as": "lo"
    },
    {
      "calculate": "toNumber(datum.age) + 1.96 * toNumber(datum.se)",
      "as": "hi"
    }
  ],
  "width": 560,
  "height": 460,
  "encoding": {
    "y": {
      "field": "label",
      "type": "nominal",
      "sort": {
        "field": "order",
        "op": "min"
      },
      "axis": {
        "title": null,
        "ticks": false,
        "domain": false,
        "minExtent": 190,
        "maxExtent": 190
      }
    }
  },
  "layer": [
    {
      "data": {
        "values": [
          {
            "x": 95
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
        },
        "y": null
      }
    },
    {
      "data": {
        "values": [
          {
            "x": 95,
            "t": "\"species-specific lifespan\", 95"
          }
        ]
      },
      "mark": {
        "type": "text",
        "style": "observed-label",
        "align": "left",
        "dx": 4,
        "y": -8
      },
      "encoding": {
        "x": {
          "field": "x",
          "type": "quantitative"
        },
        "text": {
          "field": "t"
        },
        "y": null
      }
    },
    {
      "transform": [
        {
          "filter": "isValid(toNumber(datum.se)) && datum.se != ''"
        }
      ],
      "mark": {
        "type": "rule",
        "style": "observed",
        "strokeWidth": 2
      },
      "encoding": {
        "x": {
          "field": "lo",
          "type": "quantitative"
        },
        "x2": {
          "field": "hi"
        }
      }
    },
    {
      "mark": {
        "type": "point",
        "style": "model-point",
        "filled": true,
        "size": 55
      },
      "encoding": {
        "x": {
          "field": "age",
          "type": "quantitative",
          "scale": {
            "domain": [
              60,
              155
            ],
            "nice": false
          },
          "axis": {
            "title": "Age at which the fitted Gompertz lines converge, years",
            "values": [
              60,
              80,
              100,
              120,
              140
            ]
          }
        },
        "tooltip": [
          {
            "field": "group",
            "title": "kind"
          },
          {
            "field": "label",
            "title": "data"
          },
          {
            "field": "age",
            "title": "convergence age"
          }
        ]
      }
    },
    {
      "mark": {
        "type": "text",
        "style": "label",
        "align": "left",
        "dx": 8,
        "fontSize": 12
      },
      "encoding": {
        "x": {
          "field": "age",
          "type": "quantitative"
        },
        "text": {
          "field": "age",
          "format": ".0f"
        }
      }
    }
  ],
  "usermeta": {
    "axisAllowance": 200
  }
}
```

Over time within single countries, the pattern changed. Yashin and colleagues found in Swedish data that "the tendency to rectangularization of the survival curve existed for only a limited period of time. Then it was gradually replaced by near parallel shift of the survival curve to the right."[^yashin2002] Ting Li and James Anderson found the same in several countries: "Thereafter, 'hooks' emerge and the curves flatten for France, Sweden and the U.S. around 1960s and for Japan around 1980."[^li2015] Figure 3 shows this in Gompertz fits published by Dolejs for Sweden, France and the Netherlands.[^dolejs2025] Before 1950, the fitted lines converged at 82–94 years. From 1950 to 1984 mortality fell almost equally at all adult ages, and the fits show no clear convergence. Since 1985 the lines have steepened again, but they now converge at 126–149 years, beyond any observed age. Dolejs concluded that "the system tends to return to an equilibrium state in which the SM model becomes applicable again";[^dolejs2025] the convergence point to which it returned is 30–60 years older than the one it left.

```vega-lite
{
  "$schema": "https://vega.github.io/schema/vega-lite/v6.json",
  "description": "Figure 3. Gompertz lines fitted to five-year periods of mortality in Sweden, France and the Netherlands, from Dolejs (2025). Left: each period's intercept and slope; the chosen era is highlighted, and the line is the regression of intercept on slope within it, whose slope gives the age at which the era's lines converge. Right: the chosen era's fitted lines, extended beyond the ages to which they were fitted (shaded), with the convergence age marked. Before 1950 the lines meet at 82–94 years; from 1950 to 1984 they shift almost in parallel; since 1985 they meet again, at 126–149 years. Choose the country and era.",
  "params": [
    {
      "name": "country",
      "value": "Sweden",
      "bind": {
        "input": "select",
        "options": [
          "Sweden",
          "France",
          "Netherlands"
        ],
        "name": "Country"
      }
    },
    {
      "name": "era",
      "value": "before 1950",
      "bind": {
        "input": "select",
        "options": [
          "before 1950",
          "1950–1984",
          "1985–2023"
        ],
        "name": "Periods"
      }
    }
  ],
  "hconcat": [
    {
      "width": 270,
      "height": 270,
      "data": {
        "url": "/attachments/strehler-mildvan-europe.csv"
      },
      "transform": [
        {
          "filter": "datum.country == country"
        }
      ],
      "layer": [
        {
          "transform": [
            {
              "filter": "datum.era != era"
            }
          ],
          "mark": {
            "type": "point",
            "style": "observed",
            "filled": true,
            "size": 30,
            "opacity": 0.3
          },
          "encoding": {
            "x": {
              "field": "b",
              "type": "quantitative",
              "scale": {
                "domain": [
                  0.055,
                  0.115
                ],
                "nice": false
              },
              "axis": {
                "title": "Gompertz slope b, per year",
                "values": [
                  0.06,
                  0.08,
                  0.1
                ],
                "format": ".2f"
              }
            },
            "y": {
              "field": "ln_a",
              "type": "quantitative",
              "scale": {
                "domain": [
                  -12.5,
                  -6
                ],
                "nice": false
              },
              "axis": {
                "title": "Gompertz intercept, ln a",
                "values": [
                  -12,
                  -10,
                  -8,
                  -6
                ]
              }
            }
          }
        },
        {
          "transform": [
            {
              "filter": "datum.era == era"
            }
          ],
          "mark": {
            "type": "point",
            "style": "model-point",
            "filled": true,
            "size": 40
          },
          "encoding": {
            "tooltip": [
              {
                "field": "period"
              },
              {
                "field": "b",
                "title": "slope b",
                "format": ".4f"
              },
              {
                "field": "ln_a",
                "title": "ln a"
              }
            ],
            "x": {
              "field": "b",
              "type": "quantitative",
              "scale": {
                "domain": [
                  0.055,
                  0.115
                ],
                "nice": false
              },
              "axis": {
                "title": "Gompertz slope b, per year",
                "values": [
                  0.06,
                  0.08,
                  0.1
                ],
                "format": ".2f"
              }
            },
            "y": {
              "field": "ln_a",
              "type": "quantitative",
              "scale": {
                "domain": [
                  -12.5,
                  -6
                ],
                "nice": false
              },
              "axis": {
                "title": "Gompertz intercept, ln a",
                "values": [
                  -12,
                  -10,
                  -8,
                  -6
                ]
              }
            }
          }
        },
        {
          "transform": [
            {
              "filter": "datum.era == era"
            },
            {
              "regression": "ln_a",
              "on": "b"
            }
          ],
          "mark": {
            "type": "line",
            "style": "model",
            "strokeWidth": 1.5
          },
          "encoding": {
            "x": {
              "field": "b",
              "type": "quantitative",
              "scale": {
                "domain": [
                  0.055,
                  0.115
                ],
                "nice": false
              },
              "axis": {
                "title": "Gompertz slope b, per year",
                "values": [
                  0.06,
                  0.08,
                  0.1
                ],
                "format": ".2f"
              }
            },
            "y": {
              "field": "ln_a",
              "type": "quantitative",
              "scale": {
                "domain": [
                  -12.5,
                  -6
                ],
                "nice": false
              },
              "axis": {
                "title": "Gompertz intercept, ln a",
                "values": [
                  -12,
                  -10,
                  -8,
                  -6
                ]
              }
            }
          }
        },
        {
          "transform": [
            {
              "filter": "datum.era == era"
            },
            {
              "regression": "ln_a",
              "on": "b",
              "params": true
            },
            {
              "calculate": "'lines meet at ' + format(-datum.coef[1], '.0f') + ' years'",
              "as": "t"
            },
            {
              "calculate": "'r² = ' + format(datum.rSquared, '.2f')",
              "as": "t2"
            }
          ],
          "layer": [
            {
              "mark": {
                "type": "text",
                "style": "model-label",
                "align": "left",
                "x": 8,
                "y": 230
              },
              "encoding": {
                "text": {
                  "field": "t"
                }
              }
            },
            {
              "mark": {
                "type": "text",
                "style": "label",
                "align": "left",
                "x": 8,
                "y": 248
              },
              "encoding": {
                "text": {
                  "field": "t2"
                }
              }
            }
          ]
        }
      ]
    },
    {
      "width": 270,
      "height": 270,
      "layer": [
        {
          "data": {
            "values": [
              {
                "a": 40,
                "b": 95
              }
            ]
          },
          "mark": {
            "type": "rect",
            "style": "observed",
            "opacity": 0.1
          },
          "encoding": {
            "x": {
              "field": "a",
              "type": "quantitative",
              "scale": {
                "domain": [
                  30,
                  140
                ],
                "nice": false
              }
            },
            "x2": {
              "field": "b"
            }
          }
        },
        {
          "data": {
            "values": [
              {
                "x": 67,
                "t": "ages fitted"
              }
            ]
          },
          "mark": {
            "type": "text",
            "style": "observed-label",
            "y": 258
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
            "url": "/attachments/strehler-mildvan-europe.csv"
          },
          "transform": [
            {
              "filter": "datum.country == country && datum.era == era"
            },
            {
              "calculate": "sequence(30, 141, 5)",
              "as": "age"
            },
            {
              "flatten": [
                "age"
              ]
            },
            {
              "calculate": "exp(datum.ln_a + datum.b * datum.age)",
              "as": "mu"
            }
          ],
          "mark": {
            "type": "line",
            "style": "model",
            "strokeWidth": 1,
            "opacity": 0.45,
            "clip": true
          },
          "encoding": {
            "x": {
              "field": "age",
              "type": "quantitative",
              "scale": {
                "domain": [
                  30,
                  140
                ],
                "nice": false
              },
              "axis": {
                "title": "Age, years",
                "values": [
                  30,
                  50,
                  70,
                  90,
                  110,
                  130
                ]
              }
            },
            "y": {
              "field": "mu",
              "type": "quantitative",
              "scale": {
                "type": "log",
                "domain": [
                  0.0005,
                  30
                ]
              },
              "axis": {
                "title": "Deaths per person per year",
                "values": [
                  0.001,
                  0.01,
                  0.1,
                  1,
                  10
                ],
                "labelExpr": "datum.value >= 1 ? format(datum.value, ',') : format(datum.value, '~g')"
              }
            },
            "detail": {
              "field": "period"
            }
          }
        },
        {
          "data": {
            "url": "/attachments/strehler-mildvan-europe.csv"
          },
          "transform": [
            {
              "filter": "datum.country == country && datum.era == era"
            },
            {
              "regression": "ln_a",
              "on": "b",
              "params": true
            },
            {
              "calculate": "-datum.coef[1]",
              "as": "x"
            }
          ],
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
        }
      ]
    }
  ]
}
```

## Interpretations

- **Vitality and challenges.** In Strehler and Mildvan's reading, the convergence age is the age at which vitality reaches zero, and populations differ in the harshness of their environments, not in their rate of ageing.[^sm1960][^li2015] The derivation's problems, and the movement of the convergence age, count against a literal reading.
- **Reliability theory.** The Gavrilovs read the convergence age as a species-specific lifespan reflecting a constant "true aging rate", which they put at "approximately 1% per year", and inferred that "the total pool of functional cells could be entirely depleted by the age of 115–120 years".[^gavrilova2024] This builds an extrapolation on a statistic that depends on the data and window used. (See [[reliability-theory-of-ageing|Reliability theory of ageing]].)
- **Heterogeneity.** In a population of individuals with different frailties, high mortality from causes unrelated to age removes the frailest early, leaving a more robust older population and a flatter mortality curve.[^hawkes2012] This produces convergence without any limit to lifespan.
- **Damage and removal.** In the [[saturating-removal-model-of-senescence|saturating-removal model]], damage is produced at a rate $\eta t$ and removed at a rate that saturates at $\beta$. To leading order, the log mortality rate is a constant minus $(\beta - \eta t) X_c/\varepsilon$, where $X_c$ is the threshold for death and $\varepsilon$ the noise. Populations that differ in noise or threshold then lie on lines converging at age $\beta/\eta$, about 107 years for the human parameters of Karin and colleagues; populations that differ in removal capacity $\beta$ are shifted in parallel; and populations that differ in the rate of damage production $\eta$ have different slopes from the same starting level.[^karin2019] In this reading the convergence is real and has a biological meaning, but nothing fixes its age, which moves when production or removal change. (See also [[critical-point-model-of-ageing|Critical-point model of ageing]], which identifies its critical point with the zero of Strehler–Mildvan vitality.)

## Assessment

Human mortality curves do converge: populations and periods with high mortality in early adulthood have flatter curves, and in national data this is not an artefact of fitting. Correlation coefficients near −1 do not show it, because they are measured at age 0, and in small laboratory cohorts noise in fitting alone produces such correlations. The theory's derivation of the Gompertz law assumes what it explains, and its interpretation of the convergence age as the age at which vitality runs out, or as a species-specific lifespan, is contradicted by the movement of that age between eras, sexes, regions and fitting windows, and by the breakdown of the pattern after 1950. The correlation describes how mortality has fallen; it does not reveal a fixed limit of human life.

## History

Strehler and Mildvan published the theory in *Science* in 1960, and Sacher and Trucco gave a stochastic version in 1962.[^sm1960][^sacher1962] The Gavrilovs described the compensation effect of mortality in their 1991 book, and showed that omitting the Makeham term produces a spurious correlation.[^gavrilov2022] Riggs studied the convergence in American data in 1990.[^riggs1990] Yashin and colleagues reported the breakdown of the pattern in 2001 and 2002.[^yashin2002] Finkelstein analysed the theory's assumptions in 2012,[^finkelstein2012] Kristen Hawkes and colleagues proposed differential heterogeneity as its cause the same year,[^hawkes2012] and Li and Anderson recast it in a two-process vitality model in 2015.[^li2015] Burger and Missov in 2016, and Andrei Tarkhov, Leonid Menshikov and Peter Fedichev in 2017, argued that the correlation is largely a statistical property of the Gompertz law.[^burger2016][^tarkhov2017] The Gavrilovs extended their analysis to all countries in 2025.[^gavrilova2025]

## Data and figures

Figure 3 uses the Gompertz parameters that Dolejs fitted to Human Mortality Database period life tables, by ordinary least squares on log mortality at ages 40–95 for five-year periods (his Table 1).[^dolejs2025] Over all periods these give convergence ages of 102.7, 117.8 and 106.5 years for Sweden, France and the Netherlands, as he reported; the values by era were computed for this article by regressing $\ln a$ on $b$ within each era. Figure 1 uses the Swedish periods before 1950; the curve for unrelated populations has the same standard deviations of log mortality at age 60 (0.32) and slope (0.0089) as the Swedish data, with no correlation between them, and follows from the formula for the correlation of a linear combination. Figure 2 combines published estimates with the era estimates of Figure 3; bars are 95% intervals from the published standard errors where these exist. The standard errors of the fitted slope for cohorts of different sizes were computed for a Gompertz law with $\ln a = -9.8$ and $b$ = 0.09 a year, fitted by least squares to log mortality at ages 40–95, with Poisson-distributed deaths.

[^sm1960]: Strehler BL, Mildvan AS (1960). "General theory of mortality and aging". *Science*. 132 (3418): 14–21. [doi:10.1126/science.132.3418.14](https://doi.org/10.1126/science.132.3418.14)

[^finkelstein2012]: Finkelstein M (2012). "Discussing the Strehler-Mildvan model of mortality". *Demographic Research*. 26: 191–206. [doi:10.4054/DemRes.2012.26.9](https://doi.org/10.4054/DemRes.2012.26.9)

[^gavrilov2022]: Gavrilov LA, Gavrilova NS (2022). "Trends in human species-specific lifespan and actuarial aging rate". *Biochemistry (Moscow)*. 87 (12–13): 1622–1633. [doi:10.1134/S0006297922120173](https://doi.org/10.1134/S0006297922120173)

[^yashin2002]: Yashin AI, Begun AS, Boiko SI, Ukraintseva SV, Oeppen J (2002). "New age patterns of survival improvement in Sweden: do they characterize changes in individual aging?". *Mechanisms of Ageing and Development*. 123 (6): 637–647. [doi:10.1016/S0047-6374(01)00410-9](https://doi.org/10.1016/S0047-6374(01)00410-9)

[^li2015]: Li T, Anderson JJ (2015). "The Strehler–Mildvan correlation from the perspective of a two-process vitality model". *Population Studies*. 69 (1): 91–104. [doi:10.1080/00324728.2014.992358](https://doi.org/10.1080/00324728.2014.992358)

[^riggs1990]: Riggs JE (1990). "Longitudinal Gompertzian analysis of adult mortality in the U.S., 1900–1986". *Mechanisms of Ageing and Development*. 54 (3): 235–247. [doi:10.1016/0047-6374(90)90053-I](https://doi.org/10.1016/0047-6374(90)90053-I)

[^gavrilova2025]: Gavrilova NS, Gavrilov LA (2025). "The compensation effect of mortality: a global analysis of human populations". *Ageing and Longevity Research*. 1 (1): 100004. [doi:10.53941/alr.2025.100004](https://doi.org/10.53941/alr.2025.100004)

[^dolejs2025]: Dolejs J (2025). "The Strehler-Mildvan correlation as a valuable tool for monitoring the long-term health status of a population". *Frontiers in Public Health*. 13: 1627111. [doi:10.3389/fpubh.2025.1627111](https://doi.org/10.3389/fpubh.2025.1627111)

[^hawkes2012]: Hawkes K, Smith KR, Blevins JK (2012). "Human actuarial aging increases faster when background death rates are lower: a consequence of differential heterogeneity?". *Evolution*. 66 (1): 103–114. [doi:10.1111/j.1558-5646.2011.01414.x](https://doi.org/10.1111/j.1558-5646.2011.01414.x)

[^tarkhov2017]: Tarkhov AE, Menshikov LI, Fedichev PO (2017). "Strehler-Mildvan correlation is a degenerate manifold of Gompertz fit". *Journal of Theoretical Biology*. 416: 180–189. [doi:10.1016/j.jtbi.2017.01.017](https://doi.org/10.1016/j.jtbi.2017.01.017)

[^burger2016]: Burger O, Missov TI (2016). "Evolutionary theory of ageing and the problem of correlated Gompertz parameters". *Journal of Theoretical Biology*. 408: 34–41. [doi:10.1016/j.jtbi.2016.08.002](https://doi.org/10.1016/j.jtbi.2016.08.002)

[^gavrilova2024]: Gavrilova NS, Gavrilov LA (2024). "Compensation effect of mortality is a challenge to substantial lifespan extension of humans". *Biogerontology*. 25 (5): 851–857. [doi:10.1007/s10522-024-10111-z](https://doi.org/10.1007/s10522-024-10111-z)

[^karin2019]: Karin O, Agrawal A, Porat Z, Krizhanovsky V, Alon U (2019). "Senescent cell turnover slows with age providing an explanation for the Gompertz law". *Nature Communications*. 10: 5495. [doi:10.1038/s41467-019-13192-4](https://doi.org/10.1038/s41467-019-13192-4)

[^sacher1962]: Sacher GA, Trucco E (1962). "The stochastic theory of mortality". *Annals of the New York Academy of Sciences*. 96 (4): 985–1007. [doi:10.1111/j.1749-6632.1962.tb54116.x](https://doi.org/10.1111/j.1749-6632.1962.tb54116.x)
