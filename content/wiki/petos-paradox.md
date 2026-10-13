---
title: Peto's paradox
tags:
  - content/wiki
date: 2026-10-13
draft: true
aliases:
  - Peto paradox
---
# Peto's paradox

**Peto's paradox** is the observation that across animal species the risk of cancer does not rise with body size and lifespan as it would if every cell carried the same risk. A human has about a thousand times as many cells as a mouse and lives about thirty times as long, yet the two species are not very different in their lifetime chance of cancer.[^peto1977][^caulin2011] The epidemiologist Richard Peto set out the problem in 1977,[^peto1977] and the evolutionary biologist Leonard Nunney named it in 1999.[^nunney1999][^nunney2013]

The paradox follows from the **multistage model** of cancer, in which a tumour starts when one cell lineage accumulates a small number of rate-limiting changes. Under that model, a body with more cells offers more chances for one of them to complete the sequence, and a longer life gives each cell more time; the expected number of cancers rises in proportion to the number of cells and with a power of lifespan.[^nunney2020] Within a single species the expectation holds: across 31 human tissues, cancer risk tracks the total number of stem cell divisions with a rank correlation of 0.81.[^tomasetti2015] Across species it fails by many orders of magnitude, as Figure 1 shows. The accepted reading is that large and long-lived lineages evolved stronger cancer suppression than small and short-lived ones,[^caulin2011][^nunney1999] and the candidate mechanisms include extra copies of tumour-suppressor genes in elephants,[^abegglen2015][^sulak2016] somatic mutation rates per year that fall in inverse proportion to lifespan,[^cagan2022] and more accurate DNA repair in the bowhead whale.[^firsanov2025]

Three questions run through the field. The first is how flat the relationship really is: a 2022 analysis of 191 mammal species in zoos found no increase in cancer mortality with body mass,[^vincze2022] while two 2025 analyses of nearly 300 vertebrate species found a modest increase.[^compton2025][^butler2025] The second is which of the proposed mechanisms carry most of the load, since most were found in one or two species and have not been tested across many. The third is whether the same tuning links cancer to ageing: the study that found somatic mutation rates scaling with lifespan suggested that they "may be a contributing factor in ageing".[^cagan2022]

## Terminology

- **Multistage model.** Cancer arises in one cell lineage after *k* rate-limiting events, each occurring at a low rate. If every event has the same constant rate, the incidence of cancer at age *t* rises roughly as *t*<sup>*k*−1</sup>. Armitage and Doll examined death rates from 17 types of cancer; for cancers of the oesophagus, stomach, colon, rectum and pancreas, the slopes on log–log axes ranged from 4.97 to 6.48, consistent with six or seven stages.[^armitage1954] (See [[Armitage–Doll model]].)
- **Rate-limiting step.** One of the *k* events. A step is often a mutation that disables a tumour-suppressor gene or activates an oncogene, but it can be any heritable change whose rate limits progress.
- **Lifetime risk** is the probability of developing a cancer by the end of life. In the United States it is 39.9% for men and 39.0% for women, for invasive cancers excluding basal and squamous cell skin cancers.[^siegel2025]
- **Cancer mortality risk (CMR)** is the measure used by Vincze and colleagues: the number of cancer-related deaths divided by the number of individuals with post-mortem records. Cancer was recorded only if the pathologist judged it a contributing cause of death.[^vincze2022]
- **Neoplasia prevalence** and **malignancy prevalence** are the shares of necropsied animals with any tumour and with a malignant tumour, the measures used by Compton and colleagues.[^compton2025]
- **End-of-lifespan burden** is the number of somatic mutations a cell is expected to carry at the end of a species' lifespan: its mutation rate per year multiplied by its lifespan.[^cagan2022]

## The arithmetic

In the multistage model, a cell that must accumulate *k* changes, each at rate *u* per year, completes the sequence by age *t* with a probability that rises approximately as (*ut*)<sup>*k*</sup> while that probability is small. A body of *C* such cells then expects a number of cancers proportional to *C*(*ut*)<sup>*k*</sup>. Nunney wrote the risk as *p* = *C*(*ukt*)<sup>*M*</sup> and drew the consequence: "the risk of cancer increases linearly with cell number (∝*C*) and even more strongly with longevity (∝*t*<sup>*M*</sup>)."[^nunney2020]

Figure 1 applies that formula to mammals of different sizes, with every species given human cells. The number of cells is taken as proportional to body mass, and the model is calibrated so that a 60-kilogram human living 80 years has a 40% lifetime risk, about the observed figure.[^siegel2025] At the default of six rate-limiting steps, a mouse is expected to develop essentially no cancer at all and a blue whale about 2,600 cancers. Lower the slider to one step and the whale still expects about 1,400. Tick the box to make the mutation rate per year inversely proportional to lifespan, the pattern Cagan and colleagues found (see [below](#fewer-mutations-per-year)); the lifespan term disappears, and the shading then depends on body mass alone. The whale's expectation falls only twofold, because its lifespan in the model is close to a human's.

```vega-lite
{
  "$schema": "https://vega.github.io/schema/vega-lite/v6.json",
  "description": "Figure 1. Expected number of cancers per lifetime that the multistage model predicts if every cell in every species carried a human cell's risk. Expected number = 0.51 × (body mass ÷ 60 kilograms) × (lifespan ÷ 80 years) raised to the power k, so that a 60-kilogram human living 80 years expects 0.51 cancers: a 40% chance of at least one, about the lifetime risk of invasive cancer in the United States. Shading is darker where more cancers are expected, on a logarithmic scale from 1 in 10,000 to 10,000; the line marks the human level. Labels give the expected number for each species. Masses and lifespans for the mouse, human and blue whale are those used by Nunney (2020); those for the naked mole-rat are from Cagan et al. (2022). The slider sets k, the number of rate-limiting steps. The box makes each species' mutation rate per year inversely proportional to its lifespan, as Cagan et al. measured, which removes the lifespan term.",
  "params": [
    {
      "name": "k",
      "value": 6,
      "bind": {
        "input": "range",
        "min": 1,
        "max": 8,
        "step": 1,
        "name": "Rate-limiting steps, k"
      }
    },
    {
      "name": "scaled",
      "value": false,
      "bind": {
        "input": "checkbox",
        "name": "Mutation rate per year inversely proportional to lifespan"
      }
    }
  ],
  "width": 560,
  "height": 340,
  "layer": [
    {
      "data": {
        "sequence": {
          "start": 0,
          "stop": 64,
          "step": 1,
          "as": "i"
        }
      },
      "transform": [
        {
          "calculate": "sequence(0, 40)",
          "as": "j"
        },
        {
          "flatten": [
            "j"
          ]
        },
        {
          "calculate": "pow(10, -2 + datum.i * 8 / 64)",
          "as": "m0"
        },
        {
          "calculate": "pow(10, -2 + (datum.i + 1) * 8 / 64)",
          "as": "m1"
        },
        {
          "calculate": "pow(10, datum.j * 2.5 / 40)",
          "as": "l0"
        },
        {
          "calculate": "pow(10, (datum.j + 1) * 2.5 / 40)",
          "as": "l1"
        },
        {
          "calculate": "sqrt(datum.m0 * datum.m1)",
          "as": "m"
        },
        {
          "calculate": "sqrt(datum.l0 * datum.l1)",
          "as": "l"
        },
        {
          "calculate": "log(0.5108 * (datum.m / 60) * pow(scaled ? 1 : datum.l / 80, k)) / log(10)",
          "as": "logH"
        }
      ],
      "mark": {
        "type": "rect",
        "style": "model"
      },
      "encoding": {
        "x": {
          "field": "m0"
        },
        "x2": {
          "field": "m1"
        },
        "y": {
          "field": "l0"
        },
        "y2": {
          "field": "l1"
        },
        "opacity": {
          "field": "logH",
          "type": "quantitative",
          "scale": {
            "domain": [
              -4,
              4
            ],
            "range": [
              0,
              0.5
            ],
            "clamp": true
          },
          "legend": null
        }
      }
    },
    {
      "data": {
        "sequence": {
          "start": -2,
          "stop": 6.05,
          "step": 0.05,
          "as": "lm"
        }
      },
      "transform": [
        {
          "calculate": "pow(10, datum.lm)",
          "as": "mass"
        },
        {
          "calculate": "80 * pow(60 / datum.mass, 1 / k)",
          "as": "life"
        },
        {
          "filter": "!scaled && datum.life >= 1 && datum.life <= 316"
        }
      ],
      "mark": {
        "type": "line",
        "style": "model",
        "clip": true
      },
      "encoding": {
        "x": {
          "field": "mass",
          "type": "quantitative"
        },
        "y": {
          "field": "life",
          "type": "quantitative"
        }
      }
    },
    {
      "data": {
        "values": [
          {
            "mass": 60
          }
        ]
      },
      "transform": [
        {
          "filter": "scaled"
        }
      ],
      "mark": {
        "type": "rule",
        "style": "model"
      },
      "encoding": {
        "x": {
          "field": "mass",
          "type": "quantitative"
        }
      }
    },
    {
      "data": {
        "values": [
          {
            "name": "Mouse",
            "mass": 0.02,
            "life": 2
          },
          {
            "name": "Naked mole-rat",
            "mass": 0.035,
            "life": 25
          },
          {
            "name": "Human",
            "mass": 60,
            "life": 80
          },
          {
            "name": "Blue whale",
            "mass": 150000,
            "life": 90
          }
        ]
      },
      "transform": [
        {
          "calculate": "0.5108 * (datum.mass / 60) * pow(scaled ? 1 : datum.life / 80, k)",
          "as": "H"
        },
        {
          "calculate": "datum.name + ': ' + (datum.H < 0.001 ? '<0.001' : datum.H < 10 ? format(datum.H, '.2~r') : format(datum.H, '.2~s'))",
          "as": "label"
        }
      ],
      "layer": [
        {
          "mark": {
            "type": "circle",
            "style": "observed",
            "opacity": 1,
            "size": 60,
            "stroke": "currentColor"
          }
        },
        {
          "transform": [
            {
              "filter": "datum.mass < 1"
            }
          ],
          "mark": {
            "type": "text",
            "style": "label",
            "align": "left",
            "dx": 9,
            "dy": 0,
            "fontWeight": 600
          },
          "encoding": {
            "text": {
              "field": "label"
            }
          }
        },
        {
          "transform": [
            {
              "filter": "datum.mass > 1 && datum.mass < 1000"
            }
          ],
          "mark": {
            "type": "text",
            "style": "label",
            "align": "left",
            "dx": 8,
            "dy": -12,
            "fontWeight": 600
          },
          "encoding": {
            "text": {
              "field": "label"
            }
          }
        },
        {
          "transform": [
            {
              "filter": "datum.mass > 1000"
            }
          ],
          "mark": {
            "type": "text",
            "style": "label",
            "align": "right",
            "dx": 4,
            "dy": 16,
            "fontWeight": 600
          },
          "encoding": {
            "text": {
              "field": "label"
            }
          }
        }
      ],
      "encoding": {
        "x": {
          "field": "mass",
          "type": "quantitative"
        },
        "y": {
          "field": "life",
          "type": "quantitative"
        }
      }
    }
  ],
  "encoding": {
    "x": {
      "type": "quantitative",
      "scale": {
        "type": "log",
        "domain": [
          0.01,
          1000000
        ],
        "nice": false
      },
      "axis": {
        "title": "Body mass, kilograms",
        "values": [
          0.01,
          0.1,
          1,
          10,
          100,
          1000,
          10000,
          100000,
          1000000
        ],
        "format": "~s"
      }
    },
    "y": {
      "type": "quantitative",
      "scale": {
        "type": "log",
        "domain": [
          1,
          316
        ],
        "nice": false
      },
      "axis": {
        "title": "Lifespan, years",
        "values": [
          1,
          3,
          10,
          30,
          100,
          300
        ]
      }
    }
  }
}
```

Peto put the comparison in his 1977 review of multistage models:

> a man has 1000 times as many cells as a mouse…. and we usually live at least 30 times as long as mice…. However, it seems that, in the wild, the probabilities of carcinoma induction in mice and in men are not vastly different. Are our stem cells really, then, 1 billion or 1 trillion times more 'cancer proof' than murine stem cells? This is biologically pretty implausible; if human DNA is no more resistant to mutagenesis in vitro than mouse DNA, why don't we all die of notable carcinomas at an early age? Presumably some concomitant of our evolved ability to grow big and to live for three score years and ten is involved.[^peto1977]

Caulin and Maley put the same comparison as "about 30% of both rodents and humans have cancer by the end of their life", although the two differ about 40-fold in lifespan and a thousandfold in size.[^caulin2011]

### How much extra suppression

How much protection a large species needs depends on what is held fixed. Because expected cancers scale with *C*·*u*<sup>*k*</sup>, a thousandfold increase in cell number is cancelled by a 1000<sup>1/*k*</sup>-fold decrease in the mutation rate: about 3.2-fold when *k* = 6. Caulin and colleagues reached that figure in models of colorectal cancer. Comparing animals with a thousand times as many stem cells as a human, they found that "a two- to three-fold decrease in the mutation rate or stem cell division rate is enough to reduce a whale's cancer risk to that of a human", and that one or two extra required mutations would do the same.[^caulin2015]

Nunney's 2020 models asked a harder question: how much suppression a human and a blue whale need relative to a mouse, with both size and longevity counted, for three cancers with different numbers of steps. Without compensation, a 1% lifetime risk in a mouse became a 100% risk at human or blue-whale size and longevity. Adding suppression in the form of extra required mutations, a human needed about 4 (hepatocellular carcinoma) to 12 (colorectal adenocarcinoma) more than a mouse, and a blue whale about 6 to 18. Achieving the same by lowering the mutation rate alone required a more than 120,000-fold reduction in the whale, which Nunney judged unrealistic.[^nunney2020]

Cell culture shows that mouse and human cells differ in how many changes they need. Rangarajan and colleagues reported that "perturbation of two signaling pathways—involving p53 and Raf—suffices for the tumorigenic conversion of normal murine fibroblasts, while perturbation of six pathways—involving p53, pRb, PP2A, telomerase, Raf, and Ral-GEFs—is needed for human fibroblasts."[^rangarajan2004] The comparison counts signalling pathways in fibroblasts, not mutations in tissues.

## The comparative evidence

Testing the paradox requires cancer rates for many species measured in the same way. Wild animals are rarely examined after death, so the data come from zoos, where animals are fed, treated and protected from predators.

- **Abegglen and colleagues (2015)** compiled necropsy records for 36 species at the San Diego Zoo and found "no significant relationship" between cancer incidence and any combination of mass, lifespan and basal metabolic rate. From 644 annotated elephant deaths they estimated a lifetime cancer incidence of 3.11% (95% confidence interval 1.74–4.47%), or 4.81% if deaths of unrecorded cause were assigned conservatively, compared with 11% to 25% cancer mortality in humans.[^abegglen2015]
- **Boddy and colleagues (2020)** analysed 852 necropsies of 37 mammal species collected over 42 years. Mean neoplasia prevalence was 12.5% and mean malignancy prevalence 9%, with "no association between lifespan and/or body mass and the prevalence of neoplasia or malignancy". Malignancy rose with litter size, but only marginally once the Virginia opossum was removed.[^boddy2020]
- **Vincze and colleagues (2022)** used records of 110,148 adult animals of 191 species from the global zoo database, 11,840 of them with post-mortem records (Figure 2). Cancer mortality risk ranged from zero in 47 species to 57% in the kowari, a small marsupial, and exceeded 10% in 41 species. Doubling body mass changed risk by a 2.8–2.9% *decrease*, and body mass explained 0.78% of the variation between species; doubling adult life expectancy raised risk by about 25%, a non-significant effect explaining 2.94% of the variation. Carnivores had higher risk than primates or even-toed ungulates, which were the least cancer-prone order, and species that often eat other mammals had higher risk than those that do not.[^vincze2022]
- **Compton and colleagues (2025)** assembled 16,049 necropsy records of 292 species of amphibians, reptiles, birds and mammals, with at least 20 necropsies per species. Neoplasia prevalence rose by 2.1 percentage points per tenfold increase in adult mass. Malignancy prevalence rose by 1.9 points per tenfold increase once gestation time was controlled for, and not significantly without that control. Within mammals the slopes were 3.4 points for neoplasia and 2.6 for malignancy.[^compton2025]
- **Butler and colleagues (2025)** reanalysed 263 of those species and concluded that there is "no evidence for Peto's paradox across amphibians, birds, mammals, and squamate reptiles: Larger species do in fact have a higher cancer prevalence compared to smaller species." They also found that lineages whose body size had evolved faster had less neoplasia.[^butler2025]

Compton and colleagues replied that the paradox concerns the absence of the scaling the multistage model predicts, not the absence of any correlation, and that Butler and colleagues' own conclusion, that larger species "grow larger over time without experiencing the anticipated cancer burden associated with their size", restates it.[^compton2025reply] The dispute is over the slope. The positive slopes reported in 2025 are a few percentage points per tenfold increase in mass; proportional scaling predicts tenfold more cancers per tenfold increase. In Figure 2, the dotted line rises from 5% to near certainty within a hundredfold range of body mass; the observed average stays between about 1% and 6% across five orders of magnitude.

```vega-lite
{
  "$schema": "https://vega.github.io/schema/vega-lite/v6.json",
  "description": "Figure 2. Cancer mortality in 191 mammal species kept in zoos (data of Vincze et al. 2022). Each circle is a species: the share of necropsied adults in which cancer contributed to death, against adult body mass. Circle area grows with the number of necropsies, from 20 to 413. Teal circles are carnivores. The dashed brown line is an unweighted local average across species. The dotted line is what proportional scaling would predict: the expected number of cancers rising in proportion to body mass, starting from the pooled rate of 5.2% at the median mass of 13 kilograms.",
  "width": 560,
  "height": 340,
  "data": {
    "url": "/attachments/zoo-mammal-cancer-mortality.csv"
  },
  "layer": [
    {
      "data": {
        "sequence": {
          "start": -2,
          "stop": 3.3,
          "step": 0.02,
          "as": "lm"
        }
      },
      "transform": [
        {
          "calculate": "pow(10, datum.lm)",
          "as": "mass_kg"
        },
        {
          "calculate": "1 - exp(-0.0534 * datum.mass_kg / 13)",
          "as": "cmr"
        },
        {
          "filter": "datum.cmr <= 0.62"
        }
      ],
      "mark": {
        "type": "line",
        "style": "guide",
        "clip": true
      },
      "encoding": {
        "x": {
          "field": "mass_kg",
          "type": "quantitative"
        },
        "y": {
          "field": "cmr",
          "type": "quantitative"
        }
      }
    },
    {
      "data": {
        "values": [
          {
            "mass_kg": 95,
            "cmr": 0.6,
            "t": "Proportional to mass"
          }
        ]
      },
      "mark": {
        "type": "text",
        "style": "observed-label",
        "align": "left",
        "dx": 6
      },
      "encoding": {
        "x": {
          "field": "mass_kg",
          "type": "quantitative"
        },
        "y": {
          "field": "cmr",
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
          "filter": "datum.order !== 'Carnivora'"
        }
      ],
      "mark": {
        "type": "circle",
        "style": "observed",
        "opacity": 0.45
      },
      "encoding": {
        "x": {
          "field": "mass_kg",
          "type": "quantitative"
        },
        "y": {
          "field": "cmr",
          "type": "quantitative"
        },
        "size": {
          "field": "necropsies",
          "type": "quantitative",
          "scale": {
            "domain": [
              20,
              420
            ],
            "range": [
              20,
              380
            ]
          },
          "legend": null
        }
      }
    },
    {
      "transform": [
        {
          "filter": "datum.order === 'Carnivora'"
        }
      ],
      "mark": {
        "type": "circle",
        "style": "model-point",
        "opacity": 0.7
      },
      "encoding": {
        "x": {
          "field": "mass_kg",
          "type": "quantitative"
        },
        "y": {
          "field": "cmr",
          "type": "quantitative"
        },
        "size": {
          "field": "necropsies",
          "type": "quantitative",
          "scale": {
            "domain": [
              20,
              420
            ],
            "range": [
              20,
              380
            ]
          },
          "legend": null
        }
      }
    },
    {
      "transform": [
        {
          "calculate": "log(datum.mass_kg) / log(10)",
          "as": "lm"
        },
        {
          "loess": "cmr",
          "on": "lm",
          "bandwidth": 0.5
        },
        {
          "calculate": "pow(10, datum.lm)",
          "as": "mass_kg"
        }
      ],
      "mark": {
        "type": "line",
        "style": "alt"
      },
      "encoding": {
        "x": {
          "field": "mass_kg",
          "type": "quantitative"
        },
        "y": {
          "field": "cmr",
          "type": "quantitative"
        }
      }
    },
    {
      "data": {
        "values": [
          {
            "mass_kg": 0.1288,
            "cmr": 0.5714,
            "t": "Kowari",
            "s": "label"
          },
          {
            "mass_kg": 161.9,
            "cmr": 0.1275,
            "t": "Lion",
            "s": "label"
          },
          {
            "mass_kg": 911.6,
            "cmr": 0.0123,
            "t": "Giraffe",
            "s": "label-up"
          },
          {
            "mass_kg": 2.5,
            "cmr": 0.33,
            "t": "Carnivora",
            "s": "model"
          },
          {
            "mass_kg": 2.5,
            "cmr": 0.29,
            "t": "Other orders",
            "s": "observed"
          },
          {
            "mass_kg": 0.02,
            "cmr": 0.075,
            "t": "Local average",
            "s": "loess"
          }
        ]
      },
      "layer": [
        {
          "transform": [
            {
              "filter": "datum.s === 'label'"
            }
          ],
          "mark": {
            "type": "text",
            "style": "label",
            "align": "left",
            "dx": 9,
            "dy": -2
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
              "filter": "datum.s === 'label-up'"
            }
          ],
          "mark": {
            "type": "text",
            "style": "label",
            "align": "center",
            "dy": -16
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
              "filter": "datum.s === 'model'"
            }
          ],
          "mark": {
            "type": "circle",
            "style": "model-point",
            "opacity": 0.7,
            "size": 90,
            "xOffset": -10
          }
        },
        {
          "transform": [
            {
              "filter": "datum.s === 'observed'"
            }
          ],
          "mark": {
            "type": "circle",
            "style": "observed",
            "opacity": 0.6,
            "size": 90,
            "xOffset": -10
          }
        },
        {
          "transform": [
            {
              "filter": "datum.s === 'loess'"
            }
          ],
          "mark": {
            "type": "text",
            "style": "alt-label",
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
              "filter": "datum.s === 'model'"
            }
          ],
          "mark": {
            "type": "text",
            "style": "model-label",
            "align": "left",
            "dx": 2
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
              "filter": "datum.s === 'observed'"
            }
          ],
          "mark": {
            "type": "text",
            "style": "observed-label",
            "align": "left",
            "dx": 2
          },
          "encoding": {
            "text": {
              "field": "t"
            }
          }
        }
      ],
      "encoding": {
        "x": {
          "field": "mass_kg",
          "type": "quantitative"
        },
        "y": {
          "field": "cmr",
          "type": "quantitative"
        }
      }
    }
  ],
  "resolve": {
    "scale": {
      "size": "shared"
    }
  },
  "encoding": {
    "x": {
      "type": "quantitative",
      "scale": {
        "type": "log",
        "domain": [
          0.01,
          3000
        ],
        "nice": false
      },
      "axis": {
        "title": "Adult body mass, kilograms",
        "values": [
          0.01,
          0.1,
          1,
          10,
          100,
          1000
        ],
        "format": "~s"
      }
    },
    "y": {
      "type": "quantitative",
      "scale": {
        "domain": [
          0,
          0.62
        ],
        "nice": false
      },
      "axis": {
        "title": "Deaths with cancer, share of necropsies",
        "format": ".0%",
        "values": [
          0,
          0.1,
          0.2,
          0.3,
          0.4,
          0.5,
          0.6
        ]
      }
    }
  }
}
```

All of these data come from captive animals and from deaths examined by pathologists, and the measures differ: Vincze's counts cancers judged to have contributed to death; Compton's counts tumours found at necropsy, whether or not they killed. Zoo animals of long-lived species may die before old age, and their diets, reproduction and exposures differ from those in the wild. None of these biases is large enough to hide the thousandfold or millionfold differences the naive model predicts.

## Proposed mechanisms

### Fewer mutations per year

Cagan and colleagues sequenced the genomes of 208 single colonic crypts from 56 animals of 16 mammal species and measured how many somatic mutations accumulate per year.[^cagan2022] Rates ranged "from 47 substitutions per year in humans to 796 substitutions per year in mice". Across the 15 species of known age, the rate per year fell with lifespan: "A log-log allometric regression yielded a strong linear anticorrelation between mutation rate per year and lifespan (fraction of inter-species variance explained (FVE) = 0.85, P = 1 × 10<sup>–6</sup>), with a slope close to and not significantly different from –1." Lifespan was defined as the age by which 80% of individuals that reach adulthood have died. A slope of −1 means the rate is inversely proportional to lifespan, so every species reaches a similar number of mutations at the end of its life: a mean of about 3,200 substitutions per genome per crypt, varying only threefold across species whose masses differ about 40,000-fold (Figure 3).

```vega-lite
{
  "$schema": "https://vega.github.io/schema/vega-lite/v6.json",
  "description": "Figure 3. Somatic mutation rates in 15 mammal species (data of Cagan et al. 2022), measured as single-base substitutions per genome per year in colonic crypts. First panel: rate against lifespan, defined as the age by which 80% of individuals that reach adulthood have died; both axes are logarithmic. The line is rate = 3,206 ÷ lifespan, the paper's fitted model. Second panel: the number of substitutions per genome expected at the end of the lifespan, rate times lifespan, sorted; the line marks 3,206. Across the 15 species, mass varies about 40,000-fold, lifespan about 30-fold, and this end-of-lifespan burden about 3-fold.",
  "data": {
    "url": "/attachments/somatic-mutation-rates-mammals.csv"
  },
  "hconcat": [
    {
      "width": 300,
      "height": 300,
      "layer": [
        {
          "data": {
            "sequence": {
              "start": 0.4,
              "stop": 2.0,
              "step": 0.02,
              "as": "ll"
            }
          },
          "transform": [
            {
              "calculate": "pow(10, datum.ll)",
              "as": "lifespan"
            },
            {
              "calculate": "3206 / datum.lifespan",
              "as": "rate"
            }
          ],
          "mark": {
            "type": "line",
            "style": "model"
          },
          "encoding": {
            "x": {
              "field": "lifespan",
              "type": "quantitative"
            },
            "y": {
              "field": "rate",
              "type": "quantitative"
            }
          }
        },
        {
          "mark": {
            "type": "circle",
            "style": "observed",
            "opacity": 1,
            "size": 55,
            "stroke": "currentColor"
          },
          "encoding": {
            "x": {
              "field": "lifespan",
              "type": "quantitative"
            },
            "y": {
              "field": "rate",
              "type": "quantitative"
            }
          }
        },
        {
          "transform": [
            {
              "filter": "indexof(['Mouse','Human','Cat','Ferret','Horse'], datum.species) >= 0"
            }
          ],
          "mark": {
            "type": "text",
            "style": "label",
            "align": "left",
            "dx": 7,
            "dy": -7
          },
          "encoding": {
            "x": {
              "field": "lifespan",
              "type": "quantitative"
            },
            "y": {
              "field": "rate",
              "type": "quantitative"
            },
            "text": {
              "field": "species"
            }
          }
        },
        {
          "transform": [
            {
              "filter": "indexof(['Naked mole-rat'], datum.species) >= 0"
            }
          ],
          "mark": {
            "type": "text",
            "style": "label",
            "align": "left",
            "dx": 6,
            "dy": 13
          },
          "encoding": {
            "x": {
              "field": "lifespan",
              "type": "quantitative"
            },
            "y": {
              "field": "rate",
              "type": "quantitative"
            },
            "text": {
              "field": "species"
            }
          }
        },
        {
          "transform": [
            {
              "filter": "indexof(['Rabbit','Giraffe'], datum.species) >= 0"
            }
          ],
          "mark": {
            "type": "text",
            "style": "label",
            "align": "right",
            "dx": -7,
            "dy": 0
          },
          "encoding": {
            "x": {
              "field": "lifespan",
              "type": "quantitative"
            },
            "y": {
              "field": "rate",
              "type": "quantitative"
            },
            "text": {
              "field": "species"
            }
          }
        },
        {
          "transform": [
            {
              "filter": "datum.species === 'Rat'"
            }
          ],
          "mark": {
            "type": "text",
            "style": "label",
            "align": "left",
            "dx": 6,
            "dy": 14
          },
          "encoding": {
            "x": {
              "field": "lifespan",
              "type": "quantitative"
            },
            "y": {
              "field": "rate",
              "type": "quantitative"
            },
            "text": {
              "field": "species"
            }
          }
        }
      ],
      "encoding": {
        "x": {
          "type": "quantitative",
          "scale": {
            "type": "log",
            "domain": [
              2.5,
              100
            ],
            "nice": false
          },
          "axis": {
            "title": "Lifespan, years",
            "values": [
              3,
              10,
              30,
              100
            ]
          }
        },
        "y": {
          "type": "quantitative",
          "scale": {
            "type": "log",
            "domain": [
              30,
              1200
            ],
            "nice": false
          },
          "axis": {
            "title": "Substitutions per genome per year",
            "values": [
              30,
              100,
              300,
              1000
            ]
          }
        }
      }
    },
    {
      "width": 300,
      "height": 300,
      "layer": [
        {
          "mark": {
            "type": "bar",
            "style": "observed",
            "opacity": 0.55
          },
          "encoding": {
            "y": {
              "field": "species",
              "type": "nominal",
              "sort": {
                "field": "burden",
                "order": "descending"
              },
              "axis": {
                "title": null,
                "labelLimit": 160
              }
            },
            "x": {
              "field": "burden",
              "type": "quantitative",
              "scale": {
                "domain": [
                  0,
                  6000
                ]
              },
              "axis": {
                "title": "Substitutions at end of lifespan",
                "values": [
                  0,
                  2000,
                  4000,
                  6000
                ],
                "format": ",.0f"
              }
            }
          }
        },
        {
          "data": {
            "values": [
              {
                "burden": 3206
              }
            ]
          },
          "mark": {
            "type": "rule",
            "style": "model"
          },
          "encoding": {
            "x": {
              "field": "burden",
              "type": "quantitative"
            }
          }
        }
      ]
    }
  ]
}
```

Body mass did not add to the explanation. Mass alone explained less of the variation than lifespan, and once lifespan was in the model, adding mass did not improve it significantly (*P* = 0.16). The naked mole-rat and the giraffe, which differ about 23,000-fold in mass, have similar mutation rates (93 and 99 substitutions per year) and similar lifespans (25 and 24 years).[^cagan2022]

In terms of Figure 1, this pattern removes the lifespan term: ticking the box there flattens the shading along the lifespan axis. It does not remove the body-mass term, so it does not by itself explain why large species are protected. The measurements come from one tissue in 15 species, the largest of which, the giraffe and the cow, weigh under a tonne.

The bowhead whale, which may live for more than a century, has been studied directly. Four males in a 1999 study were estimated at over 100 years old by the racemization of amino acids in the eye lens,[^george1999] and one at about 211 years with a standard error of 35.[^keane2015] In 2025, Firsanov and colleagues reported that bowhead fibroblasts repair DNA double-strand breaks by both main pathways at higher rates than cells of other mammals, are more efficient at mismatch repair, and "display lower spontaneous and induced mutation rates and are especially resistant to accumulation of" large structural variants. A cold-inducible RNA-binding protein, CIRBP, was abundant in bowhead cells and tissues and "largely undetectable in other mammals except humpback whale". Unexpectedly, bowhead fibroblasts "required fewer oncogenic hits to undergo malignant transformation than human fibroblasts", and had lower basal p53 activity. The authors read this as "evidence that additional tumour suppressors are not the only solutions to Peto's paradox."[^firsanov2025]

### Extra tumour-suppressor genes

Elephants carry extra copies of [[p53-tp53|*TP53*]], the gene for the tumour suppressor p53. Abegglen and colleagues reported that "While humans have 1 copy (2 alleles) of *TP53*, African elephants have at least 20 copies (40 alleles), including 19 retrogenes (38 alleles) with evidence of transcriptional activity". After ionizing radiation, 14.6% of elephant lymphocytes underwent apoptosis, compared with 7.2% of lymphocytes from human controls and 2.7% from patients with Li–Fraumeni syndrome, who carry one damaged copy of *TP53*.[^abegglen2015]

Sulak and colleagues surveyed 61 genomes. The African elephant has 19 *TP53* retrogenes, 14 of which could still encode truncated proteins; the Asian elephant has an estimated 12 to 17, the woolly and Columbian mammoths about 14, and the American mastodon 3 to 8. The rock hyrax and the West Indian manatee, the elephant's closest living relatives, have one. The first copy arose about 64 million years ago and the family expanded after about 40 million years ago, in parallel with the evolution of large body size in the elephant lineage.[^sulak2016] A related gene, *LIF6*, is a pseudogene that regained function in elephants: p53 switches it on after DNA damage and it induces apoptosis.[^vazquez2018] A later survey found that duplications of tumour suppressors are common across Afrotheria, the group that includes elephants, hyraxes, manatees and tenrecs, not only in elephants, and suggested that they helped make larger bodies possible.[^vazquez2021]

Whales show weaker evidence of the same kind. A 2019 analysis of cetacean genomes, including a new humpback whale assembly, estimated that about 450 protein-coding genes were under positive selection in cetaceans and found large segmental duplications containing genes of the apoptotic pathway.[^tollis2019] The 2015 bowhead genome paper reported a duplication of *PCNA*, a gene for a DNA replication and repair protein, and bowhead-specific changes in repair genes such as *ERCC1*. The authors described these as candidates.[^keane2015] Neither study tested function.

### Replicative senescence

Large mammals tend to switch off telomerase, the enzyme that maintains the ends of chromosomes, in their somatic cells, so that their cells stop dividing after a limited number of divisions (see [[telomeres]], [[telomerase-tert]] and [[cellular-senescence]]). Across 15 rodent species, Seluanov and colleagues found that telomerase activity in tissues correlated negatively with body mass (*r*<sup>2</sup> = 0.53, *P* = 0.002) but not with maximum lifespan, and concluded that "large body mass presents a greater risk of cancer than long lifespan."[^seluanov2007] A survey of more than 60 mammal species found the same pattern: telomerase repression co-evolved with body size (*P* = 0.008) and showed no independent effect on lifespan, and species heavier than about one kilogram tended to have short telomeres and repressed telomerase.[^gomes2011] Bowhead whale fibroblasts also lack telomerase activity and their telomeres shorten.[^firsanov2025]

### Small long-lived species

The paradox also applies to small species that live long, such as the naked mole-rat, which weighs about 35 grams and lives for decades. Early reports described its cells as resistant to transformation: a combination of oncogenic *RAS* and SV40 large T antigen, which transforms mouse fibroblasts, failed to do so in naked mole-rat cells, and the cells stopped dividing at unusually low density.[^seluanov2009] In 2013, Tian and colleagues attributed this to hyaluronan, a sugar polymer of the extracellular matrix, of very high molecular mass, "over five times larger than human or mouse"; cells in which the hyaluronan was removed formed tumours.[^tian2013]

These findings are contested. Hadi and colleagues transformed naked mole-rat cells with the same oncogenes and argued for a mechanism outside the cell; Tian's group replied that the result reflected much higher expression of *RAS*.[^hadi2020][^zhao2020] A 2022 review of claims about naked mole-rats cited a measurement that naked mole-rat hyaluronan is large on average but "not greater than 2.5 MDa", and noted that under some culture conditions the cells show no early contact inhibition.[^buffenstein2022] Cancers have been found in captive naked mole-rats: two cases in a 2016 report, and four among 37 necropsies in a 2017 report from one zoo colony; the authors of both described the incidence as low.[^delaney2016][^taylor2017]

### Cell size, metabolism and tumour dynamics

Other proposals are less developed.

- **Cell size.** Maciak and Michalak argued that larger animals have larger cells that divide more slowly, so that a large body contains fewer cells than its mass suggests.[^maciak2015] Savage and colleagues found instead that most cell types, including erythrocytes, fibroblasts, hepatocytes and epithelial cells, keep the same volume across mammals of different sizes, while their metabolic rate per cell falls with body mass; slowly dividing neurons and adipocytes are larger in larger animals.[^savage2007]
- **Metabolic rate.** Because mass-specific metabolic rate falls with body size, Dang proposed that lower metabolic rates per cell generate fewer mutagenic by-products in large animals.[^dang2015] Nunney's 2020 models showed that a metabolic effect of plausible size would reduce, but not remove, the extra suppression a whale needs.[^nunney2020]
- **Hypertumours.** Nagy and colleagues modelled tumours in which aggressive subclones grow as parasites on their parent tumour. Because a tumour takes longer to reach a lethal size in a large body, such *hypertumours* could make cancer "more common and less lethal" in large organisms.[^nagy2007] The idea has not been tested.

## Peto's paradox and ageing

The paradox connects cancer suppression to life history. The disposable soma theory predicts that selection tunes somatic maintenance to the length of life a species can expect (see [[disposable-soma-theory]]), and a mutation rate per year inversely proportional to lifespan is the pattern such tuning would produce. Cagan and colleagues concluded that somatic mutation rates "are evolutionarily constrained and may be a contributing factor in ageing".[^cagan2022] The same pattern would arise if selection acted only to keep cancer rare within the lifespan, and the comparative data do not distinguish the two readings.

Peto, Roe and colleagues raised a related point in 1975. In skin-painting experiments on 950 mice, they found that cancer incidence depended on the duration of exposure to a carcinogen rather than on age, and suggested that a common cause might underlie ageing rates and cancer rates, which "might be the reason why most species suffer some cancer of old age, whether old age occurs at 80 weeks or 80 years".[^peto1975]

## History

The multistage model came first. In 1953 Carl Nordling proposed that "several successive mutations in the same cell, probably about seven in the case of human cancer, would be necessary", from the observation that cancer rates in men rose with about the sixth power of age.[^nordling1953] In 1954 Peter Armitage and Richard Doll formalised the model and showed that death rates from many cancers "accord with the theory that 6 or 7 successive changes in the cell are necessary before cancer appears", while warning that this did not prove a seven-stage process.[^armitage1954]

Peto's 1975 mouse experiment showed that incidence rises as a power of the time a tissue has been exposed to a carcinogen, which suggested that the power-law rise of human cancers with age reflects duration of exposure rather than ageing itself.[^peto1975] In his 1977 review he set out the comparison between mice and men quoted above.[^peto1977] Leonard Nunney's 1999 model of "lineage selection" argued that "compared to small rodents, humans must have evolved more complex genetic controls over cell growth in at least some of their tissues because of their greater size and longevity", and gave the problem its name.[^nunney1999][^nunney2013] By 2007 the term appeared in the title of a paper proposing hypertumours as a resolution.[^nagy2007]

Caulin and Maley's 2011 review framed the paradox as a programme for cancer prevention: "Animals with 1,000 times more cells than humans do not exhibit an increased cancer risk, suggesting that natural mechanisms can suppress cancer 1,000 times more effectively than is done in human cells."[^caulin2011] The elephant *TP53* papers of 2015 and 2016 gave the first mechanism tied to a specific large species,[^abegglen2015][^sulak2016] and the 2022 papers of Cagan and Vincze supplied the first systematic measurements of mutation rates and cancer mortality across many mammals.[^cagan2022][^vincze2022] Since 2025 the debate has turned to how flat the relationship between body size and cancer actually is.[^compton2025][^butler2025][^compton2025reply]

## Data and figures

Figure 1 was computed for this article from the formula in its caption. Expected numbers are shown for each cell of a 64 × 40 grid on logarithmic axes; the line connects the body masses and lifespans at which the expected number equals a human's.

Figure 2 uses the species-level data published with Vincze et al. (2022): adult body mass, number of necropsies and number of cancer-related deaths for 191 species. The local average is a LOESS fit of cancer mortality on the logarithm of body mass, with bandwidth 0.5, unweighted by sample size.

Figure 3 uses the species-level mutation rates (Supplementary Table 3) and lifespans (Supplementary Table 6) of Cagan et al. (2022). The end-of-lifespan burdens are rate times lifespan; their minimum and maximum (1,828 in the rat, 5,379 in the cat) match the paper's Table 1. The line at 3,206 is the paper's fitted mean burden (95% confidence interval 2,684–3,729).

[^peto1977]: Peto R (1977). "Epidemiology, multistage models, and short-term mutagenicity tests". In Hiatt HH, Watson JD, Winsten JA (eds), *Origins of Human Cancer*, Book C, pp. 1403–1428. Cold Spring Harbor Laboratory. Reprinted in *International Journal of Epidemiology* (2016) 45 (3): 621–637. [doi:10.1093/ije/dyv199](https://doi.org/10.1093/ije/dyv199). Quoted passage (pp. 1413–1414) as quoted by Nunney (2013).

[^caulin2011]: Caulin AF, Maley CC (2011). "Peto's Paradox: evolution's prescription for cancer prevention". *Trends in Ecology & Evolution*. 26 (4): 175–182. [doi:10.1016/j.tree.2011.01.002](https://doi.org/10.1016/j.tree.2011.01.002)

[^nunney1999]: Nunney L (1999). "Lineage selection and the evolution of multistage carcinogenesis". *Proceedings of the Royal Society B*. 266 (1418): 493–498. [doi:10.1098/rspb.1999.0664](https://doi.org/10.1098/rspb.1999.0664)

[^nunney2013]: Nunney L (2013). "The real war on cancer: the evolutionary dynamics of cancer suppression". *Evolutionary Applications*. 6 (1): 11–19. [doi:10.1111/eva.12018](https://doi.org/10.1111/eva.12018)

[^nunney2020]: Nunney L (2020). "Resolving Peto's paradox: Modeling the potential effects of size-related metabolic changes, and of the evolution of immune policing and cancer suppression". *Evolutionary Applications*. 13 (7): 1581–1592. [doi:10.1111/eva.12993](https://doi.org/10.1111/eva.12993)

[^tomasetti2015]: Tomasetti C, Vogelstein B (2015). "Variation in cancer risk among tissues can be explained by the number of stem cell divisions". *Science*. 347 (6217): 78–81. [doi:10.1126/science.1260825](https://doi.org/10.1126/science.1260825)

[^abegglen2015]: Abegglen LM, Caulin AF, Chan A, Lee K, Robinson R, et al. (2015). "Potential mechanisms for cancer resistance in elephants and comparative cellular response to DNA damage in humans". *JAMA*. 314 (17): 1850–1860. [doi:10.1001/jama.2015.13134](https://doi.org/10.1001/jama.2015.13134)

[^sulak2016]: Sulak M, Fong L, Mika K, Chigurupati S, Yon L, Mongan NP, Emes RD, Lynch VJ (2016). "*TP53* copy number expansion is associated with the evolution of increased body size and an enhanced DNA damage response in elephants". *eLife*. 5: e11994. [doi:10.7554/eLife.11994](https://doi.org/10.7554/eLife.11994)

[^cagan2022]: Cagan A, Baez-Ortega A, Brzozowska N, Abascal F, Coorens THH, et al. (2022). "Somatic mutation rates scale with lifespan across mammals". *Nature*. 604 (7906): 517–524. [doi:10.1038/s41586-022-04618-z](https://doi.org/10.1038/s41586-022-04618-z)

[^firsanov2025]: Firsanov D, Zacher M, Tian X, et al. (2025). "Evidence for improved DNA repair in the long-lived bowhead whale". *Nature*. 648: 717–725. [doi:10.1038/s41586-025-09694-5](https://doi.org/10.1038/s41586-025-09694-5)

[^vincze2022]: Vincze O, Colchero F, Lemaître J-F, Conde DA, Pavard S, et al. (2022). "Cancer risk across mammals". *Nature*. 601 (7892): 263–267. [doi:10.1038/s41586-021-04224-5](https://doi.org/10.1038/s41586-021-04224-5)

[^compton2025]: Compton ZT, Mellon W, Harris VK, et al. (2025). "Cancer prevalence across vertebrates". *Cancer Discovery*. 15 (1): 227–244. [doi:10.1158/2159-8290.CD-24-0573](https://doi.org/10.1158/2159-8290.CD-24-0573)

[^butler2025]: Butler G, Baker J, Amend SR, Pienta KJ, Venditti C (2025). "No evidence for Peto's paradox in terrestrial vertebrates". *Proceedings of the National Academy of Sciences*. 122 (9): e2422861122. [doi:10.1073/pnas.2422861122](https://doi.org/10.1073/pnas.2422861122)

[^compton2025reply]: Compton ZT, Vincze O, et al. (2025). "Paradoxical indeed". *Proceedings of the National Academy of Sciences*. 122 (19): e2504512122. [doi:10.1073/pnas.2504512122](https://doi.org/10.1073/pnas.2504512122)

[^armitage1954]: Armitage P, Doll R (1954). "The age distribution of cancer and a multi-stage theory of carcinogenesis". *British Journal of Cancer*. 8 (1): 1–12. [doi:10.1038/bjc.1954.1](https://doi.org/10.1038/bjc.1954.1)

[^siegel2025]: Siegel RL, Kratzer TB, Giaquinto AN, Sung H, Jemal A (2025). "Cancer statistics, 2025". *CA: A Cancer Journal for Clinicians*. 75 (1): 10–45. [doi:10.3322/caac.21871](https://doi.org/10.3322/caac.21871)

[^caulin2015]: Caulin AF, Graham TA, Wang LS, Maley CC (2015). "Solutions to Peto's paradox revealed by mathematical modelling and cross-species cancer gene analysis". *Philosophical Transactions of the Royal Society B*. 370 (1673): 20140222. [doi:10.1098/rstb.2014.0222](https://doi.org/10.1098/rstb.2014.0222)

[^rangarajan2004]: Rangarajan A, Hong SJ, Gifford A, Weinberg RA (2004). "Species- and cell type-specific requirements for cellular transformation". *Cancer Cell*. 6 (2): 171–183. [doi:10.1016/j.ccr.2004.07.009](https://doi.org/10.1016/j.ccr.2004.07.009)

[^boddy2020]: Boddy AM, Abegglen LM, Pessier AP, Aktipis A, Schiffman JD, Maley CC, Witte C (2020). "Lifetime cancer prevalence and life history traits in mammals". *Evolution, Medicine, and Public Health*. 2020 (1): 187–195. [doi:10.1093/emph/eoaa015](https://doi.org/10.1093/emph/eoaa015)

[^george1999]: George JC, Bada J, Zeh J, Scott L, Brown SE, O'Hara T, Suydam R (1999). "Age and growth estimates of bowhead whales (*Balaena mysticetus*) via aspartic acid racemization". *Canadian Journal of Zoology*. 77 (4): 571–580. [doi:10.1139/z99-015](https://doi.org/10.1139/z99-015)

[^keane2015]: Keane M, Semeiks J, Webb AE, Li YI, Quesada V, et al. (2015). "Insights into the evolution of longevity from the bowhead whale genome". *Cell Reports*. 10 (1): 112–122. [doi:10.1016/j.celrep.2014.12.008](https://doi.org/10.1016/j.celrep.2014.12.008)

[^vazquez2018]: Vazquez JM, Sulak M, Chigurupati S, Lynch VJ (2018). "A zombie *LIF* gene in elephants is upregulated by TP53 to induce apoptosis in response to DNA damage". *Cell Reports*. 24 (7): 1765–1776. [doi:10.1016/j.celrep.2018.07.042](https://doi.org/10.1016/j.celrep.2018.07.042)

[^vazquez2021]: Vazquez JM, Lynch VJ (2021). "Pervasive duplication of tumor suppressors in Afrotherians during the evolution of large bodies and reduced cancer risk". *eLife*. 10: e65041. [doi:10.7554/eLife.65041](https://doi.org/10.7554/eLife.65041)

[^tollis2019]: Tollis M, Robbins J, Webb AE, Kuderna LFK, Caulin AF, et al. (2019). "Return to the sea, get huge, beat cancer: an analysis of cetacean genomes including an assembly for the humpback whale (*Megaptera novaeangliae*)". *Molecular Biology and Evolution*. 36 (8): 1746–1763. [doi:10.1093/molbev/msz099](https://doi.org/10.1093/molbev/msz099)

[^seluanov2007]: Seluanov A, Chen Z, Hine C, Sasahara THC, Ribeiro AACM, et al. (2007). "Telomerase activity coevolves with body mass not lifespan". *Aging Cell*. 6 (1): 45–52. [doi:10.1111/j.1474-9726.2006.00262.x](https://doi.org/10.1111/j.1474-9726.2006.00262.x)

[^gomes2011]: Gomes NMV, Ryder OA, Houck ML, Charter SJ, Walker W, et al. (2011). "Comparative biology of mammalian telomeres: hypotheses on ancestral states and the roles of telomeres in longevity determination". *Aging Cell*. 10 (5): 761–768. [doi:10.1111/j.1474-9726.2011.00718.x](https://doi.org/10.1111/j.1474-9726.2011.00718.x)

[^seluanov2009]: Seluanov A, Hine C, Azpurua J, Feigenson M, Bozzella M, et al. (2009). "Hypersensitivity to contact inhibition provides a clue to cancer resistance of naked mole-rat". *Proceedings of the National Academy of Sciences*. 106 (46): 19352–19357. [doi:10.1073/pnas.0905252106](https://doi.org/10.1073/pnas.0905252106)

[^tian2013]: Tian X, Azpurua J, Hine C, Vaidya A, Myakishev-Rempel M, et al. (2013). "High-molecular-mass hyaluronan mediates the cancer resistance of the naked mole rat". *Nature*. 499 (7458): 346–349. [doi:10.1038/nature12234](https://doi.org/10.1038/nature12234)

[^hadi2020]: Hadi F, Kulaberoglu Y, Lazarus KA, et al. (2020). "Transformation of naked mole-rat cells". *Nature*. 583 (7814): E1–E7. [doi:10.1038/s41586-020-2410-x](https://doi.org/10.1038/s41586-020-2410-x)

[^zhao2020]: Zhao J, Tian X, Zhu Y, et al. (2020). "Reply to: Transformation of naked mole-rat cells". *Nature*. 583 (7814): E8–E13. [doi:10.1038/s41586-020-2411-9](https://doi.org/10.1038/s41586-020-2411-9)

[^buffenstein2022]: Buffenstein R, Amoroso V, Andziak B, et al. (2022). "The naked truth: a comprehensive clarification and classification of current 'myths' in naked mole-rat biology". *Biological Reviews*. 97 (1): 115–140. [doi:10.1111/brv.12791](https://doi.org/10.1111/brv.12791)

[^delaney2016]: Delaney MA, Ward JM, Walsh TF, et al. (2016). "Initial case reports of cancer in naked mole-rats (*Heterocephalus glaber*)". *Veterinary Pathology*. 53 (3): 691–696. [doi:10.1177/0300985816630796](https://doi.org/10.1177/0300985816630796)

[^taylor2017]: Taylor KR, Milone NA, Rodriguez CE (2017). "Four cases of spontaneous neoplasia in the naked mole-rat (*Heterocephalus glaber*), a putative cancer-resistant species". *Journals of Gerontology Series A*. 72 (1): 38–43. [doi:10.1093/gerona/glw047](https://doi.org/10.1093/gerona/glw047)

[^maciak2015]: Maciak S, Michalak P (2015). "Cell size and cancer: a new solution to Peto's paradox?". *Evolutionary Applications*. 8 (1): 2–8. [doi:10.1111/eva.12228](https://doi.org/10.1111/eva.12228)

[^savage2007]: Savage VM, Allen AP, Brown JH, Gillooly JF, Herman AB, Woodruff WH, West GB (2007). "Scaling of number, size, and metabolic rate of cells with body size in mammals". *Proceedings of the National Academy of Sciences*. 104 (11): 4718–4723. [doi:10.1073/pnas.0611235104](https://doi.org/10.1073/pnas.0611235104)

[^dang2015]: Dang CV (2015). "A metabolic perspective of Peto's paradox and cancer". *Philosophical Transactions of the Royal Society B*. 370 (1673): 20140223. [doi:10.1098/rstb.2014.0223](https://doi.org/10.1098/rstb.2014.0223)

[^nagy2007]: Nagy JD, Victor EM, Cropper JH (2007). "Why don't all whales have cancer? A novel hypothesis resolving Peto's paradox". *Integrative and Comparative Biology*. 47 (2): 317–328. [doi:10.1093/icb/icm062](https://doi.org/10.1093/icb/icm062)

[^peto1975]: Peto R, Roe FJC, Lee PN, Levy L, Clack J (1975). "Cancer and ageing in mice and men". *British Journal of Cancer*. 32 (4): 411–426. [doi:10.1038/bjc.1975.242](https://doi.org/10.1038/bjc.1975.242)

[^nordling1953]: Nordling CO (1953). "A new theory on the cancer-inducing mechanism". *British Journal of Cancer*. 7 (1): 68–72. [doi:10.1038/bjc.1953.8](https://doi.org/10.1038/bjc.1953.8)
