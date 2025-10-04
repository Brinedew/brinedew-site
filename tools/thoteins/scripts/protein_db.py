from __future__ import annotations

import argparse
import csv
import json
import os
from pathlib import Path
from typing import Any, Dict, Iterable, List
from urllib.request import urlopen, Request

try:
  import comfyui_client
except ImportError:
  comfyui_client = None


def repo_root() -> str:
  here = os.path.dirname(os.path.abspath(__file__))
  return os.path.abspath(os.path.join(here, ".."))


def data_root() -> str:
  p = os.path.join(repo_root(), "data")
  os.makedirs(p, exist_ok=True)
  return p


def uniprot_dir() -> str:
  p = os.path.join(data_root(), "proteins", "uniprot")
  os.makedirs(p, exist_ok=True)
  return p


def features_csv_path() -> str:
  p = os.path.join(data_root(), "proteins")
  os.makedirs(p, exist_ok=True)
  return os.path.join(p, "features.csv")


def persona_csv_path() -> str:
  p = os.path.join(data_root(), "proteins")
  os.makedirs(p, exist_ok=True)
  return os.path.join(p, "persona.csv")


def mapping_path() -> str:
  return os.path.join(data_root(), "mapping.json")


# ---------------- Cancer role (ONGene/TSGene) integration ----------------

def cancer_roles_dir() -> str:
  p = os.path.join(data_root(), "cancer_roles")
  os.makedirs(p, exist_ok=True)
  return p


def _download_to(url: str, dst: str, timeout: int = 20) -> bool:
  try:
    req = Request(url, headers={"User-Agent": "Thoteins/1.0"})
    with urlopen(req, timeout=timeout) as resp:
      data = resp.read()
    tmp = dst + ".tmp"
    with open(tmp, "wb") as f:
      f.write(data)
    os.replace(tmp, dst)
    return True
  except Exception:
    return False


def _parse_gene_symbols(txt: str) -> List[str]:
  syms: List[str] = []
  lines = [ln.rstrip("\r\n") for ln in (txt or "").splitlines() if ln.strip() and not ln.strip().startswith("#")]
  if not lines:
    return syms
  # detect delimiter
  delim = "\t" if ("\t" in lines[0]) else ("," if ("," in lines[0]) else None)
  header = lines[0]
  start_idx = 0
  col_idx = 0
  def _norm_hdr(s: str) -> str:
    import re
    return re.sub(r"[^a-z0-9]+", "", s.lower())
  # prefer common header names
  preferred = [
    "hugosymbol", "gene_symbol", "genesymbol", "symbol", 
    "genename", "gene", "oncogenename"
  ]
  if delim:
    headers = [h.strip() for h in header.split(delim)]
    norm_headers = [_norm_hdr(h) for h in headers]
    hit_idx = None
    for cand in preferred:
      cand_norm = _norm_hdr(cand)
      for i, h in enumerate(norm_headers):
        if h == cand_norm:
          hit_idx = i; break
      if hit_idx is not None:
        break
    # fallback: any header containing 'symbol' or 'gene'
    if hit_idx is None:
      for i, h in enumerate(norm_headers):
        if ("symbol" in h) or ("gene" in h):
          hit_idx = i; break
    if hit_idx is not None:
      col_idx = hit_idx
    start_idx = 1  # treat first line as header when we detected a delimiter
  for i in range(start_idx, len(lines)):
    ln = lines[i]
    if delim:
      parts = [p.strip() for p in ln.split(delim)]
      if 0 <= col_idx < len(parts):
        syms.append(parts[col_idx])
    else:
      # whitespace or single-column
      tok = ln.split()
      if tok:
        syms.append(tok[0])
  return syms


def _iter_local_role_files(name_patterns: List[str]):
  try:
    base = cancer_roles_dir()
    files = os.listdir(base)
    pats = [p.lower() for p in name_patterns]
    for fn in files:
      fl = fn.lower()
      if any(p in fl for p in pats):
        yield os.path.join(base, fn)
  except Exception:
    return


def _load_gene_set(local_names: List[str], urls: List[str], patterns: List[str] | None = None) -> set:
  # try local files by exact names
  for name in local_names:
    path = os.path.join(cancer_roles_dir(), name)
    if os.path.exists(path):
      try:
        with open(path, "r", encoding="utf-8", errors="ignore") as f:
          txt = f.read()
        return {s.upper() for s in _parse_gene_symbols(txt) if s}
      except Exception:
        pass
  # try local files by pattern match
  if patterns:
    for path in _iter_local_role_files(patterns):
      try:
        with open(path, "r", encoding="utf-8", errors="ignore") as f:
          txt = f.read()
        return {s.upper() for s in _parse_gene_symbols(txt) if s}
      except Exception:
        pass
  # try download
  for url in urls:
    path = os.path.join(cancer_roles_dir(), local_names[0])
    if _download_to(url, path):
      try:
        with open(path, "r", encoding="utf-8", errors="ignore") as f:
          txt = f.read()
        return {s.upper() for s in _parse_gene_symbols(txt) if s}
      except Exception:
        pass
  return set()


def load_ongene_set() -> set:
  # Known downloadable sources (may vary). User can also drop a local file in data/cancer_roles
  urls = [
    # Placeholder candidates; if blocked, user can place a local file instead.
    "https://raw.githubusercontent.com/biocypher/knowledge-base-registry/main/data/ONGene_human.tsv",
    "https://raw.githubusercontent.com/biocypher/knowledge-base-registry/main/data/ONGene_human.csv",
  ]
  return _load_gene_set(["ongene.tsv", "ongene.csv", "ongene.txt"], urls, patterns=["ongene"]) 


def load_tsgene_set() -> set:
  urls = [
    "https://raw.githubusercontent.com/biocypher/knowledge-base-registry/main/data/TSGene_human.tsv",
    "https://raw.githubusercontent.com/biocypher/knowledge-base-registry/main/data/TSGene_human.csv",
  ]
  return _load_gene_set(["tsgene.tsv", "tsgene.csv", "tsgene.txt"], urls, patterns=["tsgene", "human_tsg"]) 


def cancer_alignment_for_symbol(symbol: str) -> str:
  s = str(symbol or "").upper()
  if not s:
    return "unknown"
  og = load_ongene_set()
  ts = load_tsgene_set()
  in_og = s in og
  in_ts = s in ts
  if in_og and in_ts:
    return "both"
  if in_og:
    return "oncogene"
  if in_ts:
    return "tumor_suppressor"
  return "unknown"


# ---------------- MobiDB per-ID cache + percent disordered ----------------

def mobidb_dir() -> str:
  p = os.path.join(data_root(), "proteins", "mobidb")
  os.makedirs(p, exist_ok=True)
  return p


def rvis_dir() -> str:
  p = os.path.join(data_root(), "proteins", "rvis")
  os.makedirs(p, exist_ok=True)
  return p


def hpa_dir() -> str:
  p = os.path.join(data_root(), "proteins", "hpa")
  os.makedirs(p, exist_ok=True)
  return p


def kegg_gene_cache_dir() -> str:
  p = os.path.join(data_root(), "proteins", "kegg_gene")
  os.makedirs(p, exist_ok=True)
  return p


def kegg_ko_cache_dir() -> str:
  p = os.path.join(data_root(), "proteins", "kegg_ko")
  os.makedirs(p, exist_ok=True)
  return p


def kegg_brite_cache_dir() -> str:
  p = os.path.join(data_root(), "proteins", "kegg_brite")
  os.makedirs(p, exist_ok=True)
  return p






def _covered_len(intervals: List[Dict[str, int]]) -> int:
  try:
    spans = sorted([(int(iv.get("start")), int(iv.get("end"))) for iv in intervals if iv.get("start") is not None and iv.get("end") is not None], key=lambda x: (x[0], x[1]))
  except Exception:
    return 0
  if not spans:
    return 0
  total = 0
  cs, ce = spans[0]
  for s, e in spans[1:]:
    if s <= ce + 1:
      if e > ce:
        ce = e
    else:
      total += max(0, ce - cs + 1)
      cs, ce = s, e
  total += max(0, ce - cs + 1)
  return total


def percent_disordered_from_entry(entry: Dict[str, Any]) -> float | str | None:
  """Return percent disordered from a MobiDB entry.

  Only uses top-level disorder fields with content_fraction.
  Returns percentage as float, "none" for missing data, or None for errors.
  """
  try:
    # Check top-level disorder fields only (most reliable for MobiDB API)
    best_cf = -1.0
    for key, value in entry.items():
      if isinstance(value, dict) and "disorder" in str(key).lower():
        try:
          cf = float(value.get("content_fraction"))
          if cf is not None and cf > best_cf:
            best_cf = cf
        except Exception:
          pass

    if best_cf >= 0:
      return round(best_cf * 100.0, 1)

    # No disorder fields found - return "none"
    return "none"

  except Exception:
    return None


def percent_disordered_for_uid(uid: str) -> float | str | None:
  cache_path = os.path.join(mobidb_dir(), f"{uid}.json")
  ent = _generic_load(cache_path)
  if ent is None:
    return "none"
  return percent_disordered_from_entry(ent)


# --------------- RVIS percentile fetching (GenoHub API) ---------------





def rvis_percentile_for_gene(gene_symbol: str) -> float | str | None:
  """Get RVIS percentile for a gene symbol. Returns percentile as float, 'none' for missing data, or None for errors."""
  try:
    cache_path = os.path.join(rvis_dir(), f"{gene_symbol}.json")
    entry = _generic_load(cache_path)
    if entry is None:
      return "none"

    # Extract RVIS percentile
    rvis_percentile = entry.get("rvis_percentile_ex_ac")
    if rvis_percentile is not None:
      try:
        return float(rvis_percentile)
      except Exception:
        pass

    return "none"
  except Exception:
    return None


# --------------- Data Source Registry ---------------
# Central registry - all data source config in one place

def _generic_fetch(url: str, timeout: int = 30) -> Dict[str, Any] | str | None:
  """Generic fetch from URL. Returns JSON dict, plain text string, or None on failure."""
  try:
    import ssl
    # Create SSL context that doesn't verify certificates (for Windows compatibility)
    ssl_context = ssl._create_unverified_context()
    # Don't specify Accept header - let server decide format
    req = Request(url, headers={"User-Agent": "Thoteins/1.0"})
    with urlopen(req, timeout=timeout, context=ssl_context) as resp:
      content = resp.read().decode('utf-8')
      # Try to parse as JSON first
      try:
        return json.loads(content)
      except json.JSONDecodeError:
        # Return as plain text
        return content
  except Exception as e:
    print(f"Fetch failed: {e}")
    return None

def _generic_save(path: str, data: Dict[str, Any]) -> None:
  """Generic JSON save to file."""
  os.makedirs(os.path.dirname(path), exist_ok=True)
  with open(path, "w", encoding="utf-8") as f:
    json.dump(data, f, indent=2, ensure_ascii=False)

def _generic_load(path: str) -> Dict[str, Any] | None:
  """Generic JSON load from file."""
  if os.path.exists(path):
    try:
      with open(path, "r", encoding="utf-8") as f:
        return json.load(f)
    except Exception:
      return None
  return None

DATA_SOURCES = {
  "uniprot": {"requires": "uid", "url_pattern": None, "cache_dir": None, "extract": None},
  "mobidb": {
    "requires": "uid",
    "url_pattern": lambda uid: f"https://mobidb.org/api/download_page?acc={uid}",
    "cache_dir": lambda: os.path.join(data_root(), "proteins", "mobidb"),
    "extract": lambda data: data.get("data", [{}])[0] if isinstance(data.get("data"), list) and len(data["data"]) > 0 else None
  },
  "rvis": {
    "requires": "gene_symbol",
    "url_pattern": lambda symbol: f"https://api.genohub.org/v1/annotations/{symbol.strip().upper()}",
    "cache_dir": lambda: os.path.join(data_root(), "proteins", "rvis"),
    "extract": None  # Return whole response
  },
  "hpa": {
    "requires": "gene_symbol",
    "url_pattern": lambda symbol: f"https://www.proteinatlas.org/api/search_download.php?search={symbol.strip().upper()}&format=json&columns=g,t_RNA__tau&compress=no",
    "cache_dir": lambda: os.path.join(data_root(), "proteins", "hpa"),
    "extract": lambda data: data[0] if isinstance(data, list) and len(data) > 0 else None
  }
}

def get_data_source_names():
  """Get list of all registered data source names."""
  return list(DATA_SOURCES.keys())

def refresh_data_source(source_name: str, uid: str = None, gene_symbol: str = None, force: bool = False) -> bool:
  """Refresh any registered data source given uid and/or gene_symbol.

  Args:
    source_name: Name of the data source from DATA_SOURCES registry
    uid: UniProt ID (for sources that require it)
    gene_symbol: Gene symbol (for sources that require it)
    force: If False (default), skip if cache exists. If True, fetch regardless.

  Returns:
    True if data was fetched or already cached, False on failure
  """
  if source_name not in DATA_SOURCES:
    return False

  config = DATA_SOURCES[source_name]
  if not config["url_pattern"] or not config["cache_dir"]:
    return False  # UniProt handled separately

  identifier = uid if config["requires"] == "uid" else gene_symbol
  if not identifier:
    return False

  # Build cache path
  cache_dir = config["cache_dir"]()
  os.makedirs(cache_dir, exist_ok=True)
  cache_path = os.path.join(cache_dir, f"{identifier}.json")

  # Check cache first if not forcing refresh
  if not force and _generic_load(cache_path):
    print(f"{source_name} cached for {identifier}, skipping")
    return True

  # Fetch and save
  try:
    url = config["url_pattern"](identifier)
    raw_data = _generic_fetch(url)
    if not raw_data:
      return False

    # Extract specific part of response if needed
    data = config["extract"](raw_data) if config["extract"] else raw_data
    if not data:
      return False

    _generic_save(cache_path, data)
    print(f"Fetched {source_name} for {identifier}")
    return True
  except Exception as e:
    print(f"Error fetching {source_name} for {identifier}: {e}")
    return False


# --------------- HPA Tissue Tau fetching ---------------





def tissue_tau_for_gene(gene_symbol: str) -> float | str | None:
  """Get Tissue Tau score for a gene symbol. Returns tau as float (0-1), 'none' for missing data, or None for errors."""
  try:
    cache_path = os.path.join(hpa_dir(), f"{gene_symbol}.json")
    entry = _generic_load(cache_path)
    if entry is None:
      return "none"

    # Extract Tissue Tau - HPA uses "TAU score - Tissue" key
    tau = entry.get("TAU score - Tissue")
    if tau is not None:
      try:
        tau_float = float(tau)
        # Tau should be in [0, 1] range
        if 0 <= tau_float <= 1:
          return tau_float
      except Exception:
        pass

    return "none"
  except Exception:
    return None


def biological_process_keywords(uid: str) -> str:
  """Extract biological process keywords from UniProt cached JSON. Returns semicolon-delimited string."""
  try:
    cache_path = os.path.join(uniprot_dir(), f"{uid}.json")
    entry = _generic_load(cache_path)
    if entry is None:
      return ""

    # Extract keywords with category "Biological process"
    keywords = entry.get("keywords", [])
    bp_keywords = [k.get("name") for k in keywords if k.get("category") == "Biological process" and k.get("name")]

    if bp_keywords:
      return "; ".join(bp_keywords)
    return ""
  except Exception:
    return ""


# --------------- KEGG protein families (3-hop pipeline) ---------------

def kegg_gene_for_uniprot(uid: str) -> str | None:
  """Step 1: Map UniProt ID to KEGG gene ID. Returns gene ID like 'hsa:7157' or None."""
  try:
    cache_path = os.path.join(kegg_gene_cache_dir(), f"{uid}.json")
    cached = _generic_load(cache_path)
    if cached:
      return cached.get("kegg_gene")

    url = f"https://rest.kegg.jp/conv/genes/uniprot:{uid}"
    response = _generic_fetch(url, timeout=10)
    if not response:
      return None

    # Parse "hsa:7157\tuniprot:P04637" format
    # Response is plain text, not JSON
    if isinstance(response, dict):
      # Already parsed as JSON somehow
      return None

    lines = response.strip().split('\n') if isinstance(response, str) else []
    for line in lines:
      if '\t' in line:
        parts = line.split('\t')
        # Response format: "up:P04637\thsa:7157" - we want the second part (hsa:7157)
        if len(parts) >= 2:
          gene_id = parts[1].strip()
          if gene_id and gene_id.startswith('hsa:'):
            _generic_save(cache_path, {"kegg_gene": gene_id, "uniprot_id": uid})
            return gene_id
    return None
  except Exception:
    return None


def kegg_ko_for_gene(gene_id: str) -> str | None:
  """Step 2: Map KEGG gene ID to KO (KEGG Orthology) ID. Returns KO like 'ko:K04451' or None."""
  try:
    safe_name = gene_id.replace(':', '_')
    cache_path = os.path.join(kegg_ko_cache_dir(), f"{safe_name}.json")
    cached = _generic_load(cache_path)
    if cached:
      return cached.get("ko")

    url = f"https://rest.kegg.jp/link/ko/{gene_id}"
    response = _generic_fetch(url, timeout=10)
    if not response:
      return None

    # Parse "hsa:7157\tko:K04451" format
    if isinstance(response, dict):
      return None

    lines = response.strip().split('\n') if isinstance(response, str) else []
    for line in lines:
      if '\t' in line:
        parts = line.split('\t')
        if len(parts) >= 2:
          ko_id = parts[1].strip()
          if ko_id:
            _generic_save(cache_path, {"ko": ko_id, "gene_id": gene_id})
            return ko_id
    return None
  except Exception:
    return None


def kegg_protein_families_for_ko(ko_id: str) -> str:
  """Step 3: Extract protein family membership from KO's BRITE section. Returns semicolon-delimited string."""
  try:
    safe_name = ko_id.replace(':', '_')
    cache_path = os.path.join(kegg_brite_cache_dir(), f"{safe_name}.json")
    cached = _generic_load(cache_path)
    if cached:
      return cached.get("protein_families", "")

    url = f"https://rest.kegg.jp/get/{ko_id}"
    response = _generic_fetch(url, timeout=10)
    if not response:
      return ""

    # Parse BRITE section for protein families (categories 09181-09183)
    if isinstance(response, dict):
      return ""

    families = []
    in_protein_families = False
    for line in (response.split('\n') if isinstance(response, str) else []):
      # Look for protein family category lines (09181, 09182, 09183)
      if '09181 Protein families: metabolism' in line or \
         '09182 Protein families: genetic information processing' in line or \
         '09183 Protein families: signaling and cellular processes' in line:
        in_protein_families = True
        continue

      # We're in a protein families section
      if in_protein_families:
        # Check if we've left the protein families section
        if line and not line[0].isspace():
          in_protein_families = False
          continue

        # Extract family names - they appear with 5 leading spaces and a code like "03000"
        stripped = line.strip()
        if stripped and ' ' in stripped:
          parts = stripped.split(maxsplit=1)
          # Format: "03000 Transcription factors"
          if len(parts) == 2 and parts[0].isdigit() and len(parts[0]) == 5:
            family_name = parts[1]
            # Stop if we hit the KO code line (K04451)
            if not family_name.startswith('K'):
              families.append(family_name)

    result = "; ".join(families) if families else ""
    _generic_save(cache_path, {"protein_families": result, "ko_id": ko_id})
    return result
  except Exception:
    return ""


def kegg_protein_families(uid: str) -> str:
  """
  Get KEGG protein family membership via 3-hop pipeline: UniProt → gene → KO → families.
  Each hop is cached separately for reusability.
  Returns semicolon-delimited family names or empty string.
  """
  try:
    # Hop 1: UniProt → KEGG gene
    gene_id = kegg_gene_for_uniprot(uid)
    if not gene_id:
      return ""

    # Hop 2: KEGG gene → KO
    ko_id = kegg_ko_for_gene(gene_id)
    if not ko_id:
      return ""

    # Hop 3: KO → protein families
    families = kegg_protein_families_for_ko(ko_id)
    return families
  except Exception:
    return ""


# --------------- MobiDB percent disordered (precomputed, file-based) ---------------

def _mobidb_file_candidates() -> List[str]:
  base = os.path.join(data_root(), "proteins")
  return [
    os.path.join(base, "mobidb_disorder.tsv"),
    os.path.join(base, "mobidb_disorder.csv"),
    os.path.join(base, "mobidb_disorder.txt"),
  ]


def _read_text(path: str) -> List[str]:
  with open(path, "r", encoding="utf-8", errors="ignore") as f:
    return f.read().splitlines()


def _norm_hdr(s: str) -> str:
  return "".join(ch for ch in (s or "").lower() if ch.isalnum())


def load_mobidb_percent_map() -> Dict[str, float]:
  """Load a mapping from UniProt accession to percent disordered.

  Supports TSV/CSV with headers. Accessions column names accepted:
  uniprot, accession, uniprotid, primaryaccession, acc, uniprotacc, uniprot_id
  Value column names accepted:
  percentdisordered, disorderpercent, disordercontent, disorder_content,
  contentfraction, content_fraction, fractiondisordered, disordercoverage, coverage
  Values in [0,1] are treated as fractions and converted to percent.
  """
  paths = [p for p in _mobidb_file_candidates() if os.path.exists(p)]
  out: Dict[str, float] = {}
  if not paths:
    return out
  # use first existing
  try:
    lines = _read_text(paths[0])
    if not lines:
      return out
    header = lines[0]
    delim = "\t" if ("\t" in header) else ("," if ("," in header) else None)
    headers = [h.strip() for h in (header.split(delim) if delim else header.split())]
    norm = [_norm_hdr(h) for h in headers]
    acc_candidates = {"uniprot", "accession", "uniprotid", "primaryaccession", "acc", "uniprotacc", "uniprotid", "uniprot_id"}
    val_candidates = {
      "percentdisordered", "disorderpercent", "disordercontent", "disorder_content",
      "contentfraction", "content_fraction", "fractiondisordered", "disordercoverage", "coverage"
    }
    acc_idx = None; val_idx = None
    for i, h in enumerate(norm):
      if h in acc_candidates:
        acc_idx = i; break
    if acc_idx is None:
      for i, h in enumerate(norm):
        if ("uniprot" in h) or ("access" in h):
          acc_idx = i; break
    for i, h in enumerate(norm):
      if h in val_candidates:
        val_idx = i; break
    if val_idx is None:
      for i, h in enumerate(norm):
        if ("disorder" in h) and (("percent" in h) or ("fraction" in h) or ("content" in h) or ("coverage" in h)):
          val_idx = i; break
    if acc_idx is None or val_idx is None:
      return out
    for ln in lines[1:]:
      if not ln.strip():
        continue
      parts = [p.strip() for p in (ln.split(delim) if delim else ln.split())]
      if len(parts) <= max(acc_idx, val_idx):
        continue
      acc = parts[acc_idx].strip().upper()
      try:
        x = float(parts[val_idx])
        if 0.0 <= x <= 1.0:
          x = round(x * 100.0, 1)
        else:
          x = round(x, 1)
        if acc:
          out[acc] = x
      except Exception:
        continue
  except Exception:
    return {}
  return out


def load_mapping() -> Dict[str, Any] | None:
  mp = mapping_path()
  try:
    with open(mp, "r", encoding="utf-8") as f:
      obj = json.load(f)
    if isinstance(obj, dict) and isinstance(obj.get("mappings"), list):
      return obj
  except Exception:
    return None
  return None


def _atomic_replace(tmp_path: str, final_path: str) -> str:
  """Best-effort atomic replace with Windows-friendly fallback when target is locked.

  Returns the path that now contains the data (either final_path or final_path + '.next').
  """
  try:
    os.replace(tmp_path, final_path)
    return final_path
  except PermissionError:
    # Target likely open in Excel. Fall back to writing a sidecar '.next'.
    try:
      next_path = final_path + ".next"
      # Ensure any pre-existing .next is removed
      try:
        if os.path.exists(next_path):
          os.remove(next_path)
      except Exception:
        pass
      os.replace(tmp_path, next_path)
      print(f"[warn] Target locked: wrote to {next_path}. Close applications using {final_path} and rerun to finalize.")
      return next_path
    except Exception:
      # Last resort: try to write bytes copy
      try:
        import shutil as _sh
        next_path = final_path + ".next"
        _sh.copyfile(tmp_path, next_path)
        os.remove(tmp_path)
        print(f"[warn] Target locked: copied to {next_path}. Close applications using {final_path} and rerun to finalize.")
        return next_path
      except Exception as _e:
        # Re-raise original permission error to signal failure
        raise


def norm(x: Any) -> str:
  return str(x or "").strip()


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


def first_str(val: Any) -> str:
  if isinstance(val, dict):
    s = val.get("value")
    return norm(s) if s else ""
  if isinstance(val, list) and val:
    v = val[0]
    if isinstance(v, dict):
      s = v.get("value")
      return norm(s) if s else ""
    return norm(v)
  return norm(val)


# Membrane topology classification: GO-CC term → membrane depth
# Based on minimum number of lipid bilayers from extracellular space to compartment interior
# 0 = extracellular (outer space), 1 = cytosolic (outdoors), 2 = single-membrane organelle lumen (indoors), 3 = double-membrane organelle interior (deep indoors)
GO_DEPTH = {
  # 0 membranes - outer space (truly extracellular)
  "GO:0005576": 0,  # extracellular region
  "GO:0005615": 0,  # extracellular space
  "GO:0005614": 0,  # interstitial matrix
  "GO:0062023": 0,  # collagen-containing extracellular matrix
  "GO:0005578": 0,  # extracellular matrix

  # 1 membrane - outdoors (cytosolic side of PM, cytoplasm)
  "GO:0005829": 1,  # cytosol
  "GO:0005737": 1,  # cytoplasm
  "GO:0005856": 1,  # cytoskeleton
  "GO:0005886": 1,  # plasma membrane (default to cytosolic side)
  "GO:0009925": 1,  # basal plasma membrane
  "GO:0016323": 1,  # basolateral plasma membrane
  "GO:0009897": 1,  # external side of plasma membrane (actually 0, but protein anchored = 1)
  "GO:0009986": 1,  # cell surface
  "GO:0030054": 1,  # cell junction
  "GO:0005794": 1,  # Golgi apparatus (includes membrane)
  "GO:0005801": 1,  # cis-Golgi network
  "GO:0005802": 1,  # trans-Golgi network
  "GO:1903561": 1,  # extracellular vesicle
  "GO:0070062": 1,  # extracellular exosome

  # 2 membranes - indoors (single-membrane organelle lumens + mitochondrial envelope)
  "GO:0005788": 2,  # endoplasmic reticulum lumen
  "GO:0005783": 2,  # endoplasmic reticulum
  "GO:0005789": 2,  # endoplasmic reticulum membrane (lumenal side)
  "GO:0005796": 2,  # Golgi lumen
  "GO:0000139": 2,  # Golgi membrane (lumenal side)
  "GO:0005768": 2,  # endosome
  "GO:0005765": 2,  # early endosome lumen
  "GO:0005770": 2,  # late endosome
  "GO:0005764": 2,  # lysosome
  "GO:0005773": 2,  # vacuole
  "GO:0005777": 2,  # peroxisome
  "GO:0005778": 2,  # peroxisomal matrix
  "GO:0005741": 2,  # mitochondrial outer membrane (BCL2 family lives here)
  "GO:0005758": 2,  # mitochondrial intermembrane space

  # 3 membranes - deep indoors (double-membrane organelle interiors)
  "GO:0005634": 3,  # nucleus
  "GO:0005654": 3,  # nucleoplasm (specific inner space, gets +0.5 bonus)
  "GO:0005730": 3,  # nucleolus
  "GO:0000785": 3,  # chromatin
  "GO:0005694": 3,  # chromosome
  "GO:0031965": 3,  # nuclear membrane (envelope inner side)
  "GO:0005739": 3,  # mitochondrion (general)
  "GO:0005759": 3,  # mitochondrial matrix (specific inner space, gets +0.5 bonus)
  "GO:0005743": 3,  # mitochondrial inner membrane
}

# GO evidence code weights (by strength of evidence)
EVIDENCE_WEIGHTS = {
  # EXP group - direct experimental evidence
  "IDA": 5,  # Inferred from Direct Assay
  "IMP": 5,  # Inferred from Mutant Phenotype
  "IGI": 5,  # Inferred from Genetic Interaction
  "IEP": 5,  # Inferred from Expression Pattern
  "HDA": 5,  # Inferred from High Throughput Direct Assay
  "IPI": 5,  # Inferred from Physical Interaction
  # Author statement
  "TAS": 4,  # Traceable Author Statement
  "NAS": 3,  # Non-traceable Author Statement
  # Computational/similarity
  "IBA": 2,  # Inferred from Biological aspect of Ancestor
  "ISS": 2,  # Inferred from Sequence or structural Similarity
  "ISO": 2,  # Inferred from Sequence Orthology
  "ISA": 2,  # Inferred from Sequence Alignment
  # Electronic inference (weakest)
  "IEA": 1,  # Inferred from Electronic Annotation
}

# Specific inner space GO terms that get specificity bonus
SPECIFIC_INNER_TERMS = {"GO:0005654", "GO:0005759"}  # nucleoplasm, mitochondrial matrix

# Fallback keyword matching for terms not in GO_DEPTH
DEPTH_KEYWORDS = {
  0: ["extracellular", "secreted", "blood", "plasma", "serum"],
  1: ["cytosol", "cytoplasm", "plasma membrane", "cell surface", "cell cortex", "cytoskeleton"],
  2: ["endoplasmic reticulum", "er lumen", "golgi lumen", "endosome", "lysosome", "peroxisome"],
  3: ["nucleus", "nucleoplasm", "nucleolus", "chromatin", "mitochondrial matrix"],
}

def classify_membrane_depth(tokens: List[str], go_terms: List[Dict[str, Any]] = None) -> int:
  """
  Classify protein location by membrane depth (0/1/2/3) using evidence-weighted voting.

  Decision logic:
  1. If strong extracellular evidence exists → depth 0
  2. Otherwise, score each depth by evidence quality (EXP=5, TAS=4, IBA/ISS=2, IEA=1)
  3. Nuclear (depth 3) requires strong evidence to beat cytoplasmic (depth 1)
  4. Tie-break toward shallower depths (cytoplasm over nucleus if equal weight)
  """

  # Score accumulator: {depth: total_weight}
  scores = {0: 0.0, 1: 0.0, 2: 0.0, 3: 0.0}
  has_strong_evidence = {0: False, 1: False, 2: False, 3: False}  # Track EXP/TAS presence

  # Process GO terms with evidence codes
  if go_terms:
    for go in go_terms:
      go_id = go.get("id", "")
      evidence = go.get("evidence", "IEA")  # Default to weakest if missing

      if go_id not in GO_DEPTH:
        continue

      depth = GO_DEPTH[go_id]

      # Get base weight from evidence code
      weight = EVIDENCE_WEIGHTS.get(evidence, 1.0)

      # Specificity bonus for inner compartment terms
      if go_id in SPECIFIC_INNER_TERMS:
        weight += 0.5

      scores[depth] += weight

      # Track if this depth has strong evidence (EXP/TAS)
      if weight >= 4:
        has_strong_evidence[depth] = True

  # Fallback to keyword matching if no GO terms matched
  if sum(scores.values()) == 0 and tokens:
    toks = [norm(t).lower() for t in tokens if norm(t)]
    for depth, keywords in DEPTH_KEYWORDS.items():
      if any(keyword in tok for tok in toks for keyword in keywords):
        scores[depth] += 2.0  # Moderate weight for keyword matches

  # If nothing matched at all, default to cytoplasm
  if sum(scores.values()) == 0:
    return 1

  # Decision rules:

  # Rule 1: Extracellular with strong evidence always wins
  if has_strong_evidence[0]:
    return 0

  # Rule 2: Nuclear gate - depth 3 can only beat depth 1 if:
  #   - It has strong evidence (EXP/TAS) AND
  #   - Its score beats depth 1 by at least 2 points
  if scores[3] > 0 and scores[1] > 0:
    if not has_strong_evidence[3]:
      # No strong nuclear evidence, demote
      scores[3] = 0
    elif scores[3] < scores[1] + 2:
      # Not enough margin to overcome cytoplasmic evidence
      scores[3] = 0

  # Rule 3: Pick highest score, tie-break to shallower depth
  best_depth = max(scores.keys(), key=lambda d: (scores[d], -d))

  return best_depth

def classify_found_in(tokens: List[str]) -> str:
  """Legacy function - maps to background settings. Kept for compatibility."""
  depth = classify_membrane_depth(tokens)
  if depth == 0:
    return "outer space"
  elif depth == 1:
    return "outdoors"
  else:  # depth 2 or 3
    return "indoors"


def transmembrane_count(obj: Dict[str, Any]) -> int:
  try:
    feats = obj.get("features") or []
    cnt = 0
    for f in feats:
      t = norm(f.get("type")).lower()
      if t == "transmembrane" or t == "transmem":
        cnt += 1
    return cnt
  except Exception:
    return 0

def _int(v: Any) -> int | None:
  try:
    return int(v)
  except Exception:
    return None

def chain_segments(obj: Dict[str, Any]) -> List[Dict[str, int]]:
  """Return the contiguous tiling sequence of chain segments without relying on type names.

  Algorithm:
  - Determine chain span: prefer the feature labeled "Chain" (case-insensitive). If absent,
    fall back to [1, sequence.length].
  - Gather all features with integer start/end wholly within the chain span, excluding the
    chain row itself (by span equality).
  - Build an adjacency-tiling path that starts at chain_start and repeatedly picks a segment
    whose start == previous_end + 1. If multiple candidates share the same start, pick the one
    with the smallest end (shortest segment) to favor fine-grained tiling.
  - Stop when no next segment exists or we reach chain_end. If the path ends exactly at
    chain_end, we consider it the chain partition.
  """
  feats = obj.get("features") or []
  # Find chain span
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
    # Fallback to full sequence if Chain is missing
    chain_start = 1
    chain_end = _int(safe_get(obj, ["sequence", "length"], None)) or 0

  if chain_end <= 0:
    return []

  # Collect candidate segments within chain span (exclude exact chain span)
  cands: List[Dict[str, int]] = []
  for f in feats:
    s = _int(safe_get(f, ["location", "start", "value"], None))
    e = _int(safe_get(f, ["location", "end", "value"], None))
    if s is None or e is None or e < s:
      continue
    if s == chain_start and e == chain_end:
      # exclude the chain row itself
      continue
    if s < chain_start or e > chain_end:
      continue
    cands.append({"start": s, "end": e})

  if not cands:
    return []

  # Index by start, choose shortest end first to favor fine tiling
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
  # Validate coverage
  if path and path[0]["start"] == chain_start and path[-1]["end"] == chain_end:
    return path
  return path  # return best-effort; caller can still count


def extract_row(obj: Dict[str, Any], uid_fallback: str) -> Dict[str, Any]:
  uid = obj.get("primaryAccession") or uid_fallback
  symbol = safe_get(obj, ["genes", 0, "geneName", "value"], "")
  if not symbol:
    syn = safe_get(obj, ["genes", 0, "synonyms", 0, "value"], "")
    symbol = syn or symbol or uid
  rec = safe_get(obj, ["proteinDescription", "recommendedName"], {}) or {}
  short_name = first_str(rec.get("shortName") or rec.get("shortNames") or "")
  if not short_name:
    alts = safe_get(obj, ["proteinDescription", "alternativeNames"], []) or []
    if isinstance(alts, list):
      for alt in alts:
        if isinstance(alt, dict):
          short_name = first_str(alt.get("shortName") or alt.get("shortNames") or "")
          if short_name:
            break
  full_name = safe_get(obj, ["proteinDescription", "recommendedName", "fullName", "value"], "")
  # Fallbacks to avoid empty column 3 (short_name)
  if not short_name:
    short_name = symbol or (full_name.split(" ")[0] if isinstance(full_name, str) and full_name else uid)
  # Alignment based on ONGene / TSGene (no API key required)
  alignment = cancer_alignment_for_symbol(symbol)

  mw = safe_get(obj, ["sequence", "molWeight"], None)
  # Round mass to nearest whole kDa
  if isinstance(mw, (int, float)):
    try:
      mass = int(round(float(mw) / 1000.0))
    except Exception:
      mass = ""
  else:
    mass = ""
  length = safe_get(obj, ["sequence", "length"], "")

  feats = obj.get("features") or []
  dom_names: List[str] = []
  if isinstance(feats, list):
    for f in feats:
      t = norm(f.get("type")).upper()
      if t in {"DOMAIN", "REGION", "MOTIF"}:
        if len(dom_names) < 3:
          name = f.get("description")
          if name:
            dom_names.append(norm(name))

  locs: List[str] = []
  comments = obj.get("comments") or []
  if isinstance(comments, list):
    for c in comments:
      if c.get("commentType") == "SUBCELLULAR_LOCATION":
        for sl in c.get("subcellularLocations") or []:
          v = safe_get(sl, ["location", "value"], None)
          if v:
            locs.append(norm(v))
  # Also collect GO cellular component terms (database == GO, GoTerm starts with 'C:')
  # Extract GO IDs, names, and evidence codes for membrane depth classification
  go_cc_terms = []
  try:
    for xr in obj.get("uniProtKBCrossReferences") or []:
      if norm(xr.get("database")).upper() == "GO":
        go_id = xr.get("id", "")
        # Parse properties to get GoTerm and evidence code
        props = {norm(p.get("key")): p.get("value") for p in xr.get("properties", [])}
        go_term = props.get("GoTerm", "")
        evidence_type = props.get("GoEvidenceType", "IEA")  # Default to IEA if missing

        # Extract evidence code from "IDA:HPA" format
        evidence_code = evidence_type.split(":")[0] if ":" in evidence_type else evidence_type

        if go_term and go_term.startswith("C:"):
          part = go_term[2:].strip()
          if part:
            locs.append(part)
          # Save GO term with ID and evidence code
          go_cc_terms.append({"id": go_id, "name": part, "evidence": evidence_code})
  except Exception:
    pass
  keywords_arr: List[str] = []
  for k in obj.get("keywords") or []:
    v = k.get("value")
    if v:
      keywords_arr.append(norm(v))

  # Calculate membrane depth (0/1/2/3) from GO terms and location strings
  membrane_depth = classify_membrane_depth(locs + keywords_arr, go_cc_terms)
  tm_count = transmembrane_count(obj)
  transmem = "Yes" if tm_count > 0 else "No"

  # Domain count: prefer explicit domain-like feature count; fallback to tiling
  try:
    domain_like = 0
    for f in feats or []:
      t = norm(f.get("type")).upper()
      if t in {"DOMAIN", "REGION", "MOTIF"}:
        domain_like += 1
    domain_count = domain_like if domain_like > 0 else len(chain_segments(obj))
  except Exception:
    domain_count = len(chain_segments(obj))

  # Structural segmentation count (second concept): number of contiguous tiling segments across the chain
  chain_tiling = len(chain_segments(obj))

  return {
    "uniprot_id": uid,
    "gene_symbol": symbol,
    "short_name": short_name,
    "full_name": full_name,
    "mass": mass,
    "length": length,
    "domain_count": domain_count,
    "chain_tiling_segments": chain_tiling,
    "alignment": alignment,
    "domains_top3": "; ".join(dom_names),
    "locations": "; ".join(dict.fromkeys(locs)),
    "keywords": "; ".join(dict.fromkeys(keywords_arr)),
    "membrane_depth": str(membrane_depth),
    "Has transmembrane domains": transmem,
    "transmembrane_count": tm_count,
  }


def enrich_protein_row(row: Dict[str, Any]) -> Dict[str, Any]:
  """
  Add supplementary data from external sources (MobiDB, RVIS, etc.) to a protein row.
  This is the single source of truth for all data enrichment.
  """
  enriched = dict(row)  # Copy to avoid mutating input

  uid = str(enriched.get("uniprot_id", "")).strip().upper()
  gene_symbol = str(enriched.get("gene_symbol", "")).strip()

  # Add MobiDB disorder percentage (only if numeric)
  try:
    if uid:
      # Try cached JSON first (most accurate)
      pct_json = percent_disordered_for_uid(uid)
      if pct_json is not None and isinstance(pct_json, (int, float)):
        enriched["percent_disordered"] = pct_json
      else:
        # Fallback to bulk file
        mob_map = load_mobidb_percent_map()
        pct = mob_map.get(uid)
        if pct is not None and isinstance(pct, (int, float)):
          enriched["percent_disordered"] = pct
  except Exception:
    pass

  # Add RVIS percentile (only if numeric)
  try:
    if gene_symbol:
      rvis_pct = rvis_percentile_for_gene(gene_symbol)
      if rvis_pct is not None and isinstance(rvis_pct, (int, float)):
        enriched["rvis_percentile"] = rvis_pct
  except Exception:
    pass

  # Add HPA Tissue Tau (only if numeric)
  try:
    if gene_symbol:
      tau = tissue_tau_for_gene(gene_symbol)
      if tau is not None and isinstance(tau, (int, float)):
        enriched["tissue_tau"] = tau
  except Exception:
    pass

  # Add first letter of gene symbol (for persona mapping)
  if gene_symbol:
    enriched["first_letter"] = gene_symbol[0].upper()
  else:
    enriched["first_letter"] = ""

  # Add biological process keywords from UniProt
  if uid:
    bp = biological_process_keywords(uid)
    if bp:
      enriched["biological_process"] = bp

  # Add KEGG protein families (3-hop pipeline)
  if uid:
    families = kegg_protein_families(uid)
    if families:
      enriched["kegg_families"] = families

  return enriched


def _split_semicolons(s: str) -> List[str]:
  if not s:
    return []
  out: List[str] = []
  for part in str(s).replace("|", ";").replace("/", ";").split(";"):
    v = norm(part)
    if v:
      out.append(v)
  # dedupe preserving order
  seen = set()
  uniq: List[str] = []
  for v in out:
    if v not in seen:
      seen.add(v)
      uniq.append(v)
  return uniq


def _prepare_protein_for_mapping(row: Dict[str, Any], mapping: Dict[str, Any] | None = None) -> Dict[str, Any]:
  """Bridge a features-like row to the mapping engine without hardcoding names.

  For each declared molecular variable in `mapping`, include a value under its exact name:
  - numeric types -> float or None
  - non-numeric -> a token list split on ";", "|", "/" when present; otherwise a string
  Also preserves common fields (mass/length/domains) if not explicitly declared.
  """
  p: Dict[str, Any] = {}
  # Mapping-driven population
  mol = []
  try:
    mol = (mapping or {}).get("molecular") or []
  except Exception:
    mol = []
  seen: set[str] = set()
  for var in mol:
    try:
      name = str(var.get("name") or "").strip()
      if not name or name in seen:
        continue
      vtype = str(var.get("type") or "").strip().lower()
      raw = row.get(name, "")
      if vtype == "numeric":
        try:
          p[name] = float(raw) if raw not in (None, "") else None
        except Exception:
          p[name] = None
      else:
        tokens = _split_semicolons(raw) if isinstance(raw, str) else []
        p[name] = tokens if tokens else str(raw or "")
      seen.add(name)
    except Exception:
      continue
  # Convenience back-compat
  if "mass" not in p:
    try:
      p["mass"] = float(row.get("mass")) if row.get("mass") not in (None, "") else None
    except Exception:
      p["mass"] = None
  if "length" not in p:
    try:
      p["length"] = float(row.get("length")) if row.get("length") not in (None, "") else None
    except Exception:
      p["length"] = None
  if "domains" not in p:
    p["domains"] = row.get("domains_top3", "")
  return p


def _apply_mapping(mapping: Dict[str, Any] | None, protein: Dict[str, Any]) -> Dict[str, Any]:
  if not mapping or not isinstance(mapping.get("mappings"), list):
    return {}
  overrides: Dict[str, Any] = {}
  for m in mapping.get("mappings", []):
    try:
      mtype = m.get("type")
      source = m.get("source")
      target = m.get("target")
      if not source or not target:
        continue
      if mtype == "Numeric (multiplier)":
        k = float(m.get("multiplier", 1) or 1)
        use_log = bool(m.get("log", False))
        raw = protein.get(source)
        try:
          val = float(raw)
        except Exception:
          continue
        base = (None if (val is None) else ((val > 0 and __import__("math").log10(val)) if use_log else val))
        if base is None or base != base:  # NaN check
          continue
        mapped = k * base
        if str(target).lower() == "height":
          try:
            overrides[target] = int(round(mapped))
          except Exception:
            overrides[target] = mapped
        else:
          overrides[target] = round(mapped, 1)
      elif mtype == "Categorical (bins)":
        bins = m.get("bins") or {}
        src_val = protein.get(source)
        toks: List[str] = []
        if isinstance(src_val, list):
          toks = src_val
        elif src_val not in (None, ""):
          toks = [src_val]
        def _norm(s: Any) -> str:
          # Handle numeric values: convert to int if it's a whole number, then stringify
          if isinstance(s, (int, float)):
            try:
              if s == int(s):  # If it's a whole number (3.0 == 3)
                return str(int(s)).strip().lower()
            except (ValueError, OverflowError):
              pass
          return str(s or "").strip().lower()
        look = { _norm(k): v for k, v in (bins.items() if isinstance(bins, dict) else []) }

        # Collect all matching bin values (for set→set mappings)
        chosen = []
        for t in toks:
          hit = look.get(_norm(t))
          if hit:
            chosen.append(hit)

        if chosen:
          # If target is a set type, join with semicolons; otherwise take first value
          target_field = next((f for f in mapping.get("human", []) if f.get("name") == target), None)
          if target_field and target_field.get("type") == "set":
            overrides[target] = "; ".join(chosen)
          else:
            overrides[target] = chosen[0]
    except Exception:
      continue
  return overrides


def update_persona_csv_with_obj(uid: str, obj: Dict[str, Any]) -> str:
  row = extract_row(obj, uid)
  mapping = load_mapping() or {"human": [], "mappings": []}
  protein = _prepare_protein_for_mapping(row, mapping)
  overrides = _apply_mapping(mapping, protein)
  # Columns: id, gene symbol, short_name, then human variables as declared in mapping["human"]
  human_vars = []
  try:
    for hv in mapping.get("human", []) or []:
      name = hv.get("name")
      if name and name not in human_vars:
        human_vars.append(name)
  except Exception:
    human_vars = []
  base_cols = ["uniprot_id", "gene_symbol", "short_name"]
  cols = base_cols + human_vars
  out_csv = persona_csv_path()
  # Load existing rows and existing columns to preserve any older targets
  rows: Dict[str, Dict[str, Any]] = {}
  existing_cols: List[str] = []
  if os.path.exists(out_csv):
    try:
      with open(out_csv, "r", encoding="utf-8", newline="") as f:
        rdr = csv.DictReader(f)
        existing_cols = list(rdr.fieldnames or [])
        for r in rdr:
          uid0 = r.get("uniprot_id")
          if uid0:
            rows[uid0] = r
    except Exception:
      rows = {}
  # Merge columns (keep order: existing, then any new human vars)
  for hv in cols:
    if hv not in existing_cols:
      existing_cols.append(hv)
  final_cols = existing_cols if existing_cols else cols
  # Upsert this row
  rec = { k: rows.get(uid, {}).get(k, "") for k in final_cols }
  rec["uniprot_id"] = row.get("uniprot_id", uid)
  rec["gene_symbol"] = row.get("gene_symbol", "")
  rec["short_name"] = row.get("short_name", "")
  for k, v in overrides.items():
    if k in final_cols:
      rec[k] = v
    else:
      final_cols.append(k)
      rec[k] = v
  rows[rec["uniprot_id"]] = rec
  tmp = out_csv + ".tmp"
  with open(tmp, "w", encoding="utf-8", newline="") as f:
    w = csv.DictWriter(f, fieldnames=final_cols)
    w.writeheader()
    for uid0 in sorted(rows.keys()):
      r = rows[uid0]
      w.writerow({ k: r.get(k, "") for k in final_cols })
  return _atomic_replace(tmp, out_csv)


def save_uniprot_json(uid: str, obj: Dict[str, Any]) -> str:
  out = os.path.join(uniprot_dir(), f"{uid}.json")
  with open(out, "w", encoding="utf-8") as f:
    json.dump(obj, f, indent=2, ensure_ascii=False)
  return out


def fetch_uniprot_json(uid: str, timeout: int = 20) -> Dict[str, Any]:
  url = f"https://rest.uniprot.org/uniprotkb/{uid}.json"
  req = Request(url, headers={"User-Agent": "Thoteins/1.0"})
  with urlopen(req, timeout=timeout) as resp:
    return json.load(resp)


def update_features_csv_with_obj(uid: str, obj: Dict[str, Any]) -> str:
  row = extract_row(obj, uid)
  row = enrich_protein_row(row)  # Add all supplementary data in one place
  out_csv = features_csv_path()
  cols = list(row.keys())  # Column list derived from enriched row
  # Load existing rows
  rows: Dict[str, Dict[str, Any]] = {}
  if os.path.exists(out_csv):
    try:
      with open(out_csv, "r", encoding="utf-8", newline="") as f:
        rdr = csv.DictReader(f)
        for r in rdr:
          uid0 = r.get("uniprot_id")
          if uid0:
            rows[uid0] = r
    except Exception:
      rows = {}

  rows[row["uniprot_id"]] = row
  tmp = out_csv + ".tmp"
  with open(tmp, "w", encoding="utf-8", newline="") as f:
    w = csv.DictWriter(f, fieldnames=cols)
    w.writeheader()
    for uid0 in sorted(rows.keys()):
      w.writerow({k: rows[uid0].get(k, "") for k in cols})
  return _atomic_replace(tmp, out_csv)


def rebuild_features_csv() -> str:
  out_csv = features_csv_path()
  files = [os.path.join(uniprot_dir(), fn) for fn in os.listdir(uniprot_dir()) if fn.lower().endswith('.json')]
  rows: List[Dict[str, Any]] = []
  for fp in files:
    try:
      with open(fp, "r", encoding="utf-8") as f:
        obj = json.load(f)
    except Exception:
      continue
    uid = os.path.splitext(os.path.basename(fp))[0]
    r = extract_row(obj, uid)
    r = enrich_protein_row(r)  # Add all supplementary data in one place
    rows.append(r)

  # Derive column list from all enriched rows (union of all keys)
  all_keys = set()
  for r in rows:
    all_keys.update(r.keys())
  # Order columns: standard fields first, then alphabetical
  standard_cols = ["uniprot_id", "gene_symbol", "short_name", "full_name", "mass", "length",
                   "domain_count", "chain_tiling_segments", "alignment", "domains_top3", "locations",
                   "keywords", "Found in", "Has transmembrane domains", "transmembrane_count"]
  cols = [c for c in standard_cols if c in all_keys] + sorted([c for c in all_keys if c not in standard_cols])
  tmp = out_csv + ".tmp"
  with open(tmp, "w", encoding="utf-8", newline="") as f:
    w = csv.DictWriter(f, fieldnames=cols)
    w.writeheader()
    for r in sorted(rows, key=lambda x: x.get("uniprot_id", "")):
      w.writerow(r)
  return _atomic_replace(tmp, out_csv)


def rebuild_persona_csv() -> str:
  """Rebuild persona.csv from saved UniProt JSONs and current mapping.json.

  Columns: uniprot_id, gene_symbol, followed by mapping["human"] variable names.
  Values are computed via Numeric (multiplier) and Categorical (bins) rules.
  """
  out_csv = persona_csv_path()
  mapping = load_mapping() or {"human": [], "mappings": []} 
  # Determine target human variables (stable order): mapping["human"] ∪ all mapping targets 
  human_vars: List[str] = [] 
  try: 
    for hv in mapping.get("human", []) or []: 
      name = hv.get("name") 
      if name and name not in human_vars: 
        human_vars.append(name) 
  except Exception: 
    human_vars = [] 
  try:
    for mm in mapping.get("mappings", []) or []:
      tgt = mm.get("target")
      if tgt and tgt not in human_vars:
        human_vars.append(tgt)
  except Exception:
    pass
  cols = ["uniprot_id", "gene_symbol", "short_name"] + human_vars + ["hexcode"]

  files = [os.path.join(uniprot_dir(), fn) for fn in os.listdir(uniprot_dir()) if fn.lower().endswith('.json')]
  rows: List[Dict[str, Any]] = []
  for fp in files:
    try:
      with open(fp, "r", encoding="utf-8") as f:
        obj = json.load(f)
    except Exception:
      continue
    uid = os.path.splitext(os.path.basename(fp))[0]
    # Get base row + mapping overrides
    base = extract_row(obj, uid)
    base = enrich_protein_row(base)  # Add supplementary data (MobiDB, RVIS, first_letter)
    protein = _prepare_protein_for_mapping(base, mapping)
    overrides = _apply_mapping(mapping, protein)
    rec: Dict[str, Any] = {
      "uniprot_id": base.get("uniprot_id", uid),
      "gene_symbol": base.get("gene_symbol", ""),
      "short_name": base.get("short_name", ""),
    }
    for k in human_vars:
      v = overrides.get(k, "")
      rec[k] = v

    # Add hexcode from HSLuv skintone coordinates
    try:
      from hsluv import hsluv_to_hex
      hue = overrides.get("Skintone Hue ")
      sat = overrides.get("Skintone Saturation")
      light = overrides.get("Skintone Lightness")
      if all(x not in (None, "", " ") for x in [hue, sat, light]):
        hex_color = hsluv_to_hex([float(hue), float(sat), float(light)])
        rec["hexcode"] = hex_color
      else:
        rec["hexcode"] = ""
    except Exception:
      rec["hexcode"] = ""

    rows.append(rec)
  tmp = out_csv + ".tmp"
  os.makedirs(os.path.dirname(out_csv), exist_ok=True)
  with open(tmp, "w", encoding="utf-8", newline="") as f:
    w = csv.DictWriter(f, fieldnames=cols)
    w.writeheader()
    for r in sorted(rows, key=lambda x: x.get("uniprot_id", "")):
      w.writerow({ k: r.get(k, "") for k in cols })
  return _atomic_replace(tmp, out_csv)


def main(argv: List[str] | None = None) -> int:
  ap = argparse.ArgumentParser(prog="protein_db", description="Thoteins UniProt local DB helper")
  sub = ap.add_subparsers(dest="cmd", required=True)

  p_fetch = sub.add_parser("fetch", help="Fetch one or more UniProt IDs and update features.csv")
  p_fetch.add_argument("ids", nargs="+", help="UniProt accessions")

  p_rebuild = sub.add_parser("rebuild", help="Rebuild features.csv from saved JSONs")

  p_rebuildp = sub.add_parser("rebuild-persona", help="Rebuild persona.csv from saved JSONs and current mapping.json")

  p_dump = sub.add_parser("dump-row", help="Print extracted row for an ID from saved JSON")
  p_dump.add_argument("id")

  p_refresh = sub.add_parser("refresh-mobidb", help="Re-fetch MobiDB data for specific IDs")
  p_refresh.add_argument("ids", nargs="+", help="UniProt IDs to refresh")

  p_refresh_rvis = sub.add_parser("refresh-rvis", help="Re-fetch RVIS data for specific gene symbols")
  p_refresh_rvis.add_argument("genes", nargs="+", help="Gene symbols to refresh")

  p_gen_img = sub.add_parser("generate-image", help="Generate character portrait image for a protein using ComfyUI")
  p_gen_img.add_argument("uniprot_id", help="UniProt ID to generate image for")
  p_gen_img.add_argument("--force", action="store_true", help="Regenerate even if image already exists")

  p_gen_all = sub.add_parser("generate-all-images", help="Generate images for all proteins in persona.csv")
  p_gen_all.add_argument("--force", action="store_true", help="Regenerate even if images already exist")

  args = ap.parse_args(argv)
  if args.cmd == "fetch":
    for uid in args.ids:
      uid = uid.strip()
      if not uid:
        continue
      print(f"Fetching {uid}...")

      # 1. Fetch UniProt (required)
      obj = fetch_uniprot_json(uid)
      save_uniprot_json(uid, obj)

      # Extract gene symbol for sources that need it
      gene = ""
      try:
        gene_symbol = obj.get("genes", [])
        if gene_symbol and len(gene_symbol) > 0:
          gene = gene_symbol[0].get("geneName", {}).get("value", "")
      except Exception:
        pass

      # 2. Fetch MobiDB (disorder data)
      try:
        if refresh_data_source("mobidb", uid=uid, gene_symbol=gene, force=False):
          print(f"  [OK] MobiDB")
        else:
          print(f"  [SKIP] MobiDB (already cached)")
      except Exception as e:
        print(f"  [FAIL] MobiDB: {e}")

      # 3. Fetch RVIS (genetic constraint)
      if gene:
        try:
          if refresh_data_source("rvis", uid=uid, gene_symbol=gene, force=False):
            print(f"  [OK] RVIS ({gene})")
          else:
            print(f"  [SKIP] RVIS (already cached)")
        except Exception as e:
          print(f"  [FAIL] RVIS ({gene}): {e}")

      # 4. Fetch HPA (tissue expression)
      if gene:
        try:
          if refresh_data_source("hpa", uid=uid, gene_symbol=gene, force=False):
            print(f"  [OK] HPA ({gene})")
          else:
            print(f"  [SKIP] HPA (already cached)")
        except Exception as e:
          print(f"  [FAIL] HPA ({gene}): {e}")

      update_features_csv_with_obj(uid, obj)
      print(f"  > Updated features.csv")

    # After fetching all proteins, rebuild to trigger KEGG enrichment
    print("\nRebuilding features.csv to enrich KEGG families...")
    rebuild_features_csv()
    print("Done. Updated:", features_csv_path())

    # Also rebuild persona to propagate changes
    print("Rebuilding persona.csv...")
    rebuild_persona_csv()
    print("Done. Updated:", persona_csv_path())

    return 0
  if args.cmd == "rebuild":
    out = rebuild_features_csv()
    print("Rebuilt:", out)
    return 0
  if args.cmd == "rebuild-persona":
    out = rebuild_persona_csv()
    print("Rebuilt:", out)
    return 0
  if args.cmd == "dump-row":
    fp = os.path.join(uniprot_dir(), f"{args.id}.json")
    with open(fp, "r", encoding="utf-8") as f:
      obj = json.load(f)
    row = extract_row(obj, args.id)
    print(json.dumps(row, indent=2))
    return 0
  if args.cmd == "refresh-mobidb":
    success_count = 0
    for uid in args.ids:
      uid = uid.strip().upper()
      if not uid:
        continue
      if refresh_mobidb_cache(uid):
        success_count += 1
        # Test the disorder percentage after refresh
        pct = percent_disordered_for_uid(uid)
        if pct is not None:
          print(f"  - {uid}: {pct}% disordered")
        else:
          print(f"  - {uid}: No disorder data found")
    print(f"Successfully refreshed {success_count}/{len(args.ids)} entries")
    return 0
  if args.cmd == "refresh-rvis":
    success_count = 0
    for gene in args.genes:
      gene = gene.strip().upper()
      if not gene:
        continue
      if refresh_rvis_cache(gene):
        success_count += 1
        # Test the RVIS percentile after refresh
        rvis_pct = rvis_percentile_for_gene(gene)
        if rvis_pct is not None and rvis_pct != "none":
          print(f"  - {gene}: {rvis_pct}% RVIS percentile")
        else:
          print(f"  - {gene}: No RVIS data found")
    print(f"Successfully refreshed {success_count}/{len(args.genes)} entries")
    return 0

  if args.cmd == "generate-image":
    if comfyui_client is None:
      print("Error: comfyui_client module not found. Check installation.")
      return 1

    # Load persona data for this protein
    persona_path = persona_csv_path()
    if not os.path.exists(persona_path):
      print(f"Error: persona.csv not found at {persona_path}")
      print("Run 'python protein_db.py rebuild-persona' first")
      return 1

    persona_data = None
    with open(persona_path, 'r', encoding='utf-8') as f:
      reader = csv.DictReader(f)
      for row in reader:
        if row['uniprot_id'] == args.uniprot_id:
          persona_data = row
          break

    if not persona_data:
      print(f"Error: No persona data found for {args.uniprot_id}")
      return 1

    # Check if image already exists
    output_dir = Path(repo_root()) / "data" / "proteins" / "images"
    output_path = output_dir / f"{args.uniprot_id}.png"

    if output_path.exists() and not args.force:
      print(f"Image already exists: {output_path}")
      print("Use --force to regenerate")
      return 0

    # Generate image
    try:
      result_path = comfyui_client.generate_character_image(
        persona_data,
        args.uniprot_id,
        output_path
      )
      print(f"Success! Image saved to {result_path}")
      return 0
    except comfyui_client.ComfyUINotAvailableError as e:
      print(f"Error: {e}")
      return 1
    except comfyui_client.WorkflowExecutionError as e:
      print(f"Error generating image: {e}")
      return 1

  if args.cmd == "generate-all-images":
    if comfyui_client is None:
      print("Error: comfyui_client module not found. Check installation.")
      return 1

    # Load all persona data
    persona_path = persona_csv_path()
    if not os.path.exists(persona_path):
      print(f"Error: persona.csv not found at {persona_path}")
      print("Run 'python protein_db.py rebuild-persona' first")
      return 1

    personas = []
    with open(persona_path, 'r', encoding='utf-8') as f:
      reader = csv.DictReader(f)
      personas = list(reader)

    print(f"Found {len(personas)} proteins in persona.csv")

    output_dir = Path(repo_root()) / "data" / "proteins" / "images"
    output_dir.mkdir(parents=True, exist_ok=True)

    success_count = 0
    skip_count = 0
    fail_count = 0

    for i, persona_data in enumerate(personas, 1):
      uniprot_id = persona_data['uniprot_id']
      output_path = output_dir / f"{uniprot_id}.png"

      print(f"\n[{i}/{len(personas)}] Processing {uniprot_id}...")

      # Check if already exists
      if output_path.exists() and not args.force:
        print(f"  Skipping (image exists)")
        skip_count += 1
        continue

      # Generate image
      try:
        result_path = comfyui_client.generate_character_image(
          persona_data,
          uniprot_id,
          output_path
        )
        print(f"  Success: {result_path}")
        success_count += 1
      except comfyui_client.ComfyUINotAvailableError as e:
        print(f"  Error: {e}")
        print("\nStopping batch generation (ComfyUI not available)")
        return 1
      except comfyui_client.WorkflowExecutionError as e:
        print(f"  Failed: {e}")
        fail_count += 1
      except Exception as e:
        print(f"  Unexpected error: {e}")
        fail_count += 1

    print(f"\n{'='*60}")
    print(f"Batch generation complete:")
    print(f"  Generated: {success_count}")
    print(f"  Skipped: {skip_count}")
    print(f"  Failed: {fail_count}")
    return 0

  return 1


if __name__ == "__main__":
  raise SystemExit(main())
