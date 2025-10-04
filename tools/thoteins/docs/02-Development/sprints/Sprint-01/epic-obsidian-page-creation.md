# Epic: Automatic Obsidian Page Creation for Proteins

**Status**: Not Started
**Priority**: High (Long-term goal, final integration piece)
**Estimated Effort**: 4-6 hours

## what we're building

Auto-populate protein pages in your existing Obsidian wiki structure. Right now you have a template at `Templates/Protein Template QuickAdd.md` and manually created pages like `wiki/egfr-erbb1-p00533.md`. This epic makes it automatic: run a command, get a fully populated page with frontmatter from features.csv and persona.csv, plus the character image.

## why this matters

The long-term goal is "enter a protein name → protein's page gets created on my website's obsidian pages database, with character image." This epic is that final integration. You already have the structure and existing pages - this just automates the tedious data entry.

## current state

**Existing structure:**
- Obsidian vault at `D:\Coding\Website\content`
- Protein pages in `wiki/` folder
- Naming pattern: `{gene_lowercase}-{symbol_lowercase}-{uniprot_id}.md` (e.g., `egfr-erbb1-p00533.md`)
- Template at `Templates/Protein Template QuickAdd.md`

**Frontmatter fields in your template:**
```yaml
title: EGFR (ERBB1)
tags: [protein, content/wiki]
date: 2025-08-21
draft: true
aliases: [ERBB1, epidermal growth factor receptor]
symbol: EGFR
mass: 134.3
length (aa): 1210
protein_type: receptor tyrosine kinase
transmembrane: true
domains: [list]
pathways: [list]
uniprot_id: P00533
image_link: ""
```

**Content sections:**
- "What it is" - protein description
- "Why it matters here" - cancer relevance
- "Notes" - pathways/ligands

**Data sources available:**
- features.csv: mass, length, full_name, domains_top3, locations, keywords, transmembrane_count
- persona.csv: height, Sex, Politics, background_setting, color_signature

## what needs to happen

### 1. create page generation function

```python
def create_obsidian_protein_page(uniprot_id: str) -> str:
    """
    Creates/updates an Obsidian protein page in existing format.

    Returns: Path to the created page (wiki/gene-symbol-id.md)
    """
```

The function should:
1. Load features.csv and persona.csv rows for the protein
2. Generate filename: `wiki/{gene_symbol.lower()}-{gene_symbol.lower()}-{uniprot_id.lower()}.md`
   - Example: EGFR/P00533 → `wiki/egfr-egfr-p00533.md`
   - Handle edge cases: if gene symbol has spaces (HLA-A), use as-is but lowercase
3. Build frontmatter dict from CSV data
4. Check if page exists using MCP `obsidian_list_files_in_dir("wiki")`
5. If exists, skip (or update only empty fields)
6. Generate page content with populated frontmatter + template prose sections
7. Copy image to `Attachments/` folder if it exists
8. Create page using MCP `obsidian_append_content()`

### 2. map CSV fields to frontmatter

```python
FIELD_MAPPING = {
    # From features.csv
    "title": lambda row: f"{row['gene_symbol']} ({row['short_name']})" if row['short_name'] != row['gene_symbol'] else row['gene_symbol'],
    "symbol": "gene_symbol",
    "mass": "mass",  # Already in kDa
    "length (aa)": "length",
    "uniprot_id": "uniprot_id",
    "domains": lambda row: row['domains_top3'].split("; ") if row['domains_top3'] else [],
    "transmembrane": lambda row: row['transmembrane_count'] > 0,

    # Fields that need manual entry (leave empty for now)
    "protein_type": "",  # Could infer from keywords?
    "pathways": [],  # Not in our data
    "image_link": lambda row: f"Attachments/{row['uniprot_id']}.png"  # After copying
}
```

### 3. handle image embedding

Your existing pages use `image_link:` in frontmatter, not inline `![[image]]`. Options:

**Option A**: Copy image to Attachments/, set image_link to relative path
```python
import shutil
source = f"D:/Coding/Thoteins/data/proteins/images/{uniprot_id}.png"
dest = f"D:/Coding/Website/content/Attachments/{uniprot_id}.png"
if os.path.exists(source):
    shutil.copy(source, dest)
    frontmatter["image_link"] = f"Attachments/{uniprot_id}.png"
```

**Option B**: Use Wikilink in body instead
```markdown
![[P00533.png]]
```

Recommend Option A since that matches your existing format (image_link in frontmatter).

### 4. generate prose sections

The manual sections are hardest to automate. Options:

**Conservative approach**: Leave them as template placeholders
```markdown
**What it is.** [Auto-generated description from keywords/domains]

**Why it matters here.** [Auto-generated from cancer alignment + politics]

**Notes.** [Empty or basic stats]
```

**Generated approach**: Use persona data to fill in basics
```python
def generate_description(features_row, persona_row):
    # "What it is"
    locations = features_row['locations'].split("; ")[0] if features_row['locations'] else "cellular"
    domains = features_row['domains_top3'].split("; ")[0] if features_row['domains_top3'] else "protein"
    desc = f"A {locations} protein with {domains} domain."

    # "Why it matters here"
    alignment = features_row.get('alignment', 'unknown')
    if alignment == 'oncogene':
        relevance = "Oncogenic driver that promotes cell growth."
    elif alignment == 'tumor_suppressor':
        relevance = "Tumor suppressor that restricts proliferation."
    else:
        relevance = "Regulatory protein involved in growth control."

    return desc, relevance
```

Start with conservative (placeholders), add generation later if wanted.

### 5. add CLI command and API endpoint

```bash
# Single protein
python protein_db.py create-obsidian-page P00533

# Batch (all proteins in persona.csv)
python protein_db.py create-all-obsidian-pages
```

```python
# API endpoint in local_writer.py
POST /create-obsidian-page
Body: {"uniprot_id": "P00533"}
Returns: {"page_path": "wiki/egfr-egfr-p00533.md", "status": "created"}
```

### 6. handle edge cases

- **Protein already has manual page**: Skip or update only empty fields
- **No image generated yet**: Set image_link to empty, page still created
- **Gene symbol conflicts**: Some proteins share gene symbols - filename collision
  - Solution: Use `{gene}-{short_name}-{uniprot_id}.md` format prevents this
- **Special characters in gene names**: HLA-A, IL-2, etc. are valid, keep hyphens
- **Aliasing**: Full protein name should go in aliases array for search

## open questions

**Q: Should we update existing pages or only create new ones?**

You already have 30+ manually created protein pages in wiki/. Do we:
1. Skip all existing pages
2. Update only empty fields (fill in mass/length/domains if missing)
3. Overwrite everything (lose manual edits)

**A**: For MVP, skip existing. Add `--update-empty` flag later for filling gaps.

**Q: How to handle the character persona attributes in Obsidian?**

Your current pages don't have height, sex, politics, skintone. Do we:
1. Add them as new frontmatter fields
2. Create a separate "## Character Profile" section
3. Ignore them (pages are for molecular data only)

**A**: [Need Product Owner input]

**Q: What about the prose sections - generate or leave as placeholders?**

**A**: Start with placeholders. Can iterate on generation later based on what sounds good.

## acceptance criteria

When this epic is done:
- [ ] `create_obsidian_protein_page()` function implemented
- [ ] Function reads from features.csv and persona.csv
- [ ] Generates filename in your existing format (`gene-symbol-uniprot_id.md`)
- [ ] Populates frontmatter fields from CSV data
- [ ] Copies image to `Attachments/` folder if it exists
- [ ] Sets `image_link` field to relative path
- [ ] Creates page using MCP Obsidian tools
- [ ] Page follows your existing template structure
- [ ] CLI command `create-obsidian-page <uniprot_id>` works
- [ ] API endpoint `/create-obsidian-page` works
- [ ] Batch command `create-all-obsidian-pages` works
- [ ] At least 3 new proteins tested and pages display correctly in Obsidian
- [ ] Existing pages are not overwritten

## implementation notes

### Filename generation

```python
def generate_page_filename(gene_symbol: str, uniprot_id: str) -> str:
    """Generate filename matching existing pattern."""
    # Your pattern: egfr-erbb1-p00533.md
    # Format: {gene_lower}-{symbol_lower}-{uniprot_lower}.md
    gene_clean = gene_symbol.lower().replace(" ", "-")
    uniprot_clean = uniprot_id.lower()
    # Use gene symbol twice if no separate short_name
    return f"wiki/{gene_clean}-{gene_clean}-{uniprot_clean}.md"
```

### Frontmatter rendering

```python
import yaml

def render_frontmatter(data: Dict[str, Any]) -> str:
    """Render YAML frontmatter block."""
    return "---\n" + yaml.dump(data, default_flow_style=False, allow_unicode=True) + "---\n"
```

### Full page template

```python
def build_page_content(features: Dict, persona: Dict) -> str:
    frontmatter = {
        "title": f"{features['gene_symbol']} ({features['short_name']})",
        "tags": ["protein", "content/wiki"],
        "date": datetime.now().strftime("%Y-%m-%d"),
        "draft": True,
        "symbol": features['gene_symbol'],
        "mass": float(features['mass']) if features['mass'] else None,
        "length (aa)": int(features['length']) if features['length'] else None,
        "uniprot_id": features['uniprot_id'],
        "image_link": f"Attachments/{features['uniprot_id']}.png",
        # Add more fields...
    }

    body = f"""# {frontmatter['title']}

**What it is.** [Description]

**Why it matters here.** [Cancer relevance]

**Notes.** [Additional details]
"""

    return render_frontmatter(frontmatter) + "\n" + body
```

## risks and gotchas

**Risk**: Filename generation doesn't match your existing pattern perfectly, creates duplicates.

**Mitigation**: Test filename generation against existing pages first. Verify pattern with 5-10 examples.

**Risk**: Image copy fails if Attachments/ folder doesn't exist or is in cloud sync (OneDrive).

**Mitigation**: Create Attachments/ folder if missing. Wrap copy in try/except, set image_link to empty if copy fails.

**Risk**: YAML frontmatter rendering adds weird quotes or formatting that breaks Obsidian parsing.

**Mitigation**: Test with yaml.safe_dump(). Verify output in Obsidian before batch operation.

**Risk**: MCP obsidian_append_content might create pages in wrong location if relative paths are off.

**Mitigation**: Test with dummy page first. Verify it appears in correct wiki/ folder in Obsidian UI.

**Risk**: Overwriting manually created pages loses valuable content (descriptions, pathways you researched).

**Mitigation**: Always check if page exists first. Default to skip existing, require explicit `--force` flag to overwrite.

## estimated breakdown

- **Implement field mapping from CSV to frontmatter**: 1.5 hours
- **Create page generation function**: 1.5 hours
- **Implement image copying to Attachments/**: 30 minutes
- **Add filename generation matching existing pattern**: 30 minutes
- **Create page using MCP tools**: 1 hour
- **Add CLI command and API endpoint**: 45 minutes
- **Add batch processing**: 30 minutes
- **Test with new proteins, verify in Obsidian**: 1.5 hours
- **Documentation**: 30 minutes

**Total**: ~8 hours

Could be faster (~5 hours) if existing structure is straightforward and no MCP issues.