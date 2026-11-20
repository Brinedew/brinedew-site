#!/usr/bin/env python3
"""Deterministic daily-note intake scanner and ledger manager for the Brinedew wiki.

Scans `content/YYYY-MM-DD.md` files, segments them into topical blocks, computes
SHA-256 hashes per file and per section, matches concepts against existing
`content/wiki/*.md` titles/aliases/filenames, and tracks processed state in
`.agents/skills/daily-note-wiki-editor/state/intake_ledger.json` (outside
`content/` so Quartz never publishes operational metadata).
"""

from __future__ import annotations

import argparse
import datetime as dt
import hashlib
import json
import re
import sys
from pathlib import Path

DAILY_NOTE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}\.md$")


def locate_repo_root() -> Path:
    here = Path(__file__).resolve()
    for parent in [here.parents[4], Path.cwd().resolve(), Path.cwd().resolve() / "Website"]:
        if (parent / "content" / "wiki").is_dir():
            return parent
    raise FileNotFoundError("Could not locate Website repo root containing content/wiki.")


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


def sha256_text(text: str) -> str:
    normalized = "\n".join(line.rstrip() for line in text.strip().splitlines())
    return hashlib.sha256(normalized.encode("utf-8")).hexdigest()[:16]


def load_wiki_index(wiki_dir: Path) -> list[dict]:
    entries: list[dict] = []
    for path in sorted(wiki_dir.glob("*.md")):
        if path.name in {"index.md", "Wiki Assessment.md"}:
            continue
        raw = path.read_text(encoding="utf-8", errors="replace")
        meta, _ = parse_frontmatter(raw)
        title = str(meta.get("title") or path.stem).strip()
        aliases_raw = meta.get("aliases") or []
        if isinstance(aliases_raw, str):
            aliases_raw = [aliases_raw]
        terms = {path.stem.lower(), title.lower()}
        for alias in aliases_raw:
            if alias and len(str(alias).strip()) >= 3:
                terms.add(str(alias).strip().lower())
        # Also add normalized space-separated stem
        stem_words = path.stem.replace("-", " ").lower()
        if len(stem_words) >= 4:
            terms.add(stem_words)
        entries.append(
            {
                "rel_path": f"wiki/{path.name}",
                "title": title,
                "class": str(meta.get("class") or ""),
                "vital_level": str(meta.get("vital_level") or ""),
                "terms": sorted((t for t in terms if len(t) >= 3), key=len, reverse=True),
            }
        )
    return entries


def split_sections(raw: str) -> list[dict]:
    _, body = parse_frontmatter(raw)
    if not body.strip():
        return []
    lines = body.splitlines()
    sections: list[dict] = []
    current_heading = "(Lead / Opening)"
    current_lines: list[str] = []

    def flush() -> None:
        text = "\n".join(current_lines).strip()
        if not text:
            return
        words = len(re.findall(r"\S+", text))
        svg_count = len(re.findall(r"```svg|<svg\b", text, flags=re.IGNORECASE))
        table_count = len(re.findall(r"\n\|[^\n]+\|\r?\n\|[\s:|-]+\|", "\n" + text))
        sections.append(
            {
                "heading": current_heading,
                "hash": sha256_text(text),
                "words": words,
                "svg_count": svg_count,
                "table_count": table_count,
                "text": text,
            }
        )

    for line in lines:
        heading_match = re.match(r"^(#{1,3})\s+(.+)$", line)
        if heading_match:
            flush()
            current_heading = heading_match.group(2).strip()
            current_lines = [line]
        else:
            current_lines.append(line)
    flush()
    return sections


def match_wiki_candidates(text: str, wiki_entries: list[dict], limit: int = 8) -> list[dict]:
    lowered = text.lower()
    scored: list[tuple[int, dict]] = []
    for entry in wiki_entries:
        hits = 0
        matched_term = ""
        for term in entry["terms"]:
            # Require word boundaries so short gene names don't match substrings
            pattern = r"(?<![a-z0-9])" + re.escape(term) + r"(?![a-z0-9])"
            count = len(re.findall(pattern, lowered))
            if count > 0:
                hits += count * max(1, len(term.split()))
                if not matched_term:
                    matched_term = term
        if hits > 0:
            scored.append((hits, {**entry, "score": hits, "matched_term": matched_term}))
    scored.sort(key=lambda item: (-item[0], item[1]["rel_path"]))
    return [item[1] for item in scored[:limit]]


def load_ledger(ledger_path: Path) -> dict:
    if not ledger_path.exists():
        return {"version": 1, "processed_notes": {}}
    return json.loads(ledger_path.read_text(encoding="utf-8"))


def save_ledger(ledger_path: Path, data: dict) -> None:
    ledger_path.parent.mkdir(parents=True, exist_ok=True)
    ledger_path.write_text(json.dumps(data, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")


def analyze_daily_note(path: Path, wiki_entries: list[dict], ledger: dict) -> dict:
    date_key = path.stem
    raw = path.read_text(encoding="utf-8", errors="replace")
    file_hash = sha256_text(raw)
    sections = split_sections(raw)
    total_words = sum(s["words"] for s in sections)
    total_svgs = sum(s["svg_count"] for s in sections)
    total_tables = sum(s["table_count"] for s in sections)

    recorded = ledger.get("processed_notes", {}).get(date_key)
    recorded_section_hashes = set(recorded.get("section_hashes", [])) if recorded else set()

    if total_words == 0:
        status = "empty"
    elif not recorded:
        status = "unprocessed"
    elif recorded.get("file_hash") == file_hash:
        status = "processed"
    else:
        status = "modified_since_processed"

    for sec in sections:
        sec["status"] = "processed" if sec["hash"] in recorded_section_hashes else "unprocessed"
        sec["candidates"] = [
            {
                "rel_path": c["rel_path"],
                "title": c["title"],
                "class": c["class"],
                "score": c["score"],
            }
            for c in match_wiki_candidates(sec["text"], wiki_entries, limit=5)
        ]

    top_candidates = [
        {
            "rel_path": c["rel_path"],
            "title": c["title"],
            "class": c["class"],
            "score": c["score"],
        }
        for c in match_wiki_candidates(raw, wiki_entries, limit=8)
    ]

    return {
        "date": date_key,
        "file": f"content/{path.name}",
        "status": status,
        "file_hash": file_hash,
        "words": total_words,
        "sections_total": len(sections),
        "sections_unprocessed": sum(1 for s in sections if s["status"] == "unprocessed"),
        "svg_count": total_svgs,
        "table_count": total_tables,
        "top_wiki_candidates": top_candidates,
        "recorded": recorded,
        "sections": sections,
    }


def cmd_scan(args: argparse.Namespace, repo_root: Path, ledger_path: Path) -> int:
    content_dir = repo_root / "content"
    wiki_entries = load_wiki_index(content_dir / "wiki")
    ledger = load_ledger(ledger_path)

    note_paths = sorted(
        p for p in content_dir.iterdir() if p.is_file() and DAILY_NOTE_RE.match(p.name)
    )
    summaries = []
    for path in note_paths:
        info = analyze_daily_note(path, wiki_entries, ledger)
        if not args.all and info["status"] in {"processed", "empty"}:
            continue
        summaries.append(
            {
                k: v
                for k, v in info.items()
                if k != "sections"
            }
        )

    if args.json:
        print(json.dumps(summaries, indent=2, ensure_ascii=False))
        return 0

    if not summaries:
        print("All non-empty daily notes are processed and up to date.")
        return 0

    print(f"Found {len(summaries)} daily note(s) needing editorial attention:\n")
    for item in summaries:
        cand_str = ", ".join(
            f"{c['rel_path']} ({c['class'] or 'unrated'})"
            for c in item["top_wiki_candidates"][:5]
        ) or "none (likely new topic)"
        print(
            f"- {item['date']} [{item['status'].upper()}] "
            f"({item['words']} words, {item['sections_unprocessed']}/{item['sections_total']} unprocessed sections, "
            f"{item['table_count']} table(s), {item['svg_count']} SVG(s))"
        )
        print(f"  Candidate wiki matches: {cand_str}")
    return 0


def cmd_inspect(args: argparse.Namespace, repo_root: Path, ledger_path: Path) -> int:
    content_dir = repo_root / "content"
    note_path = content_dir / f"{args.date}.md"
    if not note_path.exists():
        print(f"Daily note not found: {note_path}", file=sys.stderr)
        return 1

    wiki_entries = load_wiki_index(content_dir / "wiki")
    ledger = load_ledger(ledger_path)
    info = analyze_daily_note(note_path, wiki_entries, ledger)

    if args.json:
        for sec in info["sections"]:
            sec["preview"] = sec.pop("text")[:300]
        print(json.dumps(info, indent=2, ensure_ascii=False))
        return 0

    print(
        f"=== {info['date']} ({info['status'].upper()}) | "
        f"{info['words']} words | {info['table_count']} table(s) | {info['svg_count']} SVG(s) ==="
    )
    for idx, sec in enumerate(info["sections"], start=1):
        cands = ", ".join(f"{c['rel_path']}" for c in sec["candidates"]) or "none"
        preview = " ".join(sec["text"].splitlines()[:3]).strip()
        if len(preview) > 160:
            preview = preview[:157] + "..."
        print(
            f"\n[{idx}] {sec['heading']} [{sec['status'].upper()}] "
            f"(hash={sec['hash']}, {sec['words']}w, {sec['table_count']} tbl, {sec['svg_count']} svg)"
        )
        print(f"    Matches: {cands}")
        print(f"    Preview: {preview}")
    return 0


def cmd_mark(args: argparse.Namespace, repo_root: Path, ledger_path: Path) -> int:
    content_dir = repo_root / "content"
    note_path = content_dir / f"{args.date}.md"
    if not note_path.exists():
        print(f"Daily note not found: {note_path}", file=sys.stderr)
        return 1

    raw = note_path.read_text(encoding="utf-8", errors="replace")
    file_hash = sha256_text(raw)
    sections = split_sections(raw)
    targets = [t.strip() for t in (args.targets or "").split(",") if t.strip()]

    ledger = load_ledger(ledger_path)
    ledger.setdefault("processed_notes", {})[args.date] = {
        "file_hash": file_hash,
        "section_hashes": [s["hash"] for s in sections],
        "processed_at": dt.datetime.now(dt.timezone.utc).isoformat(),
        "targets_touched": targets,
        "notes": args.notes or "",
    }
    save_ledger(ledger_path, ledger)
    print(f"Marked {args.date} (hash={file_hash}, {len(sections)} sections) as processed.")
    return 0


def main() -> int:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="cmd", required=True)

    p_scan = sub.add_parser("scan", help="List unprocessed or modified daily notes")
    p_scan.add_argument("--all", action="store_true", help="Include already-processed and empty notes")
    p_scan.add_argument("--json", action="store_true", help="Output JSON")

    p_inspect = sub.add_parser("inspect", help="Inspect sections and wiki matches for one daily note")
    p_inspect.add_argument("--date", required=True, help="Daily note date (YYYY-MM-DD)")
    p_inspect.add_argument("--json", action="store_true", help="Output JSON")

    p_mark = sub.add_parser("mark", help="Mark a daily note as processed in the intake ledger")
    p_mark.add_argument("--date", required=True, help="Daily note date (YYYY-MM-DD)")
    p_mark.add_argument("--targets", default="", help="Comma-separated wiki paths updated/created")
    p_mark.add_argument("--notes", default="", help="Editorial summary of what was integrated or skipped")

    args = parser.parse_args()
    repo_root = locate_repo_root()
    ledger_path = (
        repo_root
        / ".agents"
        / "skills"
        / "daily-note-wiki-editor"
        / "state"
        / "intake_ledger.json"
    )

    if args.cmd == "scan":
        return cmd_scan(args, repo_root, ledger_path)
    if args.cmd == "inspect":
        return cmd_inspect(args, repo_root, ledger_path)
    if args.cmd == "mark":
        return cmd_mark(args, repo_root, ledger_path)
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
