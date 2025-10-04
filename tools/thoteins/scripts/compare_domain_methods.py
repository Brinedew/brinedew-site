from __future__ import annotations

import json
import os
from typing import Any, Dict, List


def repo_root() -> str:
    here = os.path.dirname(os.path.abspath(__file__))
    return os.path.abspath(os.path.join(here, ".."))


def uniprot_dir() -> str:
    p = os.path.join(repo_root(), "data", "proteins", "uniprot")
    return p


def norm(x: Any) -> str:
    return str(x or "").strip()


def _int(v: Any):
    try:
        return int(v)
    except Exception:
        return None


def safe_get(d: Dict[str, Any], path: List[Any], default=None):
    cur: Any = d
    for key in path:
        if isinstance(cur, dict):
            if key in cur:
                cur = cur[key]
            else:
                return default
        elif isinstance(cur, list) and isinstance(key, int):
            idx = key if key >= 0 else (len(cur) + key)
            if 0 <= idx < len(cur):
                cur = cur[idx]
            else:
                return default
        else:
            return default
    return cur


def chain_segments(obj: Dict[str, Any]) -> List[Dict[str, int]]:
    feats = obj.get("features") or []
    chain_start = None
    chain_end = None
    for f in feats:
        t = str(f.get("type") or "")
        if t.lower() == "chain":
            s = _int(safe_get(f, ["location", "start", "value"], None))
            e = _int(safe_get(f, ["location", "end", "value"], None))
            if s is not None and e is not None and e >= s:
                chain_start, chain_end = s, e
                break
    if chain_start is None or chain_end is None:
        chain_start = 1
        chain_end = _int(safe_get(obj, ["sequence", "length"], None)) or 0
    if chain_end <= 0:
        return []
    cands: List[Dict[str, int]] = []
    for f in feats:
        s = _int(safe_get(f, ["location", "start", "value"], None))
        e = _int(safe_get(f, ["location", "end", "value"], None))
        if s is None or e is None or e < s:
            continue
        if s == chain_start and e == chain_end:
            continue
        if s < chain_start or e > chain_end:
            continue
        cands.append({"start": s, "end": e})
    if not cands:
        return []
    by_start: Dict[int, List[Dict[str, int]]] = {}
    for seg in sorted(cands, key=lambda x: (x["start"], x["end"])):
        by_start.setdefault(seg["start"], []).append(seg)
    path: List[Dict[str, int]] = []
    cur_start = chain_start
    guard = 0
    while guard < 10000 and cur_start <= chain_end:
        guard += 1
        choices = by_start.get(cur_start)
        if not choices:
            break
        seg = choices[0]
        path.append(seg)
        cur_start = seg["end"] + 1
    return path


def domain_like_count(obj: Dict[str, Any]) -> int:
    feats = obj.get("features") or []
    n = 0
    for f in feats or []:
        t = norm(f.get("type")).upper()
        if t in {"DOMAIN", "REGION", "MOTIF"}:
            n += 1
    return n


def main() -> int:
    updir = uniprot_dir()
    files = [os.path.join(updir, fn) for fn in os.listdir(updir) if fn.lower().endswith(".json")]
    rows = []
    for fp in sorted(files)[:50]:
        with open(fp, "r", encoding="utf-8") as f:
            obj = json.load(f)
        uid = obj.get("primaryAccession") or os.path.splitext(os.path.basename(fp))[0]
        symbol = safe_get(obj, ["genes", 0, "geneName", "value"], "") or uid
        d_like = domain_like_count(obj)
        tiling = len(chain_segments(obj))
        rows.append((uid, symbol, d_like, tiling))
    # Print a small table
    print("uid\tsymbol\tdomain_like\ttiling_segments")
    for uid, sym, dl, tl in rows:
        print(f"{uid}\t{sym}\t{dl}\t{tl}")
    # Summary
    diff = sum(1 for _,_,dl,tl in rows if dl != tl)
    print(f"\nCompared {len(rows)} entries; {diff} had different counts between methods.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

