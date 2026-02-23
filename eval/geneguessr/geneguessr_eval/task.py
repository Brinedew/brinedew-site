"""GeneGuessr Inspect eval -- task definition with tools, solver, and scorer.

Run with:
    inspect eval geneguessr_eval/task.py --model openai/gpt-4o

Environment variables:
    GENEGUESSR_BENCH_API_KEY  -- required, the benchmark API key
    GENEGUESSR_BENCH_URL      -- optional, override base URL
"""

from __future__ import annotations

import base64
import json
import os
from typing import Any

import httpx
from inspect_ai import Task, task
from inspect_ai.agent import react
from inspect_ai.scorer import (
    Score,
    Target,
    accuracy,
    mean,
    scorer,
    stderr,
)
from inspect_ai.solver import TaskState, solver, system_message
from inspect_ai.tool import ToolError, tool
from inspect_ai.util import store_as
from pydantic import Field

from geneguessr_eval.dataset import make_dataset, make_random_dataset
from geneguessr_eval.prompts import SYSTEM_PROMPT

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------

DEFAULT_BASE_URL = "https://geneguessr-bench.brinedew.bio"


def _get_config() -> tuple[str, str]:
    """Return (base_url, api_key) from environment."""
    api_key = os.environ.get("GENEGUESSR_BENCH_API_KEY", "")
    if not api_key:
        raise RuntimeError(
            "GENEGUESSR_BENCH_API_KEY environment variable is required. "
            "Set it to your benchmark API key."
        )
    base_url = os.environ.get("GENEGUESSR_BENCH_URL", DEFAULT_BASE_URL).rstrip("/")
    return base_url, api_key


# ---------------------------------------------------------------------------
# HTTP client (shared per eval, async + connection pooling)
# ---------------------------------------------------------------------------

_client: httpx.AsyncClient | None = None


def _get_client() -> httpx.AsyncClient:
    global _client
    if _client is None or _client.is_closed:
        _client = httpx.AsyncClient(timeout=30.0)
    return _client


async def _api_request(
    method: str,
    path: str,
    body: dict | None = None,
) -> dict[str, Any]:
    """Make an authenticated request to the benchmark API."""
    base_url, api_key = _get_config()
    client = _get_client()

    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
    }

    url = f"{base_url}{path}"

    if method == "GET":
        resp = await client.get(url, headers=headers)
    else:
        resp = await client.post(url, headers=headers, json=body or {})

    if resp.status_code >= 400:
        try:
            err = resp.json()
            msg = err.get("error", resp.text)
        except Exception:
            msg = resp.text
        raise ToolError(f"API error ({resp.status_code}): {msg}")

    return resp.json()


# ---------------------------------------------------------------------------
# Playwright browser (shared per eval run for structure screenshots)
# ---------------------------------------------------------------------------

_playwright_instance: Any = None
_browser_context: Any = None


async def _get_browser_context():
    """Launch Playwright browser with WebGL support (reused across tool calls)."""
    global _playwright_instance, _browser_context
    if _browser_context is not None:
        return _browser_context

    from playwright.async_api import async_playwright

    _playwright_instance = await async_playwright().start()
    browser = await _playwright_instance.chromium.launch(
        headless=False,
        args=[
            "--use-angle=swiftshader",
            "--use-gl=angle",
            "--enable-unsafe-swiftshader",
        ],
    )
    _browser_context = await browser.new_context(
        viewport={"width": 800, "height": 600},
    )
    return _browser_context


# ---------------------------------------------------------------------------
# Session state -- persisted in the Inspect sample store
# ---------------------------------------------------------------------------

from inspect_ai.util import StoreModel


class GameSession(StoreModel):
    """Tracks the active benchmark session for this sample."""

    session_id: str = ""
    started: bool = False
    finished: bool = False
    protein_id: str = ""  # only set for specified-protein games
    final_score: float = 0.0
    exact_match: bool = False
    guesses_used: int = 0
    hints_used: int = 0
    actions_taken: int = 0


async def _ensure_session(protein_id: str = "") -> str:
    """Create a benchmark session if one doesn't exist yet. Return session_id."""
    session = store_as(GameSession)

    if session.started and session.session_id:
        return session.session_id

    # Create new session
    body: dict[str, Any] = {}
    if protein_id and protein_id != "RANDOM":
        body["protein_id"] = protein_id

    data = await _api_request("POST", "/sessions", body)
    session.session_id = data["session_id"]
    session.started = True
    session.protein_id = protein_id
    return session.session_id


# ---------------------------------------------------------------------------
# Tools -- these are what the agent actually calls
# ---------------------------------------------------------------------------


@tool
def search_proteins():
    """Search the protein database."""

    async def execute(query: str) -> str:
        """Search ~20,000 human proteins by gene name, protein name, or keyword.

        Returns up to 10 matching proteins.

        Args:
            query: Search query -- gene symbol (e.g. "BRCA1"), protein name
                (e.g. "insulin"), or keyword (e.g. "kinase"). Minimum 2 characters.

        Returns:
            Search results with gene symbol and full name for each match.
        """
        session_id = await _ensure_session(
            store_as(GameSession).protein_id
        )

        data = await _api_request("POST", "/actions", {
            "session_id": session_id,
            "action": "search",
            "payload": {"query": query},
        })

        store_as(GameSession).actions_taken += 1

        result = data.get("result", {})
        if "error" in result:
            return f"Search error: {result['error']}"

        results = result.get("results", [])
        if not results:
            return f"No proteins found for '{query}'."

        lines = [f"Found {len(results)} result(s) for '{query}':"]
        for r in results:
            gene = r.get('gene', '?')
            name = r.get('full_name', '?')
            lines.append(f"  - {gene} -- {name}")

        remaining = data.get("remaining_actions", "?")
        lines.append(f"\n({remaining} actions remaining)")
        return "\n".join(lines)

    return execute


@tool
def guess_protein():
    """Submit a protein guess."""

    async def execute(gene_name: str) -> str | list:
        """Guess which protein is the target by gene symbol.

        You get back a similarity score, full protein info for your guess
        (the same feedback card a human player sees), and a 3D structure
        collage of the guessed protein so you can visually compare it to
        the target.

        Args:
            gene_name: Gene symbol of your guess (e.g. "TP53", "BRCA1").
                Use search_proteins() to find gene names.

        Returns:
            Whether the guess was correct, similarity score, full protein
            sections for the guessed protein, matching properties, and a
            6-view 3D structure image of the guess.
        """
        from inspect_ai.model import ContentImage, ContentText

        session_id = await _ensure_session(
            store_as(GameSession).protein_id
        )

        data = await _api_request("POST", "/actions", {
            "session_id": session_id,
            "action": "guess",
            "payload": {"gene": gene_name},
        })

        game_session = store_as(GameSession)
        game_session.actions_taken += 1

        result = data.get("result", {})
        if "error" in result:
            return f"Guess error: {result['error']}"

        correct = result.get("correct", False)
        guess_info = result.get("guess", {})
        score_info = result.get("score", {})
        game_state = result.get("game_state", {})
        matched_hints = result.get("matched_hints", [])
        guess_sections = result.get("guess_sections", [])

        lines = []
        if correct:
            target = result.get("target", {})
            lines.append(f"CORRECT! The target protein is {target.get('gene', '?')}.")
            lines.append(f"Full name: {target.get('full_name', '?')}")
            game_session.exact_match = True
            game_session.finished = True
        else:
            lines.append(f"INCORRECT. You guessed {guess_info.get('gene', '?')}.")
            lines.append(f"Full name: {guess_info.get('full_name', '?')}")
            lines.append(f"Similarity to target: {score_info.get('similarity', 0):.1f}%")

            if score_info.get("isLadder"):
                lines.append(f"  Ladder hit (rank {score_info.get('ladderRank', '?')}) -- immediate neighborhood!")

            # Show full protein sections with per-item match highlighting
            # (mirrors what the human sees in their feedback card)
            if guess_sections:
                lines.append("")
                lines.append("=== Guessed protein details ===")
                lines.append("(Items marked ** MATCH ** share a property with the target)")

                # Build a set of matching texts per section for inline highlighting.
                # matched_hints covers domains, GO terms, pathways, etc. (text-based).
                # score_info flags cover tissue, properties, length (boolean-based).
                match_sets: dict[str, set[str]] = {}
                if isinstance(matched_hints, dict):
                    for sec_id, texts in matched_hints.items():
                        if isinstance(texts, list):
                            match_sets[sec_id] = {t.lower().strip() for t in texts}
                        elif isinstance(texts, str):
                            match_sets[sec_id] = {texts.lower().strip()}

                # Boolean flag matches: mark every item in the section
                if score_info.get("tissueMatch"):
                    match_sets.setdefault("tissue", set()).add("*")
                if score_info.get("lengthBinMatch"):
                    match_sets.setdefault("length", set()).add("*")
                # Properties section: index 0 = TM, index 1 = secreted
                prop_match = {}
                if score_info.get("tmMatch"):
                    prop_match[0] = True
                if score_info.get("secretedMatch"):
                    prop_match[1] = True

                for section in guess_sections:
                    label = section.get("label", "")
                    section_id = section.get("id", "")
                    items = section.get("items", [])
                    if not items:
                        continue
                    if section_id == "summary":
                        continue
                    if label:
                        lines.append(f"\n  {label}:")

                    sec_matches = match_sets.get(section_id, set())
                    for idx, item in enumerate(items):
                        text = item.get("text", "")
                        if not text:
                            continue
                        # Determine if this specific item matches the target
                        is_match = False
                        if section_id == "properties":
                            is_match = prop_match.get(idx, False)
                        elif "*" in sec_matches:
                            # Wildcard: whole section matches (tissue, length)
                            is_match = True
                        elif text.lower().strip() in sec_matches:
                            is_match = True

                        if is_match:
                            lines.append(f"    - {text}  ** MATCH **")
                        else:
                            lines.append(f"    - {text}")

        lines.append(f"\nGuesses used: {game_state.get('guesses_used', '?')}/{game_state.get('guesses_used', 0) + game_state.get('guesses_remaining', 0)}")
        lines.append(f"Hint credits: {game_state.get('hint_credits', '?')}")
        lines.append(f"Hints revealed: {game_state.get('hints_revealed', 0)}")

        remaining = data.get("remaining_actions", "?")
        lines.append(f"({remaining} actions remaining)")

        if data.get("game_over"):
            lines.append("\n** Game over **")
            game_session.finished = True

        game_session.guesses_used = game_state.get("guesses_used", 0)
        game_session.hints_used = game_state.get("hints_revealed", 0)

        text_output = "\n".join(lines)

        # Render 3D structure of the guessed protein (same as human feedback card)
        guess_uniprot = guess_info.get("uniprot", "")
        if not correct and guess_uniprot:
            try:
                structure_image = await _render_structure_collage(guess_uniprot)
                if structure_image:
                    return [
                        ContentText(text=text_output),
                        ContentText(
                            text=(
                                f"3D structure of your guess ({guess_info.get('gene', '?')}) "
                                "shown below for visual comparison with the target."
                            )
                        ),
                        ContentImage(image=f"data:image/png;base64,{structure_image}"),
                    ]
            except Exception:
                pass  # Fall through to text-only output

        return text_output

    return execute


async def _render_structure_collage(protein_id: str) -> str | None:
    """Render a 6-view structure collage for any protein. Returns base64 PNG or None."""
    render_base = os.environ.get(
        "GENEGUESSR_RENDER_URL",
        "https://geneguessr.brinedew.bio/apps/geneguessr/render",
    )
    render_url = f"{render_base}?protein_id={protein_id}&mode=structure"

    try:
        ctx = await _get_browser_context()
    except Exception:
        return None

    page = await ctx.new_page()
    try:
        await page.goto(render_url, wait_until="domcontentloaded")
        await page.wait_for_selector("body[data-loaded]", timeout=60000)

        loaded = await page.get_attribute("body", "data-loaded")
        if loaded != "true":
            return None

        try:
            await page.wait_for_function("window.viewReady === true", timeout=10000)
        except Exception:
            pass

        views = ["front", "back", "left", "right", "top", "bottom"]
        screenshots: list[tuple[str, bytes]] = []

        for view_name in views:
            try:
                await page.evaluate(f'window.setCameraView("{view_name}")')
            except Exception:
                pass
            png = await page.screenshot(type="png")
            screenshots.append((view_name, png))

        from PIL import Image, ImageDraw, ImageFont
        import io

        cell_w, cell_h = 800, 600
        collage = Image.new("RGB", (cell_w * 3, cell_h * 2), (0, 0, 0))
        draw = ImageDraw.Draw(collage)

        try:
            font = ImageFont.truetype("arial.ttf", 28)
        except Exception:
            try:
                font = ImageFont.truetype(
                    "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", 28
                )
            except Exception:
                font = ImageFont.load_default()

        for i, (label, png_bytes) in enumerate(screenshots):
            col, row = i % 3, i // 3
            img = Image.open(io.BytesIO(png_bytes))
            collage.paste(img, (col * cell_w, row * cell_h))
            lx, ly = col * cell_w + 10, row * cell_h + 8
            bbox = draw.textbbox((lx, ly), label.upper(), font=font)
            draw.rectangle(
                [bbox[0] - 4, bbox[1] - 2, bbox[2] + 4, bbox[3] + 2],
                fill=(0, 0, 0),
            )
            draw.text((lx, ly), label.upper(), fill=(255, 255, 255), font=font)

        buf = io.BytesIO()
        collage.save(buf, format="PNG", optimize=True)
        return base64.b64encode(buf.getvalue()).decode()
    except Exception:
        return None
    finally:
        await page.close()


@tool
def reveal_hint():
    """Reveal a hidden clue section."""

    async def execute(hint_id: str) -> str:
        """Spend a hint credit to unmask a hidden clue section about the target protein.

        You start with 1 hint credit and earn 1 more each time you guess wrong.
        Each reveal costs 1 credit.

        Common hint IDs: "function_summary", "subcellular_location",
        "tissue_expression", "disease_associations", "protein_interactions".
        Use get_current_clues() to see all available hint IDs.

        Args:
            hint_id: The ID of the clue section to reveal (e.g. "function_summary").

        Returns:
            The revealed clue text, or an error if you don't have enough credits
            or the hint ID is invalid.
        """
        session_id = await _ensure_session(
            store_as(GameSession).protein_id
        )

        data = await _api_request("POST", "/actions", {
            "session_id": session_id,
            "action": "reveal_hint",
            "payload": {"hint_id": hint_id},
        })

        game_session = store_as(GameSession)
        game_session.actions_taken += 1

        result = data.get("result", {})
        if "error" in result:
            msg = result["error"]
            if "available_hint_ids" in result:
                msg += f"\nAvailable hint IDs: {', '.join(result['available_hint_ids'])}"
            if "message" in result:
                msg += f"\n{result['message']}"
            return f"Hint error: {msg}"

        if result.get("locked"):
            return f"Hint '{hint_id}' is locked -- it would reveal the answer directly."

        text = result.get("text", "(no text)")
        remaining_credits = result.get("hint_credits_remaining", "?")
        total_hints = result.get("hints_revealed", "?")

        game_session.hints_used = result.get("hints_revealed", 0)

        remaining = data.get("remaining_actions", "?")
        return (
            f"Revealed '{hint_id}':\n{text}\n\n"
            f"(Hint credits remaining: {remaining_credits}, "
            f"total hints revealed: {total_hints}, "
            f"{remaining} actions remaining)"
        )

    return execute


@tool
def get_current_clues():
    """View all clue sections and their masked/revealed state."""

    async def execute() -> str:
        """Get the current state of all clue sections for the mystery protein.

        Shows which sections are visible (with their text) and which are still
        masked. Masked sections show their hint_id so you can reveal them.

        Returns:
            All clue sections with their current state.
        """
        session_id = await _ensure_session(
            store_as(GameSession).protein_id
        )

        data = await _api_request("POST", "/actions", {
            "session_id": session_id,
            "action": "get_clues",
            "payload": {},
        })

        store_as(GameSession).actions_taken += 1

        result = data.get("result", {})
        if "error" in result:
            return f"Error: {result['error']}"

        clues = result.get("clues", [])
        game_info = (
            f"Guesses: {result.get('guesses_used', '?')}/{result.get('guesses_used', 0) + result.get('guesses_remaining', 0)} | "
            f"Hint credits: {result.get('hint_credits', '?')} | "
            f"Hints revealed: {result.get('hints_revealed', 0)}"
        )

        lines = [game_info, "=" * 60]

        for section in clues:
            title = section.get("title", "Unknown Section")
            lines.append(f"\n## {title}")

            items = section.get("items", [])
            for item in items:
                item_id = item.get("id", "")
                masked = item.get("masked", False)
                label = item.get("label", "")
                text = item.get("text", "")

                if masked:
                    lines.append(f"  [{label}] -- MASKED (hint_id: \"{item_id}\")")
                else:
                    display_text = text if text else "(empty)"
                    lines.append(f"  [{label}]: {display_text}")

        remaining = data.get("remaining_actions", "?")
        lines.append(f"\n({remaining} actions remaining)")
        return "\n".join(lines)

    return execute


@tool
def view_structure():
    """View the mystery protein's 3D structure from six angles."""

    async def execute() -> list:
        """View the 3D structure of the mystery protein as a 6-view collage.

        Shows the protein from front, back, left, right, top, and bottom.
        Multi-chain structures have colored labels; the target chain shows "Target".
        This is the same 3D view a human player sees when playing GeneGuessr.

        Returns:
            A labeled 6-view collage image of the protein structure.
        """
        from inspect_ai.model import ContentImage, ContentText

        session = store_as(GameSession)
        protein_id = session.protein_id

        if not protein_id:
            return "Structure viewing requires a specified protein (not random mode)."

        image_b64 = await _render_structure_collage(protein_id)
        if not image_b64:
            return "Structure failed to render (timeout or Mol* error)."

        return [
            ContentText(
                text=(
                    "6-view 3D structure of the mystery protein "
                    "(front, back, left, right, top, bottom). "
                    "Colored labels mark protein chains; "
                    "'Target' = the mystery protein's chains."
                )
            ),
            ContentImage(image=f"data:image/png;base64,{image_b64}"),
        ]

    return execute


# ---------------------------------------------------------------------------
# Scorer
# ---------------------------------------------------------------------------


@scorer(
    metrics={
        "max_similarity": [mean(), stderr()],
        "exact_match": [mean(), stderr()],
    }
)
def geneguessr_scorer():
    """Score a GeneGuessr game by ending the session and reading final results."""

    async def score(state: TaskState, target: Target) -> Score:
        session = store_as(GameSession)

        if not session.started or not session.session_id:
            # Agent never started a game
            return Score(
                value={"max_similarity": 0.0, "exact_match": 0.0},
                answer="No game started",
                explanation="The agent never initiated a benchmark session.",
            )

        # End the session to get final score
        try:
            data = await _api_request(
                "POST", f"/sessions/{session.session_id}/end"
            )
        except ToolError:
            # Session may already be ended (won/expired/completed)
            try:
                data = await _api_request(
                    "GET", f"/sessions/{session.session_id}"
                )
                data = data.get("session", data)
            except ToolError as e:
                return Score(
                    value={"max_similarity": 0.0, "exact_match": 0.0},
                    answer="Session error",
                    explanation=f"Could not retrieve session: {e}",
                )

        final_score = data.get("final_score", 0.0)
        exact = 1.0 if data.get("exact_match") else 0.0
        guesses_used = data.get("guesses_used", session.guesses_used)
        hints_used = data.get("hints_used", session.hints_used)
        target_protein = data.get("target", {})

        answer_text = (
            f"Score: {final_score:.3f} | "
            f"Exact: {'yes' if exact else 'no'} | "
            f"Guesses: {guesses_used} | "
            f"Hints: {hints_used}"
        )

        explanation = (
            f"Target protein: {target_protein.get('gene', '?')} "
            f"({target_protein.get('uniprot', '?')})\n"
            f"Max similarity achieved: {final_score * 100:.1f}%\n"
            f"Exact match: {'yes' if exact else 'no'}\n"
            f"Guesses used: {guesses_used}\n"
            f"Hints revealed: {hints_used}\n"
            f"Total actions: {session.actions_taken}"
        )

        return Score(
            value={"max_similarity": final_score, "exact_match": exact},
            answer=answer_text,
            explanation=explanation,
            metadata={
                "session_id": session.session_id,
                "guesses_used": guesses_used,
                "hints_used": hints_used,
                "actions_taken": session.actions_taken,
                "target_gene": target_protein.get("gene"),
                "target_uniprot": target_protein.get("uniprot"),
            },
        )

    return score


# ---------------------------------------------------------------------------
# Setup solver -- creates the benchmark session before the agent runs
# ---------------------------------------------------------------------------


@solver
def setup_game():
    """Create the benchmark session before handing off to the agent.

    Reads protein_id from sample metadata (if specified), creates the session,
    and prepends the initial clues to the conversation.
    """

    async def solve(state: TaskState, generate) -> TaskState:
        metadata = state.metadata or {}
        protein_id = metadata.get("protein_id", "")
        mode = metadata.get("mode", "random")

        # Store protein_id in game session for tools to use
        session = store_as(GameSession)
        session.protein_id = protein_id if mode != "random" else ""

        # Create session and get initial clues
        body: dict[str, Any] = {}
        if protein_id and protein_id != "RANDOM":
            body["protein_id"] = protein_id

        data = await _api_request("POST", "/sessions", body)
        session.session_id = data["session_id"]
        session.started = True

        # Format initial clues into a user-friendly message
        clues = data.get("clues", [])
        clue_lines = ["Here are your initial clues about the mystery protein:", "=" * 60]

        for section in clues:
            title = section.get("title", "Unknown")
            clue_lines.append(f"\n## {title}")
            for item in section.get("items", []):
                item_id = item.get("id", "")
                masked = item.get("masked", False)
                label = item.get("label", "")
                text = item.get("text", "")
                if masked:
                    clue_lines.append(f'  [{label}] -- MASKED (hint_id: "{item_id}")')
                else:
                    display = text if text else "(empty)"
                    clue_lines.append(f"  [{label}]: {display}")

        clue_lines.append(f"\nYou have {data.get('max_guesses', 10)} guesses, "
                          f"{data.get('max_actions', 50)} total actions, "
                          f"and {data.get('hint_credits', 1)} hint credit(s).")
        clue_lines.append("Available actions: search, guess, reveal_hint, get_clues")

        clue_text = "\n".join(clue_lines)

        # Prepend the clues as a user message
        from inspect_ai.model import ChatMessageUser
        state.messages.append(ChatMessageUser(content=clue_text))

        return state

    return solve


# ---------------------------------------------------------------------------
# Task definitions
# ---------------------------------------------------------------------------


@task
def geneguessr(
    n_samples: int | None = None,
    protein_ids: str | None = None,
    random_mode: bool = False,
    message_limit: int = 80,
    token_limit: int = 500_000,
):
    """GeneGuessr protein identification eval.

    Args:
        n_samples: Number of proteins to test (default: all 15 curated).
        protein_ids: Comma-separated UniProt IDs for specific proteins.
        random_mode: Use random protein selection instead of curated set.
        message_limit: Max messages in agent conversation.
        token_limit: Max tokens for agent.
    """
    # Build dataset
    if protein_ids:
        id_list = [p.strip() for p in protein_ids.split(",") if p.strip()]
        dataset = make_dataset(protein_ids=id_list)
    elif random_mode:
        dataset = make_random_dataset(n_samples or 10)
    else:
        dataset = make_dataset(n_samples=n_samples)

    return Task(
        dataset=dataset,
        setup=setup_game(),
        solver=react(
            name="geneguessr_agent",
            description="Protein identification game agent",
            prompt=SYSTEM_PROMPT,
            tools=[
                view_structure(),
                search_proteins(),
                guess_protein(),
                reveal_hint(),
                get_current_clues(),
            ],
        ),
        scorer=geneguessr_scorer(),
        message_limit=message_limit,
        token_limit=token_limit,
    )
