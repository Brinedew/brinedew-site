# GeneGuessr Data Notes

## Structure providers

The runtime viewer now supports three structure sources, in order of preference:

1. **PDB** entries that cover at least 60% of the UniProt sequence.
2. **SWISS-MODEL** homology models that meet the same coverage threshold and have a reasonable QMEAN score (default ≥0.6).
3. **AlphaFold** as the universal fallback when neither of the above covers enough of the protein.

The `resolveStructureRepresentation` helper in both the public app (`Website/quartz/static/geneguessr/app.js`) and the admin preview (`Website/workers/admin-html.js`) enforces that ordering at runtime.

## Data Pipeline

All structure data is fetched and processed by the pipeline in `Datasets/GeneGuessr/`:

```bash
python step_1_fill_cache.py swissmodel   # Fetch SWISS-MODEL data
python step_2_generate_column.py         # Generate structure columns
python step_3_merge_columns.py           # Merge into proteins.json
```

Coverage is always recalculated from residue ranges (not trusting API-provided coverage values) in `step_2_generate_column.py`.
