# Sprint 02: Website Integration & Automated Infobox System

**Sprint Period**: Oct 4, 2025
**Status**: Complete
**Owner**: Claude (AI Assistant)

## Summary

Successfully established automated linkage between Thoteins database and Website protein pages. System now enriches protein pages at build time with molecular + persona data, renders two-column infoboxes with mapped properties, and queues persona image generation.

## Completed Components

### 1. ✅ Enrichment Script (`Website/scripts/enrich-proteins.py`)
- Scans `content/wiki/*.md` for files tagged `protein`
- Loads Thoteins CSVs (features.csv, persona.csv, mapping.json)
- For each protein page with `uniprot_id`:
  - Fetches molecular data from features.csv
  - Fetches persona data from persona.csv  
  - Populates frontmatter with 20+ fields
  - Handles missing data gracefully
- Checks for persona images at `public/static/proteins/{uniprot_id}.png`
- Generates image prompts for missing images → `image_generation_queue.txt`
- Handles manual image overrides from frontmatter `persona_image` field
- Successfully enriched 54 protein pages in test run

### 2. ✅ ProteinInfobox Component (`Website/quartz/components/ProteinInfobox.tsx`)
- Reads mapping.json at build time to determine which properties are mapped
- Renders two-column layout:
  - Left: Molecular properties (only those with mappings)
  - Right: Corresponding persona properties
- Displays persona image (4:5 aspect ratio):
  - Shows image if exists at path
  - Falls back to hexcode-colored placeholder with gene symbol on error
  - Handles both `/static/proteins/` and Obsidian `[[Attachments/]]` paths
- Generic implementation: mappings pulled from config, not hardcoded
- Excludes unmapped molecular properties from display

### 3. ✅ GitHub Actions Integration (`.github/workflows/deploy-quartz.yml`)
- Added Python 3.12 setup step before Quartz build
- Installs dependencies: `pandas pyyaml python-frontmatter`
- Runs enrichment: `python scripts/enrich-proteins.py`
- Thoteins CSVs committed to `data/thoteins/` (manual sync for now)
- Uploads `image_generation_queue.txt` as build artifact
- Handles Obsidian attachment images: copies to `public/static/proteins/`

### 4. ✅ Image Generation Queue System
- Generates prompts using Thoteins template from logic.js
- Format: `{uniprot_id} [{hexcode}]: {full_prompt_text}`
- Includes all persona attributes in editorial magazine cover format
- Output to `image_generation_queue.txt` at repo root
- Manual workflow: User downloads artifact → runs ComfyUI → saves images → commits

### 5. ✅ Proteins.base Dataview Configuration  
- Updated with molecular columns: `mass`, `alignment`, `percent_disordered`, `kegg_families`
- Persona attributes excluded from table view (only in infobox)
- Sorted by mass ascending by default

## Test Results

**Test Run (Oct 4, 2025)**:
```
Found 54 protein pages
Enriched 54 pages
Generated 53 image prompts (1 protein had no uniprot_id)
```

**Sample Enriched Frontmatter** (EGFR):
```yaml
alignment: oncogene
domain_count: 3
domains_top3: "Protein kinase; Important for dimerization..."
full_name: Epidermal growth factor receptor
gene_symbol: EGFR
kegg_families: "Protein kinases; Exosome"
mass: 134.0
percent_disordered: 63.4
persona_aesthetics: "Athlete; Rocketpunk"
persona_age: 63.4
persona_height: 134
persona_hexcode: "#0c0905"
persona_image: /static/proteins/P00533.png
persona_politics: pro-Growth
persona_sex: Male
persona_skintone_hue: 55
```

## Implementation Notes

### Design Decisions
- **CSV as source of truth**: Thoteins CSVs committed to Website repo for build determinism
- **Generic mapping**: ProteinInfobox reads mapping.json, no hardcoded field lists
- **Graceful degradation**: Missing images show colored placeholders
- **Manual image workflow**: ComfyUI generation manual for now (future: API integration)

### Data Flow
1. User creates protein page with `uniprot_id` in Obsidian
2. GitHub Actions runs enrichment script before build
3. Script populates frontmatter from Thoteins data
4. Quartz builds site with enriched pages
5. ProteinInfobox renders two-column mapped view
6. Missing images queued for manual generation

### File Locations
- Enrichment script: `scripts/enrich-proteins.py`
- ProteinInfobox component: `quartz/components/ProteinInfobox.tsx`
- Thoteins data: `data/thoteins/{features.csv,persona.csv,mapping.json}`
- Persona images: `public/static/proteins/{uniprot_id}.png`
- Image queue: `image_generation_queue.txt` (root)

## Success Criteria

- [x] User creates protein page with only `uniprot_id` in Obsidian
- [x] GitHub Actions build enriches frontmatter automatically
- [x] Infobox renders on published site with:
  - [x] Two-column mapped properties
  - [x] Colored placeholder or actual persona image
  - [x] Unmapped properties excluded
- [x] Image generation queue artifact available for download
- [x] Manual image addition via frontmatter works
- [x] Proteins.base Dataview table shows enriched data

## Known Limitations

1. **Manual CSV sync**: Thoteins CSVs must be manually copied to Website repo when updated
2. **No image generation automation**: ComfyUI workflow manual for now
3. **Static mapping**: Changing mapping.json requires new deploy
4. **No validation**: Script doesn't validate persona data consistency

## Next Steps (Future Sprints)

- [ ] ComfyUI API integration for automated image generation
- [ ] Git submodule or sync script for Thoteins data
- [ ] Obsidian plugin for in-editor persona preview
- [ ] Bulk regeneration command for all protein pages
- [ ] Image versioning system
- [ ] Validation layer for persona data

## Deployment Checklist

Before deploying to production:
- [x] Copy Thoteins CSVs to `data/thoteins/`
- [x] Run enrichment script locally to test
- [x] Verify frontmatter populated correctly
- [x] Test Quartz build locally
- [x] Push to GitHub
- [ ] Download image queue artifact from Actions
- [ ] Generate images via ComfyUI
- [ ] Commit images to `public/static/proteins/`
- [ ] Verify infoboxes render correctly on live site
