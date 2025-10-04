# Epic: Support Both Gene Symbols and UniProt IDs as Input

**Status**: Not Started
**Priority**: Medium (Nice-to-have for user workflow)
**Estimated Effort**: 3-4 hours

## what we're building

Let users type "EGFR" instead of having to look up "P00533" every time. Right now the entire system expects UniProt accession IDs (like P00533, P01116), but people think in gene symbols (EGFR, KRAS). Adding gene symbol support makes the workflow way less annoying.

## why this matters

When you're working with proteins, you know them by their common names - EGFR, TP53, BRCA1. Having to look up the UniProt ID every single time breaks flow. It's like if you had to remember license plate numbers instead of people's names.

The downstream pipeline (n8n automation, Obsidian pages) will probably start with gene symbols anyway, so we need to handle this conversion at the entry point.

## current state

The system is 100% UniProt ID-based:
- `fetch_uniprot_json(uid)` requires UniProt ID
- `/refresh-proteins` endpoint expects `{"uniprot_ids": ["P00533", ...]}`
- All caching uses UniProt IDs as filenames

Gene symbols only appear *after* fetching - they're extracted from the UniProt JSON and stored in features.csv. There's no reverse lookup.

## what needs to happen

### 1. add gene symbol resolver

Create a function that converts gene symbol → UniProt ID:
```python
def resolve_protein_identifier(identifier: str) -> str | None:
    """
    Takes either a gene symbol (EGFR) or UniProt ID (P00533).
    Returns the canonical UniProt ID or None if not found.
    """
```

UniProt has a search API for this:
```
GET https://rest.uniprot.org/uniprotkb/search?query=gene:EGFR+AND+organism_id:9606&format=json
```

Returns a list of matching proteins (usually one primary entry for human proteins).

### 2. update entry points to accept both formats

Modify these functions to call the resolver first:
- `fetch_uniprot_json()` - add resolution before fetching
- `/refresh-proteins` endpoint - resolve each identifier in the input list
- CLI commands (`fetch`, `refresh-mobidb`) - accept both formats

Pattern:
```python
def fetch_uniprot_json(identifier: str) -> Dict[str, Any]:
    uid = resolve_protein_identifier(identifier)
    if not uid:
        raise ValueError(f"Could not resolve '{identifier}' to UniProt ID")
    # ... rest of existing fetch logic using uid
```

### 3. cache the resolution results

Gene symbol lookups hit an API - don't want to do this repeatedly. Cache the mappings:
- File: `data/proteins/gene_symbol_cache.json`
- Structure: `{"EGFR": "P00533", "KRAS": "P01116", ...}`
- Update cache whenever we successfully resolve a new symbol

### 4. handle ambiguous cases

Some gene symbols map to multiple UniProt IDs (isoforms, obsolete entries):
- Take the first "reviewed" (Swiss-Prot) entry for human
- Log a warning if multiple hits found
- Return None if zero hits

### 5. detect format automatically

Don't make users specify which format they're using. Auto-detect:
- UniProt IDs: 6-10 alphanumeric characters, often start with P,Q,O (regex: `^[OPQ][0-9][A-Z0-9]{3}[0-9]$`)
- Gene symbols: Usually all caps, shorter (EGFR, TP53, HLA-A)

If it looks like a UniProt ID, try using it directly. If that fails or it looks like a gene symbol, try resolving.

## open questions

**Q: What happens if someone types a gene symbol that resolves to multiple proteins?**

Example: HLA-A has dozens of alleles (HLA-A*01:01, HLA-A*02:01...). Do we:
1. Pick the reference sequence (HLA-A*01:01)
2. Ask the user to be more specific
3. Fetch all of them

**A**: For MVP, pick the first "reviewed" human entry and log a warning. Can add disambiguation UI later if needed.

**Q: Should we support other identifier types?**

UniProt also accepts:
- Ensembl IDs (ENSG...)
- Entrez Gene IDs (3105)
- RefSeq IDs (NP_...)

**A**: Start with gene symbols only. Can add other formats later if there's demand.

**Q: What if the cache gets stale (gene name changes, UniProt deprecates an ID)?**

**A**: Cache entries should have timestamps. If an entry is >90 days old, refresh it. Or just add a CLI command to clear the cache when weird stuff happens.

## acceptance criteria

When this epic is done:
- [ ] `resolve_protein_identifier()` function exists and works for both formats
- [ ] UniProt search API integration works (gets first reviewed human entry)
- [ ] Gene symbol cache file created and used
- [ ] `fetch_uniprot_json()` accepts both gene symbols and UniProt IDs
- [ ] `/refresh-proteins` endpoint accepts mixed lists (can handle both formats in same request)
- [ ] Auto-detection works: "P00533" → treated as UniProt ID, "EGFR" → treated as gene symbol
- [ ] Error messages are clear when resolution fails ("Could not find UniProt ID for gene symbol 'NOTREAL'")
- [ ] Tested with at least 5 different gene symbols (EGFR, KRAS, TP53, BRCA1, HLA-A)

## implementation notes

### UniProt search API format

```python
import requests

def resolve_gene_symbol(symbol: str) -> str | None:
    url = f"https://rest.uniprot.org/uniprotkb/search"
    params = {
        "query": f"gene:{symbol} AND organism_id:9606 AND reviewed:true",
        "format": "json",
        "size": 1  # Just get the first result
    }
    resp = requests.get(url, params=params, timeout=10)
    if resp.status_code == 200:
        data = resp.json()
        results = data.get("results", [])
        if results:
            return results[0].get("primaryAccession")
    return None
```

### Cache structure

```json
{
  "EGFR": {
    "uniprot_id": "P00533",
    "cached_at": "2025-09-30T12:34:56Z"
  },
  "KRAS": {
    "uniprot_id": "P01116",
    "cached_at": "2025-09-30T12:35:12Z"
  }
}
```

### Auto-detection regex

```python
import re

UNIPROT_ID_PATTERN = re.compile(r"^[OPQ][0-9][A-Z0-9]{3}[0-9]$|^[A-NR-Z][0-9]([A-Z][A-Z0-9]{2}[0-9]){1,2}$")

def looks_like_uniprot_id(s: str) -> bool:
    return bool(UNIPROT_ID_PATTERN.match(s.strip().upper()))
```

## risks and gotchas

**Risk**: UniProt search API rate limits. If we're resolving 50 gene symbols in a batch, that's 50 API calls.

**Mitigation**: Cache aggressively. After the initial population, most lookups will be cache hits.

**Risk**: Gene symbol isn't standardized - some sources use "EGFR", others use "ERBB1". Both are valid for the same protein.

**Mitigation**: UniProt's gene search handles synonyms, so "ERBB1" will still find P00533. Document that we use official HGNC symbols when possible.

**Risk**: User types "egfr" (lowercase) and nothing works because our cache is case-sensitive.

**Mitigation**: Normalize all input to uppercase before lookup. Store cache keys in uppercase.

## estimated breakdown

- **Implement UniProt search API client**: 1 hour
- **Add gene symbol cache (read/write)**: 45 minutes
- **Create resolve_protein_identifier() with auto-detection**: 1 hour
- **Update entry points (fetch_uniprot_json, /refresh-proteins)**: 1 hour
- **Test with sample gene symbols and edge cases**: 30 minutes
- **Document the new input format**: 15 minutes

**Total**: ~4 hours