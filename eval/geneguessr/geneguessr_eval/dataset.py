"""Dataset generation for GeneGuessr eval.

Each Sample represents one protein identification challenge. The 'input' is a
generic prompt -- the setup solver injects the actual clues. The 'target' is
the UniProt ID (used only by the scorer, never shown to the agent).

The agent never sees UniProt IDs or gene names for the target. It has to
figure that out from clues, searches, and similarity feedback.
"""

from inspect_ai.dataset import MemoryDataset, Sample


# Curated test set: (uniprot_id, gene_symbol)
# Spans well-known targets, mid-range, and obscure proteins.
CURATED_PROTEINS = [
    ("P04637", "TP53"),       # tumor protein p53
    ("P00533", "EGFR"),       # epidermal growth factor receptor
    ("P38398", "BRCA1"),      # breast cancer type 1 susceptibility
    ("P01308", "INS"),        # insulin
    ("P68871", "HBB"),        # hemoglobin subunit beta
    ("Q9NZC2", "TREM2"),      # triggering receptor on myeloid cells 2
    ("Q14764", "MVP"),        # major vault protein
    ("O43526", "KCNQ2"),      # potassium channel subfamily Q member 2
    ("P05556", "ITGB1"),      # integrin subunit beta 1
    ("P07949", "RET"),        # ret proto-oncogene
    ("Q9Y5Y9", "NTRK2"),      # neurotrophic receptor tyrosine kinase 2
    ("Q8N3R9", "MPP5"),       # membrane palmitoylated protein 5
    ("O94986", "CEP152"),     # centrosomal protein 152
    ("Q86VP6", "CAND1"),      # cullin-associated NEDD8-dissociated 1
    ("Q9UPN3", "MACF1"),      # microtubule-actin crosslinking factor 1
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
