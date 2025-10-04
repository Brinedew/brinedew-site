from __future__ import annotations

import argparse
import os
from typing import List

import json


def repo_root() -> str:
    here = os.path.dirname(os.path.abspath(__file__))
    return os.path.abspath(os.path.join(here, ".."))


def uniprot_dir() -> str:
    p = os.path.join(repo_root(), "data", "proteins", "uniprot")
    os.makedirs(p, exist_ok=True)
    return p


def run_protein_db(args: List[str]) -> int:
    import subprocess
    cmd = ["py", "-3", "-u", "protein_db.py"] + args
    try:
        return subprocess.call(cmd, cwd=os.path.join(repo_root(), "scripts"))
    except FileNotFoundError:
        # Fallback to python
        cmd = ["python", "-u", "protein_db.py"] + args
        return subprocess.call(cmd, cwd=os.path.join(repo_root(), "scripts"))


def main(argv: List[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description="Prefetch UniProt IDs into data/proteins/uniprot and rebuild CSVs")
    ap.add_argument("ids_file", help="Text/CSV file containing a column 'uniprot_id' or one ID per line")
    ap.add_argument("--rebuild", action="store_true", help="Rebuild features.csv and persona.csv after fetch")
    args = ap.parse_args(argv)

    # Extract IDs
    path = args.ids_file
    ids: List[str] = []
    with open(path, "r", encoding="utf-8", errors="replace") as f:
        text = f.read()
    # Try CSV header first
    import csv, io
    sio = io.StringIO(text)
    try:
        rdr = csv.DictReader(sio)
        if rdr.fieldnames and any(h.strip().lower() == "uniprot_id" for h in rdr.fieldnames):
            for r in rdr:
                uid = (r.get("uniprot_id") or "").strip()
                if uid:
                    ids.append(uid)
        else:
            raise ValueError("no uniprot_id header")
    except Exception:
        # Fallback: one ID per non-empty line
        ids = [ln.strip() for ln in text.splitlines() if ln.strip() and not ln.lower().startswith("uniprot_id")]

    if not ids:
        print("No IDs found.")
        return 2

    # Fetch via protein_db helper (one batch call)
    rc = run_protein_db(["fetch"] + ids)
    if rc != 0:
        print("Fetch exited with:", rc)
        return rc

    if args.rebuild:
        run_protein_db(["rebuild"])
        run_protein_db(["rebuild-persona"])

    print("Fetched:", len(ids), "IDs into", uniprot_dir())
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

