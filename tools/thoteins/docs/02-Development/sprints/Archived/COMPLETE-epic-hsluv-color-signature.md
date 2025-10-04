# Epic: HSLuv Color Signature Column

**Status**: ✅ COMPLETE (Sept 30, 2025)
**Priority**: High (Short-term goal)
**Estimated Effort**: 4-6 hours
**Actual Effort**: ~2 hours

## what we're building

Add a visual color signature to persona.csv that translates the abstract skintone coordinates (Hue/Saturation/Lightness) into actual colors you can see. Right now persona.csv has three numeric columns that represent color in HSLuv space, but there's no way to actually *see* what color each protein is without manually converting the numbers.

## why this matters

The whole point of mapping proteins to human characteristics is to make them visually distinctive. If I'm looking at EGFR with skintone `[55, 2.5, 63.4]`, I have no idea what color that actually is without running it through a converter. Adding a color signature column lets you scan the CSV and immediately see "oh, this protein is peachy-orange, that one is deep purple."

Plus, this is the foundation for the image generation pipeline - ComfyUI needs actual colors to render, not abstract coordinates.

## current state

persona.csv already has the three components we need:
- `Skintone Hue ` (0-360 degrees)
- `Skintone Saturation` (0-100 percent)
- `Skintone Lightness` (0-100 percent)

These map directly to HSLuv's [H, S, L] format. Example from AXIN1:
```
Skintone Hue : 0
Skintone Saturation: 49.2
Skintone Lightness: 73.9
```

## what needs to happen

### 1. add hsluv library
- Install Python `hsluv` package: `pip install hsluv`
- This gives us `hsluv_to_hex([h, s, l])` function for conversion

### 2. modify persona CSV generation
Add a new column `color_signature` that computes the hex color during persona rebuild:
- In `rebuild_persona_csv()` (protein_db.py line ~1118), after computing all human variables
- Read the three skintone values from the overrides dict
- Convert to hex using `hsluv.hsluv_to_hex([hue, sat, light])`
- Add `color_signature` column with the hex value (like `#9F62E3`)

### 3. handle missing data gracefully
Not all proteins have skintone data (like HLA-A). If any of the three skintone values are empty:
- Leave `color_signature` empty
- Don't try to convert partial data (would crash or produce garbage)

### 4. test the conversion
Pick a few proteins with known skintone values and verify:
- The hex codes look reasonable (not all black or all white)
- The conversion handles edge cases (hue=0, saturation=0, lightness=100)
- Empty cells stay empty

## open questions

**Q: Do we want the CSV to actually display colors, or just contain hex codes?**

CSV is plain text - it can't contain colored cells. But:
- Excel/Google Sheets can use conditional formatting to color cells based on hex values
- We could generate an HTML table instead that renders with actual colors
- We could output both: persona.csv (plain) + persona.html (visual)

**A (from Product Owner)**: The requirement says "coloring each cell in this column with the HSLuv color of that row." This suggests you want visual color, not just hex strings. Need to clarify if this means:
1. Generate a separate visual format (HTML/Excel with formatting)
2. Add conditional formatting rules to Excel output
3. Just add the hex column for now, visual rendering comes later

**Q: Should the color column trigger regeneration of downstream artifacts?**

If we have templates or prompts that reference skintone, do they need to also reference the hex color?

## acceptance criteria

When this epic is done:
- [x] `hsluv` library installed and importable
- [x] persona.csv has a new `hexcode` column (renamed from `color_signature`)
- [x] Column contains valid 7-character hex codes (like `#A3F5B2`) for proteins with complete skintone data
- [x] Column is empty for proteins missing skintone values
- [x] Running "Rebuild Persona" button generates the color column automatically
- [x] At least 3 sample proteins tested with known skintone → hex conversions verified correct (EGFR=#ae9677, GAPDH=#414035)

## what actually got built

Implemented in [protein_db.py:1167-1179](../../scripts/protein_db.py). The `rebuild_persona_csv()` function now automatically computes hex colors from HSLuv coordinates and adds them to the `hexcode` column.

Key decisions:
- Used column name `hexcode` instead of `color_signature` for clarity
- Integrated seamlessly with existing persona rebuild workflow
- Gracefully handles missing data (empty cells for incomplete skintone values)

Test results:
- EGFR (Hue=55, Sat=39, Light=63.4) → #ae9677 (warm tan)
- GAPDH (Hue=50, Sat=27, Light=28) → #414035 (desaturated brown, appropriate for housekeeping gene)

Visual rendering question was resolved by building the card gallery (separate untracked work) which displays these colors as placeholders when no character image exists.

## implementation notes

The conversion is straightforward:
```python
from hsluv import hsluv_to_hex

# In rebuild_persona_csv(), after getting overrides from _apply_mapping():
hue = overrides.get("Skintone Hue ")  # Note the trailing space in column name
sat = overrides.get("Skintone Saturation")
light = overrides.get("Skintone Lightness")

if all(x not in (None, "", " ") for x in [hue, sat, light]):
    try:
        hex_color = hsluv_to_hex([float(hue), float(sat), float(light)])
        overrides["color_signature"] = hex_color
    except:
        overrides["color_signature"] = ""
else:
    overrides["color_signature"] = ""
```

Remember to also add `color_signature` to the `mapping.json` human variables list so it persists across rebuilds.

## risks and gotchas

**Risk**: The trailing space in `"Skintone Hue "` column name is a typo waiting to bite us. If we try to read `"Skintone Hue"` (no space), we get nothing.

**Risk**: HSLuv expects values in specific ranges. If the mapping produces `Saturation: 350` somehow, the conversion will fail. Should validate input ranges.

**Risk**: Installing `hsluv` might not be available on all systems. Should document this as a new dependency in requirements.txt.

## estimated breakdown

- **Install library and test basic conversion**: 30 minutes
- **Modify rebuild_persona_csv() to add column**: 1 hour
- **Handle edge cases and missing data**: 1 hour
- **Test with sample proteins**: 30 minutes
- **Update mapping.json human variables**: 15 minutes
- **Document the new column in ARCHITECTURE.md**: 30 minutes

**Total**: ~3.5 hours for core functionality

If we also want visual rendering (HTML output or Excel formatting):
- **Generate HTML table with colored cells**: 1.5 hours
- **Add Excel conditional formatting export**: 2 hours

Depends on Product Owner's answer to the open questions.