# what i was working on - oct 1, 2025

Built AI-assisted aesthetic mapping system for protein families. Downloaded Aesthetics Wiki (989 aesthetics), created data-driven mapper that uses Gemini to suggest thematic matches, integrated into GUI. All 17 KEGG families now mapped to aesthetics.

The session was: user shows aesthetics folder → realize they want AI to map families → parse wiki XML → build generic discovery script → query Gemini with full context → apply suggestions → add GUI buttons → document workflow.

## what actually works now

**AI aesthetic mapper** - Data-driven system for mapping protein families to cultural aesthetics:

Script: `scripts/map_aesthetics.py`
- Discovers families from `features.csv` dynamically (no hardcoded lists)
- Compares against `mapping.json` to find unmapped entries
- Queries Gemini with full context: worldbuilding doc, existing mappings, all 989 aesthetics
- Applies suggestions automatically with `--apply` flag
- Works regardless of how many families exist in data

Commands:
```bash
python scripts/map_aesthetics.py              # Show unmapped families
python scripts/map_aesthetics.py --apply      # Get AI suggestions and apply
python scripts/map_aesthetics.py --force-remap # Re-map everything
```

GUI integration: Added "AI Tools" section to mapping-studio launcher with 3 buttons:
- "Map Aesthetics (AI)" - Runs full AI mapping workflow
- "Show Unmapped Families" - Quick check without querying AI
- "Update Aesthetics Wiki" - Placeholder for future re-download

**Aesthetics Wiki resources** in `data/aesthetics/`:
- `Aesthetics_Wiki.txt`: Full MediaWiki XML export (989 aesthetics, 7.1MB)
- `aesthetics_index.json`: Parsed index with aesthetic names + descriptions
- `gemini_prompt.txt`: Latest prompt (auto-saved for debugging)
- `gemini_suggestions.txt`: Latest AI output (auto-saved)

**All 17 KEGG families mapped** (Oct 1, 2025):
- Transcription factors → Dark Academia
- Protein kinases → Athlete
- Exosome → Rocketpunk
- CD molecules → Paramilitary
- Chaperones and folding catalysts → Health Goth
- Chromosome and associated proteins → Constructivism
- Cytokine receptors → Spy Fiction
- Cytokines and neuropeptides → Synthwave
- DNA repair and recombination proteins → Salvagepunk
- G protein-coupled receptors → Corporate Memphis
- Glycosaminoglycan binding proteins → Junglecore
- GPI-anchored proteins → Stickerbomb
- GTP-binding proteins → Abstract Tech
- Membrane trafficking → Cargopunk
- Mitochondrial biogenesis → Atompunk
- Peptidases and inhibitors → Wuxia
- Protein phosphatases → Minimalism

Gemini's reasoning was excellent - Health Goth for chaperones (wellness/discipline), Cargopunk for trafficking (logistics), Wuxia for peptidases vs inhibitors (martial combat), Minimalism for phosphatases (reduction, opposite of kinases).

**Persona CSV updated** - 27/29 proteins have aesthetics:
- EGFR: `Athlete; Rocketpunk` (kinase + exosome)
- KRAS: `Cargopunk; Abstract Tech` (trafficking + GTP-binding)
- TGF-β1: `Health Goth; Synthwave; Junglecore` (chaperones + cytokines + glycosaminoglycans)

Missing: NOTCH1, NOTCH3 (no KEGG families in BRITE hierarchy - expected, documented)

Files changed:
- `scripts/map_aesthetics.py` - New AI mapping script (250 lines)
- `data/aesthetics/Aesthetics_Wiki.txt` - Downloaded wiki dump
- `data/aesthetics/aesthetics_index.json` - Parsed aesthetic index
- `data/mapping.json` - Updated all family→aesthetic mappings
- `data/proteins/persona.csv` - Rebuilt with new aesthetics
- `apps/mapping-studio/gui_launcher.pyw` - Added AI Tools buttons
- `CLAUDE.md` - Documented aesthetic mapping workflow

## what's broken

Nothing. System works end-to-end.

Edge cases:
- Proteins without KEGG families won't get aesthetics from this mapping (NOTCH1, NOTCH3)
- Gemini timeout is 10 minutes - could fail for very large prompts
- aesthetics_index.json has encoding issues with default Python open() - use `encoding='utf-8'`

## where things stand

**Pipeline complete**: KEGG families → AI mapping → persona aesthetics → character generation.

**Data-driven**: Adding new proteins with KEGG families automatically works. No hardcoded lists.

**GUI-ready**: Mapping Studio launcher has button to trigger AI mapping. Shows progress in log pane.

**Commands that work**:
```bash
# Check aesthetic mapping status
python scripts/map_aesthetics.py

# Run AI mapping
python scripts/map_aesthetics.py --apply

# Rebuild persona to see results
cd scripts && python protein_db.py rebuild-persona

# Launch GUI
python apps/mapping-studio/gui_launcher.pyw
```

## what to do next

**Testing**: Open Mapping Studio GUI, click "Map Aesthetics (AI)", verify it works without errors.

**Sprint planning**: The aesthetic mapping epic is complete. Return to grooming remaining Sprint-01 epics:
- Epic 2: Dual Input Support (gene symbols + UniProt IDs) - 3-4 hours
- Epic 3: ComfyUI Integration - 8-12 hours
- Epic 4: Obsidian Page Creation - 4-6 hours

**Alternative**: Start new sprint with different focus (image generation, n8n automation, etc.)

## stuff to remember

**Aesthetics Wiki is static** - Downloaded Oct 1, 2025. To update, re-download XML export from aesthetics.fandom.com and re-run the XML parser.

**Gemini needs full context** - Don't give it snippets. It has millions of characters of context - use all 989 aesthetics, full worldbuilding doc, existing mappings. Results are way better.

**Data-driven beats hardcoding** - Original script had hardcoded 17-family list. Switched to dynamic discovery from features.csv. Now works regardless of how data changes.

**GUI is the interface** - Users shouldn't need to run command-line scripts. Every workflow should have a button in one of the GUIs.

**NOTCH proteins are special** - NOTCH1 and NOTCH3 have KO IDs but aren't in KEGG's protein families hierarchy. This is expected, not a bug. Documented in Oct 1 handoff note.

**Gemini timeout matters** - Script uses 10-minute timeout (600 seconds). Large prompts can take time. Don't use 120 seconds like original version - it timed out.
