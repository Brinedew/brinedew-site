# GeneGuessr Data Notes

## Structure providers

The runtime viewer now supports three structure sources, in order of preference:

1. **PDB** entries that cover at least 60% of the UniProt sequence.
2. **SWISS-MODEL** homology models that meet the same coverage threshold and have a reasonable QMEAN score (default ≥0.7).
3. **AlphaFold** as the universal fallback when neither of the above covers enough of the protein.

The `resolveStructureRepresentation` helper in both the public app (`Website/quartz/static/geneguessr/app.js`) and the admin preview (`Website/workers/admin-html.js`) enforces that ordering at runtime. If a high-quality PDB entry exists we stick with it; otherwise we try the best SWISS-MODEL entry before falling back to AlphaFold.

## Refreshing SWISS-MODEL data

The repo includes a small utility that queries the SWISS-MODEL REST API and stamps the best model metadata directly into `proteins.json`. Run it whenever you add new proteins or want to refresh existing entries:

```bash
node Website/tools/fetch-swiss-models.mjs
```

Useful flags:

| Flag | Description |
| --- | --- |
| `--only P01116,P31751` | Limit updates to a comma-separated list of UniProt IDs. |
| `--dry-run` | Fetch data and log decisions without writing changes. |
| `--input <path>` / `--output <path>` | Override the default `Website/workers/data/proteins.json` path. |

Environment variables let you tweak the acceptance thresholds:

```
SWISS_MODEL_COVERAGE_THRESHOLD=0.65
SWISS_MODEL_QMEAN_THRESHOLD=0.75
PDB_COVERAGE_THRESHOLD=0.6
```

The script pulls the JSON payload from `https://swissmodel.expasy.org/repository/uniprot/<UNIPROT>.json?provider=swissmodel`, picks the first entry that satisfies the coverage + QMEAN rule, and writes it under `structure.swiss_model`. If no entry passes the rule we still record the best model for reference, but the runtime will fall back to AlphaFold automatically.

## When to prefer SWISS-MODEL

The generator only marks `primary_source: "swissmodel"` when:

1. No PDB entry clears the 60% coverage bar, **and**
2. The top SWISS-MODEL entry meets the coverage (and optional QMEAN) criteria.

That way the viewer continues to highlight truly representative PDB structures whenever they exist, yet still benefits from SWISS-MODEL's curated models instead of jumping straight to AlphaFold for every partial experimental entry.
