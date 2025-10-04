import json
import sys
from urllib.request import urlopen, Request


LOC_INDOORS = {
    'nucleoplasm','nucleus','nuclear membrane','nuclear envelope','nucleoli','nucleolus','nuclear speckles','speckles',
    'mitochondria','mitochondrion','mitochondrial'
}


def fetch_uniprot(uid: str) -> dict:
    url = f"https://rest.uniprot.org/uniprotkb/{uid}.json"
    req = Request(url, headers={"User-Agent": "ProteinPortraitTester/1.0"})
    with urlopen(req, timeout=20) as resp:
        data = json.load(resp)
    # basics
    gene_symbol = (data.get('genes') or [{}])[0].get('geneName', {}).get('value') or uid
    title = data.get('proteinDescription', {}).get('recommendedName', {}).get('fullName', {}).get('value') or gene_symbol
    mass = data.get('sequence', {}).get('molWeight')
    if mass is not None:
        mass = round(mass / 1000)
    length_aa = data.get('sequence', {}).get('length')
    # domains
    domains = []
    for f in data.get('features') or []:
        if f.get('type') in ('DOMAIN','REGION','MOTIF'):
            d = f.get('description')
            if d:
                domains.append(d)
        if len(domains) >= 3:
            break
    domains_s = ", ".join(domains)
    # subcellular locations
    locs = []
    for c in data.get('comments') or []:
        if c.get('commentType') == 'SUBCELLULAR_LOCATION':
            for sl in c.get('subcellularLocations') or []:
                v = (sl.get('location') or {}).get('value')
                if v:
                    locs.append(v)
    # keywords fallback
    keywords = []
    for k in data.get('keywords') or []:
        v = k.get('value')
        if v:
            keywords.append(v)
    # TSV fallback if both empty
    if not locs and not keywords:
        try:
            import urllib.parse
            q = urllib.parse.quote(f"accession:{uid}")
            tsv_url = f"https://rest.uniprot.org/uniprotkb/stream?compressed=false&format=tsv&query={q}&fields=cc_subcellular_location,keyword"
            req2 = Request(tsv_url, headers={"User-Agent": "ProteinPortraitTester/1.0"})
            with urlopen(req2, timeout=20) as resp2:
                txt = resp2.read().decode('utf-8', errors='ignore')
            lines = [ln for ln in txt.splitlines() if ln.strip()]
            if len(lines) >= 2:
                headers = lines[0].split('\t')
                parts = lines[1].split('\t')
                try:
                    idx_loc = next(i for i,h in enumerate(headers) if 'Subcellular location' in h)
                    raw = parts[idx_loc]
                    for s in raw.replace('|',';').replace('/',';').split(';'):
                        s = s.strip()
                        if s:
                            locs.append(s)
                except StopIteration:
                    pass
                try:
                    idx_kw = next(i for i,h in enumerate(headers) if 'Keyword' in h)
                    rawk = parts[idx_kw]
                    for s in rawk.replace('|',';').replace('/',';').split(';'):
                        s = s.strip()
                        if s:
                            keywords.append(s)
                except StopIteration:
                    pass
        except Exception:
            pass
    return {
        'title': title,
        'symbol': gene_symbol,
        'uniprot_id': uid,
        'mass': mass,
        'length': length_aa,
        'domains': domains_s,
        'uniprot_locations': list(dict.fromkeys(locs)),
        'uniprot_keywords': list(dict.fromkeys(keywords)),
    }


def normalize_loc(tok: str) -> str:
    return (tok or '').strip().lower()


def category_for(p: dict) -> str:
    locs = [normalize_loc(x) for x in (p.get('uniprot_locations') or [])]
    kws = [normalize_loc(x) for x in (p.get('uniprot_keywords') or [])]
    all_tokens = locs + kws
    has_indoors = any(l in LOC_INDOORS or 'nucleus' in l for l in all_tokens)
    has_secreted = any('secreted' in l or 'extracellular' in l for l in all_tokens)
    if has_indoors and has_secreted:
        return 'both'
    if has_indoors:
        return 'indoors'
    if has_secreted:
        return 'outer'
    return 'outdoors'


# Deterministic human placeholders (xmur3 + mulberry32 ports)
def xmur3(seed: str) -> int:
    h = 1779033703 ^ len(seed)
    for ch in seed:
        h = (h ^ ord(ch)) * 3432918353 & 0xFFFFFFFF
        h = ((h << 13) | (h >> 19)) & 0xFFFFFFFF
    # finalization
    h ^= (h >> 16)
    h = (h * 2246822507) & 0xFFFFFFFF
    h ^= (h >> 13)
    h = (h * 3266489909) & 0xFFFFFFFF
    h ^= (h >> 16)
    return h & 0xFFFFFFFF


def mulberry32(a: int):
    x = a & 0xFFFFFFFF
    def rand():
        nonlocal x
        x = (x + 0x6D2B79F5) & 0xFFFFFFFF
        t = x
        t = (t ^ (t >> 15)) * (t | 1) & 0xFFFFFFFF
        t ^= (t + ((t ^ (t >> 7)) * (t | 61) & 0xFFFFFFFF)) & 0xFFFFFFFF
        t ^= (t >> 14)
        return (t & 0xFFFFFFFF) / 4294967296.0
    return rand


GENDERS = ['woman','man','androgynous person']
ETHNICITIES = ['European','East Asian','South Asian','African','Latinx','Middle Eastern','Pacific Islander']
HAIR = ['black','dark brown','light brown','blonde','red','silver']
EXPRESSIONS = ['serious','confident','thoughtful','calm','determined','subtle smile']
CLOTHING = ['formal business','lab coat over casual wear','minimalist fashion','streetwear','military-inspired','athleisure','classic academic']
POSES = ['half-length portrait, facing camera','three-quarter view, looking slightly to the side','seated, hands clasped','standing, arms crossed','tilted head, direct gaze']
BACKGROUNDS = {
    'indoors': 'nuclear lab interior with instrumentation',
    'outer': 'open outdoor setting with sky and horizon',
    'both': 'glass atrium bridging lab interior and outdoor view',
    'outdoors': 'neutral architectural exterior',
}


def choose(rand, arr):
    import math
    return arr[int(math.floor(rand()*len(arr)))]


def deterministic_human(uid: str) -> dict:
    seed = xmur3(uid)
    rand = mulberry32(seed)
    return {
        'age': 20 + int(rand()*51),
        'height': 150 + int(rand()*41),
        'gender': choose(rand, GENDERS),
        'ethnicity': choose(rand, ETHNICITIES),
        'hair_color': choose(rand, HAIR),
        'expression': choose(rand, EXPRESSIONS),
        'clothing_style': choose(rand, CLOTHING),
        'accessories_count': int(rand()*4),
        'pose_description': choose(rand, POSES),
    }


DEFAULT_TEMPLATE = (
    'Editorial magazine cover portrait photo. Magazine title: "{symbol} MONTHLY".\n'
    'Subject: {age} year old {gender}, {height} cm tall, {ethnicity} appearance, {hair_color} hair, {expression} expression, '
    'wearing {clothing_style} with {accessories_count} accessories, {pose_description}, {background_setting}.\n'
    'Professional studio lighting, high fashion photography style, sharp focus on face, shallow depth of field.\n'
    'Subheads: {title}; {domains}.'
)


def short_stats(p: dict) -> str:
    bits = []
    if p.get('mass'):
        bits.append(f"mass {p['mass']} kDa")
    if p.get('length'):
        bits.append(f"length {p['length']} aa")
    if p.get('uniprot_id'):
        bits.append(f"UniProt {p['uniprot_id']}")
    if p.get('domains'):
        bits.append(f"domains {p['domains']}")
    return '; '.join(bits)


def make_prompt(p: dict) -> tuple[str, str, str]:
    cat = category_for(p)
    bg = BACKGROUNDS[cat]
    human = deterministic_human(p['uniprot_id'])
    merged = { **p, **human, 'background_setting': bg }
    prompt = DEFAULT_TEMPLATE.format(**{
        'symbol': merged.get('symbol',''),
        'age': merged.get('age',''),
        'gender': merged.get('gender',''),
        'height': merged.get('height',''),
        'ethnicity': merged.get('ethnicity',''),
        'hair_color': merged.get('hair_color',''),
        'expression': merged.get('expression',''),
        'clothing_style': merged.get('clothing_style',''),
        'accessories_count': merged.get('accessories_count',''),
        'pose_description': merged.get('pose_description',''),
        'background_setting': merged.get('background_setting',''),
        'title': merged.get('title',''),
        'domains': merged.get('domains',''),
    })
    return cat, bg, prompt + "\nStats: " + short_stats(p)


def main():
    ids = ['P02768', 'P04637', 'P60709']  # extracellular, nuclear, cytoplasmic
    for uid in ids:
        try:
            p = fetch_uniprot(uid)
            cat, bg, prompt = make_prompt(p)
            print(f"=== {uid} ({p['symbol']}) ===")
            print("Locations:", "; ".join(p['uniprot_locations']))
            print("Category:", cat)
            print("Background:", bg)
            print("Prompt:\n" + prompt)
            print()
        except Exception as e:
            print(f"ERROR {uid}: {e}")


if __name__ == '__main__':
    main()
