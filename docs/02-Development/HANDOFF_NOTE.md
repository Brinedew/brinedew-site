# protein wiki migration to uniprot IDs - september 2, 2025

I was working on converting the protein wiki from family-based pages (like "wnt-proteins.md") to individual UniProt ID pages. The problem was that 46 protein pages were inconsistently organized - some covered protein families, others single proteins, and most were missing structured metadata that would work with the Proteins.base table view.

## what actually works now

**Analysis and automation tools**: Built working Python scripts in `scripts/` folder:
- `analyze-protein-pages.py` - identifies which pages need splitting vs UniProt ID addition
- `uniprot-fetcher.py` - fetches protein data from UniProt API with local caching
- `generate-protein-pages.py` - creates new pages with proper metadata (fixed template issues)

**Manual curation progress**: Completed 9 protein pages with proper UniProt integration:
- APAF1 (O14727) - 141.8 kDa, 1248 aa
- ARF/p14ARF (Q8N726) - 13.9 kDa, 132 aa  
- ATM (Q13315) - 350.7 kDa, 3056 aa
- ATR (Q13535) - 301.4 kDa, 2644 aa
- AKT1 (P31749) - 55.7 kDa, 480 aa (completely rewritten from bad auto-generated version)
- BAK1 (Q16611) - 23.4 kDa, 211 aa
- BAX (Q07812) - 21.2 kDa, 192 aa
- BCL2 (P10415) - 26.3 kDa, 239 aa
- BCL2L1 (Q07817) - 26.0 kDa, 233 aa

All updated pages now have:
- Correct YAML frontmatter with `uniprot_id:`, `mass:`, `length (aa):`, etc.
- Individual domain arrays (not comma-separated strings)
- Clean pathway terms for searchability
- `protein_type: globular` (removed hardcoded classification logic)

Files I changed:
- All the above protein files - added complete UniProt metadata
- `scripts/generate-protein-pages.py` - fixed template to avoid data dumps, removed hardcoded text generation
- `content/wiki/p53-tp53.md` - fixed domains to be individual array items instead of comma-separated

**QuickAdd integration attempt**: Created `.obsidian/scripts/create-protein-page.js` for automatic UniProt fetching, but decided manual curation was better approach.

## what's broken

Nothing's broken now, but there are known limitations:

**Template generation issues were fixed**: The auto-generated pages were creating horrible walls of text with 50+ pathway entries and massive function descriptions. Fixed by extracting only first sentence of function and limiting pathways.

**Obsidian title display**: There was an "[object object]" issue in Obsidian when protein titles were too long. Fixed by using simple gene symbols as titles.

## where things stand

**Current workflow**: Manual curation using alphabetical progression through the 39 remaining protein pages. The pattern works:
1. Search UniProt for protein using `python scripts/uniprot-fetcher.py --search "GENE human"`
2. Get full data with `python scripts/uniprot-fetcher.py UNIPROT_ID`  
3. Add structured metadata to existing page
4. Use proper domains (individual array items) and clean pathway terms

**Environment**: All scripts work on Windows with proper encoding fixes. UniProt API calls are cached in `scripts/uniprot_cache/` to avoid rate limiting.

**Family pages identified**: 6 family pages need splitting (WNT, PI3K, Notch, E2F, Hedgehog, MHC). The AKT family page was updated to include AKT3 alias and marked with `uniprot_id: "family"`.

## what to do next

**Continue alphabetical curation**: Next protein is **beta-catenin (CTNNB1)**. The pattern is established - just need to systematically work through the remaining 37 pages.

**Handle family pages**: After individual proteins are done, decide on family page strategy:
- Keep as overview/index pages linking to individual members
- Create individual pages for major family members (3-5 per family)
- Use the working scripts to generate family member pages

**Update Proteins.base**: Once migration is complete, verify that all the new metadata fields populate the table view correctly. May need to add new columns for domains and pathways.

## stuff to remember

**Don't use the auto-generation scripts for final pages**: They're useful for data fetching, but manual curation produces much better content. The existing page descriptions are often better than what UniProt provides.

**Domains must be arrays**: Use individual YAML array items, not comma-separated strings. This makes them searchable in the base table.

**Keep pathways simple**: Use terms like "apoptosis", "DNA damage response", not verbose Reactome names like "Activation of BAD and translocation to mitochondria".

**Windows encoding**: All scripts have emoji-free output to avoid `UnicodeEncodeError` with cp1252 encoding.

The infrastructure is solid and the pattern works. Just needs systematic execution through the remaining proteins.