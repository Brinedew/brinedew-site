---
title: Disposable soma theory
date: 2026-10-13
draft: true
tags:
  - content/wiki
aliases:
  - Disposable soma
  - Disposable Soma Theory
  - Cost of reproduction
---
# Disposable soma theory

The **disposable soma theory** is an evolutionary theory of ageing proposed by Thomas Kirkwood in 1977. It holds that organisms spend less on maintaining and repairing their bodies than indefinite survival would require, because resources spent on maintenance cannot be spent on reproduction, and because future reproduction is discounted by the chance of dying first, so that a body built to last indefinitely is not worth its cost. How the level of external mortality changes the best investment depends on how population growth is regulated.[^moorad2019] The body, the *soma*, is in this sense disposable; the germ line, the cells that pass into the next generation, is not.[^kirkwoodholliday1979] Damage that the soma does not repair accumulates, and its accumulation is ageing.[^kirkwood2005]

The theory began as an argument about the accuracy of protein synthesis: Kirkwood proposed that mortality may be "due to an energy-saving strategy of reduced error regulation in somatic cells".[^kirkwood1977] With Robin Holliday he extended it in 1979 from protein synthesis to the accuracy of macromolecular synthesis in general;[^kirkwoodholliday1979] by 1991 it covered somatic maintenance of every kind.[^kirkwoodrose1991] It is the physiological counterpart of [[antagonistic-pleiotropy-theory|antagonistic pleiotropy]]: Kirkwood and Michael Rose described the two as convergent theories, one from population genetics and the other from physiological ecology.[^kirkwoodrose1991] Both rely on the decline with age in the force of natural selection described under [[selection-shadow-theory|selection shadow]].

Three questions run through the field. The first is whether the trade-off between reproduction and longevity is a trade-off of energy and nutrients, as the theory assumes; in worms and flies, mutations and diets have separated long life from low fertility.[^partridge2005][^maklakovchapman2019] The second is whether the extension of lifespan by dietary restriction is an evolved reallocation of resources from reproduction to maintenance.[^shanleykirkwood2000][^grandison2009] The third is whether species with longer lives invest more in maintenance; comparisons of cells across species support this for some stresses and kinds of repair but not others.[^kapahi1999][^harper2007][^tian2019]

## Terminology

- The **soma** is all the cells of the body other than the **germ line**, the cells that give rise to eggs and sperm.
- **Somatic maintenance** is the set of processes that keep the soma functional: repair of damaged DNA, replacement of damaged proteins and cells, defences against oxidants, wound healing and immunity. Kirkwood and Holliday's original example was the accuracy of protein synthesis, which costs energy.[^kirkwoodholliday1979]
- A **trade-off** between two traits exists when increasing one decreases the other. The **cost of reproduction** is the trade-off between reproduction and later survival or fertility. Linda Partridge, David Gems and Dominic Withers called it "of widespread occurrence".[^partridge2005]
- **Allocation** is the division of resources between competing uses; **acquisition** is how much an individual obtains. Individuals that acquire more can both reproduce more and live longer, so a trade-off in allocation can be hidden by differences in acquisition.[^vannoordwijk1986]
- **Extrinsic mortality** is the risk of death from causes that would kill an individual regardless of its condition, such as predation or accidents.

## Kirkwood's argument

### From error catastrophe to maintenance

In 1963 Leslie Orgel proposed that errors in protein synthesis could feed back on themselves: an error in an enzyme of the protein-synthesis machinery produces more errors, which could end in an *error catastrophe*.[^orgel1963] Kirkwood's 1977 paper argued that avoiding such a catastrophe requires energy for proofreading, and that an organism may save that energy in its somatic cells. Its abstract concludes that mortality may be "due to an energy-saving strategy of reduced error regulation in somatic cells", a view that "supports Orgel's 'error catastrophe' hypothesis".[^kirkwood1977] Direct measurements later failed to support the error catastrophe: error frequencies in cultured human fibroblasts did not rise with passage or donor age, and an immortal transformed line made more errors, not fewer.[^harley1980] The disposable soma theory survived because its argument does not depend on any one kind of damage.

Kirkwood and Holliday set out the general argument in 1979. Macromolecules must be made accurately enough "to prevent error feedback and the development of lethal 'error catastrophes'. This involves the expenditure of energy[…]. It may be selectively advantageous for higher organisms to adopt an energy saving strategy of reduced accuracy in somatic cells to accelerate development and reproduction, but the consequence will be eventual deterioration and death."[^kirkwoodholliday1979] The germ line, by contrast, must keep high accuracy, or its defective cells must be removed, if a lineage is to persist. The same paper rejected the idea that ageing is an adaptation: "Ageing is not adaptive since it reduces reproductive potential."[^kirkwoodholliday1979]

### Optimal allocation

The theory's formal core is an optimisation. An individual's resources go either to reproduction or to maintenance. More maintenance means fewer offspring each year but a slower rise in the mortality rate with age. Natural selection favours the division that maximises fitness. Because every individual risks death from external causes, a body that would last indefinitely is not worth its cost: Francesco Drenos and Kirkwood's model confirmed that "the optimum investment in somatic maintenance is less than what would be required for indefinite longevity".[^drenoskirkwood2005]

Figure 1 is an illustrative version of the model. With an external mortality rate of 0.1 a year, the best strategy spends 22% of its resources on maintenance, and its members would live a median of 18 years if nothing external killed them. Drag the risk down to 0.02 a year: in a population held constant by fewer births, the best share rises to 48% and the median lifespan to 39 years. At 0.3 a year, maintenance is not worth paying for at all. In a population free to grow or shrink, the best share does not change.

```vega-lite
{
  "$schema": "https://vega.github.io/schema/vega-lite/v6.json",
  "description": "Figure 1. An illustrative disposable-soma model. An animal divides its resources between reproduction and maintenance; the more it spends on maintenance, the fewer offspring it has each year and the more slowly its mortality rate rises with age. The slider sets the external mortality rate. The first panel shows the share of resources spent on maintenance that maximises fitness, when the population is held constant by fewer births (solid line) and when it is free to grow or shrink (dashed line). The second shows, for the best strategy, the share still alive at each age if there were no external deaths, which measures how fast it ages. The model's numbers are arbitrary; only the directions of change carry over to real organisms.",
  "params": [
    {
      "name": "H",
      "value": 0.1,
      "bind": {
        "input": "range",
        "min": 0,
        "max": 0.5,
        "step": 0.005,
        "name": "External mortality rate, per year"
      }
    }
  ],
  "hconcat": [
    {
      "width": 290,
      "height": 230,
      "layer": [
        {
          "data": {
            "url": "/attachments/disposable-soma-model.csv"
          },
          "mark": {
            "type": "line",
            "style": "alt",
            "clip": true
          },
          "encoding": {
            "x": {
              "field": "h",
              "type": "quantitative"
            },
            "y": {
              "field": "growth",
              "type": "quantitative"
            }
          }
        },
        {
          "data": {
            "url": "/attachments/disposable-soma-model.csv"
          },
          "mark": {
            "type": "line",
            "style": "model",
            "clip": true
          },
          "encoding": {
            "x": {
              "field": "h",
              "type": "quantitative"
            },
            "y": {
              "field": "births",
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
                "expr": "H"
              },
              "type": "quantitative"
            }
          }
        },
        {
          "data": {
            "url": "/attachments/disposable-soma-model.csv"
          },
          "transform": [
            {
              "filter": "abs(datum.h - H) < 0.001"
            }
          ],
          "layer": [
            {
              "mark": {
                "type": "circle",
                "style": "model-point",
                "size": 60
              },
              "encoding": {
                "y": {
                  "field": "births",
                  "type": "quantitative"
                }
              }
            },
            {
              "mark": {
                "type": "circle",
                "style": "alt",
                "opacity": 1,
                "size": 60
              },
              "encoding": {
                "y": {
                  "field": "growth",
                  "type": "quantitative"
                }
              }
            }
          ],
          "encoding": {
            "x": {
              "field": "h",
              "type": "quantitative"
            }
          }
        },
        {
          "data": {
            "values": [
              {
                "h": 0.2,
                "h2": 0.24,
                "y": 0.66,
                "label": "Held constant by fewer births",
                "kind": "model"
              },
              {
                "h": 0.2,
                "h2": 0.24,
                "y": 0.6,
                "label": "Free to grow or shrink",
                "kind": "alt"
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
                  "field": "h2"
                }
              }
            },
            {
              "transform": [
                {
                  "filter": "datum.kind == 'alt'"
                }
              ],
              "mark": {
                "type": "rule",
                "style": "alt"
              },
              "encoding": {
                "x2": {
                  "field": "h2"
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
                  "field": "h2",
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
                  "filter": "datum.kind == 'alt'"
                }
              ],
              "mark": {
                "type": "text",
                "style": "alt-label",
                "align": "left",
                "dx": 6
              },
              "encoding": {
                "x": {
                  "field": "h2",
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
              "field": "h",
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
              0,
              0.5
            ],
            "nice": false
          },
          "axis": {
            "title": "External mortality rate, per year",
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
        "y": {
          "type": "quantitative",
          "scale": {
            "domain": [
              0,
              0.7
            ],
            "nice": false
          },
          "axis": {
            "title": "Best share spent on maintenance",
            "format": ".0%",
            "values": [
              0,
              0.2,
              0.4,
              0.6
            ]
          }
        }
      }
    },
    {
      "width": 290,
      "height": 230,
      "layer": [
        {
          "data": {
            "url": "/attachments/disposable-soma-model.csv"
          },
          "transform": [
            {
              "filter": "abs(datum.h - H) < 0.001"
            },
            {
              "fold": [
                "births",
                "growth"
              ],
              "as": [
                "mode",
                "rho"
              ]
            },
            {
              "calculate": "0.6 * exp(-4 * datum.rho)",
              "as": "b"
            },
            {
              "calculate": "sequence(0, 121, 1)",
              "as": "age"
            },
            {
              "flatten": [
                "age"
              ]
            },
            {
              "calculate": "exp(-(0.002 / datum.b) * (exp(datum.b * datum.age) - 1))",
              "as": "alive"
            }
          ],
          "layer": [
            {
              "transform": [
                {
                  "filter": "datum.mode == 'growth'"
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
                  "filter": "datum.mode == 'births'"
                }
              ],
              "mark": {
                "type": "line",
                "style": "model"
              }
            }
          ],
          "encoding": {
            "x": {
              "field": "age",
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
            "url": "/attachments/disposable-soma-model.csv"
          },
          "transform": [
            {
              "filter": "abs(datum.h - H) < 0.001"
            },
            {
              "fold": [
                "births",
                "growth"
              ],
              "as": [
                "mode",
                "rho"
              ]
            },
            {
              "calculate": "0.6 * exp(-4 * datum.rho)",
              "as": "b"
            },
            {
              "calculate": "log(1 + log(2) * datum.b / 0.002) / datum.b",
              "as": "median"
            },
            {
              "calculate": "(datum.mode == 'births' ? 'Fewer births: ' : 'Free growth: ') + format(datum.median, '.0f') + ' years'",
              "as": "label"
            },
            {
              "calculate": "118",
              "as": "lx"
            },
            {
              "calculate": "datum.mode == 'births' ? 1.0 : 0.91",
              "as": "ly"
            }
          ],
          "layer": [
            {
              "transform": [
                {
                  "filter": "datum.mode == 'births'"
                }
              ],
              "mark": {
                "type": "text",
                "style": "model-label",
                "align": "right",
                "baseline": "top"
              }
            },
            {
              "transform": [
                {
                  "filter": "datum.mode == 'growth'"
                }
              ],
              "mark": {
                "type": "text",
                "style": "alt-label",
                "align": "right",
                "baseline": "top"
              }
            }
          ],
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
        },
        {
          "data": {
            "values": [
              {
                "x": 118,
                "y": 0.82,
                "label": "median lifespan, no external deaths"
              }
            ]
          },
          "mark": {
            "type": "text",
            "style": "observed-label",
            "align": "right",
            "baseline": "top"
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
              120
            ],
            "nice": false
          },
          "axis": {
            "title": "Age",
            "values": [
              0,
              20,
              40,
              60,
              80,
              100,
              120
            ]
          }
        },
        "y": {
          "type": "quantitative",
          "scale": {
            "domain": [
              0,
              1.02
            ],
            "nice": false
          },
          "axis": {
            "title": "Alive without external deaths",
            "format": ".0%",
            "values": [
              0,
              0.25,
              0.5,
              0.75,
              1
            ]
          }
        }
      }
    }
  ]
}
```

Which curve applies depends on how the population is regulated. Sido Mylius and Odo Diekmann showed that the strategy that natural selection favours maximises lifetime reproduction when crowding acts by reducing births or the survival of the young, and maximises the population's growth rate when crowding acts as extra mortality at all ages, or when there is no crowding at all.[^myliusdiekmann1995] Only in the first case does a higher external mortality rate favour less maintenance. This is the same result that Peter Abrams obtained for the evolution of senescence in general: extrinsic mortality can speed ageing, slow it or leave it unchanged, depending on how density dependence acts.[^abrams1993] (See [[selection-shadow-theory#extrinsic-mortality-and-the-pace-of-ageing|Selection shadow]].)

> [!note]- The model in Figure 1
> A share $\rho$ of resources goes to maintenance. From maturity at age 1, an individual has $m = M(1 - \rho)$ offspring a year. Its mortality rate from internal causes follows the Gompertz law (see [[Mortality rate models#gompertz-law|Mortality rate models]]),
>
> $$
> \mu_{\text{int}}(x) = a\,e^{b(\rho)\,x}, \qquad b(\rho) = b_0\,e^{-c\rho},
> $$
>
> so that more maintenance slows the rise in mortality with age. External causes add a constant risk $h$. With $l_{\text{int}}(x)$ the share surviving internal causes to age $x$, lifetime reproduction and the growth rate $r$ are
>
> $$
> R_0(\rho) = M(1-\rho)\int_1^\infty e^{-hx}\,l_{\text{int}}(x)\,\mathrm{d}x, \qquad M(1-\rho)\int_1^\infty e^{-(r+h)x}\,l_{\text{int}}(x)\,\mathrm{d}x = 1.
> $$
>
> In the second equation $h$ appears only in the sum $r + h$, so the share that maximises $r$ does not depend on $h$. The figure uses $a = 0.002$, $b_0 = 0.6$ and $c = 4$, with $M$ set so that the best strategy neither grows nor shrinks at $h = 0.1$. The two optima then coincide at $h = 0.1$.

### Later models

Peter Abrams and Donald Ludwig modelled the optimal division between reproduction and repair at each age. In their models mortality "should increase at an increasing rate with age", but an exponential rise, the Gompertz law, corresponds to only one of many possible relations between reproduction and ageing; if the disposable soma explains much of the rise in mortality, the Gompertz law is unlikely to hold generally.[^abramsludwig1995] Mariusz Cichoń added growth to the allocation problem. Low extrinsic mortality and efficient repair favoured investment in repair, especially early in life, together with slow growth, late maturity, large body size and long life, so that the observed associations between these traits may be "by-products of optimal allocation strategies".[^cichon1997]

## Evidence

### Costs of reproduction

The theory predicts that reproduction should shorten life or reduce later fertility.

- **Experiments in flies.** Carla Sgrò and Partridge measured when the extra mortality caused by egg production occurs in female *Drosophila*, and found a delayed wave that coincided with the onset of the steep rise in mortality and with its later deceleration.[^sgropartridge1999]
- **Wild vertebrates.** Jean-François Lemaître and colleagues compiled 26 studies of free-ranging vertebrate populations that tested for a trade-off between performance early and late in life, and found "overall support for the presence of early-late life trade-offs": 21 of the 26 supported a trade-off. Such trade-offs are predicted by antagonistic pleiotropy as well, so they do not distinguish the two theories.[^lemaitre2015]
- **Physiological costs.** In small mammals, John Speakman described the direct costs of reproduction as "increased energy, protein and calcium demands during pregnancy, but most particularly during lactation", and judged knowledge of these costs "at best described as rudimentary".[^speakman2008] Oxidative stress, a popular candidate link, has had equivocal experimental support, partly because results depend on the tissue and assay.[^speakmangarratt2014]
- **Animals in captivity.** Robert Ricklefs and Daniel Cadena compared offspring production with subsequent lifespan in zoo populations of 18 mammal and 12 bird species, where food is not limiting. Of 68 regressions, only one was significant, and its slope was positive.[^ricklefscadena2007]
- **Castrated men.** Korean court eunuchs of the Chosŏn dynasty, 81 men recorded in one genealogy, lived to a mean age of 70, 14 to 19 years longer than intact men of similar status; three reached 100, a rate the authors put at more than 130 times that of modern developed countries, which suggests errors in recorded ages.[^min2012] Italian castrati lived no longer than intact singers.[^nieschlag1993] Castration also removes testosterone, so neither result isolates the cost of reproduction.

Studies of historical human populations have mostly not supported a cost of reproduction. Rudi Westendorp and Kirkwood reported that, among British aristocrats, women who lived longest had fewer children and were more often childless.[^westendorpkirkwood1998] Natalia Gavrilova and colleagues checked 335 of the reported cases of childlessness in the genealogical data set that study used against other sources, and found that "at least 107 allegedly childless women did have children", 32% of the claims. One of six women born before 1700 who reached 90, recorded with one child, had twelve. In the original data 26–49% of women were recorded as childless at each age at death; in 3,723 married women of the European nobility, with each case of childlessness checked against at least two sources, the figure was 10–17% at every age, and exceptional longevity did not increase the chance of being childless.[^gavrilova2004] With controls for differences in health, Gabriele Doblhammer and James Oeppen found a significant trade-off between reproduction and longevity in British peeresses, but not in peers.[^doblhammeroeppen2003] Samuli Helle, Virpi Lummaa and Jukka Jokela reported that, among 375 Sami mothers in Finland, each son reduced maternal lifespan by about 0.65 years while each daughter added about 0.44 years;[^helle2002][^cesarini2009] studies of Swedish women, including 930 Sami women from northern Sweden, found no such effect,[^cesarini2007][^cesarini2009] while a later Finnish study found reduced post-reproductive survival in mothers of many sons.[^hellelummaa2013] Reviewing natural-fertility populations, Éric Le Bourg concluded that longevity does not decrease as the number of children increases.[^lebourg2007] In modern cohorts, childless women and men have higher mortality than parents, the opposite of a simple cost, although health affects both fertility and survival.[^zeng2016] The large early estimate of a cost was mostly an artefact of incomplete records; any remaining cost in humans is small.

### Lifespan and reproduction uncoupled

If ageing were the cost of resources spent on reproduction, removing reproduction should lengthen life, and lengthening life should cost reproduction. Several results in model organisms do not fit this pattern.

- **Germ-line signals in worms.** Killing the cells that give rise to the germ line of *Caenorhabditis elegans* extends lifespan, but removing the whole gonad does not; the extension requires the DAF-16 and DAF-12 transcription factors.[^hsinkenyon1999] Natasha Arantes-Oliveira and colleagues traced the effect to the proliferating germ-line stem cells, which they proposed act by influencing the production of, or response to, a steroid hormone that promotes longevity, and showed that "neither sperm, nor oocytes, nor meiotic precursor cells are responsible".[^arantes2002] Lifespan here is set by a signal, not by the resources the germ line consumes. In *Drosophila* the result is less consistent: ablating the germ line shortened female life in one study and lengthened it, with changes in insulin signalling, in another.[^barnes2006][^flatt2008]
- **Timing in worms.** Andrew Dillin and colleagues found that insulin/IGF-1 signalling acts in adulthood to regulate ageing and "controls longevity and reproduction independently of one another".[^dillin2002]
- **Diet in flies.** Dietary restriction extends the lifespan of *Drosophila* and lowers its fecundity. Richard Grandison, Matthew Piper and Partridge tested whether this is an adaptive reallocation of nutrients from reproduction to maintenance. Adding back the amino acid methionine alone "increased fecundity as much as full feeding, but without reducing lifespan", and the authors concluded that "reallocation of nutrients therefore does not explain the DR responses".[^grandison2009] Adding all the essential amino acids raised fecundity and shortened life.

Partridge, Gems and Withers summarised such results: mutations in insulin/IGF signalling and dietary restriction "can extend lifespan in model organisms but do not always reduce fecundity, suggesting that the link between lifespan and fecundity is not inevitable".[^partridge2005]

### Dietary restriction

Daryl Shanley and Kirkwood proposed that the extension of lifespan by dietary restriction is an evolved response to famine: when food is short, resources move from reproduction to maintenance, and the individual waits for better times. Their model found the response advantageous if juveniles survive poorly during famine, or if reproduction carries an energetic overhead that must be paid before any offspring are produced; "if neither of these conditions holds, there is no evolutionary advantage to be gained from switching extra resources to maintenance".[^shanleykirkwood2000] The methionine result above shows that, in flies at least, the lifespan and fecundity responses to diet can be separated.[^grandison2009]

Later work in flies has rejected reallocation as the explanation. Margo Adler and Russell Bonduriansky proposed that the response is a nutrient-recycling mechanism that maximises immediate reproduction when food is short, and that the extension of lifespan is largely a laboratory artefact.[^adlerbonduriansky2014] Jennifer Regan and colleagues argued that the underlying signalling pathways integrate many environmental cues, of which diet is one.[^regan2020] In *Drosophila* females, Brooke Zanco and colleagues found that high-protein diets shorten life by depleting dietary sterols through reproduction; adding cholesterol restored normal lifespan, and the longest-lived flies ate protein-rich food and reproduced the most.[^zanco2021] The trade-off is real, but it is set by a limiting nutrient that can be supplied, not by an evolved switch to maintenance. Whether the same holds in mammals has not been tested.

### Maintenance across species

The theory predicts that species with longer lives should invest more in maintenance.

- **Stress resistance.** Pankaj Kapahi, Michael Boulton and Kirkwood exposed skin fibroblasts from eight mammal species to oxidants, arsenite and alkali, and found "significant positive correlations between cell LD90 and maximum life span" for every stress.[^kapahi1999] In fibroblasts from wild-caught rodents and a bat, James Harper and colleagues confirmed this for cadmium, hydrogen peroxide and heat, but not for paraquat, ultraviolet light or an alkylating agent.[^harper2007]
- **DNA repair.** Ronald Hart and Richard Setlow found that repair of ultraviolet damage in fibroblasts rose with lifespan across seven mammal species.[^hartsetlow1974] In 34 species, Kato and colleagues found no correlation.[^kato1980] Across 18 rodent species, Xiao Tian and colleagues found that repair of DNA double-strand breaks evolves with lifespan, while excision repair of ultraviolet damage does not, and traced much of the difference to the protein SIRT6.[^tian2019]

Comparisons between species that differ in exposure to external hazards, such as bats and ground-dwelling mammals of the same size, are discussed under [[selection-shadow-theory#extrinsic-mortality-and-the-pace-of-ageing|Selection shadow]].

## Alternatives

The disposable soma theory treats ageing as the accumulation of damage that the body does not repair. Alexei Maklakov and Tracey Chapman called this "a dominant paradigm" and argued that "the centrality of energy trade-offs in ageing has been increasingly challenged as studies in different organisms have uncoupled the trade-off between reproduction and longevity". In their alternative, processes tuned for early-life function become harmful later, because selection on them is weak late in life and gene regulation is not optimised for adulthood.[^maklakovchapman2019]

The **hyperfunction theory** develops this alternative. Mikhail Blagosklonny argued that "molecular damage does not cause that aging that kills us", and that ageing continues growth programmes, driven by nutrient-sensing pathways such as TOR, after development is complete.[^blagosklonny2010] David Gems and colleagues argued that tests of the oxidative-damage theory in *C. elegans* have often failed, and that overactive biosynthesis carried over from development and reproduction is a plausible alternative.[^gemsguardia2013][^gems2022] In this view the late harm is done by the normal action of genes, not by a shortfall in repair.

A third possibility concerns maintenance that itself causes decline. Some mechanisms that protect against cancer, such as the limit that shortening telomeres place on cell division, remain beneficial at old ages while contributing to tissue decline.[^campisi2005] (See [[antagonistic-pleiotropy-theory#misapplications|Antagonistic pleiotropy]] and [[tumor-suppressor-theory-of-aging]].)

## Relationship to other theories

- **Antagonistic pleiotropy.** The disposable soma is a physiological mechanism for it: an allele that shifts resources from maintenance to early reproduction raises early fitness and lowers late survival.[^kirkwoodrose1991] (See [[antagonistic-pleiotropy-theory]].)
- **Mutation accumulation.** Independent of the soma argument, but rests on the same declining force of selection. (See [[selection-shadow-theory]].)
- **Mortality rate models.** Allocation models generally predict an accelerating rise in mortality, but not specifically the Gompertz law.[^abramsludwig1995] (See [[Mortality rate models]].)

## History

### Origins

Kirkwood published the theory in *Nature* in 1977, as an evolutionary account of why somatic cells might tolerate errors that the germ line could not.[^kirkwood1977] His 1979 paper with Holliday extended the argument from protein synthesis to the accuracy of macromolecular synthesis in general.[^kirkwoodholliday1979] In 1991 Kirkwood and Rose placed it alongside antagonistic pleiotropy as one of two convergent explanations of senescence.[^kirkwoodrose1991]

### Models and tests

In the 1990s Abrams and Ludwig, Cichoń and others turned the argument into explicit optimisation models of allocation between reproduction, growth and repair.[^abramsludwig1995][^cichon1997] Kapahi, Boulton and Kirkwood tested its comparative predictions in cultured cells,[^kapahi1999] and Westendorp and Kirkwood looked for the cost of reproduction in human genealogies.[^westendorpkirkwood1998] Shanley and Kirkwood extended the theory to dietary restriction in 2000.[^shanleykirkwood2000]

### Challenges

From 1999, experiments in worms and flies separated long life from low fertility: germ-line signals in *C. elegans*,[^hsinkenyon1999][^arantes2002] the timing of insulin/IGF-1 signalling[^dillin2002] and amino acids in *Drosophila* diets.[^grandison2009] The hyperfunction theory and the energy-versus-function debate grew from these results.[^blagosklonny2010][^maklakovchapman2019][^gems2022]

## Data and figures

Figure 1 is computed from the model in the note beside it and uses no data. The best share of resources spent on maintenance was found by evaluating fitness on a grid of shares 0.005 apart, for risks of external death from 0 to 0.5 a year in steps of 0.005. The median lifespan without external deaths is the age at which $l_{\text{int}}(x) = 1/2$.

[^kirkwood1977]: Kirkwood TBL (1977). "Evolution of ageing". *Nature*. 270 (5635): 301–304. [doi:10.1038/270301a0](https://doi.org/10.1038/270301a0)

[^kirkwoodholliday1979]: Kirkwood TBL, Holliday R (1979). "The evolution of ageing and longevity". *Proceedings of the Royal Society B*. 205 (1161): 531–546. [doi:10.1098/rspb.1979.0083](https://doi.org/10.1098/rspb.1979.0083)

[^kirkwoodrose1991]: Kirkwood TBL, Rose MR (1991). "Evolution of senescence: late survival sacrificed for reproduction". *Philosophical Transactions of the Royal Society B*. 332: 15–24. [doi:10.1098/rstb.1991.0028](https://doi.org/10.1098/rstb.1991.0028)

[^kirkwood2005]: Kirkwood TBL (2005). "Understanding the odd science of aging". *Cell*. 120 (4): 437–447. [doi:10.1016/j.cell.2005.01.027](https://doi.org/10.1016/j.cell.2005.01.027)

[^orgel1963]: Orgel LE (1963). "The maintenance of the accuracy of protein synthesis and its relevance to ageing". *PNAS*. 49 (4): 517–521. [doi:10.1073/pnas.49.4.517](https://doi.org/10.1073/pnas.49.4.517)

[^drenoskirkwood2005]: Drenos F, Kirkwood TBL (2005). "Modelling the disposable soma theory of ageing". *Mechanisms of Ageing and Development*. 126 (1): 99–103. [doi:10.1016/j.mad.2004.09.026](https://doi.org/10.1016/j.mad.2004.09.026)

[^myliusdiekmann1995]: Mylius SD, Diekmann O (1995). "On evolutionarily stable life histories, optimization and the need to be specific about density dependence". *Oikos*. 74 (2): 218–224. [doi:10.2307/3545651](https://doi.org/10.2307/3545651)

[^abrams1993]: Abrams PA (1993). "Does increased mortality favor the evolution of more rapid senescence?". *Evolution*. 47 (3): 877–887. [doi:10.2307/2410191](https://doi.org/10.2307/2410191)

[^abramsludwig1995]: Abrams PA, Ludwig D (1995). "Optimality theory, Gompertz' law, and the disposable soma theory of senescence". *Evolution*. 49 (6): 1055–1066. [doi:10.1111/j.1558-5646.1995.tb04433.x](https://doi.org/10.1111/j.1558-5646.1995.tb04433.x)

[^cichon1997]: Cichoń M (1997). "Evolution of longevity through optimal resource allocation". *Proceedings of the Royal Society B*. 264 (1386): 1383–1388. [doi:10.1098/rspb.1997.0192](https://doi.org/10.1098/rspb.1997.0192)

[^vannoordwijk1986]: van Noordwijk AJ, de Jong G (1986). "Acquisition and allocation of resources: their influence on variation in life history tactics". *The American Naturalist*. 128 (1): 137–142. [doi:10.1086/284547](https://doi.org/10.1086/284547)

[^sgropartridge1999]: Sgrò CM, Partridge L (1999). "A delayed wave of death from reproduction in *Drosophila*". *Science*. 286 (5449): 2521–2524. [doi:10.1126/science.286.5449.2521](https://doi.org/10.1126/science.286.5449.2521)

[^lemaitre2015]: Lemaître J-F, Berger V, Bonenfant C, Douhard M, Gamelon M, et al. (2015). "Early-late life trade-offs and the evolution of ageing in the wild". *Proceedings of the Royal Society B*. 282 (1806): 20150209. [doi:10.1098/rspb.2015.0209](https://doi.org/10.1098/rspb.2015.0209)

[^speakman2008]: Speakman JR (2008). "The physiological costs of reproduction in small mammals". *Philosophical Transactions of the Royal Society B*. 363 (1490): 375–398. [doi:10.1098/rstb.2007.2145](https://doi.org/10.1098/rstb.2007.2145)

[^speakmangarratt2014]: Speakman JR, Garratt M (2014). "Oxidative stress as a cost of reproduction: beyond the simplistic trade-off model". *BioEssays*. 36 (1): 93–106. [doi:10.1002/bies.201300108](https://doi.org/10.1002/bies.201300108)

[^ricklefscadena2007]: Ricklefs RE, Cadena CD (2007). "Lifespan is unrelated to investment in reproduction in populations of mammals and birds in captivity". *Ecology Letters*. 10 (10): 867–872. [doi:10.1111/j.1461-0248.2007.01085.x](https://doi.org/10.1111/j.1461-0248.2007.01085.x)

[^min2012]: Min K-J, Lee C-K, Park H-N (2012). "The lifespan of Korean eunuchs". *Current Biology*. 22 (18): R792–R793. [doi:10.1016/j.cub.2012.06.036](https://doi.org/10.1016/j.cub.2012.06.036)

[^westendorpkirkwood1998]: Westendorp RGJ, Kirkwood TBL (1998). "Human longevity at the cost of reproductive success". *Nature*. 396: 743–746. [doi:10.1038/25519](https://doi.org/10.1038/25519)

[^gavrilova2004]: Gavrilova NS, Gavrilov LA, Semyonova VG, Evdokushkina GN (2004). "Does exceptional human longevity come with a high cost of infertility? Testing the evolutionary theories of aging". *Annals of the New York Academy of Sciences*. 1019: 513–517. [doi:10.1196/annals.1297.095](https://doi.org/10.1196/annals.1297.095)

[^doblhammeroeppen2003]: Doblhammer G, Oeppen J (2003). "Reproduction and longevity among the British peerage: the effect of frailty and health selection". *Proceedings of the Royal Society B*. 270 (1524): 1541–1547. [doi:10.1098/rspb.2003.2400](https://doi.org/10.1098/rspb.2003.2400)

[^helle2002]: Helle S, Lummaa V, Jokela J (2002). "Sons reduced maternal longevity in preindustrial humans". *Science*. 296 (5570): 1085. [doi:10.1126/science.1070106](https://doi.org/10.1126/science.1070106)

[^cesarini2007]: Cesarini D, Lindqvist E, Wallace B (2007). "Maternal longevity and the sex of offspring in pre-industrial Sweden". *Annals of Human Biology*. 34 (5): 535–546. [doi:10.1080/03014460701517215](https://doi.org/10.1080/03014460701517215)

[^cesarini2009]: Cesarini D, Lindqvist E, Wallace B (2009). "Is there an adverse effect of sons on maternal longevity?". *Proceedings of the Royal Society B*. 276 (1664): 2081–2084. [doi:10.1098/rspb.2009.0051](https://doi.org/10.1098/rspb.2009.0051)

[^hsinkenyon1999]: Hsin H, Kenyon C (1999). "Signals from the reproductive system regulate the lifespan of *C. elegans*". *Nature*. 399: 362–366. [doi:10.1038/20694](https://doi.org/10.1038/20694)

[^arantes2002]: Arantes-Oliveira N, Apfeld J, Dillin A, Kenyon C (2002). "Regulation of life-span by germ-line stem cells in *Caenorhabditis elegans*". *Science*. 295 (5554): 502–505. [doi:10.1126/science.1065768](https://doi.org/10.1126/science.1065768)

[^dillin2002]: Dillin A, Crawford DK, Kenyon C (2002). "Timing requirements for insulin/IGF-1 signaling in *C. elegans*". *Science*. 298 (5594): 830–834. [doi:10.1126/science.1074240](https://doi.org/10.1126/science.1074240)

[^grandison2009]: Grandison RC, Piper MDW, Partridge L (2009). "Amino-acid imbalance explains extension of lifespan by dietary restriction in *Drosophila*". *Nature*. 462: 1061–1064. [doi:10.1038/nature08619](https://doi.org/10.1038/nature08619)

[^partridge2005]: Partridge L, Gems D, Withers DJ (2005). "Sex and death: what is the connection?". *Cell*. 120 (4): 461–472. [doi:10.1016/j.cell.2005.01.026](https://doi.org/10.1016/j.cell.2005.01.026)

[^shanleykirkwood2000]: Shanley DP, Kirkwood TBL (2000). "Calorie restriction and aging: a life-history analysis". *Evolution*. 54 (3): 740–750. [doi:10.1111/j.0014-3820.2000.tb00076.x](https://doi.org/10.1111/j.0014-3820.2000.tb00076.x)

[^kapahi1999]: Kapahi P, Boulton ME, Kirkwood TBL (1999). "Positive correlation between mammalian life span and cellular resistance to stress". *Free Radical Biology and Medicine*. 26 (5–6): 495–500. [doi:10.1016/S0891-5849(98)00323-2](https://doi.org/10.1016/S0891-5849(98)00323-2)

[^hartsetlow1974]: Hart RW, Setlow RB (1974). "Correlation between deoxyribonucleic acid excision-repair and life-span in a number of mammalian species". *PNAS*. 71 (6): 2169–2173. [doi:10.1073/pnas.71.6.2169](https://doi.org/10.1073/pnas.71.6.2169)

[^kato1980]: Kato H, Harada M, Tsuchiya K, Moriwaki K (1980). "Absence of correlation between DNA repair in ultraviolet irradiated mammalian cells and life span of the donor species". *Japanese Journal of Genetics*. 55 (2): 99–108. [doi:10.1266/jjg.55.99](https://doi.org/10.1266/jjg.55.99)

[^tian2019]: Tian X, Firsanov D, Zhang Z, et al. (2019). "SIRT6 is responsible for more efficient DNA double-strand break repair in long-lived species". *Cell*. 177 (3): 622–638. [doi:10.1016/j.cell.2019.03.043](https://doi.org/10.1016/j.cell.2019.03.043)

[^maklakovchapman2019]: Maklakov AA, Chapman T (2019). "Evolution of ageing as a tangle of trade-offs: energy versus function". *Proceedings of the Royal Society B*. 286 (1911): 20191604. [doi:10.1098/rspb.2019.1604](https://doi.org/10.1098/rspb.2019.1604)

[^blagosklonny2010]: Blagosklonny MV (2010). "Why the disposable soma theory cannot explain why women live longer and why we age". *Aging*. 2 (12): 884–887. [doi:10.18632/aging.100253](https://doi.org/10.18632/aging.100253)

[^gemsguardia2013]: Gems D, de la Guardia Y (2013). "Alternative perspectives on aging in *Caenorhabditis elegans*: reactive oxygen species or hyperfunction?". *Antioxidants & Redox Signaling*. 19 (3): 321–329. [doi:10.1089/ars.2012.4840](https://doi.org/10.1089/ars.2012.4840)

[^gems2022]: Gems D (2022). "The hyperfunction theory: an emerging paradigm for the biology of aging". *Ageing Research Reviews*. 74: 101557. [doi:10.1016/j.arr.2021.101557](https://doi.org/10.1016/j.arr.2021.101557)

[^adlerbonduriansky2014]: Adler MI, Bonduriansky R (2014). "Why do the well-fed appear to die young? A new evolutionary hypothesis for the effect of dietary restriction on lifespan". *BioEssays*. 36 (5): 439–450. [doi:10.1002/bies.201300165](https://doi.org/10.1002/bies.201300165)

[^regan2020]: Regan JC, Froy H, Walling CA, Moatt JP, Nussey DH (2020). "Dietary restriction and insulin-like signalling pathways as adaptive plasticity: a synthesis and re-evaluation". *Functional Ecology*. 34 (1): 107–128. [doi:10.1111/1365-2435.13418](https://doi.org/10.1111/1365-2435.13418)

[^zanco2021]: Zanco B, Mirth CK, Sgrò CM, Piper MDW (2021). "A dietary sterol trade-off determines lifespan responses to dietary restriction in *Drosophila melanogaster* females". *eLife*. 10: e62335. [doi:10.7554/eLife.62335](https://doi.org/10.7554/eLife.62335)

[^harley1980]: Harley CB, Pollard JW, Chamberlain JW, Stanners CP, Goldstein S (1980). "Protein synthetic errors do not increase during aging of cultured human fibroblasts". *PNAS*. 77 (4): 1885–1889. [doi:10.1073/pnas.77.4.1885](https://doi.org/10.1073/pnas.77.4.1885)

[^barnes2006]: Barnes AI, Boone JM, Jacobson J, Partridge L, Chapman T (2006). "No extension of lifespan by ablation of germ line in *Drosophila*". *Proceedings of the Royal Society B*. 273 (1589): 939–947. [doi:10.1098/rspb.2005.3388](https://doi.org/10.1098/rspb.2005.3388)

[^flatt2008]: Flatt T, Min K-J, D'Alterio C, Villa-Cuesta E, Cumbers J, et al. (2008). "*Drosophila* germ-line modulation of insulin signaling and lifespan". *PNAS*. 105 (17): 6368–6373. [doi:10.1073/pnas.0709128105](https://doi.org/10.1073/pnas.0709128105)

[^nieschlag1993]: Nieschlag E, Nieschlag S, Behre HM (1993). "Lifespan and testosterone". *Nature*. 366 (6452): 215. [doi:10.1038/366215a0](https://doi.org/10.1038/366215a0)

[^harper2007]: Harper JM, Salmon AB, Leiser SF, Galecki AT, Miller RA (2007). "Skin-derived fibroblasts from long-lived species are resistant to some, but not all, lethal stresses and to the mitochondrial inhibitor rotenone". *Aging Cell*. 6 (1): 1–13. [doi:10.1111/j.1474-9726.2006.00255.x](https://doi.org/10.1111/j.1474-9726.2006.00255.x)

[^campisi2005]: Campisi J (2005). "Senescent cells, tumor suppression, and organismal aging: good citizens, bad neighbors". *Cell*. 120 (4): 513–522. [doi:10.1016/j.cell.2005.02.003](https://doi.org/10.1016/j.cell.2005.02.003)

[^moorad2019]: Moorad J, Promislow D, Silvertown J (2019). "Evolutionary ecology of senescence and a reassessment of Williams' 'extrinsic mortality' hypothesis". *Trends in Ecology & Evolution*. 34 (6): 519–530. [doi:10.1016/j.tree.2019.02.006](https://doi.org/10.1016/j.tree.2019.02.006)

[^hellelummaa2013]: Helle S, Lummaa V (2013). "A trade-off between having many sons and shorter maternal post-reproductive survival in pre-industrial Finland". *Biology Letters*. 9 (2): 20130034. [doi:10.1098/rsbl.2013.0034](https://doi.org/10.1098/rsbl.2013.0034)

[^lebourg2007]: Le Bourg É (2007). "Does reproduction decrease longevity in human beings?". *Ageing Research Reviews*. 6 (2): 141–149. [doi:10.1016/j.arr.2007.04.002](https://doi.org/10.1016/j.arr.2007.04.002)

[^zeng2016]: Zeng Y, Ni Z-M, Liu S-Y, Gu X, Huang Q, et al. (2016). "Parity and all-cause mortality in women and men: a dose-response meta-analysis of cohort studies". *Scientific Reports*. 6: 19351. [doi:10.1038/srep19351](https://doi.org/10.1038/srep19351)
