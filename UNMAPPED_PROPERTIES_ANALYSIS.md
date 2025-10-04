# Interesting Unmapped Protein Properties - Database Analysis

## Current Mappings (Already Used)
From `features.csv`:
- mass (→ height)
- Has transmembrane domains (→ Sex)
- membrane_depth (→ background_setting)
- alignment (→ Politics)
- first_letter (→ Skintone Hue)
- rvis_percentile (→ Skintone Lightness)
- tissue_tau (→ Skintone Saturation)
- kegg_families (→ Aesthetics)
- percent_disordered (→ Age)

## Available Databases & Interesting Unmapped Properties

### 1. **UniProt** (uniprot/*.json) - RICH SOURCE
**Current Status:** Downloaded for 21 proteins, contains extensive data

**Interesting Properties:**

**Temporal/Version Data:**
- `entryAudit.firstPublicDate` - When protein first described (1998-2025)
  * Map to → **Birth Year** or **Discovery Era** 
  * Example: BCL2 first public 1998-07-15
- `entryAudit.entryVersion` - How many updates (e.g., 249 for APAF1)
  * Map to → **Life Experience** or **Wisdom Score**

**Structural Complexity:**
- `features` array length - Number of annotated features
  * Map to → **Complexity** or **Detail Level**
- Domain/repeat counts from features
  * WD repeats, CARD domains, etc.
  * Map to → **Pattern Recognition** or **Modularity**

**Interaction/Social:**
- `comments[commentType="INTERACTION"].interactions` count
  * Map to → **Social Network Size** or **Friend Count**
  * APAF1 has 4+ interactions listed
- `comments[commentType="SUBUNIT"]` - Oligomerization state
  * "Monomer", "Heptameric ring", "Complex"
  * Map to → **Social Structure** (Loner vs Collective)

**Functional Specificity:**
- `comments[commentType="TISSUE SPECIFICITY"]` richness
  * Map to → **Geographic Range** or **Habitat Diversity**
- `keywords` count/diversity
  * Map to → **Skill Set Breadth**

**Evolutionary/Mutation:**
- `features[type="Mutagenesis"]` count
  * Map to → **Experimental History** or **Adaptability**
- `features[type="Sequence conflict"]` count  
  * Map to → **Controversy Score** or **Identity Crisis**

**Subcellular Theater:**
- `comments[commentType="SUBCELLULAR LOCATION"]` granularity
  * Mitochondrion vs Nucleus vs Cytoplasm vs Multi-compartment
  * Map to → **Workplace** or **Territory**

**Isoform Diversity:**
- `comments[commentType="ALTERNATIVE PRODUCTS"].isoforms` count
  * Map to → **Alternate Identities** or **Role Flexibility**
  * APAF1 has 6 isoforms

### 2. **MobiDB** (mobidb/*.json) - DISORDER & STRUCTURE
**Current Status:** Downloaded, contains 5000+ lines per protein

**Already Used:**
- percent_disordered (→ Age)

**New Properties:**
- `ptms` (Post-Translational Modifications) count & diversity
  * Phosphorylation, acetylation, ubiquitination sites
  * Map to → **Accessories** or **Decorations** or **Tattoos**
- `localization` array length/diversity
  * Map to → **Number of Homes** or **Nomadic Tendency**
- Secondary structure elements (helix/strand/turn ratios)
  * Map to → **Posture** or **Body Type** (rigid vs flexible)
- `uniref` cluster memberships (50/90/100)
  * Map to → **Family Size** or **族 Clan**

### 3. **KEGG BRITE** (kegg_brite/*.json) - PATHWAY CONTEXT
**Current Status:** Downloaded

**Already Used:**
- protein_families field is source for kegg_families (→ Aesthetics)

**New Properties:**
- `ko_id` - KEGG Orthology identifier
  * Can look up pathway membership (signaling, metabolism, etc.)
  * Map to → **Career Path** or **Life Philosophy**
  * Example: ko:K00134 could indicate metabolic vs structural roles

### 4. **HPA** (Human Protein Atlas) (hpa/*.json)  
**Current Status:** Downloaded

**Already Used:**
- TAU score (tissue specificity) → Skintone Saturation

**Potentially Available (need to verify):**
- Tissue expression levels (if present)
  * Map to → **Energy Level** or **Activity Level** 
- Subcellular location images/data
  * Map to → **Preferred Hangout Spots**

### 5. **RVIS** (rvis/*.tsv probably)
**Current Status:** Downloaded

**Already Used:**
- rvis_percentile → Skintone Lightness

**Potentially Available:**
- Exact RVIS score (continuous)
- Additional constraint metrics if file contains them

### 6. **KEGG Gene/KO** (kegg_gene/, kegg_ko/)
**Current Status:** Downloaded but unexplored

**Potential Properties:**
- Pathway membership breadth
  * Map to → **Versatility** or **Multi-tasking**
- Upstream/downstream pathway position  
  * Map to → **Hierarchical Rank** or **Career Stage**
- Interaction partners from pathways
  * Map to → **Professional Network**

## Most Promising New Mappings

**Priority 1 - Immediately Accessible:**
1. **UniProt Interaction Count** → **Friend Count / Social Butterfly Score**
2. **UniProt Isoform Count** → **Alter Egos / Role Flexibility**  
3. **UniProt First Public Date** → **Birth Year / Generation**
4. **MobiDB PTM Count** → **Piercings & Tattoos / Accessories**
5. **UniProt Oligomerization State** → **Living Situation** (Solo/Roommate/Commune)

**Priority 2 - Requires Parsing:**
6. **UniProt Tissue Specificity Detail** → **Travel Log / Places Visited**
7. **MobiDB Secondary Structure Ratio** → **Body Type** (Rigid/Flexible/Mixed)
8. **KEGG Pathway Breadth** → **Career Versatility**  
9. **UniProt Mutagenesis Count** → **Experimental History**

**Priority 3 - Novelty/Quirk:**
10. **UniProt Sequence Conflict Count** → **Identity Crisis Level**
11. **UniProt Entry Version Number** → **Biography Revisions / Character Development**
12. **UniProt Keywords Diversity** → **Skill Tags / LinkedIn Profile**

## Properties to AVOID (Too Similar to Existing)

- Length/AA count - Already proportional to mass
- Domain count - Already captured partially in domain_count field
- Simple binary/categorical duplicates

## Implementation Notes

- UniProt JSONs are comprehensive but large (~100KB each)
- MobiDB JSONs are even larger (~5MB+ each)  
- Extract specific fields rather than full parsing
- Cache computed values in features.csv
- Consider computational cost vs novelty value
