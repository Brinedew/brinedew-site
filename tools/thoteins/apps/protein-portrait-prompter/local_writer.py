from __future__ import annotations

import json
import os
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import csv
import threading
import mimetypes
from urllib.parse import urlparse
from urllib.request import urlopen, Request

# Reuse shared helpers from scripts/protein_db.py
try:
    _ROOT = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".."))
    _SCRIPTS = os.path.join(_ROOT, "scripts")
    if _SCRIPTS not in sys.path:
        sys.path.insert(0, _SCRIPTS)
    import protein_db as pdb  # type: ignore
except Exception:  # fallback; server still runs but won't auto-update CSV
    pdb = None  # type: ignore


def _repo_root() -> str:
    if pdb:
        return pdb.repo_root()
    here = os.path.dirname(os.path.abspath(__file__))
    return os.path.abspath(os.path.join(here, "..", ".."))


def _data_dir() -> str:
    root = _repo_root()
    p = os.path.join(root, "data", "proteins", "uniprot")
    os.makedirs(p, exist_ok=True)
    return p


def _features_csv_path() -> str:
    if pdb:
        return pdb.features_csv_path()
    root = _repo_root()
    out_dir = os.path.join(root, "data", "proteins")
    os.makedirs(out_dir, exist_ok=True)
    return os.path.join(out_dir, "features.csv")


def _norm(x) -> str:
    return str(x or "").strip()


def _safe_get(d: dict, path: list, default=None):
    cur = d
    for key in path:
        if isinstance(cur, dict) and key in cur:
            cur = cur[key]
        else:
            return default
    return cur


def _first_str(val):
    if isinstance(val, dict):
        s = val.get("value")
        return _norm(s) if s else ""
    if isinstance(val, list) and val:
        v = val[0]
        if isinstance(v, dict):
            s = v.get("value")
            return _norm(s) if s else ""
        return _norm(v)
    return _norm(val)


def _classify_found_in(tokens: list[str]) -> str:
    return pdb.classify_found_in(tokens) if pdb else ""


def _transmembrane_count(data: dict) -> int:
    return pdb.transmembrane_count(data) if pdb else 0


def _extract_row(obj: dict, uid_fallback: str) -> dict:
    return pdb.extract_row(obj, uid_fallback) if pdb else {}


def _update_features_csv(uid: str, obj: dict) -> None:
    if pdb:
        pdb.update_features_csv_with_obj(uid, obj)


def _update_persona_csv(uid: str, obj: dict) -> None:
    if pdb:
        try:
            pdb.update_persona_csv_with_obj(uid, obj)
        except Exception:
            pass


def _write_json(uid: str, obj: dict) -> str:
    out_dir = _data_dir()
    # sanitize filename minimal
    safe = uid.replace("/", "_").replace("\\", "_")
    path = os.path.join(out_dir, f"{safe}.json")
    with open(path, "w", encoding="utf-8") as f:
        json.dump(obj, f, indent=2, ensure_ascii=False)
    return path


def _cors_headers(handler: BaseHTTPRequestHandler) -> None:
    handler.send_header("Access-Control-Allow-Origin", "*")
    handler.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
    handler.send_header("Access-Control-Allow-Headers", "Content-Type")


class Handler(BaseHTTPRequestHandler):
    server_version = "ThoteinsLocalWriter/1.0"

    def log_message(self, fmt: str, *args) -> None:  # quieter
        sys.stderr.write("%s - - %s\n" % (self.address_string(), fmt % args))

    def do_OPTIONS(self) -> None:  # CORS preflight
        self.send_response(204)
        _cors_headers(self)
        self.end_headers()

    def _serve_bytes(self, body: bytes, code: int = 200, ctype: str = "text/plain; charset=utf-8") -> None:
        try:
            self.send_response(code)
            _cors_headers(self)
            self.send_header("Content-Type", ctype)
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Connection", "close")
            self.end_headers()
            if body:
                try:
                    self.wfile.write(body)
                except (BrokenPipeError, ConnectionResetError, ConnectionAbortedError, OSError):
                    pass
        except (BrokenPipeError, ConnectionResetError, ConnectionAbortedError, OSError):
            # Client went away mid-response; ignore to avoid noisy tracebacks
            pass

    def _serve_file(self, abspath: str) -> None:
        try:
            if not os.path.isfile(abspath):
                self._serve_bytes(b"Not found", 404)
                return
            # Restrict serving to allowed roots: prompter dir and data dir
            proot = os.path.dirname(os.path.abspath(__file__))
            droot = os.path.join(_repo_root(), "data")
            base = os.path.abspath(abspath)
            if not (base.startswith(proot) or base.startswith(droot)):
                self._serve_bytes(b"Forbidden", 403)
                return
            ctype, _ = mimetypes.guess_type(base)
            if not ctype:
                ctype = "application/octet-stream"
            with open(base, "rb") as f:
                body = f.read()
            self._serve_bytes(body, 200, ctype)
        except Exception as e:
            self._serve_bytes(f"error: {e}".encode("utf-8"), 500)

    def do_GET(self) -> None:
        parsed = urlparse(self.path or "/")
        # MobiDB proxy endpoints
        if parsed.path.startswith("/mobidb/"):
            # /mobidb/<id>/percent or /mobidb/<id>/consensus
            parts = parsed.path.split("/")
            # ['', 'mobidb', '<id>', 'percent'|'consensus']
            if len(parts) >= 4:
                uid = parts[2]
                action = parts[3] or ""
                try:
                    if action == "percent":
                        data = self._mobidb_percent(uid)
                        body = json.dumps(data).encode("utf-8")
                        self._serve_bytes(body, 200, "application/json; charset=utf-8")
                        return
                    elif action == "consensus":
                        obj = self._mobidb_get(uid, "consensus")
                        body = json.dumps(obj).encode("utf-8")
                        self._serve_bytes(body, 200, "application/json; charset=utf-8")
                        return
                except Exception as e:
                    self._serve_bytes(json.dumps({"error": str(e)}).encode("utf-8"), 502, "application/json; charset=utf-8")
                    return
        if parsed.path == "/health":
            data = {
                "status": "ok",
                "data_dir": _data_dir(),
                "root": _repo_root(),
                "server": self.server_version,
            }
            body = json.dumps(data).encode("utf-8")
            self._serve_bytes(body, 200, "application/json; charset=utf-8")
            return

        # Serve persona.csv as JSON: GET /api/persona
        # Returns: {"P00533": {"trait1": "value", ...}, "P01116": {...}, ...}
        if parsed.path == "/api/persona":
            try:
                persona_path = pdb.persona_csv_path() if pdb else os.path.join(_repo_root(), "data", "proteins", "persona.csv")
                if not os.path.exists(persona_path):
                    body = json.dumps({}).encode("utf-8")
                    self._serve_bytes(body, 200, "application/json; charset=utf-8")
                    return

                result = {}
                with open(persona_path, "r", encoding="utf-8", newline="") as f:
                    reader = csv.DictReader(f)
                    for row in reader:
                        uid = row.get("uniprot_id")
                        if not uid:
                            continue
                        # Build overrides dict (exclude uniprot_id and gene_symbol)
                        overrides = {}
                        for k, v in row.items():
                            if not k or k in ("uniprot_id", "gene_symbol"):
                                continue
                            if v:  # Only include non-empty values
                                # Try to convert to number if applicable
                                try:
                                    if "." in v:
                                        overrides[k] = float(v)
                                    else:
                                        overrides[k] = int(v)
                                except (ValueError, AttributeError):
                                    overrides[k] = v
                        result[uid] = overrides

                body = json.dumps(result).encode("utf-8")
                self._serve_bytes(body, 200, "application/json; charset=utf-8")
                return
            except Exception as e:
                body = json.dumps({"error": str(e)}).encode("utf-8")
                self._serve_bytes(body, 500, "application/json; charset=utf-8")
                return

        # Generate ComfyUI prompts: GET /api/prompts
        # Returns: {"P00533": {"gene": "EGFR", "prompt": "..."}, ...}
        if parsed.path == "/api/prompts":
            try:
                # Import comfyui_client for prompt generation
                try:
                    import comfyui_client
                except ImportError:
                    comfyui_client = None

                persona_path = pdb.persona_csv_path() if pdb else os.path.join(_repo_root(), "data", "proteins", "persona.csv")
                if not os.path.exists(persona_path):
                    body = json.dumps({}).encode("utf-8")
                    self._serve_bytes(body, 200, "application/json; charset=utf-8")
                    return

                result = {}
                skipped = 0
                with open(persona_path, "r", encoding="utf-8", newline="") as f:
                    reader = csv.DictReader(f)
                    for row in reader:
                        uid = row.get("uniprot_id")
                        gene = row.get("gene_symbol", "")

                        # Skip if ANY field (except uniprot_id and gene_symbol) is empty
                        has_empty = any(not v for k, v in row.items() if k not in ("uniprot_id", "gene_symbol"))
                        if has_empty:
                            skipped += 1
                            continue

                        if uid and comfyui_client:
                            try:
                                prompt = comfyui_client.build_character_prompt(row, gene)
                                result[uid] = {"gene": gene, "prompt": prompt}
                            except Exception:
                                skipped += 1

                result["_meta"] = {"total": len(result) - 1, "skipped": skipped}
                body = json.dumps(result).encode("utf-8")
                self._serve_bytes(body, 200, "application/json; charset=utf-8")
                return
            except Exception as e:
                body = json.dumps({"error": str(e)}).encode("utf-8")
                self._serve_bytes(body, 500, "application/json; charset=utf-8")
                return

        # Serve the Prompter UI from this folder under /prompter
        proot = os.path.dirname(os.path.abspath(__file__))
        if parsed.path == "/prompter":
            # Redirect to trailing slash so relative URLs resolve under /prompter/
            self.send_response(301)
            _cors_headers(self)
            self.send_header("Location", "/prompter/")
            self.end_headers()
            return
        if parsed.path == "/" or parsed.path == "/prompter/":
            self._serve_file(os.path.join(proot, "index.html"))
            return
        if parsed.path.startswith("/prompter/"):
            rel = parsed.path[len("/prompter/"):]
            self._serve_file(os.path.join(proot, rel))
            return
        # Serve data files under /data/* from Thoteins/data
        if parsed.path.startswith("/data/"):
            droot = os.path.join(_repo_root(), "data")
            rel = parsed.path[len("/data/"):]
            self._serve_file(os.path.join(droot, rel))
            return
        # Fallback: root-level asset requests (e.g., /styles.css or /src/main.js)
        if parsed.path in ("/styles.css", "/favicon.ico") or parsed.path.startswith("/src/"):
            rel = parsed.path.lstrip("/")
            self._serve_file(os.path.join(proot, rel))
            return
        if parsed.path == "/shutdown":
            self._serve_bytes(b"shutting down", 200)
            threading.Thread(target=self.server.shutdown, daemon=True).start()
            return
        self._serve_bytes(b"not found", 404)

    def do_POST(self) -> None:
        parsed = urlparse(self.path or "/")
        if parsed.path.startswith("/put/"):
            uid = parsed.path[len("/put/"):].strip()
            if not uid:
                self.send_response(400)
                _cors_headers(self)
                self.end_headers()
                return
            try:
                length = int(self.headers.get("Content-Length", "0"))
            except Exception:
                length = 0
            raw = self.rfile.read(length) if length > 0 else b""
            try:
                obj = json.loads(raw.decode("utf-8")) if raw else {}
            except Exception:
                self.send_response(400)
                _cors_headers(self)
                self.end_headers()
                return
            try:
                path = _write_json(uid, obj)
                # Update features.csv with this entry
                try:
                    _update_features_csv(uid, obj)
                except Exception:
                    pass
                # Update persona.csv with mapped parameters
                try:
                    _update_persona_csv(uid, obj)
                except Exception:
                    pass
                body = json.dumps({"status": "saved", "path": path}).encode("utf-8")
                self.send_response(200)
                _cors_headers(self)
                self.send_header("Content-Type", "application/json; charset=utf-8")
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)
                return
            except Exception as e:
                body = json.dumps({"status": "error", "error": str(e)}).encode("utf-8")
                self.send_response(500)
                _cors_headers(self)
                self.send_header("Content-Type", "application/json; charset=utf-8")
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)
                return

        # Apply mapping endpoint: POST /apply-mapping
        # Body: {"protein": {...protein data...}, "mapping": {...mapping config...}}
        # Returns: {"mapped": {...human attributes...}}
        if parsed.path == "/apply-mapping":
            try:
                length = int(self.headers.get("Content-Length", "0"))
            except Exception:
                length = 0
            raw = self.rfile.read(length) if length > 0 else b""
            try:
                payload = json.loads(raw.decode("utf-8")) if raw else {}
            except Exception:
                self.send_response(400)
                _cors_headers(self)
                self.end_headers()
                return

            try:
                protein_data = payload.get("protein", {})
                mapping_config = payload.get("mapping", {})

                if not protein_data:
                    raise ValueError("protein data required")

                # Use protein_db mapping logic
                if pdb:
                    # Prepare protein for mapping (same as in protein_db.py)
                    prepared = pdb._prepare_protein_for_mapping(protein_data, mapping_config)
                    mapped = pdb._apply_mapping(mapping_config, prepared)

                    body = json.dumps({"mapped": mapped}).encode("utf-8")
                    self.send_response(200)
                    _cors_headers(self)
                    self.send_header("Content-Type", "application/json; charset=utf-8")
                    self.send_header("Content-Length", str(len(body)))
                    self.end_headers()
                    self.wfile.write(body)
                else:
                    # Fallback if protein_db not available
                    body = json.dumps({"error": "protein_db module not available"}).encode("utf-8")
                    self.send_response(503)
                    _cors_headers(self)
                    self.send_header("Content-Type", "application/json; charset=utf-8")
                    self.send_header("Content-Length", str(len(body)))
                    self.end_headers()
                    self.wfile.write(body)
                return
            except Exception as e:
                body = json.dumps({"error": str(e)}).encode("utf-8")
                self.send_response(500)
                _cors_headers(self)
                self.send_header("Content-Type", "application/json; charset=utf-8")
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)
                return

        # Upload proteins file endpoint: POST /upload-proteins
        # Body: {"filename": "proteins.csv", "content": "uniprot_id,symbol\nP00533,EGFR"}
        # Returns: {"proteins": [{uniprot_id, symbol, ...}, ...], "count": 3}
        if parsed.path == "/upload-proteins":
            try:
                length = int(self.headers.get("Content-Length", "0"))
            except Exception:
                length = 0
            raw = self.rfile.read(length) if length > 0 else b""
            try:
                payload = json.loads(raw.decode("utf-8")) if raw else {}
            except Exception:
                self.send_response(400)
                _cors_headers(self)
                self.end_headers()
                return

            try:
                filename = payload.get("filename", "")
                text = payload.get("content", "")

                if not filename or not text:
                    raise ValueError("filename and content required")

                proteins = []

                # Parse based on file extension
                if filename.lower().endswith('.json'):
                    data = json.loads(text)
                    if isinstance(data, list):
                        for item in data:
                            if isinstance(item, dict) and item.get("uniprot_id"):
                                proteins.append(item)
                    elif isinstance(data, dict) and data.get("uniprot_id"):
                        proteins.append(data)

                elif filename.lower().endswith('.csv'):
                    # Use Python's csv module (handles quotes properly)
                    import io
                    reader = csv.DictReader(io.StringIO(text))
                    for row in reader:
                        if row.get("uniprot_id"):
                            proteins.append(dict(row))

                elif filename.lower().endswith('.md'):
                    # Parse frontmatter (YAML between --- delimiters)
                    if text.startswith("---"):
                        parts = text.split("---", 2)
                        if len(parts) >= 3:
                            try:
                                frontmatter = {}
                                for line in parts[1].strip().split("\n"):
                                    if ":" in line:
                                        key, val = line.split(":", 1)
                                        frontmatter[key.strip()] = val.strip().strip('"').strip("'")
                                if frontmatter.get("uniprot_id"):
                                    proteins.append(frontmatter)
                            except Exception:
                                pass

                body = json.dumps({"proteins": proteins, "count": len(proteins)}).encode("utf-8")
                self.send_response(200)
                _cors_headers(self)
                self.send_header("Content-Type", "application/json; charset=utf-8")
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)
                return

            except Exception as e:
                body = json.dumps({"error": str(e)}).encode("utf-8")
                self.send_response(500)
                _cors_headers(self)
                self.send_header("Content-Type", "application/json; charset=utf-8")
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)
                return

        # Refresh proteins endpoint: POST /refresh-proteins
        # Body: {"uniprot_ids": ["P00533", "P01116"], "sources": ["uniprot", "mobidb", "rvis"]}
        # sources is optional - defaults to all available sources
        # Returns: {"refreshed": 2, "skipped": 0, "details": {...}, "proteins": [{uniprot_id, symbol, ...}, ...]}
        if parsed.path == "/refresh-proteins":
            try:
                length = int(self.headers.get("Content-Length", "0"))
            except Exception:
                length = 0
            raw = self.rfile.read(length) if length > 0 else b""
            try:
                payload = json.loads(raw.decode("utf-8")) if raw else {}
            except Exception:
                self.send_response(400)
                _cors_headers(self)
                self.end_headers()
                return

            try:
                uniprot_ids = payload.get("uniprot_ids", [])
                # Get sources from registry if available
                available_sources = pdb.get_data_source_names() if pdb and hasattr(pdb, 'get_data_source_names') else ["uniprot", "mobidb", "rvis", "hpa"]
                sources = payload.get("sources", available_sources)

                if not uniprot_ids or not isinstance(uniprot_ids, list):
                    raise ValueError("uniprot_ids list required")

                if not pdb:
                    body = json.dumps({"error": "protein_db module not available"}).encode("utf-8")
                    self.send_response(503)
                    _cors_headers(self)
                    self.send_header("Content-Type", "application/json; charset=utf-8")
                    self.send_header("Content-Length", str(len(body)))
                    self.end_headers()
                    self.wfile.write(body)
                    return

                # Initialize details dict from registry
                details = {source: 0 for source in available_sources}
                skipped = 0
                proteins = []

                total = len(uniprot_ids)
                for idx, uid in enumerate(uniprot_ids):
                    uid = str(uid).strip()
                    if not uid:
                        skipped += 1
                        continue

                    # Log progress to console so user can see it's working
                    print(f"[{idx+1}/{total}] Processing {uid}...")

                    # Refresh UniProt if requested
                    if "uniprot" in sources:
                        try:
                            entry = pdb.fetch_uniprot_json(uid)
                            if entry:
                                pdb.save_uniprot_json(uid, entry)
                                details["uniprot"] += 1
                        except Exception:
                            pass

                    # Refresh MobiDB if requested
                    if "mobidb" in sources:
                        try:
                            pdb.refresh_mobidb_cache(uid)
                            details["mobidb"] += 1
                        except Exception:
                            pass

                    # Load gene symbol once for sources that need it
                    gene_symbol = None
                    needs_gene_symbol = [s for s in sources if s not in ["uniprot", "mobidb"]]
                    if needs_gene_symbol:
                        try:
                            uniprot_path = os.path.join(pdb.uniprot_dir(), f"{uid}.json")
                            if os.path.exists(uniprot_path):
                                with open(uniprot_path, "r", encoding="utf-8") as f:
                                    entry = json.load(f)
                                gene_symbol = pdb.safe_get(entry, ["genes", 0, "geneName", "value"], "")
                        except Exception:
                            pass

                    # Refresh all other sources using registry
                    for source in sources:
                        if source in ["uniprot", "mobidb"]:
                            continue  # Already handled above
                        try:
                            if pdb.refresh_data_source(source, uid=uid, gene_symbol=gene_symbol):
                                details[source] = details.get(source, 0) + 1
                        except Exception:
                            pass

                # Load the refreshed protein data and return it
                try:
                    uniprot_path = os.path.join(pdb.uniprot_dir(), f"{uid}.json")
                    if os.path.exists(uniprot_path):
                        with open(uniprot_path, "r", encoding="utf-8") as f:
                            entry = json.load(f)
                        # Extract normalized protein data using backend logic
                        row = pdb.extract_row(entry, uid)
                        proteins.append(row)
                except Exception:
                    # Fail silently - continue with other proteins
                    pass

                refreshed = len(uniprot_ids) - skipped
                body = json.dumps({
                    "refreshed": refreshed,
                    "skipped": skipped,
                    "details": details,
                    "proteins": proteins
                }).encode("utf-8")

                self.send_response(200)
                _cors_headers(self)
                self.send_header("Content-Type", "application/json; charset=utf-8")
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)
                return

            except Exception as e:
                body = json.dumps({"error": str(e)}).encode("utf-8")
                self.send_response(500)
                _cors_headers(self)
                self.send_header("Content-Type", "application/json; charset=utf-8")
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)
                return

        if parsed.path == "/shutdown":
            self._serve_bytes(b"shutting down", 200)
            # shutdown server in a separate thread
            threading.Thread(target=self.server.shutdown, daemon=True).start()
            return

        self._serve_bytes(b"not found", 404)

    # ---- MobiDB helpers ----
    def _mobidb_fetch_entry(self, uid: str):
        # Prefer the new API: https://mobidb.org/api/download_page?acc=<UID>
        try:
            q = f"https://mobidb.org/api/download_page?acc={uid}"
            req = Request(q, headers={"User-Agent": "ThoteinsLocalWriter/1.0", "Accept": "application/json"})
            with urlopen(req, timeout=20) as resp:
                obj = json.load(resp)
            data = obj.get('data') if isinstance(obj, dict) else None
            if isinstance(data, list) and data:
                return data[0]
        except Exception:
            pass
        # Fallback to legacy WS (may be 503 at times)
        try:
            base = f"https://mobidb.bio.unipd.it/ws/entries/{uid}"
            req = Request(base, headers={"User-Agent": "ThoteinsLocalWriter/1.0", "Accept": "application/json"})
            with urlopen(req, timeout=20) as resp:
                return json.load(resp)
        except Exception:
            return None

    def _covered_len(self, intervals):
        try:
            spans = sorted([(int(iv.get('start')), int(iv.get('end'))) for iv in intervals if 'start' in iv and 'end' in iv], key=lambda x: (x[0], x[1]))
        except Exception:
            return 0
        if not spans:
            return 0
        total = 0
        cs, ce = spans[0]
        for s,e in spans[1:]:
            if s <= ce + 1:
                if e > ce: ce = e
            else:
                total += max(0, ce - cs + 1)
                cs, ce = s, e
        total += max(0, ce - cs + 1)
        return total

    def _mobidb_percent(self, uid: str):
        # First try local bulk mapping (offline cache)
        local = self._mobidb_percent_from_file(uid)
        if local is not None:
            return local
        # Else try live API
        entry = self._mobidb_fetch_entry(uid)
        if entry is None:
            return { 'percent_disordered': None, 'segments': [], 'length': None }
        # Save raw entry to cache for rebuild pipeline (data/proteins/mobidb/<id>.json)
        try:
            out_dir = os.path.join(_repo_root(), 'data', 'proteins', 'mobidb')
            os.makedirs(out_dir, exist_ok=True)
            with open(os.path.join(out_dir, f'{uid}.json'), 'w', encoding='utf-8') as f:
                json.dump(entry, f, ensure_ascii=False, indent=2)
        except Exception:
            pass
        # Try to use precomputed content_fraction when present
        try:
            best = None
            # BFS to collect region-like dicts
            stack = [entry]
            cands = []
            while stack:
                cur = stack.pop()
                if isinstance(cur, list):
                    stack.extend(cur)
                elif isinstance(cur, dict):
                    # region schema candidate
                    if 'content_fraction' in cur or 'regions' in cur:
                        lab = str(cur.get('id') or cur.get('source_id') or cur.get('label') or '').lower()
                        if 'disorder' in lab:
                            cands.append(cur)
                    for v in cur.values():
                        if isinstance(v, (list, dict)):
                            stack.append(v)
            # Prefer one with content_fraction and 'consensus' in label
            for prefer_consensus in (True, False):
                best = None
                best_cf = -1.0
                for c in cands:
                    lab = str(c.get('id') or c.get('source_id') or c.get('label') or '').lower()
                    if prefer_consensus and 'consensus' not in lab:
                        continue
                    cf = c.get('content_fraction')
                    try:
                        x = float(cf)
                    except Exception:
                        x = None
                    if x is not None and x > best_cf:
                        best_cf = x; best = c
                if best is not None:
                    break
            if best is not None:
                L = int(entry.get('length') or entry.get('sequence_length') or 0)
                pct = round(float(best.get('content_fraction')) * 100.0, 1)
                # Collect explicit segments if present
                segs = []
                regs = best.get('regions') or []
                for r in regs:
                    if isinstance(r, (list, tuple)) and len(r) >= 2:
                        try:
                            segs.append({'start': int(r[0]), 'end': int(r[1])})
                        except Exception:
                            pass
                return { 'percent_disordered': pct, 'segments': segs, 'length': L }
        except Exception:
            pass
        # Fallback: flatten and collect disorder intervals and compute coverage
        segs = []
        stack = [entry]
        while stack:
            cur = stack.pop()
            if isinstance(cur, list):
                stack.extend(cur)
            elif isinstance(cur, dict):
                t = str(cur.get('type') or cur.get('label') or '').lower()
                s = cur.get('start'); e = cur.get('end')
                if isinstance(s, int) and isinstance(e, int) and (('disorder' in t) or ('disordered' in t) or ('mobidb' in str(cur.get('id') or '').lower())):
                    segs.append({'start': s, 'end': e})
                for v in cur.values():
                    if isinstance(v, (list, dict)):
                        stack.append(v)
        # Try to infer sequence length from the entry call; fall back to 0
        try:
            L = int(entry.get('length') or entry.get('sequence_length') or 0)
        except Exception:
            L = 0
        cov = self._covered_len(segs)
        pct = round((100.0 * cov / L), 1) if L > 0 else None
        return { 'percent_disordered': pct, 'segments': segs, 'length': L }

    def _mobidb_percent_from_file(self, uid: str):
        try:
            base = os.path.join(_repo_root(), 'data', 'proteins')
            cands = [
                os.path.join(base, 'mobidb_disorder.tsv'),
                os.path.join(base, 'mobidb_disorder.csv'),
                os.path.join(base, 'mobidb_disorder.txt'),
            ]
            path = None
            for p in cands:
                if os.path.exists(p):
                    path = p; break
            if not path:
                return None
            # Read small header to detect delimiter and columns
            with open(path, 'r', encoding='utf-8', errors='ignore') as f:
                lines = f.read().splitlines()
            if not lines:
                return None
            header = lines[0]
            delim = '\t' if ('\t' in header) else (',' if (',' in header) else None)
            def norm(s: str) -> str:
                return ''.join(ch for ch in (s or '').lower() if ch.isalnum())
            columns = [h.strip() for h in (header.split(delim) if delim else header.split())]
            cols_norm = [norm(h) for h in columns]
            # Try to find accession/uniprot column
            acc_idx = None
            for i, h in enumerate(cols_norm):
                if h in ('uniprot','accession','uniprotid','primaryaccession'):
                    acc_idx = i; break
            if acc_idx is None:
                # fallback: any column containing 'uniprot' or 'access'
                for i, h in enumerate(cols_norm):
                    if ('uniprot' in h) or ('access' in h):
                        acc_idx = i; break
            if acc_idx is None:
                return None
            # Find disorder column
            val_idx = None
            for i, h in enumerate(cols_norm):
                if h in ('percentdisordered','disorderpercent','disordercontent','disordercoverage','fractiondisordered'):
                    val_idx = i; break
            if val_idx is None:
                for i, h in enumerate(cols_norm):
                    if ('disorder' in h) and (('percent' in h) or ('content' in h) or ('coverage' in h) or ('fraction' in h)):
                        val_idx = i; break
            if val_idx is None:
                return None
            # Build map (allow large files but simple parsing)
            m = {}
            for ln in lines[1:]:
                if not ln.strip():
                    continue
                parts = [p.strip() for p in (ln.split(delim) if delim else ln.split())]
                if len(parts) <= max(acc_idx, val_idx):
                    continue
                acc = parts[acc_idx].strip()
                val = parts[val_idx].strip()
                if not acc:
                    continue
                try:
                    x = float(val)
                    # If looks like fraction 0-1, convert to percent
                    if 0 <= x <= 1.0:
                        x = round(x * 100.0, 1)
                    else:
                        x = round(x, 1)
                    m[acc.upper()] = x
                except Exception:
                    # ignore non-numeric
                    continue
            hit = m.get(uid.upper())
            if hit is None:
                return None
            return { 'percent_disordered': hit, 'segments': [], 'length': None }
        except Exception:
            return None


def main() -> int:
    host = os.environ.get("THOTEINS_WRITER_HOST", "127.0.0.1")
    try:
        port = int(os.environ.get("THOTEINS_WRITER_PORT", "8787"))
    except Exception:
        port = 8787
    httpd = ThreadingHTTPServer((host, port), Handler)
    print(f"Local writer listening on http://{host}:{port} -> {_data_dir()}")
    try:
        httpd.serve_forever(poll_interval=0.5)
    except KeyboardInterrupt:
        pass
    finally:
        httpd.server_close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
