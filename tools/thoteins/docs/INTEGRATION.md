# Integration Guide

This explains how the Thoteins tools fit with your Website repo so you can go from a mapping to published pages without guesswork.

## What lives where

- Mapping source of truth: `Thoteins/data/mapping.json`
- Runtime caches (ignored by Git): `Thoteins/data/proteins/`
- Desktop app (Mapping Studio): `Thoteins/apps/mapping-studio/`
- Browser app (Prompter UI): `Thoteins/apps/protein-portrait-prompter/`
- Site repo (Quartz): `D:/Coding/Website` (informational path)

## Typical workflow

1) Define mappings
- Launch Mapping Studio: `Thoteins/run_mapping_studio.bat` and click Start.
- Create or edit rules. Changes auto-save to `Thoteins/data/mapping.json`.

2) Generate prompts
- Open the Prompter: `Thoteins/apps/protein-portrait-prompter/index.html`.
- Enter a UniProt ID and click Fetch & Generate.
- Optional: start the local writer (`run_local_writer.bat`) so fetched UniProt JSON files are saved under `Thoteins/data/proteins/uniprot/` for offline reuse.
- The Prompter will load your mapping from `../../data/mapping.json` when opened from the repo tree.
- Persona CSV: When the local writer is running, each fetch also updates `Thoteins/data/proteins/persona.csv` with mapped human parameters (e.g., `height`, `background_setting`). The Prompter reads this CSV and uses these persona parameters for prompts when available.

3) Publish to the Website
- Keep your site at `D:/Coding/Website`.
- Use Obsidian Pages and an existing Obsidian Protein Database for both molecular and persona feature collection, to show in infoboxes

## Notes

- Logs are standardized under `Thoteins/logs/` (for example, `Thoteins/logs/mapping-studio/`).
- Caches in `Thoteins/data/proteins/` are safe to delete and will be re-created on demand.
- Mass values are rounded to whole kDa, and length is in amino acids.
