#!/usr/bin/env python3
"""
Internal spaCy stylometry and crash-blossom engine invoked exclusively by
`scripts/lint-wiki.mjs` (`pnpm run lint:wiki`).

Do not invoke directly; use `pnpm run lint:wiki [files...]`.
"""

from __future__ import annotations

import json
import os
import re
import sys
from pathlib import Path

if os.environ.get("BRINEDEW_LINT_WIKI_INTERNAL") != "1":
    sys.stderr.write(
        "This is an internal module of the wiki linter. Do not invoke it directly.\n"
        "Use the single canonical command instead: pnpm run lint:wiki [files...]\n"
    )
    raise SystemExit(2)

import spacy

REPO_ROOT = Path(__file__).resolve().parents[2]
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

TRAILING_PARTICIPLE_RE = re.compile(r",\s+([a-z]{4,}ing)\b")
TRAILING_PARTICIPLE_STOP = {
    "including", "excluding", "during", "following", "regarding", "concerning",
    "according", "depending", "considering", "assuming", "starting", "ending",
    "using", "being", "having", "nothing", "something", "everything", "anything",
    "aging", "ageing", "signaling", "signalling", "funding", "spending", "feeding",
    "remodeling", "crosslinking", "bundling", "sequencing", "profiling", "staining",
    "labeling", "cloning", "breeding", "foraging", "kneeling", "winding", "timing",
    "coupling", "wiring", "rewiring", "leveling", "sanctioning", "policing", "shedding",
    "crowding", "competing", "dividing", "renewing", "warming", "shading", "wounding",
    "streaming", "reading", "writing", "meaning", "building", "ceiling", "setting",
    "finding", "offspring", "string", "ring", "king", "wing", "thing", "bring", "spring",
}

CONTRASTIVE_NEG_RE = re.compile(
    r"\b(?:(?:is|are|was|were|does|do|did)\s+not\s+(?:merely|simply|just|only|an?\s+(?:mere|simple|peripheral|single|universal|fixed|passive|static))\b"
    r"|not\s+(?:merely|simply|just|only)\b[^.?!]{1,100}\b(?:but|rather|instead)\b"
    r"|rather\s+than\b"
    r"|instead\s+of\b"
    r"|(?:does|do|did)\s+not\s+(?:prove|settle|show|imply|mean|guarantee|explain|remove|eliminate|change|alter|require)\b)",
    re.I,
)

NEGATION_WORDS = {"not", "no", "never", "neither", "nor", "nothing", "none"}

# Common plain verbs that happen to have a high noun prior in Brown but do not
# trigger real garden-path crash blossoms after a subject noun.
SAFE_BODY_VERBS = {
    "use", "uses", "make", "makes", "give", "gives", "take", "takes",
    "show", "shows", "hold", "holds", "keep", "keeps", "set", "sets",
    "run", "runs", "move", "moves", "play", "plays", "fall", "falls",
    "rise", "rises", "drop", "drops", "stay", "stays", "live", "lives",
    "need", "needs", "mean", "means", "help", "helps", "cause", "causes",
    "change", "changes", "start", "starts", "end", "ends", "lead", "leads",
    "cut", "cuts", "pull", "pulls", "push", "pushes", "turn", "turns",
    "pay", "pays", "raise", "raises", "lower", "lowers", "grow", "grows",
    "call", "calls", "reach", "reaches", "leave", "leaves", "break", "breaks",
    "stop", "stops", "build", "builds", "stand", "stands", "carry", "carries",
    "act", "acts", "work", "works", "fit", "fits", "last", "lasts",
}

# Common non-ambiguous gerund-like nouns/adjectives that aren't crash blossoms
SAFE_ING_PREFIXES = {
    "during", "including", "excluding", "following", "regarding", "concerning",
    "according", "using", "being", "having", "aging", "ageing", "signaling",
    "signalling", "existing", "remaining", "resulting", "underlying", "neighboring",
    "surrounding", "dividing", "renewing", "developing", "competing", "expanding",
    "working", "living", "feeding", "growing", "repeating", "increasing", "rising",
    "falling", "leading", "supporting", "competing", "standing", "funding", "spending",
}


def _article_class(path: Path) -> str:
    raw = path.read_text(encoding="utf-8", errors="ignore")
    m = re.search(r"(?m)^class:\s*([A-Za-z]+)", raw)
    return m.group(1).upper() if m else ""


def _compute_mattr(words: list[str], window: int = 50) -> float:
    if len(words) < window:
        return 0.0
    total = sum(len(set(words[i : i + window])) / window for i in range(len(words) - window + 1))
    return total / (len(words) - window + 1)


def _compute_mtld_dir(words: list[str], threshold: float = 0.72) -> float:
    factors = 0.0
    types: set[str] = set()
    tokens = 0
    for w in words:
        tokens += 1
        types.add(w)
        ttr = len(types) / tokens
        if ttr <= threshold:
            factors += 1.0
            types.clear()
            tokens = 0
    if tokens > 0:
        ttr = len(types) / tokens
        if ttr < 1.0:
            factors += (1.0 - ttr) / (1.0 - threshold)
    return len(words) / factors if factors > 0 else float(len(words))


def _compute_mtld(words: list[str]) -> float:
    if len(words) < 50:
        return 0.0
    seq = words[:2000]
    return (_compute_mtld_dir(seq) + _compute_mtld_dir(list(reversed(seq)))) / 2.0


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
        if re.match(r"^##\s+(?:See also|References)\b", line, re.I):
            break
        if re.match(r"^##\s+", line):
            seen_h2 = True
            continue
        if line.strip().startswith("```"):
            in_code = not in_code
            continue
        if in_code or re.match(r"^\s*[>|#]", line) or re.match(r"^\[\^", line):
            continue
        if re.match(r"^\s*---+\s*$", line) or re.match(r"^\s*!\[\[", line):
            continue
        if re.match(r"^\*(?:For |Part of |Main article:|Further information:)", line.strip(), re.I):
            continue
        clean = re.sub(r"\[\^[^\]]+\]", "", line)
        clean = re.sub(r"\[\[(?:[^\]|]+\|)?([^\]]+)\]\]", r"\1", clean)
        clean = re.sub(r"\[([^\]]+)\]\([^)]+\)", r"\1", clean)
        clean = re.sub(r"\[\s*\d+(?:\s*[-–,]\s*\d+)*\s*\]", "", clean)
        clean = re.sub(r"https?://\S+|\$\$[\s\S]*?\$\$|\$[^$]+\$", "", clean)
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
    article_cls = _article_class(path)
    if path.name in SKIP_FILES or article_cls in ("LIST", "FL", "NA", "STUB"):
        return {"file": rel, "class": article_cls, "skipped": True}, []

    prose_lines = extract_prose_lines(path)
    findings: list[dict] = []

    sent_lens: list[int] = []
    alpha_words: list[str] = []
    body_chunks: list[str] = []
    tok_cnt = 0
    noun_cnt = 0
    verb_cnt = 0
    prep_cnt = 0
    pass_cnt = 0
    participle_clause_cnt = 0

    for line_num, text, is_lead in prose_lines:
        body_chunks.append(text)
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
            if len(toks) < 4:
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

            # Body-wide crash-blossom / garden-path ambiguity detection
            reported_cb: set[int] = set()
            for idx_t, tok in enumerate(toks):
                if idx_t == 0:
                    continue
                prev = toks[idx_t - 1]
                if prev.i + 1 != tok.i:
                    continue
                nr, vr, ns, vs = _token_nv_priors(tok)
                if ns == 0 or vs == 0:
                    continue
                has_det = any(c.dep_ in ("det", "poss", "nummod") for c in tok.children)

                # 1. Phrasal-verb particle + bare ambiguous noun-verb (e.g. "playing down wins")
                if (
                    tok.pos_ == "NOUN"
                    and not has_det
                    and vr >= 0.40
                    and prev.dep_ == "prt"
                    and prev.head.i + 1 == prev.i
                ):
                    reported_cb.add(tok.i)
                    findings.append(
                        {
                            "file": rel,
                            "line": line_num,
                            "rule": "crash-blossom",
                            "message": f"Crash-blossom phrasal-verb ambiguity `{prev.head.text} {prev.text} {tok.text}` (`{tok.text}` has {vr:.0%} verb prior with no determiner after particle `{prev.text}`; add a determiner or use an unambiguous noun).",
                        }
                    )
                    continue

                # 2. Gerund/-ing + bare ambiguous plural noun (e.g. "downplaying wins feels", "Crosslinking breaks")
                if (
                    tok.pos_ == "NOUN"
                    and tok.tag_ == "NNS"
                    and not has_det
                    and vr >= 0.45
                    and prev.text.lower().endswith("ing")
                    and prev.text.lower() not in SAFE_ING_PREFIXES
                ):
                    reported_cb.add(tok.i)
                    findings.append(
                        {
                            "file": rel,
                            "line": line_num,
                            "rule": "crash-blossom",
                            "message": f"Crash-blossom gerund+plural ambiguity `{prev.text} {tok.text}` (`{tok.text}` has {vr:.0%} verb prior with no determiner after `{prev.text}`; add a determiner or use an unambiguous noun).",
                        }
                    )
                    continue

                # 3. Verb parsed right after a particle/gerund that looks like a crash-blossom noun object
                if (
                    tok.pos_ == "VERB"
                    and tok.tag_ in ("VBZ", "VBP")
                    and nr >= 0.30
                    and (
                        (prev.dep_ == "prt" and prev.head.i + 1 == prev.i)
                        or (
                            prev.tag_ == "VBG"
                            and prev.text.lower() not in SAFE_ING_PREFIXES
                            and idx_t + 1 < len(toks)
                            and toks[idx_t + 1].pos_ in ("VERB", "AUX")
                        )
                    )
                ):
                    reported_cb.add(tok.i)
                    findings.append(
                        {
                            "file": rel,
                            "line": line_num,
                            "rule": "crash-blossom",
                            "message": f"Crash-blossom ambiguity `{prev.text} {tok.text}` (`{tok.text}` collides between noun and verb after `{prev.text}`; rewrite so object and main verb are unmistakable).",
                        }
                    )
                    continue

                # 4. Body-wide NOUN + strongly noun-dominant VERB (e.g. "gene patterns", "layer speeds", "pool backs", "dimers pair", "marks control")
                if (
                    not is_lead
                    and tok.pos_ == "VERB"
                    and tok.tag_ in ("VBZ", "VBP")
                    and prev.pos_ in ("NOUN", "PROPN")
                    and tok.text.lower() not in SAFE_BODY_VERBS
                    and nr >= 0.72
                    and ns >= 4
                    and tok.i not in reported_cb
                ):
                    findings.append(
                        {
                            "file": rel,
                            "line": line_num,
                            "rule": "crash-blossom",
                            "message": f"Crash-blossom noun-verb ambiguity `{prev.text} {tok.text}` (`{tok.text}` has {nr:.0%} noun prior / {ns} noun synsets directly after noun `{prev.text}`; use an unambiguous verb).",
                        }
                    )

            for t in toks:
                tok_cnt += 1
                if t.is_alpha:
                    alpha_words.append(t.text.lower())
                if t.pos_ == "NOUN":
                    noun_cnt += 1
                elif t.pos_ == "VERB":
                    verb_cnt += 1
                if t.tag_ == "VBG" and t.dep_ in ("advcl", "acl"):
                    participle_clause_cnt += 1
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

            # 4. Author-led literature-review opener
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
            abstract_work_nouns = {
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
                if has_year and t.lemma_.lower() in abstract_work_nouns:
                    findings.append(
                        {
                            "file": rel,
                            "line": line_num,
                            "rule": "dep-possessive-nominal-subject",
                            "message": f"Possessive-year nominalized subject (`{poss.text}'s ... {t.text}`); state the concrete idea or have a person act directly instead of abstract paper-summary prose.",
                        }
                    )
                    break

    full_prose = "\n".join(body_chunks)
    n_alpha = max(1, len(alpha_words))
    avg_sent_len = round(sum(sent_lens) / max(1, len(sent_lens)), 1)
    if len(sent_lens) > 1:
        var_sl = sum((x - avg_sent_len) ** 2 for x in sent_lens) / (len(sent_lens) - 1)
        sd_sent_len = round(var_sl ** 0.5, 1)
    else:
        sd_sent_len = 0.0
    cv_sent_len = round(sd_sent_len / avg_sent_len, 2) if avg_sent_len > 0 else 0.0
    noun_verb = round(noun_cnt / max(1, verb_cnt), 2)
    prep_1k = round(1000 * prep_cnt / max(1, tok_cnt), 1)
    pass_1k = round(1000 * pass_cnt / max(1, tok_cnt), 1)
    part_1k = round(1000 * participle_clause_cnt / max(1, tok_cnt), 1)
    mattr50 = round(_compute_mattr(alpha_words, 50), 3)
    mtld = round(_compute_mtld(alpha_words), 1)

    tp_hits = [m.group(1).lower() for m in TRAILING_PARTICIPLE_RE.finditer(full_prose) if m.group(1).lower() not in TRAILING_PARTICIPLE_STOP]
    tp_1k = round(1000 * len(tp_hits) / n_alpha, 1)
    cneg_cnt = len(CONTRASTIVE_NEG_RE.findall(full_prose))
    cneg_1k = round(1000 * cneg_cnt / n_alpha, 1)
    neg_1k = round(1000 * sum(1 for w in alpha_words if w in NEGATION_WORDS) / n_alpha, 1)
    colon_cnt = len(re.findall(r"[A-Za-z)\]]\s*:\s+[a-z]", full_prose))
    colon_1k = round(1000 * colon_cnt / n_alpha, 1)

    metrics = {
        "file": rel,
        "tokens": tok_cnt,
        "avg_sent_len": avg_sent_len,
        "sd_sent_len": sd_sent_len,
        "cv_sent_len": cv_sent_len,
        "mattr50": mattr50,
        "mtld": mtld,
        "noun_verb_ratio": noun_verb,
        "prep_per_1k": prep_1k,
        "pass_per_1k": pass_1k,
        "participle_clause_per_1k": part_1k,
        "trailing_participle_per_1k": tp_1k,
        "contrastive_neg_per_1k": cneg_1k,
        "negation_per_1k": neg_1k,
        "rhetorical_colon_per_1k": colon_1k,
    }

    # Quantitative stylometry gates calibrated against 8 Biology/Science Wikipedia FAs
    # and 10 Brinedew B-class articles (0 false positives on either baseline).
    if tok_cnt >= 250 and len(sent_lens) >= 8:
        if avg_sent_len > 25.0 or avg_sent_len < 14.5:
            findings.append(
                {
                    "file": rel,
                    "line": 1,
                    "rule": "stylometry-sent-length",
                    "message": f"Mean sentence length is {avg_sent_len} words (Wikipedia FA: 18.9–22.9; Brinedew B-class: 15.0–21.9; allowed band: 14.5–25.0).",
                }
            )
        if sd_sent_len < 7.5 or cv_sent_len < 0.38:
            findings.append(
                {
                    "file": rel,
                    "line": 1,
                    "rule": "stylometry-low-burstiness",
                    "message": f"Sentence-length rhythm is too uniform (SD={sd_sent_len}, CV={cv_sent_len}; Wikipedia FA SD=9.0–11.0, Brinedew B-class SD=9.4–15.6). Mix concise statements with fuller explanations.",
                }
            )
        if mattr50 > 0.865 and mtld > 165.0:
            findings.append(
                {
                    "file": rel,
                    "line": 1,
                    "rule": "stylometry-synonym-cycling",
                    "message": f"Over-synonymized LLM vocabulary signature (MATTR-50={mattr50}, MTLD={mtld}; Wikipedia FA MTLD=67–94, Brinedew B-class MATTR-50<=0.863, MTLD<=153). Reuse plain, concrete domain nouns.",
                }
            )
        if (participle_clause_cnt >= 4 and part_1k > 10.0) or (len(tp_hits) >= 3 and tp_1k > 4.0):
            findings.append(
                {
                    "file": rel,
                    "line": 1,
                    "rule": "stylometry-participle-density",
                    "message": f"High present-participial clause rate (VBG advcl/acl={part_1k}/1k, trailing ', verb-ing'={tp_1k}/1k; Reinhart et al. PNAS 2025 LLM marker). Convert participial clauses into finite verbs.",
                }
            )
        if (cneg_cnt >= 2 and cneg_1k > 3.0) or neg_1k > 11.5:
            findings.append(
                {
                    "file": rel,
                    "line": 1,
                    "rule": "stylometry-contrastive-negation",
                    "message": f"Overuse of contrastive negation / negative framing (contrastive={cneg_1k}/1k, raw negations={neg_1k}/1k; Wikipedia FA=0.3/1k & 3.6/1k, Brinedew B-class=0.8/1k & 7.4/1k). State mechanisms affirmatively.",
                }
            )
        if colon_cnt >= 4 and colon_1k > 6.0:
            findings.append(
                {
                    "file": rel,
                    "line": 1,
                    "rule": "stylometry-rhetorical-colons",
                    "message": f"High mid-sentence rhetorical colon rate ({colon_1k}/1k words, {colon_cnt} hits; Wikipedia FA=0.9/1k, Brinedew B-class<=5.9/1k). Use periods or subordinate clauses.",
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
    targets = [Path(a).resolve() for a in argv if Path(a).exists()]
    if not targets:
        print(json.dumps({"metrics": [], "findings": []}))
        return 0

    nlp = spacy.load("en_core_web_sm", disable=["ner"])
    all_metrics = []
    all_findings = []
    for path in targets:
        m, f = analyze_file(nlp, path)
        all_metrics.append(m)
        all_findings.extend(f)

    print(json.dumps({"metrics": all_metrics, "findings": all_findings}))
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
