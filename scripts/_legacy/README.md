# scripts/\_legacy/

One-shot migration scripts from the Quartz v5 upgrade (commit `74a0286f`,
2026-05) and earlier. Each was used exactly once to migrate a specific data
shape; none are part of the production deploy path or referenced by any
workflow, package script, or runbook.

| Script                             | What it did                                                                         | Why it is legacy                                                                                                |
| ---------------------------------- | ----------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `add-draft-property.ps1`           | Added `draft: true` frontmatter to existing wiki files during the v4 → v5 migration | Frontmatter is now managed by the author at write time, not retroactively                                       |
| `add-draft-to-remaining-files.ps1` | Same as above, second pass                                                          | Same                                                                                                            |
| `fix-missing-drafts.ps1`           | One-off fix for files that the first two passes missed                              | Done                                                                                                            |
| `rename_genedle_to_geneguessr.ps1` | Renamed `genedle` → `geneguessr` in wiki content                                    | The rename is complete; the new name is in `quartz.config.yaml:286`                                             |
| `rename_proteindle_to_genedle.ps1` | Renamed `proteindle` → `genedle` in wiki content                                    | The rename is two steps behind; superseded by the previous rename                                               |
| `run_clean_tags.cmd`               | Ran `clean_tags.py` on Windows                                                      | `clean_tags.py` is the canonical entry point; this is a Windows convenience wrapper that has no current callers |

These files are kept under `_legacy/` rather than deleted so that:

1. A future investigation of a stale frontmatter or rename artifact can see
   what the migration looked like at the time.
2. The next person to inherit the repo does not re-invent the same one-shot
   script.

If you find yourself reaching for one of these, do not. The migration is
done. Write a new script for whatever you actually need.

Canonical script languages in `scripts/` (parent directory) are:

- **`.mjs`** — Node.js, run with `node` or `pnpm exec node`. This is what
  `package.json#scripts` and the deploy workflow call.
- **`.py`** — Python 3.12, run with `python3`. The protein-enrichment and
  data-pipeline scripts live here.
- **`.ps1`** — PowerShell 7, run with `pwsh` from the local machine. Kept
  for the canonical deploy script and the Obsidian-vault maintenance script.
- **`.cmd`** — Windows batch. Kept only for the DNS diagnostic that the
  Iconoplasm portrait runbook references.

If you add a new script, pick the language that matches its closest neighbor
in the same directory. Do not introduce a fifth language.
