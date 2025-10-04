# **THOTEINS**

### *Worldbuilding Bible — Creative Development Draft v0.1*

> *Logline:* Inside every organism lies a multiverse of pocket worlds—cells—where thousands of coffin-bound personalities (proteins) sleep or wake depending on the politics of their universe. Some factions worship Growth. Others enforce Control. Most keep the lights on. Together they decide whether the multiverse thrives, stagnates, or self-destructs.

---

## 1) Purpose & North Star

This is a **creative-stage IP world bible**: a single source of truth for tone, rules, factions, visuals, and character generation. It’s designed for writers, artists, game/film teams, and toolchains that auto-generate characters from real protein data. Structure follows standard **IP bibles / show bibles / transmedia bibles**: concise pitch, pillars, canon rules, visual language, factions, cast, locations, story grammar, do/don’t, and data hooks. ([Screen Australia][1])

Influence baseline for “philosophical colors” is **MTG color theory**; we lean on it as a shared cognitive map for ideology without importing mechanics. Read for vibe and framing, not canon. ([Homo Sapiens][2])

**Creative Pillars**

* **Agency stack:** Organism = meta-agent, Cell = agent, Protein = subagent. Decisions propagate up and down the stack.
* **Expression = wakefulness:** A character with an **open coffin** is “awake” (expressed); **closed coffin** is “asleep” (silenced).
* **Place:** **Nucleus = motte** (indoors, law, records). **Cytoplasm = bailey** (outdoors, markets, logistics). Mitochondria = another motte with different purpose. Extracellular space = outer space.
* **Three grand ideologies** (see §4): **Growth** (Green-Black), **Control** (White-Black), **Maintenance** (Colorless).

---

## 2) Canon Rules (Hard Constraints)

**2.0 Visibility**
* **Blur** = visual effect that limits visibility beyond several meters, just like proteins can't know what's far away from them. Visually represented as a multi-second long-exposure motion blur with light trails effect in brownian motion patterns.

**2.1 Wake/Sleep Logic**

* **Awake** = expressed: character acts in scenes; can travel to role-appropriate districts; can be modified (post-translational “costume changes”).
* **Asleep** = silenced: remains in coffin

**2.2 One gene = one coffin**

* A **coffin** is labeled by **gene name**. **Alternative isoforms** (splice variants, edit variants) are that same character in different **aspects** (costume+move-set). Multi-product gene is a single coffin.

**2.3 Movement & Borders**

* **Membrane** = ball-pit-texture opaque wall. Transmembrane characters serve as **gatekeepers**, **smugglers** etc.

**2.4 Law & Enforcement**

* **PcG (Polycomb)** = **coffin-closers**; write/keep repressive marks.
* **TrxG (Trithorax)** = **coffin-openers**; write/keep permissive marks.
* **RNA Pol** = **Guides** who **wake** characters by reading edicts.
* **DNA Pol** = **Coffin-builders**; they duplicate coffins during city replication.
* **Proteasome** = **Barber**; **Ubiquitin** = **long hair warning (like in USSR)**.
* **High Judge (p53)** can order city-wide **lockdown** or **self-destruct**.
* **Grand Inquisitor (p21/CDKN1A)** enforces **arrest**; under extreme conditions can tip the system into sacrificial shutdown.

---

## 3) Tone, Audience, and Ethics

**Tone:** dry wit, high-concept clarity, no TED-speak. **Depict ideologies, don’t sermonize.**

---

## 4) The Three Ideologies (Factions)

### 4.1 **Ideology of Growth** *(Green-Black energy)* ([Homo Sapiens][2])

**Thesis:** survive, expand, outcompete.
**Themes:** growth, expansion, meritocracy, freedom, individualism, anarcho-primitivism, “might makes right,” tall-poppy backlash, natural selection, coup d’état.
**Aesthetic spectrum:** art nouveau, lunarpunk, bubblegum witch, green academia, goblincore, natural/pastel, bioluminescence, **Frutiger-Aurora**.
**Key cast:**

* **Oncogenes** as **industrialists**.
* **Telomerase** as **clock rewinder** (keeps clock tower hands from ticking to zero).
* **TrxG** operatives as **band of locksmiths** who keep coffins open.

### 4.2 **Ideology of Control** *(White-Black gravity)* ([Homo Sapiens][2])

**Thesis:** self-sacrifice through **cooperation, constraint, and pre-emption**.
**Themes:** coordination, self-sacrifice, planned obsolescence, degrowth, egalitarianism, affirmative action, paranoia, secret police, “vulnerable world hypothesis.”
**Aesthetic spectrum:** brutalist dystopia, gray concrete, black leather + neon, darkest academia, industrial decay, **sacricore**, socialist realism, **sovietwave**, fashwave, paramilitary SWATcore, dark aero.
**Key cast:**

* **Tumor suppressors** as **auditors**.
* **PcG** as **house arrest enforcers/coffin sealers**.
* **p53** as **High Judge**; **p21** as **Grand Inquisitor**.

### 4.3 **Ideology of Maintenance** *(Colorless pragmatism)*

**Thesis:** chores keep worlds alive.
**Themes:** mundanity, neutrality, conscientiousness, cleaning, repair, scheduling, throughput, risk budgets, pragmatism.
**Aesthetic spectrum:** dieselpunk, industrial, socialist realism, rivethead, after-hours, industrial design, atompunk.
**Key cast:**

* **Various ousekeeping genes** as **custodians, riggers, schedulers, quartermasters**.

---



---

## 10) Data-Driven Character Generation (for your database + art team)

> **Goal:** deterministic, stylized mapping from protein fields → character sheets, scenes, and visuals. These mappings can power batch renders, wiki entries, and card/game assets.

### 10.1 Base Mappings (as provided)

```json
{
  "mappings": [
    {
      "id": "map-0002",
      "type": "Numeric (multiplier)",
      "source": "mass (kDa)",
      "target": "height (cm)",
      "multiplier": 1.0,
      "log": false
    },
    {
      "id": "map-0003",
      "type": "Categorical (bins)",
      "source": "Has transmembrane domains",
      "target": "Sex",
      "bins": { "No": "Female", "Yes": "Male" }
    },
    {
      "id": "map-0004",
      "type": "Categorical (bins)",
      "source": "Found in",
      "target": "background_setting",
      "bins": {
        "non-nuclear": "outdoors",
        "extracellular": "outer space",
        "nucleus or mitochondria": "indoors"
      }
    },
    {
      "id": "map-0005",
      "type": "Categorical (bins)",
      "source": "alignment",
      "target": "Politics",
      "bins": {
        "both": "Opportunist",
        "oncogene": "pro-Growth",
        "tumor_suppressor": "pro-Control",
        "unknown": "Maintenance"
      }
    }
  ]
}
```


### 10.2 Recommended Add-Ons

* **half-life (h) → hair length** *(longer half-life → longer hair)*
* **pI → temperament** *(acidic = prickly; basic = sanguine; neutral = reserved)*
* **disorder fraction → costume looseness** *(IDR-heavy → drapey / asymmetrical)*



---

## 11) Do / Don’t (Consistency Rules)

**Do**

* Use **coffin state** to signal narrative agency instantly.

**Don’t**

*




[1]: https://www.screenaustralia.gov.au/getmedia/33694e05-95c2-4a05-8465-410fb8a224aa/Transmediaproduction-bible-template.pdf?utm_source=chatgpt.com "How to write a transmedia production bible"
[2]: https://homosabiens.substack.com/p/the-mtg-color-wheel?utm_source=chatgpt.com "The MTG Color Wheel (& Humanity) - by Duncan ..."
[3]: https://www.studiobinder.com/tv-show-bible-examples/?utm_source=chatgpt.com "How to Make a TV Show Bible With Free Series ..."
[4]: https://www.oreilly.com/library/view/storytelling-across-worlds/9780240824116/017_9780240824420_chapter10.html?utm_source=chatgpt.com "Storytelling Across Worlds: Transmedia for Creatives ..."
