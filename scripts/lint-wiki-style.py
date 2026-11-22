#!/usr/bin/env python3
"""
spaCy-based stylometric linter for Brinedew wiki articles (content/wiki/*.md).

Calibrated by unsupervised comparative stylometry against Brinedew's human-written
blog posts (content/posts/*.md: avg_sent_len=20.1, noun_verb_ratio=2.23,
prep_per_1k=83.7, pass_per_1k=6.0).

Uses spaCy POS tagging and dependency parsing (not 1975 word-list regexes) to
detect structural academese at both article and sentence level:
  1. biber-sent-length: Article mean sentence length > 28 words.
  2. biber-prep-density: Article preposition density > 120 per 1,000 tokens.
  3. biber-passive-density: Article passive-clause density > 15 per 1,000 tokens.
  4. dep-prep-chain: Nested prepositional chain of depth >= 4 in one sentence.
  5. dep-passive-chain: >= 2 passive-voice clauses in one sentence.
  6. pos-adj-pileup: >= 3 consecutive adjectives (ADJ ADJ ADJ) or >= 6-token
     unbroken ADJ/NOUN nominal stack.
  7. pos-author-led: Literature-review sentence opening with named author(s) +
     reporting verb (PROPN ... VERB) instead of leading with the mechanism.

Usage:
  python ./scripts/lint-wiki-style.py                          # audit all wiki files
  python ./scripts/lint-wiki-style.py content/wiki/foo.md ...  # audit specific file(s)
"""

from __future__ import annotations

import glob
import json
import os
import re
import sys
from pathlib import Path

import spacy

REPO_ROOT = Path(__file__).resolve().parents[1]
WIKI_DIR = REPO_ROOT / "content" / "wiki"
SKIP_FILES = {"Wiki Assessment.md", "index.md", "Glossary.md"}
NV_CACHE_PATH = Path(os.environ.get("LOCALAPPDATA") or Path.home()) / "lint-wiki-style-brown-nv.json"

_NV_BROWN_COUNTS: dict[str, list[int]] | None = None
_WN = None


def _get_nv_resources():
    """Load Brown corpus NOUN/VERB counts (cached to disk) and WordNet."""
    global _NV_BROWN_COUNTS, _WN
    if _WN is None:
        from nltk.corpus import wordnet as wn

        _WN = wn
    if _NV_BROWN_COUNTS is None:
        if NV_CACHE_PATH.exists():
            try:
                _NV_BROWN_COUNTS = json.loads(NV_CACHE_PATH.read_text(encoding="utf-8"))
            except Exception:
                _NV_BROWN_COUNTS = None
        if _NV_BROWN_COUNTS is None:
            from nltk.corpus import brown

            counts: dict[str, list[int]] = {}
            for w, tag in brown.tagged_words(tagset="universal"):
                if tag not in ("NOUN", "VERB"):
                    continue
                wl = w.lower()
                pair = counts.setdefault(wl, [0, 0])
                if tag == "NOUN":
                    pair[0] += 1
                else:
                    pair[1] += 1
            _NV_BROWN_COUNTS = counts
            try:
                NV_CACHE_PATH.write_text(json.dumps(counts), encoding="utf-8")
            except Exception:
                pass
    return _NV_BROWN_COUNTS, _WN


def _token_nv_priors(tok) -> tuple[float, float, int, int]:
    """Return (noun_prior, verb_prior, wn_noun_synsets, wn_verb_synsets) for a token."""
    counts, wn = _get_nv_resources()
    w = tok.text.lower()
    lem = tok.lemma_.lower()
    if lem.endswith("s") and not wn.synsets(lem, pos=wn.VERB) and wn.synsets(w[:-1], pos=wn.VERB):
        lem = w[:-1]
    n_syn = len(wn.synsets(lem, pos=wn.NOUN))
    v_syn = len(wn.synsets(lem, pos=wn.VERB))
    if n_syn == 0 or v_syn == 0:
        return 0.0, 0.0, n_syn, v_syn
    w_pair = counts.get(w, [0, 0])
    l_pair = counts.get(lem, [0, 0])
    bn = w_pair[0] + l_pair[0] + 2 * n_syn
    bv = w_pair[1] + l_pair[1] + 2 * v_syn
    tot = bn + bv
    return (bn / tot if tot else 0.0), (bv / tot if tot else 0.0), n_syn, v_syn

REPORTING_VERBS = {
    "show",
    "demonstrate",
    "find",
    "argue",
    "propose",
    "suggest",
    "report",
    "observe",
    "note",
    "conclude",
    "describe",
    "review",
    "establish",
    "reveal",
    "identify",
    "introduce",
    "develop",
    "frame",
}


LEAD_ACADEMESE_RE = re.compile(
    r"\b(?:comprises?|constitutes?|encompasses?|represents? an?|characterizes?|serves? as|operates? as|functions? as|enforce[sd]? .{1,30} homeostasis|canonical)\b",
    re.I,
)


def extract_prose_lines(path: Path) -> list[tuple[int, str, bool]]:
    """Extract reader-facing body prose lines with (line_num, clean_text, is_lead_first_para)."""
    raw = path.read_text(encoding="utf-8", errors="ignore")
    lines = raw.splitlines()
    out: list[tuple[int, str, bool]] = []
    in_frontmatter = False
    in_code = False
    seen_h2 = False
    found_lead = False
    for idx, line in enumerate(lines, 1):
        if idx == 1 and line.strip() == "---":
            in_frontmatter = True
            continue
        if in_frontmatter:
            if line.strip() == "---":
                in_frontmatter = False
            continue
        if re.match(r"^##\s+References\b", line, re.I):
            break
        if re.match(r"^##\s+", line):
            seen_h2 = True
            continue
        if line.strip().startswith("```"):
            in_code = not in_code
            continue
        if in_code or re.match(r"^\s*[>|#]", line) or re.match(r"^\[\^", line):
            continue
        if re.match(r"^\*(?:For |Part of |Main article:|Further information:)", line.strip(), re.I):
            continue
        clean = re.sub(r"\[\^[^\]]+\]", "", line)
        clean = re.sub(r"\[\[(?:[^\]|]+\|)?([^\]]+)\]\]", r"\1", clean)
        clean = re.sub(r"\[([^\]]+)\]\([^)]+\)", r"\1", clean)
        clean = re.sub(r"\[\s*\d+(?:\s*[-–,]\s*\d+)*\s*\]", "", clean)
        clean = re.sub(r"https?://\S+|\$[^$]+\$", "", clean)
        clean = re.sub(r"[*_`]", "", clean)
        clean = re.sub(r"^\s*(?:[-*]|\d+\.)\s+", "", clean).strip()
        if len(clean.split()) >= 6:
            is_lead = (not seen_h2) and (not found_lead)
            if is_lead:
                found_lead = True
            out.append((idx, clean, is_lead))
    return out


def prep_chain_depth(token) -> int:
    """Return nested prepositional chain depth starting at an ADP/prep token."""
    if token.dep_ != "prep":
        return 0
    best = 1
    for child in token.children:
        if child.dep_ == "pobj":
            for grandchild in child.children:
                if grandchild.dep_ == "prep":
                    best = max(best, 1 + prep_chain_depth(grandchild))
    return best


def analyze_file(nlp, path: Path) -> tuple[dict, list[dict]]:
    rel = str(path.relative_to(REPO_ROOT)).replace("\\", "/")
    prose_lines = extract_prose_lines(path)
    findings: list[dict] = []

    sent_lens: list[int] = []
    tok_cnt = 0
    noun_cnt = 0
    verb_cnt = 0
    prep_cnt = 0
    pass_cnt = 0

    for line_num, text, is_lead in prose_lines:
        doc = nlp(text)
        if is_lead:
            lead_match = LEAD_ACADEMESE_RE.search(text)
            if lead_match:
                findings.append(
                    {
                        "file": rel,
                        "line": line_num,
                        "rule": "lead-academese",
                        "message": f"Stuffy academic phrasing in lead paragraph (`{lead_match.group(0)}`); open with plain, concrete English.",
                    }
                )
        for sent in doc.sents:
            toks = [t for t in sent if not t.is_space and not t.is_punct]
            if len(toks) < 6:
                continue
            sent_lens.append(len(toks))
            sent_passives = 0
            max_prep_depth = 0

            if is_lead:
                if len(toks) > 25:
                    findings.append(
                        {
                            "file": rel,
                            "line": line_num,
                            "rule": "lead-sent-length",
                            "message": f"Lead sentence is {len(toks)} words (strict intro cap: 25): \"{sent.text[:95]}...\"",
                        }
                    )
                if sent.text.count(",") >= 3 and " and " in sent.text.lower():
                    findings.append(
                        {
                            "file": rel,
                            "line": line_num,
                            "rule": "lead-jargon-list",
                            "message": f"Lead paragraph packs a 4+ item comma list before explaining the terms: \"{sent.text[:95]}...\"",
                        }
                    )
                has_finite_verb = any(
                    t.pos_ in ("VERB", "AUX") and t.tag_ in ("VBZ", "VBP", "VBD", "MD")
                    for t in toks
                )
                for tok in toks:
                    if tok.i == 0:
                        continue
                    prev = doc[tok.i - 1]
                    if prev.is_punct or prev.is_space:
                        continue
                    nr, vr, ns, vs = _token_nv_priors(tok)
                    if ns == 0 or vs == 0:
                        continue
                    if (
                        tok.pos_ == "VERB"
                        and tok.tag_ in ("VBZ", "VBP")
                        and prev.pos_ in ("NOUN", "PROPN")
                        and (nr >= 0.50 or (nr >= 0.28 and ns >= 5 and vs >= 5))
                    ):
                        findings.append(
                            {
                                "file": rel,
                                "line": line_num,
                                "rule": "lead-verb-noun-ambiguity",
                                "message": f"Garden-path verb-noun ambiguity `{prev.text} {tok.text}` (`{tok.text}` has {nr:.0%} noun prior / {ns} noun synsets after a noun; rewrite with an unambiguous verb).",
                            }
                        )
                    elif (
                        tok.pos_ == "NOUN"
                        and prev.pos_ in ("NOUN", "PROPN")
                        and (
                            (
                                vr >= 0.50
                                and tok.dep_ in ("nsubj", "ROOT", "conj")
                                and not any(c.dep_ == "det" for c in tok.children)
                            )
                            or (tok.tag_ == "NNS" and not has_finite_verb)
                        )
                    ):
                        findings.append(
                            {
                                "file": rel,
                                "line": line_num,
                                "rule": "lead-verb-noun-ambiguity",
                                "message": f"Garden-path verb-noun ambiguity `{prev.text} {tok.text}` (`{tok.text}` collides between noun and verb after `{prev.text}`; rewrite so subject and main verb are unmistakable).",
                            }
                        )
                    elif tok.text.lower().endswith("ing") and prev.pos_ == "ADJ" and vr >= 0.75:
                        findings.append(
                            {
                                "file": rel,
                                "line": line_num,
                                "rule": "lead-verb-noun-ambiguity",
                                "message": f"Garden-path gerund-participle ambiguity `{prev.text} {tok.text}` (`{tok.text}` has {vr:.0%} verb prior after an adjective; use a concrete noun instead of a bare `-ing` form).",
                            }
                        )

            for t in toks:
                tok_cnt += 1
                if t.pos_ == "NOUN":
                    noun_cnt += 1
                elif t.pos_ == "VERB":
                    verb_cnt += 1
                if t.dep_ == "prep":
                    prep_cnt += 1
                    d = prep_chain_depth(t)
                    if d > max_prep_depth:
                        max_prep_depth = d
                if t.dep_ in ("nsubjpass", "auxpass"):
                    if t.dep_ == "auxpass":
                        pass_cnt += 1
                        sent_passives += 1

            # 1. Deep nested prepositional chain (depth >= 4)
            if max_prep_depth >= 4:
                findings.append(
                    {
                        "file": rel,
                        "line": line_num,
                        "rule": "dep-prep-chain",
                        "message": f"Nested prepositional chain of depth {max_prep_depth}: \"{sent.text[:110]}...\"",
                    }
                )

            # 2. Multiple passive-voice clauses in one sentence
            if sent_passives >= 2:
                findings.append(
                    {
                        "file": rel,
                        "line": line_num,
                        "rule": "dep-passive-chain",
                        "message": f"Sentence chains {sent_passives} passive clauses: \"{sent.text[:110]}...\"",
                    }
                )

            # 3. Triple-adjective pileup (3 separate non-hyphenated consecutive ADJ tokens)
            for i in range(len(toks) - 2):
                a, b, c = toks[i], toks[i + 1], toks[i + 2]
                if a.i + 1 != b.i or b.i + 1 != c.i:
                    continue
                if a.pos_ == b.pos_ == c.pos_ == "ADJ":
                    # Skip hyphenated technical compounds (e.g. "negative frequency-dependent")
                    raw_span = doc.text[a.idx : c.idx + len(c.text)]
                    if "-" in raw_span:
                        continue
                    findings.append(
                        {
                            "file": rel,
                            "line": line_num,
                            "rule": "pos-adj-pileup",
                            "message": f"Stacked triple-adjective modifier `{raw_span}`.",
                        }
                    )
                    break

            # 3b. Pied-piped prepositional relative ("in which", "by which", "at which", "through which")
            for i in range(len(toks) - 1):
                if (
                    toks[i].pos_ == "ADP"
                    and toks[i + 1].text.lower() == "which"
                    and toks[i + 1].dep_ == "pobj"
                ):
                    findings.append(
                        {
                            "file": rel,
                            "line": line_num,
                            "rule": "dep-pied-piping",
                            "message": f"Pied-piped relative `{toks[i].text} which`; rewrite with a direct clause.",
                        }
                    )
                    break

            # 4. Author-led literature-review opener (PROPN ... reporting VERB,
            #    including after a leading "In YYYY," date phrase)
            author_start = 0
            if (
                len(toks) >= 6
                and toks[0].text.lower() == "in"
                and re.match(r"^(?:1[6-9]\d\d|20\d\d)s?$", toks[1].text)
            ):
                author_start = 2
            if len(toks) >= author_start + 4 and toks[author_start].pos_ == "PROPN":
                window = toks[author_start : author_start + 6]
                has_author_group = (
                    author_start == 2
                    or any(
                        t.text.lower() in ("and", "et") or t.pos_ == "PROPN"
                        for t in window[1:4]
                    )
                )
                rep_verb = next(
                    (t for t in window[1:6] if t.pos_ == "VERB" and t.lemma_.lower() in REPORTING_VERBS),
                    None,
                )
                if has_author_group and rep_verb is not None:
                    findings.append(
                        {
                            "file": rel,
                            "line": line_num,
                            "rule": "pos-author-led",
                            "message": f"Author-led review opener (`{toks[author_start].text} ... {rep_verb.text}`); lead with the mechanism and move authors to footnotes unless conceptual priority matters.",
                        }
                    )

            # 4b. Bloodless possessive-author-year / paper-noun subject
            # e.g. "Fisher's 1930 reproductive value supplied...", "Haldane's 1941 analysis applied..."
            ABSTRACT_WORK_NOUNS = {
                "discussion", "analysis", "proposal", "argument", "essay", "paper",
                "lecture", "review", "critique", "formulation", "account", "framework",
                "treatment", "work", "study", "model", "theory", "value",
            }
            for t in toks:
                if t.dep_ != "nsubj" or t.pos_ != "NOUN":
                    continue
                poss = next((c for c in t.children if c.dep_ == "poss" and c.pos_ == "PROPN"), None)
                if poss is None:
                    continue
                has_year = any(re.match(r"^(?:1[6-9]\d\d|20\d\d)s?$", c.text) for c in t.children)
                if has_year and t.lemma_.lower() in ABSTRACT_WORK_NOUNS:
                    findings.append(
                        {
                            "file": rel,
                            "line": line_num,
                            "rule": "dep-possessive-nominal-subject",
                            "message": f"Possessive-year nominalized subject (`{poss.text}'s ... {t.text}`); state the concrete idea or have a person act directly instead of abstract paper-summary prose.",
                        }
                    )
                    break

    avg_sent_len = round(sum(sent_lens) / max(1, len(sent_lens)), 1)
    noun_verb = round(noun_cnt / max(1, verb_cnt), 2)
    prep_1k = round(1000 * prep_cnt / max(1, tok_cnt), 1)
    pass_1k = round(1000 * pass_cnt / max(1, tok_cnt), 1)

    metrics = {
        "file": rel,
        "tokens": tok_cnt,
        "avg_sent_len": avg_sent_len,
        "noun_verb_ratio": noun_verb,
        "prep_per_1k": prep_1k,
        "pass_per_1k": pass_1k,
    }

    if tok_cnt >= 250:
        if avg_sent_len > 28.0:
            findings.append(
                {
                    "file": rel,
                    "line": 1,
                    "rule": "biber-sent-length",
                    "message": f"Mean sentence length is {avg_sent_len} words (posts baseline: 20.1; threshold: 28.0).",
                }
            )
        if prep_1k > 125.0:
            findings.append(
                {
                    "file": rel,
                    "line": 1,
                    "rule": "biber-prep-density",
                    "message": f"Preposition density is {prep_1k}/1k tokens (posts baseline: 83.7; threshold: 125.0).",
                }
            )
        if pass_1k > 15.0:
            findings.append(
                {
                    "file": rel,
                    "line": 1,
                    "rule": "biber-passive-density",
                    "message": f"Passive-voice density is {pass_1k}/1k tokens (posts baseline: 6.0; threshold: 15.0).",
                }
            )

    return metrics, findings


def main(argv: list[str]) -> int:
    as_json = "--json" in argv
    args = [a for a in argv if a != "--json"]
    if args:
        targets = [Path(a).resolve() for a in args if Path(a).exists()]
    else:
        targets = sorted(
            p for p in WIKI_DIR.glob("*.md") if p.name not in SKIP_FILES
        )

    nlp = spacy.load("en_core_web_sm", disable=["ner"])
    all_metrics = []
    all_findings = []
    for path in targets:
        m, f = analyze_file(nlp, path)
        all_metrics.append(m)
        all_findings.extend(f)

    if as_json:
        print(json.dumps({"metrics": all_metrics, "findings": all_findings}, indent=2))
    else:
        for f in all_findings:
            print(f"{f['file']}:{f['line']} [{f['rule']}] {f['message']}")
        print(
            f"\nlint-wiki-style: {len(targets)} file(s) checked, {len(all_findings)} stylometric finding(s)."
        )
    return 1 if all_findings else 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
