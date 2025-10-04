"""
ComfyUI API client for generating protein character portraits.
Handles workflow queuing, WebSocket monitoring, and image fetching.
"""

import json
import urllib.request
import urllib.error
import uuid
import websocket
import hashlib
from pathlib import Path
from typing import Dict, Any, Optional, List
import colorsys


# ComfyUI server defaults
SERVER_ADDRESS = "127.0.0.1:8000"
WORKFLOW_PATH = Path(__file__).parent.parent / "data" / "comfyui" / "character_portrait_workflow.json"


class ComfyUINotAvailableError(Exception):
    """Raised when ComfyUI server is not reachable."""
    pass


class WorkflowExecutionError(Exception):
    """Raised when workflow execution fails."""
    pass


def check_comfyui_available(server_address: str = SERVER_ADDRESS, verbose: bool = False) -> bool:
    """Check if ComfyUI server is running and reachable."""
    try:
        response = urllib.request.urlopen(f"http://{server_address}/system_stats", timeout=5)
        if verbose:
            print(f"ComfyUI responding on http://{server_address}")
        return response.status == 200
    except urllib.error.URLError as e:
        if verbose:
            print(f"Debug: URLError when checking ComfyUI at http://{server_address}: {e.reason}")
        return False
    except TimeoutError as e:
        if verbose:
            print(f"Debug: Timeout when checking ComfyUI at http://{server_address}")
        return False
    except Exception as e:
        if verbose:
            print(f"Debug: Unexpected error when checking ComfyUI: {e}")
        return False


def hsluv_to_rgb_description(h: float, s: float, l: float) -> str:
    """
    Convert HSLuv values to a natural language color description.

    h: hue (0-360)
    s: saturation (0-100)
    l: lightness (0-100)
    """
    # Map hue to color name
    hue_names = [
        (0, 15, "reddish"),
        (15, 45, "orange"),
        (45, 70, "yellow-orange"),
        (70, 150, "greenish"),
        (150, 200, "cyan"),
        (200, 260, "blue"),
        (260, 290, "purple"),
        (290, 330, "magenta"),
        (330, 360, "reddish")
    ]

    hue_name = "neutral"
    for start, end, name in hue_names:
        if start <= h < end:
            hue_name = name
            break

    # Describe saturation and lightness
    if l < 20:
        lightness_desc = "very dark"
    elif l < 40:
        lightness_desc = "dark"
    elif l < 60:
        lightness_desc = "medium"
    elif l < 80:
        lightness_desc = "light"
    else:
        lightness_desc = "very light"

    if s < 20:
        sat_desc = "muted"
    elif s < 50:
        sat_desc = "subtle"
    else:
        sat_desc = "vivid"

    return f"{lightness_desc} {sat_desc} {hue_name}"


def build_algorithmic_parameters(persona: Dict[str, Any]) -> Dict[str, str]:
    """
    Extract algorithmic parameters from persona - filled verbatim from data.

    Returns dict of template variables that map directly from persona fields.
    """
    # Height -> age/body type
    height = float(persona.get('height', 170))
    if height < 50:
        height_desc = "young child character"
    elif height < 140:
        height_desc = "short character"
    elif height < 170:
        height_desc = "average height character"
    elif height < 190:
        height_desc = "tall character"
    else:
        height_desc = "very tall character"

    # Sex
    sex = persona.get('Sex', 'Female').lower()

    # Skin tone description from HSLuv values
    h = float(persona.get('Skintone Hue ', 0))
    s = float(persona.get('Skintone Saturation', 50))
    l = float(persona.get('Skintone Lightness', 60))
    skin_color = hsluv_to_rgb_description(h, s, l)

    # Background setting (mapped from membrane depth)
    background_map = {
        "indoors": "in a modern indoor setting with clean lighting",
        "outdoors": "in a natural outdoor environment",
        "outer space": "in an outer space setting with stars in background"
    }
    background = background_map.get(persona.get('background_setting', 'indoors'), "in a neutral setting")

    return {
        "height": height_desc,
        "sex": sex,
        "skin_color": skin_color,
        "background": background,
    }


def build_neural_parameters(persona: Dict[str, Any], protein_name: str = "") -> str:
    """
    Generate creative character details using LLM based on persona context.

    Takes: Aesthetics tags, Politics, protein biology knowledge
    Returns: Natural language description of personality, appearance details, mood

    This will be filled by an in-pipeline LLM (Gemini) that has access to:
    - Worldbuilding context (faction lore, aesthetic definitions)
    - Protein biology (oncogene vs tumor suppressor, function)
    - Aesthetic wiki entries
    """
    aesthetics = persona.get('Aesthetics', '')
    politics = persona.get('Politics', 'Maintenance')

    # For now, use simple template until LLM integration
    # TODO: Replace with actual Gemini call that reads worldbuilding docs

    aesthetic_list = [a.strip() for a in aesthetics.split(';') if a.strip() and a.strip() != 'placeholder']
    aesthetic_hint = f"{aesthetic_list[0].lower()} aesthetic" if aesthetic_list else "modern aesthetic"

    politics_mood = {
        "pro-Growth": "confident and dynamic expression",
        "pro-Control": "stern and disciplined expression",
        "Opportunist": "calculating and adaptive demeanor",
        "Maintenance": "calm and balanced presence"
    }
    mood = politics_mood.get(politics, "neutral expression")

    # Placeholder neural params - will be LLM-generated
    return f"{aesthetic_hint}, {mood}"


def build_character_prompt(persona: Dict[str, Any], protein_name: str = "") -> str:
    """
    Generate ComfyUI-ready prompt using 3-part system:

    1. SKELETON: Immutable technical specs (camera, composition, style)
    2. ALGORITHMIC: Filled verbatim from persona fields (height, sex, color, background)
    3. NEURAL: LLM-generated creative details (aesthetics, mood, personality)
    """

    # Part 1: Immutable skeleton (identical for all prompts)
    SKELETON = "professional character portrait photograph, centered composition, detailed, high quality, professional photography, portrait lighting, 4k, sharp focus"

    # Part 2: Algorithmic parameters (verbatim from persona)
    algo_params = build_algorithmic_parameters(persona)
    ALGORITHMIC = f"{algo_params['height']}, {algo_params['sex']} character with {algo_params['skin_color']} skin tone, {algo_params['background']}"

    # Part 3: Neural parameters (LLM-generated creative context)
    NEURAL = build_neural_parameters(persona, protein_name)

    # Combine all three parts
    prompt = f"{SKELETON}, {ALGORITHMIC}, {NEURAL}"

    return prompt


def generate_seed_from_protein_id(uniprot_id: str) -> int:
    """Generate deterministic seed from UniProt ID for reproducibility."""
    hash_obj = hashlib.md5(uniprot_id.encode())
    # Take first 8 bytes and convert to int
    return int.from_bytes(hash_obj.digest()[:8], byteorder='big') % (2**32)


def load_workflow_template(workflow_path: Path = WORKFLOW_PATH) -> Dict[str, Any]:
    """Load the ComfyUI workflow JSON template."""
    if not workflow_path.exists():
        raise FileNotFoundError(f"Workflow template not found at {workflow_path}")

    with open(workflow_path, 'r', encoding='utf-8') as f:
        return json.load(f)


def convert_gui_workflow_to_api(gui_workflow: Dict[str, Any]) -> Dict[str, Any]:
    """
    Convert GUI format workflow to API format.

    GUI format has "nodes" array with "id", "type", "inputs", "outputs".
    API format is dict where keys are string node IDs and values are node configs.
    """
    # Skip non-functional nodes (documentation, notes, etc)
    skip_types = {'MarkdownNote', 'Note', 'Reroute'}

    api_workflow = {}

    for node in gui_workflow.get('nodes', []):
        node_id = str(node['id'])
        node_type = node['type']

        # Skip documentation nodes
        if node_type in skip_types:
            continue

        # Build inputs dict from node inputs
        inputs = {}

        # Add inputs from connections (links)
        for input_def in node.get('inputs', []):
            input_name = input_def['name']
            link_id = input_def.get('link')

            if link_id is not None:
                # Find the source node for this link
                for link in gui_workflow.get('links', []):
                    if link[0] == link_id:
                        # link format: [link_id, source_node_id, source_slot, target_node_id, target_slot, type]
                        source_node_id = str(link[1])
                        source_slot = link[2]
                        inputs[input_name] = [source_node_id, source_slot]
                        break

        # Add widget values as inputs
        # Widget values array can include UI controls (like "randomize") that don't map to inputs
        # For KSampler specifically, widgets_values is [seed, control_after_generate, steps, cfg, sampler, scheduler, denoise]
        # but inputs only has [seed, steps, cfg, sampler_name, scheduler, denoise]
        widget_values = node.get('widgets_values', [])

        if node_type == 'KSampler' and len(widget_values) >= 7:
            # Special handling for KSampler - skip the control_after_generate value
            inputs['seed'] = widget_values[0]
            inputs['steps'] = widget_values[2]
            inputs['cfg'] = widget_values[3]
            inputs['sampler_name'] = widget_values[4]
            inputs['scheduler'] = widget_values[5]
            inputs['denoise'] = widget_values[6]
        else:
            # Generic widget mapping for other nodes
            widget_idx = 0
            for input_def in node.get('inputs', []):
                # Only process widget inputs that don't have links
                if input_def.get('widget') is not None and input_def.get('link') is None:
                    if widget_idx < len(widget_values):
                        inputs[input_def['name']] = widget_values[widget_idx]
                        widget_idx += 1

        api_workflow[node_id] = {
            "class_type": node_type,
            "inputs": inputs
        }

    return api_workflow


def inject_prompt_into_workflow(workflow: Dict[str, Any], prompt: str, seed: int, filename_prefix: str = "protein") -> Dict[str, Any]:
    """
    Inject prompt text and seed into API format workflow.

    Finds nodes by class_type and updates their inputs.
    """
    workflow = json.loads(json.dumps(workflow))  # Deep copy

    for node_id, node_data in workflow.items():
        class_type = node_data.get('class_type')

        if class_type == 'CLIPTextEncode':
            # Update text prompt
            node_data['inputs']['text'] = prompt

        elif class_type == 'KSampler':
            # Update seed and fix values
            node_data['inputs']['seed'] = seed
            # Fix misaligned values - ensure correct types
            if 'steps' in node_data['inputs'] and not isinstance(node_data['inputs']['steps'], int):
                node_data['inputs']['steps'] = 28  # Default
            if 'cfg' in node_data['inputs'] and not isinstance(node_data['inputs']['cfg'], (int, float)):
                node_data['inputs']['cfg'] = 1.0  # Default
            if 'scheduler' in node_data['inputs']:
                # Fix scheduler value - must be from valid list
                if node_data['inputs']['scheduler'] not in ['simple', 'normal', 'karras', 'exponential', 'sgm_uniform']:
                    node_data['inputs']['scheduler'] = 'simple'
            if 'denoise' in node_data['inputs'] and not isinstance(node_data['inputs']['denoise'], (int, float)):
                node_data['inputs']['denoise'] = 1.0

        elif class_type == 'SaveImage':
            # Update filename prefix
            node_data['inputs']['filename_prefix'] = filename_prefix

    return workflow


def queue_prompt(workflow: Dict[str, Any], client_id: str, server_address: str = SERVER_ADDRESS) -> str:
    """
    Queue a workflow for execution in ComfyUI.
    Returns the prompt_id for tracking.
    """
    payload = {
        "prompt": workflow,
        "client_id": client_id
    }

    data = json.dumps(payload).encode('utf-8')
    req = urllib.request.Request(
        f"http://{server_address}/prompt",
        data=data,
        headers={'Content-Type': 'application/json'}
    )

    try:
        with urllib.request.urlopen(req, timeout=10) as response:
            result = json.loads(response.read().decode('utf-8'))
            if 'prompt_id' in result:
                return result['prompt_id']
            elif 'error' in result:
                raise WorkflowExecutionError(f"Workflow validation failed: {result['error']}")
            else:
                raise WorkflowExecutionError("Unexpected response from ComfyUI")
    except urllib.error.HTTPError as e:
        error_body = e.read().decode('utf-8') if e.fp else "No error details"
        raise WorkflowExecutionError(f"HTTP {e.code}: {error_body}")


def wait_for_completion(ws: websocket.WebSocket, prompt_id: str, timeout: int = 900) -> None:
    """
    Wait for workflow execution to complete via WebSocket.
    Raises WorkflowExecutionError on timeout or failure.
    """
    ws.settimeout(timeout)

    while True:
        try:
            message = ws.recv()

            if isinstance(message, str):
                data = json.loads(message)

                if data.get('type') == 'executing':
                    exec_data = data.get('data', {})
                    # Completion is signaled when node is None
                    if exec_data.get('node') is None and exec_data.get('prompt_id') == prompt_id:
                        return

                elif data.get('type') == 'execution_error':
                    raise WorkflowExecutionError(f"Execution error: {data}")

        except websocket.WebSocketTimeoutException:
            raise WorkflowExecutionError(f"Workflow execution timed out after {timeout}s")


def get_history(prompt_id: str, server_address: str = SERVER_ADDRESS) -> Dict[str, Any]:
    """Fetch execution history and output metadata from ComfyUI."""
    url = f"http://{server_address}/history/{prompt_id}"

    with urllib.request.urlopen(url, timeout=10) as response:
        return json.loads(response.read().decode('utf-8'))


def fetch_image(filename: str, subfolder: str = "", folder_type: str = "output", server_address: str = SERVER_ADDRESS) -> bytes:
    """Download generated image from ComfyUI."""
    params = urllib.parse.urlencode({
        'filename': filename,
        'subfolder': subfolder,
        'type': folder_type
    })
    url = f"http://{server_address}/view?{params}"

    with urllib.request.urlopen(url, timeout=30) as response:
        return response.read()


def generate_character_image(
    persona: Dict[str, Any],
    uniprot_id: str,
    output_path: Path,
    workflow_path: Path = WORKFLOW_PATH,
    server_address: str = SERVER_ADDRESS
) -> Path:
    """
    Generate a character portrait for a protein using ComfyUI.

    Args:
        persona: Dict with persona attributes (height, Sex, background_setting, etc)
        uniprot_id: UniProt ID for deterministic seed generation
        output_path: Where to save the generated image
        workflow_path: Path to ComfyUI workflow JSON template
        server_address: ComfyUI server address

    Returns:
        Path to the saved image file

    Raises:
        ComfyUINotAvailableError: If ComfyUI server is not running
        WorkflowExecutionError: If generation fails
    """
    # Check ComfyUI is running
    if not check_comfyui_available(server_address, verbose=True):
        raise ComfyUINotAvailableError(
            f"ComfyUI not detected at http://{server_address}. "
            "Please start ComfyUI before generating images."
        )

    # Build prompt from persona
    prompt = build_character_prompt(persona)
    seed = generate_seed_from_protein_id(uniprot_id)

    print(f"Generating image for {uniprot_id}...")
    print(f"Prompt: {prompt}")
    print(f"Seed: {seed}")

    # Load and modify workflow
    gui_workflow = load_workflow_template(workflow_path)
    api_workflow = convert_gui_workflow_to_api(gui_workflow)
    api_workflow = inject_prompt_into_workflow(api_workflow, prompt, seed, f"protein/{uniprot_id}")

    # Set up WebSocket connection
    client_id = str(uuid.uuid4())
    ws = websocket.WebSocket()
    ws.connect(f"ws://{server_address}/ws?clientId={client_id}")

    try:
        # Queue the prompt
        prompt_id = queue_prompt(api_workflow, client_id, server_address)
        print(f"Queued with prompt_id: {prompt_id}")

        # Wait for completion
        print("Waiting for generation to complete...")
        wait_for_completion(ws, prompt_id)

        # Fetch results
        print("Fetching generated image...")
        history = get_history(prompt_id, server_address)

        if prompt_id not in history:
            raise WorkflowExecutionError("Prompt ID not found in history")

        outputs = history[prompt_id].get('outputs', {})

        # Find the SaveImage node output
        image_data = None
        for node_id, node_output in outputs.items():
            if 'images' in node_output and node_output['images']:
                img_info = node_output['images'][0]
                image_data = fetch_image(
                    img_info['filename'],
                    img_info.get('subfolder', ''),
                    img_info.get('type', 'output'),
                    server_address
                )
                break

        if not image_data:
            raise WorkflowExecutionError("No image found in outputs")

        # Save image
        output_path.parent.mkdir(parents=True, exist_ok=True)
        with open(output_path, 'wb') as f:
            f.write(image_data)

        print(f"Saved image to {output_path}")
        return output_path

    finally:
        ws.close()
