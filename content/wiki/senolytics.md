---
title: Senolytics
tags:
  - content/wiki
date: 2026-10-14
draft: true
aliases:
  - senolytic drugs
  - Senolytic
  - Senomorphics
---
# Senolytics

**Senolytics** are drugs that kill [[cellular-senescence|senescent cells]] selectively. Senescent cells have stopped dividing but resist apoptosis, and the first senolytics were found by looking for the survival pathways that keep them alive and then for drugs that block those pathways: the combination of dasatinib, a cancer drug, and quercetin, a plant flavonoid, was reported in 2015, and inhibitors of the BCL-2 family of survival proteins, such as navitoclax, followed in 2016.[^zhu2015][^zhu2016][^chang2016] Because senescent cells take weeks to accumulate again, the drugs are given intermittently.[^kirkland2020] Drugs that suppress the secretions of senescent cells without killing them are called **senomorphics**.

In mice, senolytics and genetic methods of removing senescent cells reduce markers of senescence and improve several measures of ageing and disease. The evidence that they extend life is thin. Only a handful of lifespan studies exist, none has been repeated by an independent laboratory, and the one senolytic tested by the National Institute on Aging's Interventions Testing Program, fisetin, had no effect on lifespan.[^harrison2024] In people, no randomised trial has shown a clinical benefit: trials of UBX0101 in knee osteoarthritis, of dasatinib plus quercetin in pulmonary fibrosis and in postmenopausal bone loss, and of the BCL-xL inhibitor UBX1325 in diabetic macular oedema missed their primary efficacy endpoints or found no difference from control.[^unity2020][^nambiar2023][^farr2024][^unity2025] No senolytic is approved for any use, and the company that ran the largest trials, Unity Biotechnology, dissolved in 2025.[^unity2025b]

Three questions run through the field. The first is whether the mouse results are robust; most come from one group, and the lifespan effects have not been reproduced. The second is which senescent cells should be removed, since some cells with senescence markers are needed for tissue repair and others are not senescent at all.[^grosse2020][^hall2016] The third is whether any senolytic benefits people, which requires adequately powered, placebo-controlled trials with clinical endpoints; none has yet succeeded.

## Terminology

- **Senolytic**: a drug that kills senescent cells selectively, sparing dividing and quiescent cells.
- **Senomorphic**: a drug that suppresses the [[sasp|senescence-associated secretory phenotype (SASP)]] without killing the cell. Inhibitors of JAK kinases reduce the SASP in cultured cells and frailty in old mice.[^xu2015] The two terms are used together as *senotherapeutics*.[^raffaele2022]
- **Senescent-cell anti-apoptotic pathways (SCAPs)**: the survival pathways, such as those controlled by BCL-2 family proteins, PI3K and ephrins, that senescent cells depend on. The term came into use after the first senolytics were found.[^kirkland2020]
- **Hit-and-run dosing**: giving a senolytic briefly and repeating it only after senescent cells have had time to reaccumulate, weeks later.[^kirkland2020]
- **Genetic clearance**: removal of senescent cells in transgenic mice, such as the INK-ATTAC and p16-3MR strains, in which cells expressing *p16* can be killed with a drug. These are research tools, not senolytics, but they provide most of the evidence that removing senescent cells matters. (See [[baker-ink-attac-experiment]].)

## Discovery

Yi Zhu, Tamara Tchkonia, James Kirkland and colleagues at the Mayo Clinic compared the transcriptomes of senescent and non-senescent cells and found raised expression of pro-survival genes. Silencing key nodes of this network, including "ephrins (EFNB1 or 3), PI3Kδ, p21, BCL-xL, or plasminogen-activated inhibitor-2, killed senescent cells, but not proliferating or quiescent, differentiated cells". Dasatinib "eliminated senescent human fat cell progenitors, while quercetin was more effective against senescent human endothelial cells and mouse BM-MSCs", and the combination was used because neither drug worked on every cell type.[^zhu2015]

The same group found that navitoclax, an inhibitor of BCL-2, BCL-xL and BCL-W, "is senolytic in some, but not all types of senescent cells": it killed senescent endothelial cells, lung fibroblasts and mouse embryonic fibroblasts, but not senescent human preadipocytes.[^zhu2016] In a separate study, Jianhui Chang, Daohong Zhou and colleagues used navitoclax to clear senescent blood and muscle stem cells in old and irradiated mice,[^chang2016] and Reut Yosef, Valery Krizhanovsky and colleagues showed that senescent cells depend on BCL-W and BCL-xL, and that the related compound ABT-737 kills them in the skin.[^yosef2016] Later screens added fisetin, another flavonoid, which killed senescent endothelial cells but not senescent lung fibroblasts or preadipocytes,[^zhu2017] and inhibitors of the chaperone HSP90.[^fuhrmann2017]

## Classes of senolytics

- **Kinase inhibitors and flavonoids.** Dasatinib, quercetin and fisetin. Each kills some types of senescent cell and not others in culture.[^zhu2015][^zhu2017]
- **BCL-2 family inhibitors.** Navitoclax, ABT-737 and the more selective BCL-xL inhibitors A1331852, A1155463 and UBX1325 (foselutoclax).[^zhu2016][^yosef2016][^zhu2017] Platelets depend on BCL-xL to survive, so systemic BCL-xL inhibition lowers the platelet count; in a phase 1 trial of navitoclax in lymphoid cancers, grade 3 or 4 thrombocytopenia occurred in 29 patients and was dose-limiting.[^mason2007][^wilson2010] UBX1325 was given by injection into the eye.
- **FOXO4-DRI**, a peptide that interferes with the binding of the transcription factor FOXO4 to p53; in senescent cells this "selectively causes p53 nuclear exclusion and cell-intrinsic apoptosis". In mice it "restored fitness, fur density and renal function in both fast aging XpdTTD/TTD and naturally aged mice".[^baar2017] The same group later revised the binding site, which lies in the disordered transactivation domain of p53 rather than in its DNA-binding domain.[^bourgeois2025] No independent laboratory has reported repeating the effects in old mice.
- **Prodrugs activated by senescence-associated β-galactosidase.** Senescent cells have high lysosomal β-galactosidase activity, and drugs coupled to galactose are released preferentially inside them. A galactose-conjugated navitoclax reduced the killing of platelets,[^gonzalezgualda2020] and the prodrug SSK1 killed senescent cells of several types in mice.[^cai2020] Because the enzyme also marks macrophages and other non-senescent cells, the selectivity is relative.[^hall2016]
- **Immune approaches.** T cells engineered to recognise uPAR, a protein on the surface of many senescent cells, removed senescent cells in mice with liver fibrosis and lung cancer,[^amor2020] and a single dose in old mice improved exercise capacity and glucose tolerance, with lasting effects.[^amor2024] A vaccine against GPNMB, another surface protein of senescent cells, improved age-related measures in mice and extended the lifespan of male progeroid mice.[^suda2021]

## Evidence in mice

Figure 1 collects the published studies of lifespan in normal mice.

```vega-lite
{
  "$schema": "https://vega.github.io/schema/vega-lite/v6.json",
  "description": "Figure 1. Published studies of the lifespan of normal mice after senescent cells were removed genetically or with drugs. Each filled circle is the change in median lifespan counted from birth; its area grows with the number of treated mice, from 9 to 150. Grey circles are studies from the laboratories that developed each method; teal circles are the four fisetin groups of the Interventions Testing Program, which used genetically diverse mice at three sites. Open circles, joined by dotted lines, show the change in median survival counted from the first dose, the figure usually quoted, for the studies that reported it. Studies of progeroid mice are not shown.",
  "width": 560,
  "height": {
    "step": 36
  },
  "data": {
    "url": "/attachments/senolytic-lifespan-studies.csv"
  },
  "layer": [
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
        }
      }
    },
    {
      "transform": [
        {
          "filter": "datum.post > 0"
        }
      ],
      "mark": {
        "type": "rule",
        "style": "observed",
        "strokeWidth": 1.5,
        "strokeDash": [
          2,
          3
        ]
      },
      "encoding": {
        "x": {
          "field": "whole",
          "type": "quantitative"
        },
        "x2": {
          "field": "post"
        },
        "y": {
          "field": "label",
          "type": "nominal",
          "sort": {
            "field": "order",
            "op": "min"
          }
        }
      }
    },
    {
      "transform": [
        {
          "filter": "datum.post > 0"
        }
      ],
      "mark": {
        "type": "point",
        "style": "observed",
        "filled": false,
        "strokeWidth": 1.5,
        "opacity": 1
      },
      "encoding": {
        "x": {
          "field": "post",
          "type": "quantitative"
        },
        "y": {
          "field": "label",
          "type": "nominal",
          "sort": {
            "field": "order",
            "op": "min"
          }
        },
        "size": {
          "field": "n",
          "type": "quantitative",
          "scale": {
            "domain": [
              0,
              300
            ],
            "range": [
              0,
              420
            ]
          },
          "legend": null
        }
      }
    },
    {
      "transform": [
        {
          "filter": "datum.post > 0"
        },
        {
          "calculate": "format(datum.post, '.0f') + '% from first dose'",
          "as": "t"
        }
      ],
      "mark": {
        "type": "text",
        "style": "observed-label",
        "align": "left",
        "dx": 10,
        "fontSize": 12
      },
      "encoding": {
        "x": {
          "field": "post",
          "type": "quantitative"
        },
        "y": {
          "field": "label",
          "type": "nominal",
          "sort": {
            "field": "order",
            "op": "min"
          }
        },
        "text": {
          "field": "t"
        }
      }
    },
    {
      "transform": [
        {
          "filter": "datum.lab == 'originating'"
        }
      ],
      "mark": {
        "type": "circle",
        "style": "observed",
        "opacity": 0.9
      },
      "encoding": {
        "x": {
          "field": "whole",
          "type": "quantitative"
        },
        "y": {
          "field": "label",
          "type": "nominal",
          "sort": {
            "field": "order",
            "op": "min"
          }
        },
        "size": {
          "field": "n",
          "type": "quantitative",
          "scale": {
            "domain": [
              0,
              300
            ],
            "range": [
              0,
              420
            ]
          },
          "legend": null
        }
      }
    },
    {
      "transform": [
        {
          "filter": "datum.lab == 'independent'"
        }
      ],
      "mark": {
        "type": "circle",
        "style": "model-point",
        "opacity": 0.9
      },
      "encoding": {
        "x": {
          "field": "whole",
          "type": "quantitative"
        },
        "y": {
          "field": "label",
          "type": "nominal",
          "sort": {
            "field": "order",
            "op": "min"
          }
        },
        "size": {
          "field": "n",
          "type": "quantitative",
          "scale": {
            "domain": [
              0,
              300
            ],
            "range": [
              0,
              420
            ]
          },
          "legend": null
        }
      }
    },
    {
      "mark": {
        "type": "text",
        "style": "label",
        "align": "left",
        "baseline": "bottom",
        "dy": -9,
        "x": 0
      },
      "encoding": {
        "y": {
          "field": "label",
          "type": "nominal",
          "sort": {
            "field": "order",
            "op": "min"
          }
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
          -10,
          70
        ],
        "nice": false
      },
      "axis": {
        "title": "Change in median lifespan, %",
        "values": [
          -10,
          0,
          10,
          20,
          30,
          40,
          50,
          60,
          70
        ]
      }
    },
    "y": {
      "type": "nominal",
      "sort": {
        "field": "order",
        "op": "min"
      },
      "axis": {
        "labels": false,
        "ticks": false,
        "domain": false,
        "title": null,
        "grid": false,
        "minExtent": 0,
        "maxExtent": 0
      },
      "scale": {
        "paddingOuter": 0.7
      }
    }
  }
}
```

Two genetic studies from one laboratory found the largest effects. Removing *p16*-expressing cells twice a week from 12 months extended median lifespan by 27% in mice of mixed background and 24% in C57BL/6 mice. Maximum lifespan increased only in the pooled mixed-background cohort, and the 35% gain in C57BL/6 males was measured against vehicle-injected controls that the authors judged short-lived, "suggesting that repetitive vehicle injection stress may have negatively impacted C57BL/6 male longevity".[^baker2016] When the same genetic clearance was started at 24–27 months, it did not improve survival (*P* = 0.46): "Unlike D+Q, AP20187 did not enhance late life survival."[^xu2018] Removing cells with high *p21* once a month from 20 months extended median lifespan by about 9% and maximum lifespan by 8.1%.[^wang2024]

The drug studies report survival counted from the first dose, which makes the effects look larger. Dasatinib plus quercetin given every two weeks from 24–27 months increased median survival after the first dose by 36%, from 140 to 191 days, but median lifespan from birth only from 937 to 996 days, by 6.3%; in females the difference was not significant.[^xu2018] Procyanidin C1, another flavonoid, gave 64% and 9.4% by the same two measures, and in 2026 the journal published an expression of concern about an image in that paper.[^xu2021][^xu2021eoc] Fisetin extended median lifespan from 27 to 30 months in groups of eight or nine mice.[^yousefzadeh2018] The Interventions Testing Program fed fisetin to 570 mice at three sites, continuously or for three days in every fourteen, and found no effect on lifespan in either sex; its authors noted that their study was "more adequately powered, using 30 × larger numbers of mice compared to the earlier study".[^harrison2024] No independent laboratory has reported a lifespan test of dasatinib plus quercetin, procyanidin C1 or removal of *p21*-expressing cells.

In progeroid mice, which die young from accelerated degeneration, several treatments extended life, including a vaccine against GPNMB, which lengthened the lifespan of males.[^suda2021] Removing *p16*-expressing cells in a progeroid strain did not substantially extend survival, which the authors attributed to heart failure.[^baker2011] Progeroid models say little about normal ageing.

Studies of health rather than lifespan are more numerous. In the group's own work, dasatinib plus quercetin improved cardiac function and vascular reactivity in old and progeroid mice,[^zhu2015] and reduced physical dysfunction caused by transplanting senescent cells into young mice.[^xu2018] Removing senescent cells genetically attenuated age-related decline of kidney, heart and fat.[^baker2016]

Removal can also do harm. Removing cells with high *p16* expression, most of which are endothelial cells of the liver's sinusoids, "disrupted blood-tissue barriers with subsequent liver and perivascular tissue fibrosis and health deterioration", and the cells were not replaced.[^grosse2020] Senescent cells are needed for the timely healing of skin wounds,[^demaria2014] and *p16*-expressing fibroblasts form a niche that supports repair of the lung epithelium.[^reyes2022] An independent group in Madrid found that dasatinib plus quercetin "can increase renal damage in the acute phase of experimental nephrotoxic nephropathy", in mice of both sexes.[^battaglia2025]

The markers used to count senescent cells add a further problem. Macrophages that express *p16* and β-galactosidase at pH 6, and so resemble senescent cells, accumulate in old mice; a drug that kills macrophages reduced both markers in old tissues, "indicating that a significant proportion of cells previously considered to be SCs" were macrophages.[^hall2016] A fall in these markers after treatment does not show that senescent cells were removed.

## Dosing

Senescent cells are removed and replaced continuously. Kirkland and Tchkonia argued that because senescent cells "take weeks to reaccumulate, senolytics can be administered intermittently – a 'hit-and-run' approach".[^kirkland2020] Omer Karin, Uri Alon and colleagues modelled the burden of senescent cells as produced at a rate that rises with age and removed at a rate that saturates, and wrote that in their model senolytic "treatment should start at old age, and can be as infrequent as the SnC turnover time (~month in old mice) and still be effective".[^karin2019] (See [[saturating-removal-model-of-senescence|Saturating-removal model of senescence]].)

Figure 2 simulates intermittent senolytic treatment in that model, with the parameters the authors used to fit the lifespans of C57BL/6J mice. Choose the share of senescent cells each dose removes, the interval between doses and the age at the first dose. At the default, removing 5% of senescent cells twice a week from 12 months raises the median lifespan from 28.6 to 49.8 months. Removing a quarter of them twice a week leaves no deaths before 60 months.

```vega-lite
{
  "$schema": "https://vega.github.io/schema/vega-lite/v6.json",
  "description": "Figure 2. Intermittent senolytic treatment simulated in the senescent-cell model of Karin and colleagues, with the parameters they fitted to the lifespans of C57BL/6J mice. Each dose removes the chosen share of every surviving mouse's senescent cells. The grey area is the survival of untreated mice; the teal line is the survival of treated mice, from 8,000 simulated mice per schedule. Dots mark the medians. In the model, all deaths are caused by the senescent-cell burden crossing a threshold, so the simulated effects are upper limits.",
  "params": [
    {
      "name": "frac",
      "value": 0.05,
      "bind": {
        "input": "select",
        "options": [
          0.05,
          0.1,
          0.25,
          0.5,
          0.75
        ],
        "labels": [
          "5%",
          "10%",
          "25%",
          "50%",
          "75%"
        ],
        "name": "Share of senescent cells removed per dose"
      }
    },
    {
      "name": "gap",
      "value": 3.5,
      "bind": {
        "input": "select",
        "options": [
          3.5,
          7,
          14,
          30,
          60,
          120
        ],
        "labels": [
          "twice a week",
          "weekly",
          "fortnightly",
          "monthly",
          "every 2 months",
          "every 4 months"
        ],
        "name": "Dosing interval"
      }
    },
    {
      "name": "start",
      "value": 12,
      "bind": {
        "input": "select",
        "options": [
          12,
          24
        ],
        "labels": [
          "12 months",
          "24 months"
        ],
        "name": "First dose at"
      }
    }
  ],
  "width": 560,
  "height": 300,
  "data": {
    "url": "/attachments/senolytic-dosing-model.csv"
  },
  "layer": [
    {
      "transform": [
        {
          "filter": "datum.frac == 0"
        }
      ],
      "mark": {
        "type": "area",
        "style": "observed",
        "opacity": 0.3,
        "interpolate": "step-after"
      },
      "encoding": {
        "x": {
          "field": "month",
          "type": "quantitative"
        },
        "y": {
          "field": "alive",
          "type": "quantitative"
        }
      }
    },
    {
      "transform": [
        {
          "filter": "datum.frac == 0"
        }
      ],
      "mark": {
        "type": "line",
        "style": "observed",
        "interpolate": "step-after",
        "strokeWidth": 1.5
      },
      "encoding": {
        "x": {
          "field": "month",
          "type": "quantitative"
        },
        "y": {
          "field": "alive",
          "type": "quantitative"
        }
      }
    },
    {
      "transform": [
        {
          "filter": "datum.frac == frac && datum.interval == gap && datum.start == start"
        }
      ],
      "mark": {
        "type": "line",
        "style": "model",
        "interpolate": "step-after"
      },
      "encoding": {
        "x": {
          "field": "month",
          "type": "quantitative"
        },
        "y": {
          "field": "alive",
          "type": "quantitative"
        }
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
      "transform": [
        {
          "calculate": "start",
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
    },
    {
      "data": {
        "values": [
          {
            "x": 0
          }
        ]
      },
      "transform": [
        {
          "calculate": "start",
          "as": "x"
        }
      ],
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
          "type": "quantitative"
        },
        "text": {
          "value": "first dose"
        }
      }
    },
    {
      "data": {
        "values": [
          {
            "m": 28.6,
            "a": 0.5
          }
        ]
      },
      "mark": {
        "type": "point",
        "style": "observed",
        "filled": true,
        "opacity": 1,
        "size": 40
      },
      "encoding": {
        "x": {
          "field": "m",
          "type": "quantitative"
        },
        "y": {
          "field": "a",
          "type": "quantitative"
        }
      }
    },
    {
      "data": {
        "values": [
          {
            "m": 28.6,
            "a": 0.5,
            "t": "median 28.6"
          }
        ]
      },
      "mark": {
        "type": "text",
        "style": "label",
        "align": "right",
        "dx": -7,
        "dy": -2
      },
      "encoding": {
        "x": {
          "field": "m",
          "type": "quantitative"
        },
        "y": {
          "field": "a",
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
          "filter": "datum.frac == frac && datum.interval == gap && datum.start == start && datum.month == 60 && datum.median > 0"
        },
        {
          "calculate": "0.5",
          "as": "a"
        }
      ],
      "layer": [
        {
          "mark": {
            "type": "point",
            "style": "model-point",
            "filled": true,
            "size": 40
          },
          "encoding": {
            "x": {
              "field": "median",
              "type": "quantitative"
            },
            "y": {
              "field": "a",
              "type": "quantitative"
            }
          }
        },
        {
          "transform": [
            {
              "calculate": "format(datum.median, '.1f') + ' (' + format(datum.median / 28.6 - 1, '+.0%') + ')'",
              "as": "t"
            }
          ],
          "mark": {
            "type": "text",
            "style": "model-label",
            "align": "left",
            "dx": 7,
            "dy": -2
          },
          "encoding": {
            "x": {
              "field": "median",
              "type": "quantitative"
            },
            "y": {
              "field": "a",
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
      "transform": [
        {
          "filter": "datum.frac == frac && datum.interval == gap && datum.start == start && datum.month == 60 && !(datum.median > 0)"
        }
      ],
      "mark": {
        "type": "text",
        "style": "model-label",
        "align": "right",
        "x": "width",
        "dx": -4,
        "y": 30
      },
      "encoding": {
        "text": {
          "value": "median not reached by 60 months"
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
        "title": "Age, months",
        "values": [
          12,
          18,
          24,
          30,
          36,
          42,
          48,
          54,
          60
        ]
      }
    },
    "y": {
      "type": "quantitative",
      "scale": {
        "domain": [
          0,
          1
        ]
      },
      "axis": {
        "title": "Share alive",
        "format": ".0%"
      }
    }
  }
}
```

The model's predictions are much larger than the observed effects. Darren Baker and colleagues removed p16-expressing cells twice a week from 12 months in INK-ATTAC mice and extended median lifespan by 24–27%;[^baker2016] in the model, that gain follows from removing about 2% of senescent cells per dose, which lowers the median burden at 18 months by about a quarter. In the fat of Baker's mice, where clearance worked best, cells staining for senescence-associated β-galactosidase fell from 1.6% to 0.2% of all cells, a reduction of nearly nine-tenths.[^baker2016] Clearance was partial in other organs and absent from the liver and colon, so the comparison is not exact. But if senescent cells as the model defines them were the only cause of death, a treatment that removed most of them in the tissues it reached would have done far more. Either the cells that matter for survival are not those the transgene removes, or senescent cells are one cause of death among several. Karin and colleagues took the first route: to match Baker's result they assumed that only a quarter of the burden can be removed, the rest being cells the treatment misses or "other forms of damage that impacts aging besides senescent cells", and calibrated that fraction to the same experiment, modelling the removal as daily rather than twice weekly.[^karin2019supp] The fraction was fitted, not measured.

## Human trials

As of October 2026, 57 trials of dasatinib, quercetin, fisetin, navitoclax or the Unity compounds as senolytics were registered at ClinicalTrials.gov, and 11 had posted results.[^ctgov2026] The trials with published or company-reported results are listed below, and Figure 3 shows the direction of their effects.

```vega-lite
{
  "$schema": "https://vega.github.io/schema/vega-lite/v6.json",
  "description": "Figure 3. Effect direction plot of the trials of senolytics in people with reported results. Rows are trials, randomised trials first, labelled with the drug, the design and the number of participants; columns are outcome domains. ▲ marks improvement, ▼ deterioration and ◄► no clear difference. In randomised trials the comparison is with the control group (placebo or no treatment; aflibercept, an approved drug, in the two eye trials); in uncontrolled trials it is with the patients' own baseline. Glyph area is proportional to the number of participants; teal glyphs are randomised trials, grey glyphs uncontrolled ones. Markers are laboratory measures of senescence or inflammation; harms are adverse events compared with control. Blank cells were not measured or not compared.",
  "usermeta": {
    "axisAllowance": 175
  },
  "width": 400,
  "height": {
    "step": 44
  },
  "data": {
    "values": [
      {
        "rid": "r0",
        "ri": 0,
        "col": "clin",
        "ci": 0,
        "kind": "blank",
        "design": "RCT",
        "n": 183
      },
      {
        "rid": "r0",
        "ri": 0,
        "col": "clin",
        "ci": 0,
        "kind": "none",
        "design": "RCT",
        "n": 183
      },
      {
        "rid": "r1",
        "ri": 1,
        "col": "clin",
        "ci": 0,
        "kind": "blank",
        "design": "RCT",
        "n": 60
      },
      {
        "rid": "r1",
        "ri": 1,
        "col": "clin",
        "ci": 0,
        "kind": "none",
        "design": "RCT",
        "n": 60
      },
      {
        "rid": "r2",
        "ri": 2,
        "col": "clin",
        "ci": 0,
        "kind": "blank",
        "design": "RCT",
        "n": 52
      },
      {
        "rid": "r2",
        "ri": 2,
        "col": "clin",
        "ci": 0,
        "kind": "none",
        "design": "RCT",
        "n": 52
      },
      {
        "rid": "r3",
        "ri": 3,
        "col": "clin",
        "ci": 0,
        "kind": "blank",
        "design": "RCT",
        "n": 51
      },
      {
        "rid": "r3",
        "ri": 3,
        "col": "clin",
        "ci": 0,
        "kind": "down",
        "design": "RCT",
        "n": 51
      },
      {
        "rid": "r3",
        "ri": 3,
        "col": "adv",
        "ci": 3,
        "kind": "none",
        "design": "RCT",
        "n": 51
      },
      {
        "rid": "r4",
        "ri": 4,
        "col": "clin",
        "ci": 0,
        "kind": "blank",
        "design": "RCT",
        "n": 12
      },
      {
        "rid": "r4",
        "ri": 4,
        "col": "clin",
        "ci": 0,
        "kind": "none",
        "design": "RCT",
        "n": 12
      },
      {
        "rid": "r4",
        "ri": 4,
        "col": "func",
        "ci": 1,
        "kind": "none",
        "design": "RCT",
        "n": 12
      },
      {
        "rid": "r4",
        "ri": 4,
        "col": "adv",
        "ci": 3,
        "kind": "down",
        "design": "RCT",
        "n": 12
      },
      {
        "rid": "r5",
        "ri": 5,
        "col": "clin",
        "ci": 0,
        "kind": "blank",
        "design": "none",
        "n": 14
      },
      {
        "rid": "r5",
        "ri": 5,
        "col": "clin",
        "ci": 0,
        "kind": "none",
        "design": "none",
        "n": 14
      },
      {
        "rid": "r5",
        "ri": 5,
        "col": "func",
        "ci": 1,
        "kind": "up",
        "design": "none",
        "n": 14
      },
      {
        "rid": "r6",
        "ri": 6,
        "col": "clin",
        "ci": 0,
        "kind": "blank",
        "design": "none",
        "n": 11
      },
      {
        "rid": "r6",
        "ri": 6,
        "col": "bio",
        "ci": 2,
        "kind": "up",
        "design": "none",
        "n": 11
      },
      {
        "rid": "r7",
        "ri": 7,
        "col": "clin",
        "ci": 0,
        "kind": "blank",
        "design": "none",
        "n": 5
      },
      {
        "rid": "r7",
        "ri": 7,
        "col": "clin",
        "ci": 0,
        "kind": "none",
        "design": "none",
        "n": 5
      },
      {
        "rid": "r7",
        "ri": 7,
        "col": "bio",
        "ci": 2,
        "kind": "down",
        "design": "none",
        "n": 5
      }
    ]
  },
  "layer": [
    {
      "transform": [
        {
          "filter": "datum.kind == 'up' && datum.design == 'RCT'"
        }
      ],
      "mark": {
        "type": "point",
        "shape": "M0,-1L0.9,0.7L-0.9,0.7Z",
        "filled": true,
        "opacity": 1,
        "style": "model-point"
      },
      "encoding": {
        "x": {
          "field": "col",
          "type": "nominal"
        },
        "y": {
          "field": "rid",
          "type": "nominal"
        },
        "size": {
          "field": "n",
          "type": "quantitative",
          "scale": {
            "type": "sqrt",
            "domain": [
              0,
              183
            ],
            "range": [
              0,
              700
            ]
          },
          "legend": null
        }
      }
    },
    {
      "transform": [
        {
          "filter": "datum.kind == 'up' && datum.design == 'none'"
        }
      ],
      "mark": {
        "type": "point",
        "shape": "M0,-1L0.9,0.7L-0.9,0.7Z",
        "filled": true,
        "opacity": 1,
        "style": "observed"
      },
      "encoding": {
        "x": {
          "field": "col",
          "type": "nominal"
        },
        "y": {
          "field": "rid",
          "type": "nominal"
        },
        "size": {
          "field": "n",
          "type": "quantitative",
          "scale": {
            "type": "sqrt",
            "domain": [
              0,
              183
            ],
            "range": [
              0,
              700
            ]
          },
          "legend": null
        }
      }
    },
    {
      "transform": [
        {
          "filter": "datum.kind == 'down' && datum.design == 'RCT'"
        }
      ],
      "mark": {
        "type": "point",
        "shape": "M0,1L0.9,-0.7L-0.9,-0.7Z",
        "filled": true,
        "opacity": 1,
        "style": "model-point"
      },
      "encoding": {
        "x": {
          "field": "col",
          "type": "nominal"
        },
        "y": {
          "field": "rid",
          "type": "nominal"
        },
        "size": {
          "field": "n",
          "type": "quantitative",
          "scale": {
            "type": "sqrt",
            "domain": [
              0,
              183
            ],
            "range": [
              0,
              700
            ]
          },
          "legend": null
        }
      }
    },
    {
      "transform": [
        {
          "filter": "datum.kind == 'down' && datum.design == 'none'"
        }
      ],
      "mark": {
        "type": "point",
        "shape": "M0,1L0.9,-0.7L-0.9,-0.7Z",
        "filled": true,
        "opacity": 1,
        "style": "observed"
      },
      "encoding": {
        "x": {
          "field": "col",
          "type": "nominal"
        },
        "y": {
          "field": "rid",
          "type": "nominal"
        },
        "size": {
          "field": "n",
          "type": "quantitative",
          "scale": {
            "type": "sqrt",
            "domain": [
              0,
              183
            ],
            "range": [
              0,
              700
            ]
          },
          "legend": null
        }
      }
    },
    {
      "transform": [
        {
          "filter": "datum.kind == 'none' && datum.design == 'RCT'"
        }
      ],
      "mark": {
        "type": "point",
        "shape": "M-1.35,0L-0.4,-0.81L-0.4,0.81ZM1.35,0L0.4,-0.81L0.4,0.81Z",
        "filled": true,
        "opacity": 1,
        "style": "model-point"
      },
      "encoding": {
        "x": {
          "field": "col",
          "type": "nominal"
        },
        "y": {
          "field": "rid",
          "type": "nominal"
        },
        "size": {
          "field": "n",
          "type": "quantitative",
          "scale": {
            "type": "sqrt",
            "domain": [
              0,
              183
            ],
            "range": [
              0,
              700
            ]
          },
          "legend": null
        }
      }
    },
    {
      "transform": [
        {
          "filter": "datum.kind == 'none' && datum.design == 'none'"
        }
      ],
      "mark": {
        "type": "point",
        "shape": "M-1.35,0L-0.4,-0.81L-0.4,0.81ZM1.35,0L0.4,-0.81L0.4,0.81Z",
        "filled": true,
        "opacity": 1,
        "style": "observed"
      },
      "encoding": {
        "x": {
          "field": "col",
          "type": "nominal"
        },
        "y": {
          "field": "rid",
          "type": "nominal"
        },
        "size": {
          "field": "n",
          "type": "quantitative",
          "scale": {
            "type": "sqrt",
            "domain": [
              0,
              183
            ],
            "range": [
              0,
              700
            ]
          },
          "legend": null
        }
      }
    }
  ],
  "encoding": {
    "x": {
      "type": "nominal",
      "scale": {
        "domain": [
          "clin",
          "func",
          "bio",
          "adv"
        ]
      },
      "axis": {
        "orient": "top",
        "title": null,
        "ticks": false,
        "domain": false,
        "labelAngle": 0,
        "labelFontWeight": 600,
        "labelPadding": 8,
        "grid": true,
        "labelExpr": "{'clin':['Clinical','outcome'],'func':['Function',''],'bio':['Markers',''],'adv':['Harms','']}[datum.value]"
      }
    },
    "y": {
      "type": "nominal",
      "scale": {
        "domain": [
          "r0",
          "r1",
          "r2",
          "r3",
          "r4",
          "r5",
          "r6",
          "r7"
        ]
      },
      "axis": {
        "title": null,
        "ticks": false,
        "domain": false,
        "labelAlign": "left",
        "labelPadding": 165,
        "minExtent": 165,
        "maxExtent": 165,
        "labelLimit": 160,
        "labelLineHeight": 15,
        "labelExpr": "{\"r0\": [\"Knee osteoarthritis\", \"UBX0101 \\u00b7 randomised \\u00b7 183\"], \"r1\": [\"Postmenopausal bone loss\", \"D+Q \\u00b7 randomised \\u00b7 60\"], \"r2\": [\"Diabetic macular oedema\", \"UBX1325 \\u00b7 randomised \\u00b7 52\"], \"r3\": [\"Macular degeneration\", \"UBX1325 \\u00b7 randomised \\u00b7 51\"], \"r4\": [\"Pulmonary fibrosis\", \"D+Q \\u00b7 randomised \\u00b7 12\"], \"r5\": [\"Pulmonary fibrosis\", \"D+Q \\u00b7 uncontrolled \\u00b7 14\"], \"r6\": [\"Diabetic kidney disease\", \"D+Q \\u00b7 uncontrolled \\u00b7 11\"], \"r7\": [\"Alzheimer's disease\", \"D+Q \\u00b7 uncontrolled \\u00b7 5\"]}[datum.value]"
      }
    }
  }
}
```

- **Pulmonary fibrosis, open label.** In 14 people with idiopathic pulmonary fibrosis, nine doses of dasatinib plus quercetin over three weeks were feasible; walking distance, gait speed and chair-standing time improved, while lung function, frailty and reported health did not change. There was no control group.[^justice2019]
- **Diabetic kidney disease, uncontrolled.** In 11 people given three days of dasatinib plus quercetin, *p16*-positive cells, macrophages and crown-like structures in abdominal fat were fewer 11 days later. A corrected analysis, which replaced unpaired with the pre-planned paired tests on untransformed data, found that "skin senescence markers were not statistically decreased", and among blood SASP factors only MMP-12 fell individually.[^hickson2019][^hickson2020]
- **Knee osteoarthritis.** UBX0101, an inhibitor of the MDM2–p53 interaction injected into the knee, was tested in a placebo-controlled phase 2 trial of 183 patients. At 12 weeks the change in pain was −1.02 points with placebo and −0.92, −1.05 and −1.02 with the three doses; there was "no statistically significant difference between any arm of UBX0101 and placebo", and development stopped.[^unity2020]
- **Pulmonary fibrosis, randomised.** In a single-blind, placebo-controlled pilot trial of 12 patients, physical, pulmonary and frailty measures did not differ meaningfully between groups. The treated group had 65 non-serious adverse events against 22 with placebo, and sleep disturbance or anxiety in 4 of 6 patients against none; the published abstract states the comparison the wrong way round.[^nambiar2023]
- **Alzheimer's disease.** In an open-label study of 5 patients, dasatinib reached the cerebrospinal fluid in 4, at under 1% of its plasma level, and quercetin was not detected. Cognition and imaging did not change, and IL-6 and GFAP in cerebrospinal fluid rose.[^gonzales2023]
- **Postmenopausal bone loss.** In 60 women randomised to intermittent dasatinib plus quercetin or no treatment for 20 weeks, the primary endpoint, the change in the bone-resorption marker CTx, did not differ (−4.1% against −7.7%, *P* = 0.61). A transient rise in a bone-formation marker and benefits in women with high T-cell *CDKN2A* expression were exploratory.[^farr2024]
- **Diabetic macular oedema.** In a sham-controlled phase 2 trial, Unity reported that a single eye injection of UBX1325 improved visual acuity through 48 weeks.[^unity2025] In the phase 2b ASPIRE trial against aflibercept, the standard anti-VEGF treatment, the drug was non-inferior "at most time points through 36 weeks, except for the average of weeks 20 and 24, the primary endpoint"; visual acuity improved by 3.7 letters with UBX1325 and 5.1 with aflibercept.[^unity2025][^aspire2025] In a randomised trial against aflibercept in 51 patients with neovascular age-related macular degeneration, the change in visual acuity was smaller with UBX1325 at every one of 13 measured visits, ending at −1.5 letters against +1.7.[^namd2025]

No randomised trial has met a primary efficacy endpoint. The positive findings come from uncontrolled studies, secondary or exploratory analyses, and company statements. Kirkland and Tchkonia themselves wrote that "unless and until such clinical trials are completed and demonstrate safety, tolerability, target engagement and effectiveness, candidate senolytics should not be prescribed or used by general patient populations".[^kirkland2020]

## Conflicts of interest

The discovery of dasatinib plus quercetin, most of the mouse studies of it, the main reviews and all of the human trials of the combination listed above come from the Mayo Clinic group or include its members as authors. "Patents on senolytic drugs are held by Mayo Clinic", and the authors "have a financial interest related to this research".[^kirkland2020] Members of the same group were also authors of the Interventions Testing Program study that found no effect of fisetin.[^harrison2024]

## History

Removal of senescent cells was first shown to delay age-related disease in progeroid mice in 2011, and to extend lifespan in normal mice in 2016, by genetic methods.[^baker2011][^baker2016] The first senolytic drugs were reported in 2015 and 2016.[^zhu2015][^zhu2016][^chang2016][^yosef2016] Unity Biotechnology, founded to develop senolytics, began its first trial in 2018; its lead drug failed in osteoarthritis in 2020,[^unity2020] its eye drug missed the primary endpoint of a phase 2b trial in 2025, and the company laid off all its employees and dissolved in September 2025.[^unity2025b] The first randomised trials of dasatinib plus quercetin reported in 2023 and 2024, and the Interventions Testing Program reported in 2024 that fisetin, given continuously or in a hit-and-run schedule, did not extend the lifespan of mice.[^nambiar2023][^farr2024][^harrison2024]

## Data and figures

Figure 1 uses the median lifespans reported in the papers or printed in their figures. Changes from birth for dasatinib plus quercetin and procyanidin C1 are computed from the medians printed in the papers' survival figures (937 and 996 days; 843 and 922 days), and for the Interventions Testing Program from its Table 1 (control medians 750 days in males and 876 in females).[^xu2018][^xu2021][^harrison2024]

Figure 2 was computed for this article by simulating the model of Karin and colleagues[^karin2019] with their mortality-fit parameters (production slope 0.084 per day per year, maximum removal rate 0.15 per day, half-saturation 0.5, noise 0.16 per day, death threshold 17) for 8,000 mice per schedule, with time steps of half a day; each dose multiplies every surviving mouse's burden by one minus the removed share. The comparison with Baker and colleagues uses their reported clearance in inguinal fat.

Figure 3 is an effect direction plot, the display recommended for synthesising studies whose outcomes cannot be combined into a common effect size.[^thomson2013][^boon2021] Each cell gives the direction of the reported effects in one outcome domain of one trial, taken from the publications, company reports and registry records cited in the list above; when a domain contained several measures, the arrow follows the direction of most of them. Statistical significance is not shown, following the revised method.[^boon2021]

[^zhu2015]: Zhu Y, Tchkonia T, Pirtskhalava T, Gower AC, Ding H, et al. (2015). "The Achilles' heel of senescent cells: from transcriptome to senolytic drugs". *Aging Cell*. 14 (4): 644–658. [doi:10.1111/acel.12344](https://doi.org/10.1111/acel.12344)

[^zhu2016]: Zhu Y, Tchkonia T, Fuhrmann-Stroissnigg H, Dai HM, Ling YY, et al. (2016). "Identification of a novel senolytic agent, navitoclax, targeting the Bcl-2 family of anti-apoptotic factors". *Aging Cell*. 15 (3): 428–435. [doi:10.1111/acel.12445](https://doi.org/10.1111/acel.12445)

[^chang2016]: Chang J, Wang Y, Shao L, Laberge RM, Demaria M, et al. (2016). "Clearance of senescent cells by ABT263 rejuvenates aged hematopoietic stem cells in mice". *Nature Medicine*. 22 (1): 78–83. [doi:10.1038/nm.4010](https://doi.org/10.1038/nm.4010)

[^kirkland2020]: Kirkland JL, Tchkonia T (2020). "Senolytic drugs: from discovery to translation". *Journal of Internal Medicine*. 288 (5): 518–536. [doi:10.1111/joim.13141](https://doi.org/10.1111/joim.13141)

[^harrison2024]: Harrison DE, Strong R, Reifsnyder P, Rosenthal N, Korstanje R, et al. (2024). "Astaxanthin and meclizine extend lifespan in UM-HET3 male mice; fisetin, SG1002 (hydrogen sulfide donor), dimethyl fumarate, mycophenolic acid, and 4-phenylbutyrate do not significantly affect lifespan in either sex at the doses and schedules used". *GeroScience*. 46 (1): 795–816. [doi:10.1007/s11357-023-01011-0](https://doi.org/10.1007/s11357-023-01011-0)

[^unity2020]: Unity Biotechnology (17 August 2020). Press release on the 12-week results of the phase 2 study of UBX0101 in painful knee osteoarthritis (NCT04129944), filed with the US Securities and Exchange Commission (Form 8-K, exhibit 99.1). [SEC filing](https://www.sec.gov/Archives/edgar/data/1463361/000119312520222493/d28349dex991.htm)

[^nambiar2023]: Nambiar A, Kellogg D, Justice J, Goros M, Gelfond J, et al. (2023). "Senolytics dasatinib and quercetin in idiopathic pulmonary fibrosis: results of a phase I, single-blind, single-center, randomized, placebo-controlled pilot trial on feasibility and tolerability". *eBioMedicine*. 90: 104481. [doi:10.1016/j.ebiom.2023.104481](https://doi.org/10.1016/j.ebiom.2023.104481)

[^farr2024]: Farr JN, Atkinson EJ, Achenbach SJ, Volkman TL, Tweed AJ, et al. (2024). "Effects of intermittent senolytic therapy on bone metabolism in postmenopausal women: a phase 2 randomized controlled trial". *Nature Medicine*. 30 (9): 2605–2612. [doi:10.1038/s41591-024-03096-2](https://doi.org/10.1038/s41591-024-03096-2)

[^unity2025]: Unity Biotechnology (5 May 2025). "UNITY Biotechnology announces complete 36-week results from the ASPIRE Phase 2b study of UBX1325 in diabetic macular edema and provides corporate updates". Press release, filed with the U.S. Securities and Exchange Commission as exhibit 99.1 to Form 8-K.

[^unity2025b]: Unity Biotechnology (26 September 2025). Current report on Form 8-K: completion of dissolution. U.S. Securities and Exchange Commission, CIK 0001463361.

[^grosse2020]: Grosse L, Wagner N, Emelyanov A, Molina C, Lacas-Gervais S, et al. (2020). "Defined p16High senescent cell types are indispensable for mouse healthspan". *Cell Metabolism*. 32 (1): 87–99. [doi:10.1016/j.cmet.2020.05.002](https://doi.org/10.1016/j.cmet.2020.05.002)

[^hall2016]: Hall BM, Balan V, Gleiberman AS, Strom E, Krasnov P, et al. (2016). "Aging of mice is associated with p16(Ink4a)- and β-galactosidase-positive macrophage accumulation that can be induced in young mice by senescent cells". *Aging*. 8 (7): 1294–1315. [doi:10.18632/aging.100991](https://doi.org/10.18632/aging.100991)

[^xu2015]: Xu M, Tchkonia T, Ding H, Ogrodnik M, Lubbers ER, et al. (2015). "JAK inhibition alleviates the cellular senescence-associated secretory phenotype and frailty in old age". *PNAS*. 112 (46). [doi:10.1073/pnas.1515386112](https://doi.org/10.1073/pnas.1515386112)

[^raffaele2022]: Raffaele M, Vinciguerra M (2022). "The costs and benefits of senotherapeutics for human health". *The Lancet Healthy Longevity*. 3 (1): e67–e77. [doi:10.1016/S2666-7568(21)00300-7](https://doi.org/10.1016/S2666-7568(21)00300-7)

[^yosef2016]: Yosef R, Pilpel N, Tokarsky-Amiel R, Biran A, Ovadya Y, et al. (2016). "Directed elimination of senescent cells by inhibition of BCL-W and BCL-XL". *Nature Communications*. 7: 11190. [doi:10.1038/ncomms11190](https://doi.org/10.1038/ncomms11190)

[^zhu2017]: Zhu Y, Doornebal EJ, Pirtskhalava T, Giorgadze N, Wentworth M, et al. (2017). "New agents that target senescent cells: the flavone, fisetin, and the BCL-XL inhibitors, A1331852 and A1155463". *Aging*. 9 (3): 955–963. [doi:10.18632/aging.101202](https://doi.org/10.18632/aging.101202)

[^fuhrmann2017]: Fuhrmann-Stroissnigg H, Ling YY, Zhao J, McGowan SJ, Zhu Y, et al. (2017). "Identification of HSP90 inhibitors as a novel class of senolytics". *Nature Communications*. 8: 422. [doi:10.1038/s41467-017-00314-z](https://doi.org/10.1038/s41467-017-00314-z)

[^mason2007]: Mason KD, Carpinelli MR, Fletcher JI, Collinge JE, Hilton AA, et al. (2007). "Programmed anuclear cell death delimits platelet life span". *Cell*. 128 (6): 1173–1186. [doi:10.1016/j.cell.2007.01.037](https://doi.org/10.1016/j.cell.2007.01.037)

[^wilson2010]: Wilson WH, O'Connor OA, Czuczman MS, LaCasce AS, Gerecitano JF, et al. (2010). "Navitoclax, a targeted high-affinity inhibitor of BCL-2, in lymphoid malignancies: a phase 1 dose-escalation study of safety, pharmacokinetics, pharmacodynamics, and antitumour activity". *Lancet Oncology*. 11 (12): 1149–1159. [doi:10.1016/S1470-2045(10)70261-8](https://doi.org/10.1016/S1470-2045(10)70261-8)

[^baar2017]: Baar MP, Brandt RMC, Putavet DA, Klein JDD, Derks KWJ, et al. (2017). "Targeted apoptosis of senescent cells restores tissue homeostasis in response to chemotoxicity and aging". *Cell*. 169 (1): 132–147.e16. [doi:10.1016/j.cell.2017.02.031](https://doi.org/10.1016/j.cell.2017.02.031)

[^bourgeois2025]: Bourgeois B, Spreitzer E, Platero-Rochart D, Paar M, Zhou Q, et al. (2025). "The disordered p53 transactivation domain is the target of FOXO4 and the senolytic compound FOXO4-DRI". *Nature Communications*. 16: 5672. [doi:10.1038/s41467-025-60844-9](https://doi.org/10.1038/s41467-025-60844-9)

[^gonzalezgualda2020]: González-Gualda E, Pàez-Ribes M, Lozano-Torres B, Macias D, Wilson JR, et al. (2020). "Galacto-conjugation of Navitoclax as an efficient strategy to increase senolytic specificity and reduce platelet toxicity". *Aging Cell*. 19 (4): e13142. [doi:10.1111/acel.13142](https://doi.org/10.1111/acel.13142)

[^cai2020]: Cai Y, Zhou H, Zhu Y, Sun Q, Ji Y, et al. (2020). "Elimination of senescent cells by β-galactosidase-targeted prodrug attenuates inflammation and restores physical function in aged mice". *Cell Research*. 30 (7): 574–589. [doi:10.1038/s41422-020-0314-9](https://doi.org/10.1038/s41422-020-0314-9)

[^amor2020]: Amor C, Feucht J, Leibold J, Ho YJ, Zhu C, et al. (2020). "Senolytic CAR T cells reverse senescence-associated pathologies". *Nature*. 583 (7814): 127–132. [doi:10.1038/s41586-020-2403-9](https://doi.org/10.1038/s41586-020-2403-9)

[^amor2024]: Amor C, Fernández-Maestre I, Chowdhury S, Ho YJ, Nadella S, et al. (2024). "Prophylactic and long-lasting efficacy of senolytic CAR T cells against age-related metabolic dysfunction". *Nature Aging*. 4 (3): 336–349. [doi:10.1038/s43587-023-00560-5](https://doi.org/10.1038/s43587-023-00560-5)

[^suda2021]: Suda M, Shimizu I, Katsuumi G, Yoshida Y, Hayashi Y, et al. (2021). "Senolytic vaccination improves normal and pathological age-related phenotypes and increases lifespan in progeroid mice". *Nature Aging*. 1 (12): 1117–1126. [doi:10.1038/s43587-021-00151-2](https://doi.org/10.1038/s43587-021-00151-2)

[^karin2019]: Karin O, Agrawal A, Porat Z, Krizhanovsky V, Alon U (2019). "Senescent cell turnover slows with age providing an explanation for the Gompertz law". *Nature Communications*. 10: 5495. [doi:10.1038/s41467-019-13192-4](https://doi.org/10.1038/s41467-019-13192-4)

[^karin2019supp]: Karin O, Agrawal A, Porat Z, Krizhanovsky V, Alon U (2019). Supplementary Information for "Senescent cell turnover slows with age providing an explanation for the Gompertz law", Supplementary Note 6. *Nature Communications*. 10: 5495. [doi:10.1038/s41467-019-13192-4](https://doi.org/10.1038/s41467-019-13192-4)

[^baker2016]: Baker DJ, Childs BG, Durik M, et al. (2016). "Naturally occurring p16Ink4a-positive cells shorten healthy lifespan". *Nature*. 530 (7589): 184–189. [doi:10.1038/nature16932](https://doi.org/10.1038/nature16932)

[^xu2018]: Xu M, Pirtskhalava T, Farr JN, Weigand BM, Palmer AK, et al. (2018). "Senolytics improve physical function and increase lifespan in old age". *Nature Medicine*. 24 (8): 1246–1256. [doi:10.1038/s41591-018-0092-9](https://doi.org/10.1038/s41591-018-0092-9)

[^wang2024]: Wang B, Wang L, Gasek NS, Kuo CL, Nie J, et al. (2024). "Intermittent clearance of p21-highly-expressing cells extends lifespan and confers sustained benefits to health and physical function". *Cell Metabolism*. 36 (8): 1795–1805.e6. [doi:10.1016/j.cmet.2024.07.006](https://doi.org/10.1016/j.cmet.2024.07.006)

[^xu2021]: Xu Q, Fu Q, Li Z, Liu H, Wang Y, et al. (2021). "The flavonoid procyanidin C1 has senotherapeutic activity and increases lifespan in mice". *Nature Metabolism*. 3 (12): 1706–1726. [doi:10.1038/s42255-021-00491-8](https://doi.org/10.1038/s42255-021-00491-8)

[^xu2021eoc]: Nature Metabolism (2026). "Editorial expression of concern: The flavonoid procyanidin C1 has senotherapeutic activity and increases lifespan in mice". *Nature Metabolism*. 8 (3): 757. [doi:10.1038/s42255-026-01487-y](https://doi.org/10.1038/s42255-026-01487-y)

[^yousefzadeh2018]: Yousefzadeh MJ, Zhu Y, McGowan SJ, Angelini L, Fuhrmann-Stroissnigg H, et al. (2018). "Fisetin is a senotherapeutic that extends health and lifespan". *EBioMedicine*. 36: 18–28. [doi:10.1016/j.ebiom.2018.09.015](https://doi.org/10.1016/j.ebiom.2018.09.015)

[^baker2011]: Baker DJ, Wijshake T, Tchkonia T, LeBrasseur NK, Childs BG, et al. (2011). "Clearance of p16Ink4a-positive senescent cells delays ageing-associated disorders". *Nature*. 479 (7372): 232–236. [doi:10.1038/nature10600](https://doi.org/10.1038/nature10600)

[^demaria2014]: Demaria M, Ohtani N, Youssef SA, et al. (2014). "An essential role for senescent cells in optimal wound healing through secretion of PDGF-AA". *Developmental Cell*. 31 (6): 722–733. [doi:10.1016/j.devcel.2014.11.012](https://doi.org/10.1016/j.devcel.2014.11.012)

[^reyes2022]: Reyes NS, Krasilnikov M, Allen NC, Lee JY, Hyams B, et al. (2022). "Sentinel *p16*<sup>INK4a+</sup> cells in the basement membrane form a reparative niche in the lung". *Science*. 378 (6616): 192–201. [doi:10.1126/science.abf3326](https://doi.org/10.1126/science.abf3326)

[^battaglia2025]: Battaglia-Vieni A, Marchant V, Tejedor-Santamaria L, García-Caballero C, Flores-Salguero E, et al. (2025). "Dasatinib and quercetin combination increased kidney damage in acute folic acid-induced experimental nephropathy". *Pharmaceuticals*. 18 (6): 822. [doi:10.3390/ph18060822](https://doi.org/10.3390/ph18060822)

[^ctgov2026]: ClinicalTrials.gov, search of registered studies whose interventions or titles name dasatinib, quercetin, fisetin, navitoclax, UBX compounds, foselutoclax or "senolytic", queried 14 October 2026; studies of the same compounds for other purposes excluded.

[^justice2019]: Justice JN, Nambiar AM, Tchkonia T, LeBrasseur NK, Pascual R, et al. (2019). "Senolytics in idiopathic pulmonary fibrosis: results from a first-in-human, open-label, pilot study". *EBioMedicine*. 40: 554–563. [doi:10.1016/j.ebiom.2018.12.052](https://doi.org/10.1016/j.ebiom.2018.12.052)

[^hickson2019]: Hickson LJ, Langhi Prata LGP, Bobart SA, et al. (2019). "Senolytics decrease senescent cells in humans: preliminary report from a clinical trial of dasatinib plus quercetin in individuals with diabetic kidney disease". *EBioMedicine*. 47: 446–456. [doi:10.1016/j.ebiom.2019.08.069](https://doi.org/10.1016/j.ebiom.2019.08.069)

[^hickson2020]: Hickson LJ, Langhi Prata LGP, Bobart SA, Evans TK, Giorgadze N, et al. (2020). "Corrigendum to 'Senolytics decrease senescent cells in humans: preliminary report from a clinical trial of dasatinib plus quercetin in individuals with diabetic kidney disease'". *EBioMedicine*. 52: 102595. [doi:10.1016/j.ebiom.2019.12.004](https://doi.org/10.1016/j.ebiom.2019.12.004)

[^gonzales2023]: Gonzales MM, Garbarino VR, Kautz TF, Palavicini JP, Lopez-Cruzan M, et al. (2023). "Senolytic therapy in mild Alzheimer's disease: a phase 1 feasibility trial". *Nature Medicine*. 29 (10): 2481–2488. [doi:10.1038/s41591-023-02543-w](https://doi.org/10.1038/s41591-023-02543-w)

[^aspire2025]: ClinicalTrials.gov. "UBX1325 in patients with diabetic macular edema (ASPIRE)", NCT06011798; results first posted 5 August 2025. [clinicaltrials.gov/study/NCT06011798](https://clinicaltrials.gov/study/NCT06011798)

[^namd2025]: ClinicalTrials.gov. Phase 2 study of UBX1325 versus aflibercept in neovascular age-related macular degeneration, NCT05275205; results first posted 7 August 2024. [clinicaltrials.gov/study/NCT05275205](https://clinicaltrials.gov/study/NCT05275205)

[^thomson2013]: Thomson HJ, Thomas S (2013). "The effect direction plot: visual display of non-standardised effects across multiple outcome domains". *Research Synthesis Methods*. 4 (1): 95–101. [doi:10.1002/jrsm.1060](https://doi.org/10.1002/jrsm.1060)

[^boon2021]: Boon MH, Thomson H (2021). "The effect direction plot revisited: application of the 2019 Cochrane Handbook guidance on alternative synthesis methods". *Research Synthesis Methods*. 12 (1): 29–33. [doi:10.1002/jrsm.1458](https://doi.org/10.1002/jrsm.1458)
