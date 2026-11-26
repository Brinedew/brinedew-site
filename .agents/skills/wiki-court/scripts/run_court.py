"""Standardized Wiki Promotion Court workflow (`run_workflow`).

Hybrid External-Counsel / Local-Judge architecture:
- Phase 1 (`mode="prepare"`): deterministically builds the graph dossier,
  self-contained neighborhood & standards digests, headless Quartz render
  preflight, and ready-to-paste external AI Studio prompts for Advocate
  (Trade-Off Defense Counsel) and Alex (Devil's Advocate).
- Phase 2 (external, deterministic Playwright): run both saved prompts in parallel
  across two isolated Google AI Studio tabs via `run_aistudio_court.mjs`
  (`https://aistudio.google.com/prompts/new_chat`, Gemini 4 Neon, Extra High thinking
  with per-tab High fallback on timeout, Code Execution ON, Grounding with Google
  Search ON, URL Context ON), saving verbatim Markdown outputs to:
    - `.quartz-cache/wiki-court/<slug>/advocate_brief.md`
    - `.quartz-cache/wiki-court/<slug>/alex_review.md`
- Phase 3 (`mode="judge"`): verifies both external briefs exist and runs the
  local internal Judge agent with full repo, sibling-graph, attachment, and
  rendered screenshot access to issue `VERDICT: PROMOTE` or `VERDICT: REMAND`.

Required input:
    args["article"]: Article title, filename stem, alias, or relative wiki path.
Optional inputs:
    args["mode"]: "prepare" (default) or "judge".
    args["target_class"]: Target tier ("GA" default, "A", or "FA").
"""

import hashlib
import json
import re
import subprocess
from datetime import date
from pathlib import Path


def locate_website_root() -> Path:
    candidates: list[Path] = []
    file_var = globals().get("__file__")
    if file_var:
        candidates.append(Path(file_var).resolve().parents[4])
    for ws in WORKSPACES:
        wpath = Path(ws).resolve()
        candidates.extend([wpath, wpath / "Website"])
    candidates.append(Path.cwd().resolve())
    seen: set[Path] = set()
    for root in candidates:
        if root in seen:
            continue
        seen.add(root)
        if (root / "content" / "wiki").is_dir() and (
            root / ".agents" / "skills" / "wiki-court" / "references"
        ).is_dir():
            return root
    raise FileNotFoundError(
        "Could not locate Website repository root containing content/wiki and .agents/skills/wiki-court/references."
    )


def slugify_segment(text: str) -> str:
    cleaned = re.sub(r"[^\w\s-]", "", text.strip().lower())
    return re.sub(r"[\s_]+", "-", cleaned).strip("-")


def parse_frontmatter(raw: str) -> tuple[dict, str]:
    match = re.match(r"^---\r?\n([\s\S]*?)\r?\n---\r?\n?", raw)
    if not match:
        return {}, raw
    fm_block = match.group(1)
    body = raw[match.end() :]
    meta: dict = {}
    current_key: str | None = None
    for line in fm_block.splitlines():
        if re.match(r"^\s*-\s+", line) and current_key:
            item = re.sub(r"^\s*-\s+", "", line).strip().strip("'\"")
            existing = meta.get(current_key)
            if isinstance(existing, list):
                existing.append(item)
            else:
                meta[current_key] = [item]
            continue
        kv = re.match(r"^([A-Za-z0-9_-]+)\s*:\s*(.*)$", line)
        if not kv:
            continue
        key, val = kv.group(1), kv.group(2).strip()
        current_key = key
        if val.startswith("[") and val.endswith("]"):
            inner = val[1:-1].strip()
            meta[key] = (
                [p.strip().strip("'\"") for p in inner.split(",") if p.strip()]
                if inner
                else []
            )
        elif val == "":
            meta[key] = []
        else:
            meta[key] = val.strip("'\"")
    return meta, body


def strip_markdown_code(text: str) -> str:
    return re.sub(r"```[\s\S]*?```", " ", text)


def extract_lead_snippet(body: str, max_chars: int = 340) -> str:
    clean = strip_markdown_code(body)
    lines = clean.splitlines()
    lead_lines: list[str] = []
    for line in lines:
        s = line.strip()
        if not s:
            if lead_lines:
                break
            continue
        if s.startswith("## "):
            break
        if s.startswith("# ") or s.startswith("![[") or s.startswith(">"):
            continue
        if re.match(r"^\*(?!\*)(?:For |Part of |Main article:|Further information:)", s, re.I):
            continue
        lead_lines.append(s)
    snippet = " ".join(lead_lines)
    snippet = re.sub(r"\[\^[^\]]+\]", "", snippet)
    snippet = re.sub(r"\[\[(?:[^\]|]+\|)?([^\]]+)\]\]", r"\1", snippet)
    snippet = re.sub(r"\s+", " ", snippet).strip()
    if len(snippet) > max_chars:
        snippet = snippet[: max_chars - 1].rsplit(" ", 1)[0] + "…"
    return snippet or "(no lead text)"


def extract_links_and_assets(body: str) -> tuple[list[str], list[str], list[str]]:
    clean_body = strip_markdown_code(body)
    attachments = sorted(
        {m.group(1).split("|")[0].strip() for m in re.finditer(r"!\[\[([^\]]+)\]\]", clean_body)}
    )
    wikilinks = sorted(
        {
            m.group(1).split("|")[0].split("#")[0].strip()
            for m in re.finditer(r"(?<!!)\[\[([^\]]+)\]\]", clean_body)
            if m.group(1).split("|")[0].split("#")[0].strip()
        }
    )
    footnotes = sorted({m.group(1) for m in re.finditer(r"^\[\^([^\]]+)\]:", body, re.MULTILINE)})
    return wikilinks, attachments, footnotes


def build_wiki_index(wiki_dir: Path) -> list[dict]:
    records = []
    for path in sorted(wiki_dir.glob("*.md")):
        raw = path.read_text(encoding="utf-8", errors="replace")
        meta, body = parse_frontmatter(raw)
        title = str(meta.get("title") or path.stem)
        aliases = meta.get("aliases") if isinstance(meta.get("aliases"), list) else []
        keys = {
            path.stem.lower(),
            slugify_segment(path.stem),
            title.lower(),
            slugify_segment(title),
        }
        for alias in aliases:
            keys.add(str(alias).lower())
            keys.add(slugify_segment(str(alias)))
        records.append(
            {
                "path": path,
                "stem": path.stem,
                "slug": slugify_segment(path.stem),
                "title": title,
                "aliases": [str(a) for a in aliases],
                "class": str(meta.get("class") or "unknown"),
                "vital_level": str(meta.get("vital_level") or "unset"),
                "keys": {k for k in keys if k},
                "raw": raw,
                "body": body,
                "lead": extract_lead_snippet(body),
            }
        )
    return records


def resolve_article(records: list[dict], query: str) -> dict:
    q_clean = query.strip()
    if q_clean.lower().endswith(".md"):
        q_clean = Path(q_clean).stem
    q_norm = q_clean.lower()
    q_slug = slugify_segment(q_clean)
    exact = [r for r in records if r["stem"].lower() == q_norm or r["slug"] == q_slug]
    if len(exact) == 1:
        return exact[0]
    alias_hits = [r for r in records if q_norm in r["keys"] or q_slug in r["keys"]]
    if len(alias_hits) == 1:
        return alias_hits[0]
    if not alias_hits:
        raise FileNotFoundError(f"No wiki article matched '{query}' under content/wiki.")
    names = ", ".join(str(r["path"].name) for r in alias_hits[:5])
    raise ValueError(f"Ambiguous article query '{query}'; matched: {names}")


def assemble_dossiers(
    target: dict, records: list[dict], website_root: Path
) -> tuple[str, str]:
    by_key: dict[str, list[dict]] = {}
    for rec in records:
        for key in rec["keys"]:
            by_key.setdefault(key, []).append(rec)

    outlinks, attachments, footnotes = extract_links_and_assets(target["body"])
    resolved_neighbors: list[str] = []
    neighbor_digest_out: list[str] = []
    broken_links: list[str] = []
    linked_stems: set[str] = {target["stem"].lower()}
    seen_out_stems: set[str] = set()

    for link in outlinks:
        candidates = by_key.get(link.lower()) or by_key.get(slugify_segment(link)) or []
        if candidates:
            neighbor = candidates[0]
            linked_stems.add(neighbor["stem"].lower())
            resolved_neighbors.append(
                f"- `[[{link}]]` -> `{neighbor['path']}` (class: `{neighbor['class']}`)"
            )
            if neighbor["stem"].lower() not in seen_out_stems:
                seen_out_stems.add(neighbor["stem"].lower())
                neighbor_digest_out.append(
                    f"- **{neighbor['title']}** (`class: {neighbor['class']}`, `VL{neighbor['vital_level']}`): {neighbor['lead']}"
                )
        else:
            broken_links.append(f"- BROKEN/UNRESOLVED: `[[{link}]]`")

    target_pat = re.compile(
        r"\[\[("
        + "|".join(re.escape(k) for k in sorted(target["keys"], key=len, reverse=True))
        + r")(?:[#|][^\]]*)?\]\]",
        re.IGNORECASE,
    )
    backlinks: list[str] = []
    neighbor_digest_in: list[str] = []
    for rec in records:
        if rec["path"] == target["path"]:
            continue
        if target_pat.search(rec["raw"]):
            backlinks.append(f"- `{rec['path']}` (class: `{rec['class']}`)")
            if rec["stem"].lower() not in seen_out_stems:
                neighbor_digest_in.append(
                    f"- **{rec['title']}** (`class: {rec['class']}`, `VL{rec['vital_level']}`): {rec['lead']}"
                )

    body_lower = strip_markdown_code(target["body"]).lower()
    unlinked_candidates: list[str] = []
    unlinked_digest: list[str] = []
    for rec in records:
        if rec["stem"].lower() in linked_stems:
            continue
        terms = [rec["title"]] + rec["aliases"]
        for term in terms:
            t_clean = term.strip()
            if len(t_clean) < 5:
                continue
            if re.search(rf"\b{re.escape(t_clean.lower())}\b", body_lower):
                unlinked_candidates.append(
                    f"- Unlinked match `{t_clean}` -> `{rec['path']}` (class: `{rec['class']}`)"
                )
                unlinked_digest.append(
                    f"- **{rec['title']}** (matched `{t_clean}`, `class: {rec['class']}`): {rec['lead']}"
                )
                break

    att_dir = website_root / "content" / "Attachments"
    resolved_attachments: list[str] = []
    for att in attachments:
        candidate = att_dir / att
        if not candidate.exists():
            matches = list(att_dir.glob(f"**/{Path(att).name}"))
            candidate = matches[0] if matches else candidate
        status = "EXISTS" if candidate.exists() else "MISSING"
        resolved_attachments.append(f"- `{att}` -> `{candidate}` ({status})")

    local_sections = [
        f"- **Target File:** `{target['path']}`",
        f"- **Current Class / Vital Level:** `class: {target['class']}` / `vital_level: {target['vital_level']}`",
        f"- **Footnotes Count:** `{len(footnotes)}`",
        f"- **Outbound `[[wikilinks]]` ({len(resolved_neighbors)} resolved, {len(broken_links)} broken):**",
        *(resolved_neighbors or ["- (none)"]),
        *broken_links,
        f"- **Inbound Backlinks ({len(backlinks)} files link here):**",
        *(backlinks or ["- (none — check reciprocal linking!)"]),
        f"- **Unlinked Existing Wiki Terms Appearing in Prose ({len(unlinked_candidates[:20])} shown):**",
        *(unlinked_candidates[:20] or ["- (none detected)"]),
        f"- **Embedded Attachments ({len(resolved_attachments)}):**",
        *(resolved_attachments or ["- (none)"]),
    ]

    external_sections = [
        f"- **Candidate:** `{target['title']}` (`class: {target['class']}`, `vital_level: {target['vital_level']}`, `{len(footnotes)}` footnotes, `{len(resolved_attachments)}` embedded attachments)",
        f"- **Broken outbound links detected:** `{len(broken_links)}`"
        + (f" ({', '.join(broken_links)})" if broken_links else ""),
        f"\n### Outbound Linked Neighbors ({len(neighbor_digest_out[:25])} shown)",
        *(neighbor_digest_out[:25] or ["- (none)"]),
        f"\n### Additional Inbound Backlink Neighbors ({len(neighbor_digest_in[:15])} shown)",
        *(neighbor_digest_in[:15] or ["- (none beyond outbound neighbors)"]),
        f"\n### Unlinked Existing Wiki Pages Mentioned in Prose ({len(unlinked_digest[:12])} shown)",
        *(unlinked_digest[:12] or ["- (none detected)"]),
    ]

    return "\n".join(local_sections), "\n".join(external_sections)


def build_standards_digest(target_class: str) -> str:
    is_featured_list = target_class.upper() == "FL"
    lines = [
        f"- **Target tier:** `class: {target_class}` (Court-gated promotion; promotes ONLY if the page makes the whole wiki stronger).",
    ]
    if is_featured_list:
        lines.append(
            "- **Featured List (`FL`) format & craft:** This is a **structured reference artifact** (glossary, taxonomy, spectrum, conversion table, or cheatsheet)—NOT a narrative essay. A scannable primary layout (tables, structured lists, concise thought experiments, explicit classification/inclusion criteria) is EXPECTED and PREFERRED over padded prose. Judge rigorously on conceptual airtightness, crystal-clear criteria, primary-source verification on every entry, edge-case robustness, and zero internal contradictions—especially when other wiki pages and Court Judges rely on it as a canonical baseline."
        )
    else:
        lines.append(
            "- **Voice & Craft (Wikipedia Featured Article standard):** Calm, concrete, authoritative third-person encyclopedic prose. Standalone 2–4 paragraph lead previewing every major section. Open body with historical/observational grounding before abstract models. Flowing 4–7 sentence paragraphs with natural burstiness; NO CYA semicolon-packed academese, NO inline `Author (Year)` clutter (keep bibliographic tags in footnotes unless priority/attribution is conceptual), NO blog-essay first-person or rhetorical Q&A headers, NO bold-lead executive bullet catalogs, NO mid-body `**bold buzzwords**`, NO didactic `therefore/thus` wrap-up morals, and NO meta-scaffolding (`Editorial synthesis`, `Wiki adjudication:`)."
        )
    lines.extend(
        [
            "- **Dual-audience clarity:** Teach both field biologists and intelligent quantitative non-biologists cleanly—build the conceptual puzzle before dropping wet-lab jargon, and motivate mathematical formulas from why simpler intuition fails.",
            "- **Level-indexed longevity terminology:** Never hide distinct biological levels under vague umbrella words (`aging`, `senescence`, `damage`, `immortality`, `rejuvenation`). Index the exact level (Gompertz slope, loss of functional reserve, somatic mutation load, replicative cell-cycle arrest, clonal selection) and watch for Level-2 (cell) vs. Level-3 (organism) fitness sign flips.",
            "- **Graph factoring & scope discipline:** Each experiment, model, or table belongs in detail on ONE canonical page; summarize and delegate covered subtopics via `[[wikilinks]]` / `*Main article:*` rather than cloning sibling pages. Earned hatnotes only (never defensive top disclaimers against unrelated topics, never `*Main article:*` pointing at thin stubs). **Neighbor article sizes are editable architectural choices, not constants of physics:** if a subtopic canonically belongs on a neighbor page that happens to be a stub today, keep this page concise and expand the neighbor rather than dumping off-scope material here.",
            "- **Draft status is independent of quality:** `draft: true/false` in YAML frontmatter is a separate publishing/visibility switch and has NOTHING to do with article quality or `GA`/`A`/`FA`/`FL` eligibility. Never penalize or flag `draft: true`.",
            "- **Source-Quality & Forensic Audit (Bik / Sholto David / Data Colada bar):** A cropped quote proves only what a paper printed, not that it is true. Actively audit pivotal studies via Google Search + Code Execution for PubPeer threads, Expressions of Concern, retractions, failed multi-site replications (e.g. NIA ITP, Phase II/III RCTs), blot/microscopy duplication, GRIM/GRIMMER/statistical anomalies, p-hacking, and longevity design traps (short-lived controls, mid-life start bias, progeroid extrapolation, promiscuous senescence markers).",
            "- **Honest conflict mapping:** Never smooth over real experimental divergence into `'all studies agree'` OR lazy `'evidence is mixed'` fence-sitting; partition why studies disagree by assay, species, dose, or methodological rigor directly inside the main narrative.",
        ]
    )
    return "\n".join(lines)


def find_prior_rulings(website_root: Path, slug: str) -> list[Path]:
    rulings_dir = website_root / ".agents" / "wiki-court-rulings" / slug
    if not rulings_dir.is_dir():
        return []
    return sorted(rulings_dir.glob("*.md"))


def update_article_court_frontmatter(
    article_path: Path,
    *,
    status: str,
    target_class: str,
    ruling_date: str,
    ruling_rel_path: str,
) -> None:
    raw = article_path.read_text(encoding="utf-8")
    newline = "\r\n" if "\r\n" in raw else "\n"
    match = re.match(r"^---\r?\n([\s\S]*?)\r?\n---(\r?\n|$)", raw)
    if not match:
        return
    fm_lines = [
        line
        for line in match.group(1).splitlines()
        if not re.match(r"^court_(?:status|target|date|ruling)\s*:", line)
    ]
    fm_lines.extend(
        [
            f"court_status: {status}",
            f"court_target: {target_class}",
            f"court_date: {ruling_date}",
            f"court_ruling: {ruling_rel_path}",
        ]
    )
    updated = (
        f"---{newline}"
        + newline.join(fm_lines)
        + f"{newline}---{match.group(2)}"
        + raw[match.end() :]
    )
    article_path.write_text(updated, encoding="utf-8")


async def run_render_preflight(slug: str, website_root: Path) -> tuple[str, Path]:
    out_dir = website_root / ".quartz-cache" / "wiki-court" / slug
    out_dir.mkdir(parents=True, exist_ok=True)
    built_html = website_root / "public" / "wiki" / f"{slug}.html"
    if not built_html.exists():
        return (
            f"Render preflight NOT run: `{built_html}` does not exist. "
            "Run `node ./quartz/bootstrap-cli.mjs build -d content` first if visuals/math/charts need verification.",
            out_dir,
        )
    verify_script = (
        website_root / ".agents" / "skills" / "wiki-court" / "scripts" / "verify_article_render.mjs"
    )
    cmd = [
        "node",
        str(verify_script),
        "--slug",
        slug,
        "--out",
        str(out_dir),
        "--public",
        str(website_root / "public"),
    ]
    try:
        proc = subprocess.run(
            cmd,
            cwd=str(website_root),
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            timeout=90,
            check=False,
        )
        report_file = out_dir / "render_report.json"
        if proc.returncode == 0 and report_file.exists():
            return (
                f"Render preflight passed cleanly. Inspect `{report_file}` and all screenshots listed inside:\n```json\n{report_file.read_text(encoding='utf-8')}\n```",
                out_dir,
            )
        err_tail = (proc.stderr or proc.stdout or "")[-2000:]
        return (
            f"Render preflight exited with code {proc.returncode}:\n```\n{err_tail}\n```",
            out_dir,
        )
    except Exception as err:
        return (
            f"Render preflight could not complete ({type(err).__name__}: {err}). "
            f"Verify `{built_html}` manually if needed.",
            out_dir,
        )


def fill_template(template_text: str, mapping: dict[str, str]) -> str:
    result = template_text
    for key, val in mapping.items():
        result = result.replace("{{" + key + "}}", val)
    return result


# === Main workflow execution ===
if not isinstance(args, dict) or not str(args.get("article") or "").strip():
    raise ValueError(
        'Args[\'article\'] is required (e.g. {"article": "Peto\'s paradox", "mode": "prepare"}).'
    )

ARTICLE_QUERY = str(args["article"]).strip()
TARGET_CLASS = str(args.get("target_class") or "GA").strip()
MODE = str(args.get("mode") or "prepare").strip().lower()
if MODE not in {"prepare", "judge", "verify"}:
    raise ValueError(f"Unsupported mode '{MODE}'. Must be 'prepare', 'judge', or 'verify'.")

phase("Assemble Dossier")
WEBSITE_ROOT = locate_website_root()
WIKI_DIR = WEBSITE_ROOT / "content" / "wiki"
REF_DIR = WEBSITE_ROOT / ".agents" / "skills" / "wiki-court" / "references"

records = build_wiki_index(WIKI_DIR)
target = resolve_article(records, ARTICLE_QUERY)
local_dossier, external_digest = assemble_dossiers(target, records, WEBSITE_ROOT)
prior_rulings = find_prior_rulings(WEBSITE_ROOT, target["slug"])
if prior_rulings:
    prior_lines = "\n".join(
        f"- `{p.relative_to(WEBSITE_ROOT).as_posix()}`" for p in prior_rulings[-5:]
    )
    local_dossier += (
        f"\n- **Prior Court Rulings on Record ({len(prior_rulings)} total — inspect latest to verify prior remand orders!):**\n"
        + prior_lines
    )
standards_digest = build_standards_digest(TARGET_CLASS)
render_summary, cache_dir = await run_render_preflight(target["slug"], WEBSITE_ROOT)
article_sha256 = hashlib.sha256(target["raw"].encode("utf-8")).hexdigest()

log(
    f"Resolved article: {target['title']} ({target['path']}), "
    f"class={target['class']} -> target={TARGET_CLASS}, mode={MODE}"
)

base_vars = {
    "ARTICLE_NAME": target["title"],
    "ARTICLE_PATH": str(target["path"]),
    "CURRENT_CLASS": target["class"],
    "VITAL_LEVEL": target["vital_level"],
    "TARGET_CLASS": TARGET_CLASS,
    "GRAPH_DOSSIER": local_dossier,
    "GRAPH_NEIGHBORHOOD_DIGEST": external_digest,
    "STANDARDS_DIGEST": standards_digest,
    "ARTICLE_MARKDOWN": target["raw"],
    "RENDER_SUMMARY": render_summary,
}

advocate_prompt_file = cache_dir / "advocate_prompt_ready.md"
alex_prompt_file = cache_dir / "alex_prompt_ready.md"
advocate_brief_file = cache_dir / "advocate_brief.md"
alex_review_file = cache_dir / "alex_review.md"
judge_ruling_file = cache_dir / "judge_ruling.md"
manifest_file = cache_dir / "manifest.json"

if MODE == "prepare":
    phase("Build External AI Studio Packets")
    advocate_template = (REF_DIR / "advocate_prompt.md").read_text(encoding="utf-8")
    devil_template = (REF_DIR / "devils_advocate_prompt.md").read_text(encoding="utf-8")

    advocate_ready = fill_template(advocate_template, base_vars)
    alex_ready = fill_template(devil_template, base_vars)

    advocate_prompt_file.write_text(advocate_ready, encoding="utf-8")
    alex_prompt_file.write_text(alex_ready, encoding="utf-8")

    # Emit self-contained Playwright MCP `browser_run_code_unsafe` scripts
    # (Playwright MCP executes inside a sandboxed VM without fs/require/import).
    mcp_template_path = (
        WEBSITE_ROOT / ".agents" / "skills" / "wiki-court" / "scripts" / "aistudio_mcp_template.js"
    )
    mcp_ws_dir = WEBSITE_ROOT.parent / ".playwright-mcp" / "workspace" / "wiki-court" / target["slug"]
    mcp_ws_dir.mkdir(parents=True, exist_ok=True)
    aistudio_start_file = mcp_ws_dir / "aistudio_start.js"
    aistudio_poll_file = mcp_ws_dir / "aistudio_poll.js"
    if mcp_template_path.exists():
        mcp_tpl = mcp_template_path.read_text(encoding="utf-8").lstrip("; \r\n")
        start_cfg = {
            "action": "start",
            "slug": target["slug"],
            "model": "Gemini 4 Neon",
            "thinking": "Extra High",
            "fallbackThinking": "High",
            "advocatePrompt": advocate_ready,
            "alexPrompt": alex_ready,
        }
        poll_cfg = {
            "action": "poll",
            "slug": target["slug"],
            "waitSeconds": 45,
            "extraHighRiskMin": 11,
            "stallMin": 5,
            "timeoutMin": 18,
        }
        aistudio_start_file.write_text(
            mcp_tpl.replace("__WIKI_COURT_CONFIG__", json.dumps(start_cfg, ensure_ascii=False)),
            encoding="utf-8",
        )
        aistudio_poll_file.write_text(
            mcp_tpl.replace("__WIKI_COURT_CONFIG__", json.dumps(poll_cfg, ensure_ascii=False)),
            encoding="utf-8",
        )

    # Remove stale judge ruling so a new review cycle cannot misread an old verdict
    if judge_ruling_file.exists():
        judge_ruling_file.unlink()

    manifest = {
        "article": target["title"],
        "slug": target["slug"],
        "article_path": str(target["path"]),
        "article_sha256": article_sha256,
        "current_class": target["class"],
        "target_class": TARGET_CLASS,
        "ai_studio": {
            "url": "https://aistudio.google.com/prompts/new_chat",
            "mcp_start_script": str(aistudio_start_file),
            "mcp_poll_script": str(aistudio_poll_file),
            "model": "Gemini 4 Neon",
            "thinking_level": "Extra High",
            "fallback_thinking_level": "High",
            "google_search": True,
            "code_execution": True,
            "url_context": True,
            "parallel": True,
        },
        "advocate_prompt_file": str(advocate_prompt_file),
        "alex_prompt_file": str(alex_prompt_file),
        "expected_advocate_brief_file": str(advocate_brief_file),
        "expected_alex_review_file": str(alex_review_file),
        "advocate_prompt_chars": len(advocate_ready),
        "alex_prompt_chars": len(alex_ready),
        "artifacts_dir": str(cache_dir),
    }
    manifest_file.write_text(json.dumps(manifest, indent=2, ensure_ascii=False), encoding="utf-8")
    log(
        f"Prepared self-contained AI Studio packets in {cache_dir} "
        f"(advocate={len(advocate_ready)} chars, alex={len(alex_ready)} chars)."
    )
    print(json.dumps({"status": "prepared", **manifest}, indent=2, ensure_ascii=False))
elif MODE == "verify":
    phase("Local Conditional-Accept Verification (MINOR_REVISION)")
    if not prior_rulings:
        raise FileNotFoundError(
            f"Cannot run mode='verify' for {target['title']}: no prior Court ruling found in .agents/wiki-court-rulings/{target['slug']}/."
        )
    latest_ruling_path = prior_rulings[-1]
    latest_ruling_text = latest_ruling_path.read_text(encoding="utf-8")
    verify_prompt = (
        f"You are the **Handling Judge** performing a fast local **Conditional-Accept (`MINOR_REVISION`) verification** "
        f"for `{target['title']}` (`class: {target['class']}` -> target `class: {TARGET_CLASS}`).\n\n"
        f"Do NOT restart the architectural clock or invent new scope demands. Your job is strictly twofold:\n"
        f"1. Read the updated candidate article (`{target['path']}`), relevant local sibling pages, and the fresh Quartz renders below, "
        f"and verify **each item** in the prior ruling's `Essential Revisions` checklist.\n"
        f"2. Check that the edits did not introduce any new factual, mathematical, citation, link, or rendering regressions.\n\n"
        f"## Prior Binding Ruling (`{latest_ruling_path.relative_to(WEBSITE_ROOT).as_posix()}`)\n\n"
        f"{latest_ruling_text}\n\n"
        f"## Local Graph Dossier\n{local_dossier}\n\n"
        f"## Fresh Quartz Render Preflight (inspect PNGs via `read_file`)\n{render_summary}\n\n"
        f"Write a concise verification opinion confirming each checklist item (pass/fail) and any regression check. "
        f"End with a final standalone line containing literally either:\n\n"
        f"`VERDICT: PROMOTE`\n\n"
        f"`VERDICT: MINOR_REVISION`\n\n"
        f"`VERDICT: MAJOR_REVISION`"
    )
    ruling_text = await agent(
        verify_prompt,
        schema={"type": "string"},
        role=f"Verify Judge: {target['title']}",
        type_name="research",
    )
    judge_ruling_file.write_text(ruling_text, encoding="utf-8")
    verdict_match = re.findall(
        r"^VERDICT:\s*(PROMOTE|MINOR_REVISION|MAJOR_REVISION|REMAND)\b", ruling_text, re.MULTILINE
    )
    final_verdict = verdict_match[-1] if verdict_match else "UNKNOWN"
    if final_verdict == "REMAND":
        final_verdict = "MAJOR_REVISION"

    ruling_date = date.today().isoformat()
    verdict_slug = final_verdict.lower().replace("_", "-")
    permanent_dir = WEBSITE_ROOT / ".agents" / "wiki-court-rulings" / target["slug"]
    permanent_dir.mkdir(parents=True, exist_ok=True)
    permanent_ruling_file = permanent_dir / f"{ruling_date}-{TARGET_CLASS}-{verdict_slug}.md"
    permanent_ruling_file.write_text(ruling_text, encoding="utf-8")
    ruling_rel_path = permanent_ruling_file.relative_to(WEBSITE_ROOT).as_posix()
    status_map = {
        "PROMOTE": "promoted",
        "MINOR_REVISION": "minor_revision",
        "MAJOR_REVISION": "major_revision",
    }
    court_status = status_map.get(final_verdict, "unknown")
    update_article_court_frontmatter(
        target["path"],
        status=court_status,
        target_class=TARGET_CLASS,
        ruling_date=ruling_date,
        ruling_rel_path=ruling_rel_path,
    )
    log(
        f"Verify Judge verdict for {target['title']} -> {TARGET_CLASS}: {final_verdict} "
        f"(archived to {ruling_rel_path} and stamped into frontmatter)"
    )
    print(
        json.dumps(
            {
                "status": "verified",
                "article": target["title"],
                "article_path": str(target["path"]),
                "target_class": TARGET_CLASS,
                "verdict": final_verdict,
                "court_status": court_status,
                "permanent_ruling_file": str(permanent_ruling_file),
                "court_ruling_rel": ruling_rel_path,
                "artifacts_dir": str(cache_dir),
                "judge_ruling_file": str(judge_ruling_file),
                "judge_ruling": ruling_text,
            },
            indent=2,
            ensure_ascii=False,
        )
    )
else:
    phase("Validate External AI Studio Briefs")
    missing: list[str] = []
    if not advocate_brief_file.exists() or len(advocate_brief_file.read_text(encoding="utf-8").strip()) < 300:
        missing.append(str(advocate_brief_file))
    if not alex_review_file.exists() or len(alex_review_file.read_text(encoding="utf-8").strip()) < 300:
        missing.append(str(alex_review_file))
    if missing:
        raise FileNotFoundError(
            "Cannot convene local Judge before both external Google AI Studio briefs exist and are populated (>= 300 chars). "
            f"Missing/empty: {', '.join(missing)}. Run mode='prepare', then run the Playwright MCP start/poll scripts, then re-run mode='judge'."
        )

    if manifest_file.exists():
        manifest = json.loads(manifest_file.read_text(encoding="utf-8"))
        if manifest.get("article_sha256") and manifest["article_sha256"] != article_sha256:
            log(
                "WARNING: Candidate article changed on disk after mode='prepare' was run. "
                "Re-run mode='prepare' and AI Studio counsels if substantive edits occurred."
            )

    advocate_brief = advocate_brief_file.read_text(encoding="utf-8")
    alex_review = alex_review_file.read_text(encoding="utf-8")

    phase("Local Judicial Ruling")
    judge_template = (REF_DIR / "judge_prompt.md").read_text(encoding="utf-8")
    judge_vars = {
        **base_vars,
        "ADVOCATE_BRIEF": advocate_brief,
        "DEVILS_ADVOCATE_BRIEF": alex_review,
    }
    ruling_text = await agent(
        fill_template(judge_template, judge_vars),
        schema={"type": "string"},
        role=f"Judge: {target['title']}",
        type_name="research",
    )

    judge_ruling_file.write_text(ruling_text, encoding="utf-8")
    verdict_match = re.findall(
        r"^VERDICT:\s*(PROMOTE|MINOR_REVISION|MAJOR_REVISION|REMAND)\b", ruling_text, re.MULTILINE
    )
    final_verdict = verdict_match[-1] if verdict_match else "UNKNOWN"
    if final_verdict == "REMAND":
        final_verdict = "MAJOR_REVISION"

    # Persist git-tracked ruling record and stamp article frontmatter so future
    # agents automatically discover open remands or past rulings without memory.
    ruling_date = date.today().isoformat()
    verdict_slug = final_verdict.lower().replace("_", "-")
    permanent_dir = WEBSITE_ROOT / ".agents" / "wiki-court-rulings" / target["slug"]
    permanent_dir.mkdir(parents=True, exist_ok=True)
    permanent_ruling_file = permanent_dir / f"{ruling_date}-{TARGET_CLASS}-{verdict_slug}.md"
    permanent_ruling_file.write_text(ruling_text, encoding="utf-8")
    ruling_rel_path = permanent_ruling_file.relative_to(WEBSITE_ROOT).as_posix()
    status_map = {
        "PROMOTE": "promoted",
        "MINOR_REVISION": "minor_revision",
        "MAJOR_REVISION": "major_revision",
    }
    court_status = status_map.get(final_verdict, "unknown")
    update_article_court_frontmatter(
        target["path"],
        status=court_status,
        target_class=TARGET_CLASS,
        ruling_date=ruling_date,
        ruling_rel_path=ruling_rel_path,
    )
    log(
        f"Judge verdict for {target['title']} -> {TARGET_CLASS}: {final_verdict} "
        f"(archived to {ruling_rel_path} and stamped into frontmatter)"
    )

    print(
        json.dumps(
            {
                "status": "ruled",
                "article": target["title"],
                "article_path": str(target["path"]),
                "target_class": TARGET_CLASS,
                "verdict": final_verdict,
                "court_status": court_status,
                "permanent_ruling_file": str(permanent_ruling_file),
                "court_ruling_rel": ruling_rel_path,
                "artifacts_dir": str(cache_dir),
                "judge_ruling_file": str(judge_ruling_file),
                "alex_review_file": str(alex_review_file),
                "advocate_brief_file": str(advocate_brief_file),
                "judge_ruling": ruling_text,
            },
            indent=2,
            ensure_ascii=False,
        )
    )
