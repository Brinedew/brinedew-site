"""Standardized Wiki Promotion Court workflow (`run_workflow`).

Required input:
    args["article"]: Article title, filename stem, alias, or relative wiki path.
Optional input:
    args["target_class"]: Target tier ("GA" default, "A", or "FA").
"""

import json
import re
import subprocess
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


def assemble_graph_dossier(target: dict, records: list[dict], website_root: Path) -> str:
    by_key: dict[str, list[dict]] = {}
    for rec in records:
        for key in rec["keys"]:
            by_key.setdefault(key, []).append(rec)

    outlinks, attachments, footnotes = extract_links_and_assets(target["body"])
    resolved_neighbors: list[str] = []
    broken_links: list[str] = []
    linked_stems: set[str] = {target["stem"].lower()}

    for link in outlinks:
        candidates = by_key.get(link.lower()) or by_key.get(slugify_segment(link)) or []
        if candidates:
            neighbor = candidates[0]
            linked_stems.add(neighbor["stem"].lower())
            resolved_neighbors.append(
                f"- `[[{link}]]` -> `{neighbor['path']}` (class: `{neighbor['class']}`)"
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
    for rec in records:
        if rec["path"] == target["path"]:
            continue
        if target_pat.search(rec["raw"]):
            backlinks.append(f"- `{rec['path']}` (class: `{rec['class']}`)")

    body_lower = strip_markdown_code(target["body"]).lower()
    unlinked_candidates: list[str] = []
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

    sections = [
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
    return "\n".join(sections)


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
    raise ValueError('Args[\'article\'] is required (e.g. {"article": "Compensatory proliferation"}).')

ARTICLE_QUERY = str(args["article"]).strip()
TARGET_CLASS = str(args.get("target_class") or "GA").strip()

phase("Assemble Dossier")
WEBSITE_ROOT = locate_website_root()
WIKI_DIR = WEBSITE_ROOT / "content" / "wiki"
REF_DIR = WEBSITE_ROOT / ".agents" / "skills" / "wiki-court" / "references"

records = build_wiki_index(WIKI_DIR)
target = resolve_article(records, ARTICLE_QUERY)
graph_dossier = assemble_graph_dossier(target, records, WEBSITE_ROOT)
render_summary, cache_dir = await run_render_preflight(target["slug"], WEBSITE_ROOT)

log(f"Resolved article: {target['title']} ({target['path']}), class={target['class']} -> target={TARGET_CLASS}")

base_vars = {
    "ARTICLE_NAME": target["title"],
    "ARTICLE_PATH": str(target["path"]),
    "CURRENT_CLASS": target["class"],
    "VITAL_LEVEL": target["vital_level"],
    "TARGET_CLASS": TARGET_CLASS,
    "GRAPH_DOSSIER": graph_dossier,
    "RENDER_SUMMARY": render_summary,
}

advocate_template = (REF_DIR / "advocate_prompt.md").read_text(encoding="utf-8")
devil_template = (REF_DIR / "devils_advocate_prompt.md").read_text(encoding="utf-8")
judge_template = (REF_DIR / "judge_prompt.md").read_text(encoding="utf-8")

free_prose_schema = {"type": "string"}

phase("Adversarial Hearings")
advocate_brief, alex_review = await parallel(
    [0, 1],
    lambda idx: agent(
        fill_template(advocate_template, base_vars),
        schema=free_prose_schema,
        role=f"Advocate: {target['title']}",
        type_name="research",
    )
    if idx == 0
    else agent(
        fill_template(devil_template, base_vars),
        schema=free_prose_schema,
        role=f"Alex (Devil's Advocate): {target['title']}",
        type_name="research",
    ),
)

(cache_dir / "advocate_brief.md").write_text(advocate_brief, encoding="utf-8")
(cache_dir / "alex_review.md").write_text(alex_review, encoding="utf-8")
log(f"Saved Advocate brief ({len(advocate_brief)} chars) and Alex review ({len(alex_review)} chars) to {cache_dir}")

phase("Judicial Ruling")
judge_vars = {
    **base_vars,
    "ADVOCATE_JSON": advocate_brief,
    "DEVILS_ADVOCATE_JSON": alex_review,
}
ruling_text = await agent(
    fill_template(judge_template, judge_vars),
    schema=free_prose_schema,
    role=f"Judge: {target['title']}",
    type_name="research",
)

(cache_dir / "judge_ruling.md").write_text(ruling_text, encoding="utf-8")
verdict_match = re.findall(r"^VERDICT:\s*(PROMOTE|REMAND)\b", ruling_text, re.MULTILINE)
final_verdict = verdict_match[-1] if verdict_match else "UNKNOWN"
log(f"Judge verdict for {target['title']} -> {TARGET_CLASS}: {final_verdict}")

print(
    json.dumps(
        {
            "article": target["title"],
            "article_path": str(target["path"]),
            "target_class": TARGET_CLASS,
            "verdict": final_verdict,
            "artifacts_dir": str(cache_dir),
            "judge_ruling_file": str(cache_dir / "judge_ruling.md"),
            "alex_review_file": str(cache_dir / "alex_review.md"),
            "advocate_brief_file": str(cache_dir / "advocate_brief.md"),
            "judge_ruling": ruling_text,
        },
        indent=2,
        ensure_ascii=False,
    )
)
