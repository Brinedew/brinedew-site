from __future__ import annotations

import argparse
import csv
import io
import os
import sys
from typing import List, Dict
from urllib.request import Request, urlopen
from urllib.error import HTTPError


def repo_root() -> str:
    here = os.path.dirname(os.path.abspath(__file__))
    return os.path.abspath(os.path.join(here, ".."))


def default_out_path() -> str:
    out_dir = os.path.join(repo_root(), "data", "proteins")
    os.makedirs(out_dir, exist_ok=True)
    return os.path.join(out_dir, "batch_top100.csv")


def make_sparql_query(taxon: int = 9606, reviewed: bool = True, curated_only: bool = False, limit: int = 100) -> str:
    graph_filter = []
    graph_filter.append("?protein a up:Protein ;")
    if taxon:
        graph_filter.append(f"         up:organism taxon:{taxon} ;")
    if reviewed:
        graph_filter.append("         up:reviewed true .")
    else:
        # terminate triple if last line didn't place a dot
        if graph_filter[-1].strip().endswith(";"):
            graph_filter[-1] = graph_filter[-1].rstrip(";") + " ."

    curated_block = (
        "  GRAPH <http://sparql.uniprot.org/uniprot> {\n"
        "    ?protein up:citation ?citation .\n"
        "  }\n"
    )
    mapped_block = (
        "  GRAPH <http://sparql.uniprot.org/citationmapping> {\n"
        "    ?stmt a up:Citation_Statement ;\n"
        "          rdf:subject ?protein ;\n"
        "          up:mappedCitation ?citation .\n"
        "  }\n"
    )

    if curated_only:
        citation_part = curated_block
    else:
        citation_part = curated_block + "  UNION\n" + mapped_block

    query = f"""
PREFIX up:    <http://purl.uniprot.org/core/>
PREFIX taxon: <http://purl.uniprot.org/taxonomy/>
PREFIX uniprotkb: <http://purl.uniprot.org/uniprot/>
PREFIX rdf:   <http://www.w3.org/1999/02/22-rdf-syntax-ns#>

SELECT
  (SUBSTR(STR(?protein), STRLEN(STR(uniprotkb:))+1) AS ?uniprot_accession)
  (COUNT(DISTINCT ?citation) AS ?pub_count)
WHERE {{
  GRAPH <http://sparql.uniprot.org/uniprot> {{
    {os.linesep.join(graph_filter)}
  }}

{citation_part}
}}
GROUP BY ?protein
ORDER BY DESC(?pub_count)
LIMIT {int(limit)}
""".strip()
    return query


def fetch_top_ids(query: str, timeout: int = 30) -> List[Dict[str, str]]:
    endpoint = "https://sparql.uniprot.org/sparql"
    req = Request(
        endpoint,
        data=query.encode("utf-8"),
        method="POST",
        headers={
            "Content-Type": "application/sparql-query",
            "Accept": "application/sparql-results+csv, text/csv",
            "User-Agent": "ThoteinsBatch/1.0",
        },
    )
    try:
        with urlopen(req, timeout=timeout) as resp:
            body = resp.read().decode("utf-8", errors="replace")
    except HTTPError:
        # Fallback: POST as application/x-www-form-urlencoded with query= and format=csv
        import urllib.parse as _up
        data = _up.urlencode({"query": query, "format": "csv"}).encode("utf-8")
        req2 = Request(
            endpoint,
            data=data,
            method="POST",
            headers={
                "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
                "Accept": "application/sparql-results+csv, text/csv; charset=UTF-8",
                "User-Agent": "ThoteinsBatch/1.0",
            },
        )
        try:
            with urlopen(req2, timeout=timeout) as resp2:
                body = resp2.read().decode("utf-8", errors="replace")
        except HTTPError:
            # Final fallback: GET with query params
            params = _up.urlencode({"query": query, "format": "csv"})
            url = endpoint + "?" + params
            req3 = Request(
                url,
                method="GET",
                headers={
                    "Accept": "application/sparql-results+csv, text/csv; charset=UTF-8",
                    "User-Agent": "ThoteinsBatch/1.0",
                },
            )
            with urlopen(req3, timeout=timeout) as resp3:
                body = resp3.read().decode("utf-8", errors="replace")
    # Parse CSV
    rows: List[Dict[str, str]] = []
    rdr = csv.DictReader(io.StringIO(body))
    for r in rdr:
        # Normalize likely headers
        uid = r.get("uniprot_accession") or r.get("uniprot") or r.get("accession") or ""
        cnt = r.get("pub_count") or r.get("count") or ""
        uid = str(uid).strip()
        if not uid:
            continue
        rows.append({"uniprot_id": uid, "pub_count": str(cnt).strip()})
    return rows


def write_prompter_csv(rows: List[Dict[str, str]], out_path: str, include_count: bool = True) -> str:
    os.makedirs(os.path.dirname(out_path), exist_ok=True)
    fieldnames = ["uniprot_id"] + (["pub_count"] if include_count else [])
    tmp = out_path + ".tmp"
    with open(tmp, "w", encoding="utf-8", newline="") as f:
        w = csv.DictWriter(f, fieldnames=fieldnames)
        w.writeheader()
        for r in rows:
            w.writerow({k: r.get(k, "") for k in fieldnames})
    # Replace
    try:
        os.replace(tmp, out_path)
    except PermissionError:
        # Fallback if the file is open somewhere
        alt = out_path + ".next"
        try:
            if os.path.exists(alt):
                os.remove(alt)
        except Exception:
            pass
        os.replace(tmp, alt)
        return alt
    return out_path


def main(argv: List[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description="Build a Prompter-ready CSV of top UniProt IDs by publication count (UniProt SPARQL)")
    ap.add_argument("--taxon", type=int, default=9606, help="NCBI Taxon ID (default: 9606 human)")
    ap.add_argument("--limit", type=int, default=100, help="Number of entries (default: 100)")
    grp = ap.add_mutually_exclusive_group()
    grp.add_argument("--curated-only", action="store_true", help="Count curated citations only (no mapped)")
    grp.add_argument("--include-mapped", action="store_true", help="Include mapped citations (default)")
    ap.add_argument("--reviewed", action="store_true", default=True, help="Limit to reviewed entries (Swiss-Prot). Default on.")
    ap.add_argument("--unreviewed", action="store_true", help="Include unreviewed entries (TrEMBL)")
    ap.add_argument("--out", default=default_out_path(), help="Output CSV path (default: data/proteins/batch_top100.csv)")
    ap.add_argument("--ids-only", action="store_true", help="Write only the uniprot_id column (omit pub_count)")
    ap.add_argument("--from-sparql-csv", help="Use a previously downloaded UniProt SPARQL CSV file instead of querying over network")
    ap.add_argument("--from-ids", help="Path to a text/CSV file containing a column named 'uniprot_id' or plain one-ID-per-line list")
    args = ap.parse_args(argv)

    reviewed = not args.unreviewed
    curated_only = args.curated_only and not args.include_mapped

    if args.from_ids:
        # Parse IDs from a simple text/CSV file
        path = args.from_ids
        rows = []
        try:
            with open(path, "r", encoding="utf-8", errors="replace") as f:
                text = f.read()
            # Try CSV first
            sio = io.StringIO(text)
            try:
                rdr = csv.DictReader(sio)
                if rdr.fieldnames and any(h.strip().lower() == "uniprot_id" for h in rdr.fieldnames):
                    for r in rdr:
                        uid = (r.get("uniprot_id") or "").strip()
                        if uid:
                            rows.append({"uniprot_id": uid})
                else:
                    raise ValueError("no uniprot_id header")
            except Exception:
                # Fallback: one ID per non-empty line
                rows = []
                for line in text.splitlines():
                    uid = line.strip()
                    if uid and not uid.lower().startswith("uniprot_id"):
                        rows.append({"uniprot_id": uid})
        except Exception as e:
            print("Failed to read IDs:", e, file=sys.stderr)
            return 2
    elif args.from_sparql_csv:
        # Local CSV path from SPARQL UI download
        with open(args.from_sparql_csv, "r", encoding="utf-8", errors="replace") as f:
            rdr = csv.DictReader(f)
            rows = []
            for r in rdr:
                uid = (r.get("uniprot_accession") or r.get("uniprot") or r.get("accession") or "").strip()
                cnt = (r.get("pub_count") or r.get("count") or "").strip()
                if uid:
                    rows.append({"uniprot_id": uid, "pub_count": cnt})
    else:
        q = make_sparql_query(taxon=args.taxon, reviewed=reviewed, curated_only=curated_only, limit=args.limit)
        rows = fetch_top_ids(q)
    if not rows:
        print("No rows returned from SPARQL.", file=sys.stderr)
        return 2
    out_path = write_prompter_csv(rows, args.out, include_count=(not args.ids_only))
    print("Wrote:", out_path)
    print("Count:", len(rows))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
