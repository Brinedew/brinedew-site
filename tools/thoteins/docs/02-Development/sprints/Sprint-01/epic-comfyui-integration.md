# Epic: ComfyUI Integration for Character Image Generation

**Status**: Not Started
**Priority**: High (Medium-term goal, blocks Obsidian automation)
**Estimated Effort**: 8-12 hours

## what we're building

Connect the protein persona data to your local ComfyUI instance to generate character portraits automatically. Right now we have height, sex, skintone HSL values, background settings, and politics for each protein, but no actual images. ComfyUI integration turns those attributes into visual character portraits.

## why this matters

The whole point of mapping proteins to personas is to make them visually memorable. A spreadsheet with "height: 134, Skintone Hue: 55" is abstract. A generated portrait of a tall person with peachy-orange skin standing in outer space is concrete and memorable.

This is also required for the Obsidian page generation - you can't create protein character pages without the character images.

## current state

- ComfyUI is installed locally (user confirmed)
- Persona.csv has all the visual attributes needed for character generation:
  - `height` (numeric, in cm)
  - `Sex` (Male/Female)
  - `Skintone Hue`, `Skintone Saturation`, `Skintone Lightness` (HSLuv coordinates)
  - `background_setting` (indoors/outdoors/outer space)
  - `Politics` (pro-Growth/pro-Control/Opportunist/Maintenance)
- `color_signature` column (from HSLuv epic) provides hex color codes

No integration exists yet - there's no code that talks to ComfyUI.

## what needs to happen

### 1. create ComfyUI workflow template

Design a base workflow in ComfyUI's UI that:
- Takes a text prompt describing the character
- Uses ControlNet or similar for pose/composition consistency
- Generates portrait-style images
- Has clearly identified nodes for parameterization

Save this workflow using "Save (API Format)" button → `data/comfyui/character_portrait_workflow.json`

The workflow needs these dynamic inputs:
- Positive prompt text (character description)
- Negative prompt (quality filters)
- Seed (for reproducibility)
- Maybe: color guidance values, height-to-framing mapping

### 2. build prompt template system

Convert persona attributes into natural language prompts for image generation:

```python
def build_character_prompt(persona: Dict[str, Any]) -> str:
    """
    Generate ComfyUI-ready prompt from persona attributes.

    Example output:
    "portrait of a tall male character with peachy-orange skin tone,
     standing in an outer space setting, professional photography,
     detailed, high quality"
    """
```

Template considerations:
- Height → framing (tall people get full-body shots, short people get close-ups?)
- Sex → gender presentation cues
- Skintone → color descriptors ("peachy-orange", "deep purple")
- Background setting → environment description
- Politics → maybe expression/mood? (pro-Growth = confident, pro-Control = stern?)

### 3. implement ComfyUI API client

Create `scripts/comfyui_client.py` with:
- `queue_prompt(workflow, params)` - sends workflow to ComfyUI
- `wait_for_completion(prompt_id)` - WebSocket listener for progress
- `fetch_image(filename)` - downloads generated image
- Error handling for ComfyUI not running, workflow failures, timeout

Based on the API pattern Gemini provided (POST to `/prompt`, WebSocket for status, GET from `/view` for images).

### 4. integrate with protein workflow

Add a new command and endpoint:
```python
# CLI command
python protein_db.py generate-image P00533

# API endpoint in local_writer.py
POST /generate-image
Body: {"uniprot_id": "P00533"}
Returns: {"image_path": "data/proteins/images/P00533.png"}
```

The flow:
1. Load persona.csv row for the protein
2. Build character prompt from attributes
3. Load ComfyUI workflow template
4. Inject prompt and seed into workflow
5. Queue workflow via ComfyUI API
6. Wait for completion
7. Save image to `data/proteins/images/<uniprot_id>.png`
8. Return image path

### 5. handle batch generation

Since we have 29 proteins, support batch mode:
```python
python protein_db.py generate-all-images
```

Should:
- Process all proteins in persona.csv sequentially (ComfyUI typically handles one at a time)
- Skip proteins that already have images (unless `--force` flag)
- Show progress bar
- Handle failures gracefully (log error, continue to next protein)

## open questions

**Q: How should we map persona attributes to visual style?**

The tricky part is converting abstract attributes like "Politics: pro-Growth" into visual characteristics. Do we:
1. Ignore abstract attributes, focus only on concrete ones (height, sex, skin color, background)
2. Add subtle visual cues (pro-Control characters have more rigid poses, pro-Growth characters have dynamic poses)
3. Use abstract attributes to generate character accessories/clothing

**A**: Start with concrete attributes only. Abstract attributes can be added to the prompt as mood/expression keywords but don't force specific visual mappings yet.

**Q: Should we version/track the generated images?**

If we regenerate with a different workflow or prompt template, do we:
1. Overwrite the old image
2. Keep both with timestamps (`P00533_v1.png`, `P00533_v2.png`)
3. Store generation metadata (seed, workflow version, prompt used)

**A**: For MVP, just overwrite. Can add versioning later if needed.

**Q: What happens if ComfyUI isn't running when we try to generate?**

**A**: Check if ComfyUI is reachable (`GET /system_stats`) before attempting generation. Give clear error: "ComfyUI not detected at http://127.0.0.1:8188. Please start ComfyUI before generating images."

**Q: How do we handle the fact that image generation is slow?**

A single image might take 30-60 seconds. Batch generating 29 images could take 15-30 minutes.

**A**:
- Show progress clearly (including time per image)
- For API endpoint, consider async: return immediately with a job ID, poll for completion
- For CLI, just run synchronously with progress bar

## acceptance criteria

When this epic is done:
- [ ] ComfyUI workflow template created and saved as JSON
- [ ] `comfyui_client.py` module created with API integration functions
- [ ] `build_character_prompt()` function converts persona → natural language prompt
- [ ] CLI command `generate-image <uniprot_id>` works
- [ ] API endpoint `/generate-image` works
- [ ] Images saved to `data/proteins/images/<uniprot_id>.png`
- [ ] Batch command `generate-all-images` processes all proteins
- [ ] Error handling for ComfyUI offline, workflow failures, timeouts
- [ ] At least 3 test images generated and verified to match persona attributes
- [ ] Documentation added to ARCHITECTURE.md about image generation flow

## implementation notes

### ComfyUI workflow customization

Key nodes to parameterize in the saved workflow JSON:
- **Node 6** (CLIPTextEncode, positive): `inputs.text = character_prompt`
- **Node 7** (CLIPTextEncode, negative): `inputs.text = negative_prompt`
- **Node 3** (KSampler): `inputs.seed = hash(uniprot_id)` for reproducibility

Use protein's UniProt ID hash as seed so regenerating the same protein always produces the same image.

### Prompt template structure

```python
PROMPT_TEMPLATE = """portrait of a {height_description} {sex} character with {skin_color_description} skin tone, {background_description}, professional photography, detailed, high quality, centered composition"""

NEGATIVE_PROMPT = "blurry, low quality, distorted, disfigured, bad anatomy, watermark, text, logo, multiple people"

HEIGHT_MAP = {
    range(0, 50): "young child-like",
    range(50, 150): "short",
    range(150, 170): "average height",
    range(170, 190): "tall",
    range(190, 300): "very tall"
}

BACKGROUND_MAP = {
    "indoors": "in a modern indoor setting with clean lighting",
    "outdoors": "in a natural outdoor environment with trees and sky",
    "outer space": "floating in outer space with stars and nebulae in background"
}
```

### Error handling patterns

```python
class ComfyUINotAvailableError(Exception):
    pass

class WorkflowExecutionError(Exception):
    pass

def check_comfyui_available(server_address="127.0.0.1:8188"):
    try:
        resp = requests.get(f"http://{server_address}/system_stats", timeout=2)
        return resp.status_code == 200
    except requests.RequestException:
        return False
```

## risks and gotchas

**Risk**: ComfyUI API format might change. The workflow JSON structure is not officially versioned.

**Mitigation**: Save the workflow JSON in version control. Document the ComfyUI version used (probably in ARCHITECTURE.md).

**Risk**: Some persona attributes might produce poor image results (skintone values outside realistic ranges, weird height/background combinations).

**Mitigation**: Add validation before prompt generation. Clamp skintone lightness to 30-80 range, for example.

**Risk**: Generated images might not visually match the persona attributes (ComfyUI ignores parts of the prompt, produces wrong skin tones, etc.).

**Mitigation**: This is an inherent limitation of AI image generation. Document that images are "inspired by" persona attributes, not exact representations. Consider adding ControlNet for better attribute control.

**Risk**: WebSocket connection hangs if ComfyUI crashes mid-generation.

**Mitigation**: Add timeout to WebSocket listener (default 5 minutes). If no completion message received, raise WorkflowExecutionError.

## estimated breakdown

- **Create and test ComfyUI workflow template**: 2 hours
- **Build prompt template system with attribute mapping**: 2 hours
- **Implement ComfyUI API client (queue, wait, fetch)**: 3 hours
- **Integrate with protein workflow (CLI command + API endpoint)**: 2 hours
- **Add batch generation support**: 1 hour
- **Error handling and edge cases**: 1 hour
- **Test with sample proteins and iterate on prompts**: 2 hours
- **Documentation**: 30 minutes

**Total**: ~13.5 hours (call it 12-14 hours depending on how much prompt iteration is needed)