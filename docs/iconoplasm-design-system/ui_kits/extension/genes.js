/* Iconoplasm UI kit — representative gene "specimens".
   Real cards fetch color + portrait + details per-gene from the server;
   this is a hand-picked offline sample. Exposed as window.ICONO_GENES.

   Each gene pairs MOLECULAR data with its HUMAN-term isomorphism
   (from the Iconoplasm / LessWrong "Mnemonic portraits" mapping):
     discovery year  -> age   (2020 = age 0)
     protein mass kDa -> weight kg
     transmembrane status -> sex  (transmembrane = male, soluble = female)
     Pfam clan        -> fashion style
*/
window.ICONO_GENES = [
  {
    symbol: "TP53", name: "tumor protein p53", color: "#c0392b", colorName: "stop-sign red",
    character: "the overseer", origin: "guardian of the genome",
    firstNoted: "1979", age: "41 y.o.", massKDa: "44 kDa", massKg: "44 kg",
    category: "soluble", sex: "female", style: "dark academia",
    emulsion: "07157", family: "P53", trait: "never off the clock", pfam: "P53",
    portrait: "linear-gradient(160deg,#7a1f16,#2a0d09)"
  },
  {
    symbol: "BRCA1", name: "breast cancer type 1", color: "#2a6f9e", colorName: "deep harbor",
    character: "the proofreader", origin: "keeper of the double strand",
    firstNoted: "1994", age: "26 y.o.", massKDa: "207 kDa", massKg: "207 kg",
    category: "soluble", sex: "female", style: "art academia",
    emulsion: "00672", family: "BRCA", trait: "checks twice, cuts once", pfam: "BRCT",
    portrait: "linear-gradient(160deg,#163d57,#08151f)"
  },
  {
    symbol: "PTEN", name: "phosphatase and tensin homolog", color: "#3d8b6e", colorName: "mossy green",
    character: "the brake pedal", origin: "tamer of runaway signals",
    firstNoted: "1997", age: "23 y.o.", massKDa: "47 kDa", massKg: "47 kg",
    category: "soluble", sex: "female", style: "minimalist",
    emulsion: "05728", family: "PTEN", trait: "calm under pressure", pfam: "PTEN_C2",
    portrait: "linear-gradient(160deg,#1f5240,#0c2018)"
  },
  {
    symbol: "RHO", name: "rhodopsin", color: "#7d5ba6", colorName: "twilight plum",
    character: "the night watch", origin: "first to see in the dark",
    firstNoted: "1876", age: "144 y.o.", massKDa: "40 kDa", massKg: "40 kg",
    category: "transmembrane", sex: "male", style: "dark fantasy",
    emulsion: "06011", family: "OPSIN", trait: "allergic to daylight", pfam: "7tm_1",
    portrait: "linear-gradient(160deg,#3a2752,#140b1f)"
  },
  {
    symbol: "INS", name: "insulin", color: "#c98a2b", colorName: "amber honey",
    character: "the keymaster", origin: "opens the door for sugar",
    firstNoted: "1959", age: "61 y.o.", massKDa: "12 kDa", massKg: "12 kg",
    category: "soluble", sex: "female", style: "cottagecore",
    emulsion: "13198", family: "INS", trait: "punctual to a fault", pfam: "INSULIN",
    portrait: "linear-gradient(160deg,#7a5417,#241606)"
  },
  {
    symbol: "HOXB1", name: "homeobox B1", color: "#2f8f8a", colorName: "verdigris",
    character: "the architect", origin: "lays out the body plan",
    firstNoted: "1984", age: "36 y.o.", massKDa: "33 kDa", massKg: "33 kg",
    category: "soluble", sex: "female", style: "drafting blues",
    emulsion: "04417", family: "HOX", trait: "draws the blueprint twice", pfam: "Homeodomain",
    portrait: "linear-gradient(160deg,#175450,#08211f)"
  }
];
