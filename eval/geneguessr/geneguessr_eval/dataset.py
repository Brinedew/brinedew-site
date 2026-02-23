"""Dataset generation for GeneGuessr eval.

Each Sample represents one protein identification challenge. The 'input' is a
generic prompt -- the setup solver injects the actual clues. The 'target' is
the UniProt ID (used only by the scorer, never shown to the agent).

The agent never sees UniProt IDs or gene names for the target. It has to
figure that out from clues, searches, and similarity feedback.
"""

from inspect_ai.dataset import MemoryDataset, Sample


# Curated test set: (uniprot_id, gene_symbol)
# Drawn from January 2026 daily picks. Mix of famous, moderate, and obscure.
CURATED_PROTEINS = [
    ("O14746", "TERT"),       # telomerase reverse transcriptase
    ("Q92731", "ESR2"),       # estrogen receptor beta
    ("P43220", "GLP1R"),      # glucagon-like peptide 1 receptor
    ("P02042", "HBD"),        # hemoglobin subunit delta
    ("P04156", "PRNP"),       # prion protein
    ("Q92918", "MAP4K1"),     # mitogen-activated protein kinase kinase kinase kinase 1
    ("Q71U36", "TUBA1A"),     # tubulin alpha-1A chain
    ("P11387", "TOP1"),       # DNA topoisomerase 1
    ("Q8N3U4", "STAG2"),      # cohesin subunit SA-2
    ("P49711", "CTCF"),       # transcriptional repressor CTCF
    ("Q9HCK5", "AGO4"),       # protein argonaute-4
    ("P48039", "MTNR1A"),     # melatonin receptor type 1A
    ("A6ND01", "IZUMO1R"),    # IZUMO1 receptor (JUNO)
    ("P43320", "CRYBB2"),     # beta-crystallin B2
    ("P00742", "F10"),        # coagulation factor X
]


def make_dataset(
    n_samples: int | None = None,
    protein_ids: list[str] | None = None,
) -> MemoryDataset:
    """Build a dataset of GeneGuessr challenges.

    Args:
        n_samples: How many proteins to test. None = all 15 curated.
        protein_ids: Explicit list of UniProt IDs. Overrides n_samples.

    Returns:
        MemoryDataset with one Sample per protein challenge.
    """
    # Generic input -- the setup solver will prepend the actual clues.
    # The agent never sees the target identity in the prompt.
    INPUT_TEXT = "Play GeneGuessr. Identify the mystery protein."

    if protein_ids:
        samples = [
            Sample(
                input=INPUT_TEXT,
                target=pid,
                id=pid,  # logs will show UniProt for specified IDs
                metadata={"protein_id": pid, "mode": "specified"},
            )
            for pid in protein_ids
        ]
    else:
        pool = CURATED_PROTEINS
        if n_samples is not None:
            pool = pool[:n_samples]

        samples = [
            Sample(
                input=INPUT_TEXT,
                target=uniprot,
                id=gene,  # logs show gene names: "Sample TP53", not "Sample P04637"
                metadata={
                    "protein_id": uniprot,
                    "gene": gene,
                    "mode": "curated",
                },
            )
            for uniprot, gene in pool
        ]

    return MemoryDataset(samples, name="geneguessr")


def make_random_dataset(n_samples: int = 10) -> MemoryDataset:
    """Build a dataset that uses random protein selection (no fixed IDs).

    The benchmark Worker picks the protein at random. Tests the agent
    on proteins it hasn't been optimized for.
    """
    samples = [
        Sample(
            input="Play GeneGuessr. Identify the mystery protein.",
            target="RANDOM",  # scorer handles this case
            id=f"random_{i}",
            metadata={"mode": "random"},
        )
        for i in range(n_samples)
    ]
    return MemoryDataset(samples, name="geneguessr_random")
