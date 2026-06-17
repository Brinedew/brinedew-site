# -*- coding: utf-8 -*-
"""
Tag cleanup tool for an Obsidian/Quartz vault.
- Lists all tags found in YAML frontmatter ('tags') and in Markdown bodies.
- Prompts for comma-separated tags to delete (also deletes their subtags).
- Removes matching tags from frontmatter and body text (outside code blocks).
- Writes timestamped backups under scripts/tag_cleanup_backups/<timestamp>/...
- Designed for double-click via run_clean_tags.cmd (Windows).
"""

import sys, re, os, shutil, subprocess, datetime
from pathlib import Path
from collections import Counter, defaultdict

# --- Configuration ---
# Vault content directory: by default, ..\content relative to this script.
SCRIPT_DIR = Path(__file__).resolve().parent
DEFAULT_CONTENT_DIR = (SCRIPT_DIR.parent / "content").resolve()

# You may override by passing a path as the first CLI argument.
CONTENT_DIR = Path(sys.argv[1]).resolve() if len(sys.argv) > 1 else DEFAULT_CONTENT_DIR

BACKUP_ROOT = (SCRIPT_DIR / "tag_cleanup_backups").resolve()
MD_EXTENSIONS = {".md", ".markdown"}

# Tag syntax (Obsidian): '#tag' where tag chars include letters, digits, '_', '-', '/'.
#  - We intentionally exclude headings like '# Title' (space after '#')
#  - We also ignore code blocks when scanning/replacing in body
TAG_FINDER = re.compile(r'(?<![A-Za-z0-9_])#([A-Za-z0-9][A-Za-z0-9/_-]*)')

# Code block fences (``` ... ```)
FENCE = re.compile(r"```.*?```", re.DOTALL)

# --- YAML support (PyYAML) ---
def ensure_pyyaml():
    try:
        import yaml  # noqa: F401
        return
    except Exception:
        print("PyYAML not found. Installing PyYAML ...")
        subprocess.check_call([sys.executable, "-m", "pip", "install", "--user", "pyyaml"])
        print("PyYAML installed.\n")

ensure_pyyaml()
import yaml  # noqa: E402


# -------- Helpers --------
def split_frontmatter(text):
    """Return (yaml_text_or_None, body_text). Recognizes '---' delimiters at top of file."""
    if text.startswith("---"):
        # Find the closing '---' on its own line
        m = re.search(r"^---\s*\r?\n(.*?)\r?\n---\s*\r?\n?", text, flags=re.DOTALL | re.MULTILINE)
        if m:
            full = m.group(0)
            inner = m.group(1)
            body = text[len(full):]
            return inner, body
    return None, text


def load_yaml(yaml_src):
    if yaml_src is None:
        return None
    try:
        data = yaml.safe_load(yaml_src)
        if data is None:
            data = {}
        if not isinstance(data, dict):
            # Non-dict YAML: treat as empty mapping to avoid surprises
            return {}
        return data
    except Exception:
        # YAML parse error: treat as opaque body; caller can decide
        return None


def dump_yaml(data):
    # Keep YAML minimal and readable
    return yaml.safe_dump(data, sort_keys=False, allow_unicode=True).strip() + "\n"


def flatten_frontmatter_tags(tags_value):
    """
    Normalize frontmatter 'tags' to a list[str].
    Accepts: str (space/comma separated), list[str|list], nested lists.
    """
    out = []

    def add_one(x):
        if isinstance(x, str):
            s = x.strip()
            if s:
                out.append(s)
        elif isinstance(x, list):
            for y in x:
                add_one(y)

    if isinstance(tags_value, str):
        # Split on commas or whitespace
        parts = re.split(r"[,\s]+", tags_value)
        for p in parts:
            if p.strip():
                out.append(p.strip())
    elif isinstance(tags_value, list):
        add_one(tags_value)
    return out


def collect_tags_in_body(body_text):
    """Return list of tags (lowercased) found outside code blocks."""
    tags = []
    last = 0
    for m in FENCE.finditer(body_text):
        segment = body_text[last:m.start()]
        tags.extend([t.lower() for t in TAG_FINDER.findall(segment)])
        last = m.end()
    # tail
    segment = body_text[last:]
    tags.extend([t.lower() for t in TAG_FINDER.findall(segment)])
    return tags


def build_delete_regex(base_tag):
    """
    Build a regex that removes '#base_tag' OR any '#base_tag/...' (subtags).
    Case-insensitive; respects word-ish boundaries; avoids eating neighbors.
    We also permit a single trailing punctuation/comma immediately after the tag.
    """
    escaped = re.escape(base_tag)
    pattern = rf"(?<![A-Za-z0-9_])#(?:{escaped}(?:/[A-Za-z0-9/_-]+)?)\b"
    return re.compile(pattern, flags=re.IGNORECASE)


def remove_tags_from_body(body_text, delete_matchers):
    """Remove matching tags outside code fences. Return new_body, removed_count."""
    removed = 0
    out = []
    last = 0
    for m in FENCE.finditer(body_text):
        segment = body_text[last:m.start()]
        new_seg, c = _remove_from_segment(segment, delete_matchers)
        removed += c
        out.append(new_seg)
        out.append(body_text[m.start():m.end()])  # keep code fences verbatim
        last = m.end()
    # tail
    segment = body_text[last:]
    new_seg, c = _remove_from_segment(segment, delete_matchers)
    removed += c
    out.append(new_seg)

    new_body = "".join(out)
    new_body = _tidy_whitespace(new_body)
    return new_body, removed


def _remove_from_segment(segment, delete_matchers):
    removed = 0
    for rx in delete_matchers:
        # For counting, measure matches before substitution
        hits = list(rx.finditer(segment))
        if hits:
            removed += len(hits)
            segment = rx.sub("", segment)
    return segment, removed


def _tidy_whitespace(text):
    # Collapse double spaces left by removals; fix spaces before punctuation; trim trailing ws per line
    text = re.sub(r"[ ]{2,}", " ", text)
    text = re.sub(r"[ ]+([,.;:!?])", r"\1", text)
    text = re.sub(r"[ \t]+(\r?\n)", r"\1", text)
    return text


def remove_from_frontmatter_tags(data, targets_lower):
    """
    Remove matching tags from YAML 'tags'. Returns (changed_bool, data_mutated).
    A match if tag == base OR tag startswith base + '/' (case-insensitive).
    """
    if not isinstance(data, dict):
        return False, data
    tags_val = data.get("tags", None)
    if tags_val is None:
        return False, data

    original = flatten_frontmatter_tags(tags_val)
    if not original:
        return False, data

    def keep(tag):
        t = tag.lower()
        for base in targets_lower:
            if t == base or t.startswith(base + "/"):
                return False
        return True

    filtered = [t for t in original if keep(t)]
    if filtered == original:
        return False, data

    if filtered:
        data["tags"] = sorted(set(filtered))
    else:
        # if nothing left, remove the key entirely
        del data["tags"]
    return True, data


def write_backup(backup_root, content_dir, file_path, original_text):
    rel = file_path.relative_to(content_dir)
    target = (backup_root / rel).resolve()
    target.parent.mkdir(parents=True, exist_ok=True)
    with open(target, "w", encoding="utf-8", newline="") as f:
        f.write(original_text)


def main():
    print(f"Vault directory: {CONTENT_DIR}")
    if not CONTENT_DIR.exists():
        print("ERROR: Content directory not found.")
        sys.exit(1)

    # 1) Discover markdown files
    files = [p for p in CONTENT_DIR.rglob("*") if p.suffix.lower() in MD_EXTENSIONS]
    if not files:
        print("No markdown files found.")
        sys.exit(0)

    # 2) Collect all tags with counts
    fm_counter = Counter()
    body_counter = Counter()
    fm_map = defaultdict(list)  # tag -> list of files
    body_map = defaultdict(list)

    for path in files:
        try:
            text = path.read_text(encoding="utf-8")
        except UnicodeDecodeError:
            # Try cp1252 fallback
            text = path.read_text(encoding="cp1252")

        yaml_src, body = split_frontmatter(text)
        data = load_yaml(yaml_src)

        # frontmatter tags
        if data is not None and isinstance(data, dict) and "tags" in data:
            for t in flatten_frontmatter_tags(data["tags"]):
                tl = t.lower()
                fm_counter[tl] += 1
                fm_map[tl].append(path)

        # body tags (outside code)
        for tl in collect_tags_in_body(body):
            body_counter[tl] += 1
            body_map[tl].append(path)

    # union of tags
    all_tags = Counter()
    for k, v in fm_counter.items():
        all_tags[k] += v
    for k, v in body_counter.items():
        all_tags[k] += v

    if not all_tags:
        print("No tags detected in vault.")
        sys.exit(0)

    print("\nDetected tags (frontmatter + body occurrences):")
    print("===============================================")
    width = max(len(t) for t in all_tags)
    for tag, cnt in all_tags.most_common():
        fm = fm_counter.get(tag, 0)
        bd = body_counter.get(tag, 0)
        print(f"{tag.ljust(width)}  total:{str(cnt).rjust(5)}  fm:{str(fm).rjust(5)}  body:{str(bd).rjust(5)}")

    # 3) Prompt for tags to delete (base tags; implicit subtags)
    print("\nEnter comma-separated base tags to delete (no leading '#').")
    print("Examples: topic, glossary/protein")
    raw = input("> ").strip()
    if not raw:
        print("No input provided. Exiting.")
        sys.exit(0)

    bases = [t.strip().lstrip("#").lower() for t in raw.split(",") if t.strip()]
    bases = sorted(set(bases))
    if not bases:
        print("No valid tags provided. Exiting.")
        sys.exit(0)

    # Compute which existing tags would be affected
    affected = sorted({t for t in all_tags if any(t == b or t.startswith(b + "/") for b in bases)})
    if not affected:
        print("None of the provided bases matched existing tags. Exiting.")
        sys.exit(0)

    print("\nThese tags will be removed (base + subtags):")
    for t in affected:
        print(" -", t)

    confirm = input("\nProceed with deletion and write backups? (y/n): ").strip().lower()
    if confirm not in {"y", "yes"}:
        print("Aborted.")
        sys.exit(0)

    # 4) Build regex matchers for body removal
    matchers = [build_delete_regex(b) for b in bases]

    # 5) Prepare backup directory
    stamp = datetime.datetime.now().strftime("%Y%m%d-%H%M%S")
    backup_root = BACKUP_ROOT / stamp

    total_files_changed = 0
    total_body_removed = 0
    total_fm_changed = 0

    for path in files:
        try:
            original = path.read_text(encoding="utf-8")
        except UnicodeDecodeError:
            original = path.read_text(encoding="cp1252")

        yaml_src, body = split_frontmatter(original)
        data = load_yaml(yaml_src)

        # Frontmatter handling
        fm_changed = False
        if data is not None:
            fm_changed, data = remove_from_frontmatter_tags(data, set(bases))

        # Body handling
        new_body, removed = remove_tags_from_body(body, matchers)

        if fm_changed or removed > 0:
            # backup then write
            write_backup(backup_root, CONTENT_DIR, path, original)
            total_files_changed += 1
            total_body_removed += removed
            if fm_changed:
                total_fm_changed += 1

            if data is not None:
                # Reconstruct file with YAML
                new_yaml = dump_yaml(data)
                new_text = f"---\n{new_yaml}---\n{new_body}"
            else:
                # File had no (valid) YAML; just write body
                new_text = new_body

            path.write_text(new_text, encoding="utf-8", newline="")

    print("\nSummary")
    print("=======")
    print(f"Files scanned:          {len(files)}")
    print(f"Files modified:         {total_files_changed}")
    print(f"Frontmatters changed:   {total_fm_changed}")
    print(f"Body tag instances rmv: {total_body_removed}")
    print(f"Backups written under:  {backup_root}")
    print("\nDone.")

if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        print("\nInterrupted by user.")