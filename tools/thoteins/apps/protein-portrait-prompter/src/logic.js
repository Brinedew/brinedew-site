// Core logic module for Protein Portrait Prompter
// Exports pure functions so UI can be thin and maintainable.

export const DEFAULT_BACKGROUNDS = {
  indoors: 'nuclear lab interior with instrumentation',
  outer: 'open outdoor setting with sky and horizon',
  both: 'glass atrium bridging lab interior and outdoor view',
  outdoors: 'neutral architectural exterior',
};

export const DEFAULT_TEMPLATE = `Editorial magazine cover portrait photo. Magazine title: "{symbol} MONTHLY".
Subject: {age} year old {gender}, {height} cm tall, {ethnicity} appearance, {hair_color} hair, {expression} expression, wearing {clothing_style} with {accessories_count} accessories, {pose_description}, {background_setting}.
Professional studio lighting, high fashion photography style, sharp focus on face, shallow depth of field.
Subheads: {title}; {domains}.`;

// --- utilities ---
export function xmur3(str){ let h=1779033703 ^ str.length; for(let i=0;i<str.length;i++){ h = Math.imul(h ^ str.charCodeAt(i), 3432918353); h = (h<<13) | (h>>>19); } return function(){ h = Math.imul(h ^ (h>>>16), 2246822507); h = Math.imul(h ^ (h>>>13), 3266489909); return (h ^= h>>>16) >>> 0; } }
export function mulberry32(a){ return function(){ let t=a+=0x6D2B79F5; t = Math.imul(t ^ (t>>>15), t | 1); t ^= t + Math.imul(t ^ (t>>>7), t | 61); return ((t ^ (t>>>14)) >>> 0) / 4294967296; } }
export function choice(rand, arr){ return arr[Math.floor(rand()*arr.length)] }

// --- helpers for interval coverage ---
function coveredLength(intervals){
  try {
    const spans = (intervals||[]).map(iv => [Number(iv.start), Number(iv.end)]).filter(x => Number.isFinite(x[0]) && Number.isFinite(x[1]) && x[1] >= x[0]).sort((a,b)=> a[0]-b[0] || a[1]-b[1]);
    if (!spans.length) return 0;
    let total = 0; let [cs, ce] = spans[0];
    for (let i=1;i<spans.length;i++){
      const [s,e] = spans[i];
      if (s <= ce+1){ ce = Math.max(ce, e); }
      else { total += (ce - cs + 1); cs = s; ce = e; }
    }
    total += (ce - cs + 1);
    return total;
  } catch { return 0 }
}

// Try to fetch MobiDB consensus disorder percent. Returns { percent, segments } or null.
export async function fetchMobidbPercent(uniprotId, lengthAA = null){
  const id = String(uniprotId || '').trim(); if (!id) return null;
  // Prefer local writer proxy if connected (avoids CORS); caller can pass a writer base URL
  async function tryLocal(){
    try {
      const r = await fetch(`http://127.0.0.1:8787/mobidb/${encodeURIComponent(id)}/percent`, { cache: 'no-store' });
      if (!r.ok) return null; const obj = await r.json();
      if (typeof obj?.percent_disordered === 'number') return { percent: obj.percent_disordered, segments: obj.segments||[], length: obj.length||null };
      return null;
    } catch { return null }
  }
  async function tryDirect(){
    try {
      const r = await fetch(`https://mobidb.bio.unipd.it/ws/entries/${encodeURIComponent(id)}/consensus`, { method:'GET' });
      if (!r.ok) return null; const data = await r.json();
      // Heuristic: collect any objects with start/end where type/label mentions disorder
      const segs = [];
      const stack = [data];
      while (stack.length){
        const cur = stack.pop();
        if (Array.isArray(cur)) { for (const v of cur) stack.push(v); }
        else if (cur && typeof cur === 'object') {
          const t = String(cur.type || cur.label || '').toLowerCase();
          const s = cur.start; const e = cur.end;
          if (Number.isFinite(s) && Number.isFinite(e) && (t.includes('disorder') || t.includes('disordered') || t.includes('mobidb'))){ segs.push({ start:s, end:e }); }
          for (const v of Object.values(cur)) if (v && typeof v === 'object') stack.push(v);
        }
      }
      const L = Number(lengthAA)||null;
      if (!segs.length || !L) return { percent: null, segments: segs, length: L };
      const cov = coveredLength(segs);
      const pct = Math.round((1000*cov)/L)/10; // 1 decimal
      return { percent: pct, segments: segs, length: L };
    } catch { return null }
  }
  return await tryLocal() ?? await tryDirect();
}

// Deterministic placeholder human attributes
export function deterministicHuman(uniprot){
  const seed = xmur3(String(uniprot || 'X'))();
  const rand = mulberry32(seed);
  const genders = ['woman','man','androgynous person'];
  const ethnicities = ['European','East Asian','South Asian','African','Latinx','Middle Eastern','Pacific Islander'];
  const hair = ['black','dark brown','light brown','blonde','red','silver'];
  const expressions = ['serious','confident','thoughtful','calm','determined','subtle smile'];
  const clothing = ['formal business','lab coat over casual wear','minimalist fashion','streetwear','military-inspired','athleisure','classic academic'];
  const poses = ['half-length portrait, facing camera','three-quarter view, looking slightly to the side','seated, hands clasped','standing, arms crossed','tilted head, direct gaze'];
  return {
    age: 20 + Math.floor(rand()*51), // 20–70
    height: 150 + Math.floor(rand()*41), // 150–190 cm
    gender: choice(rand, genders),
    ethnicity: choice(rand, ethnicities),
    hair_color: choice(rand, hair),
    expression: choice(rand, expressions),
    clothing_style: choice(rand, clothing),
    accessories_count: Math.floor(rand()*4),
    pose_description: choice(rand, poses),
  };
}

// Minimal frontmatter parser for YAML subset used in site
export function parseFrontmatter(md){
  const start = md.indexOf('---');
  if (start !== 0) return null;
  const end = md.indexOf('\n---', 3);
  if (end === -1) return null;
  const block = md.slice(3, end+1).trim();
  const lines = block.split(/\r?\n/);
  const obj = {}; let currentKey = null;
  for (let i=0; i<lines.length; i++){
    const line = lines[i];
    const m = line.match(/^([^:][^:]*?):\s*(.*)$/);
    if (m){
      const key = m[1].trim();
      let val = m[2].trim();
      if (val === ''){ currentKey = key; obj[currentKey] = []; }
      else {
        if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))){ val = val.slice(1, -1); }
        obj[key] = val; currentKey = null;
      }
    } else if (currentKey && line.match(/^\s*-\s*(.*)$/)){
      const item = RegExp.$1.trim();
      obj[currentKey].push(item);
    }
  }
  return obj;
}

export function normalizeProtein(meta){
  return {
    title: meta['title'] || '',
    symbol: meta['symbol'] || (Array.isArray(meta['aliases']) ? meta['aliases'][0] : '') || '',
    uniprot_id: meta['uniprot_id'] || '',
    mass: meta['mass'] || '',
    length: meta['length (aa)'] || meta['length'] || '',
    domains: Array.isArray(meta['domains']) ? meta['domains'].join(', ') : (meta['Domains'] || meta['domains'] || ''),
    tags: Array.isArray(meta['tags']) ? meta['tags'] : [],
    uniprot_locations: Array.isArray(meta['uniprot_locations']) ? meta['uniprot_locations'] : [],
    uniprot_keywords: Array.isArray(meta['uniprot_keywords']) ? meta['uniprot_keywords'] : [],
    mobidb_percent_disordered: (typeof meta['mobidb_percent_disordered'] === 'number') ? meta['mobidb_percent_disordered'] : null,
  };
}

const LOC_INDOORS = new Set([
  'nucleoplasm','nucleus','nuclear membrane','nuclear envelope','nucleoli','nucleolus','nuclear speckles','speckles','mitochondria','mitochondrion','mitochondrial'
]);
function normalizeLocToken(tok){ if (!tok) return ''; const s=String(tok).trim().toLowerCase(); return s.replace(/\s+/g,' '); }

export function classifyCategory(protein){
  const tags = Array.isArray(protein.tags) ? protein.tags.map(normalizeLocToken) : [];
  const locs = (Array.isArray(protein.uniprot_locations) ? protein.uniprot_locations : []).map(normalizeLocToken);
  const kws = (Array.isArray(protein.uniprot_keywords) ? protein.uniprot_keywords : []).map(normalizeLocToken);
  const all = locs.concat(kws).concat(tags.filter(t => /(nucle|mitochond|secreted|extracellular)/.test(t)));
  const hasIndoors = all.some(l => LOC_INDOORS.has(l) || /nucleus/.test(l));
  const hasSecreted = all.some(l => l.includes('secreted') || l.includes('extracellular'));
  if (hasIndoors && hasSecreted) return 'both';
  if (hasIndoors) return 'indoors';
  if (hasSecreted) return 'outer';
  return 'outdoors';
}

export function mappedBackground(protein, backgrounds = DEFAULT_BACKGROUNDS){
  const cat = classifyCategory(protein);
  return backgrounds[cat] || backgrounds.outdoors;
}

export function renderTemplate(tpl, protein, backgrounds = DEFAULT_BACKGROUNDS){
  const human = deterministicHuman(protein.uniprot_id);
  const bg = mappedBackground(protein, backgrounds);
  const dict = { ...protein, ...human, length: protein.length, domains: protein.domains || '', background_setting: bg };
  return tpl.replace(/\{([^}]+)\}/g, (_, k) => { return (dict[k.trim()] ?? '').toString(); });
}


// Render with optional overrides applied (e.g., Mapping Studio output)
export function renderTemplateWithOverrides(tpl, protein, overrides = {}, backgrounds = DEFAULT_BACKGROUNDS){
  const human = deterministicHuman(protein.uniprot_id);
  const bg = (overrides && overrides.background_setting) ? overrides.background_setting : mappedBackground(protein, backgrounds);
  const dict = { ...protein, ...human, ...overrides, length: protein.length, domains: protein.domains || '', background_setting: bg };
  return tpl.replace(/\{([^}]+)\}/g, (_, k) => { return (dict[k].toString?.() ?? String(dict[k] ?? '')); });
}

export function shortStats(p){
  const bits = [];
  if (p.mass) bits.push(`mass ${p.mass} kDa`);
  if (p.length) bits.push(`length ${p.length} aa`);
  if (p.uniprot_id) bits.push(`UniProt ${p.uniprot_id}`);
  if (p.domains) bits.push(`domains ${p.domains}`);
  return bits.join('; ');
}

export async function fetchUniProt(id){
  const url = `https://rest.uniprot.org/uniprotkb/${encodeURIComponent(id)}.json`;
  const r = await fetch(url, { method: 'GET' });
  if (!r.ok) throw new Error(`UniProt ${id} ${r.status}`);
  const data = await r.json();
  const geneSymbol = data.genes?.[0]?.geneName?.value || id;
  const title = data.proteinDescription?.recommendedName?.fullName?.value || geneSymbol;
  const mass = data.sequence?.molWeight ? Math.round(data.sequence.molWeight / 1000) : '';
  const lengthAA = data.sequence?.length || '';
  const features = Array.isArray(data.features) ? data.features : [];
  const domains = features.filter(f => f.type === 'DOMAIN' || f.type === 'REGION' || f.type === 'MOTIF').map(f => f.description).filter(Boolean).slice(0,3).join(', ');
  const comments = Array.isArray(data.comments) ? data.comments : [];
  const locs = [];
  for (const c of comments){
    if (c.commentType === 'SUBCELLULAR_LOCATION' && Array.isArray(c.subcellularLocations)){
      for (const sl of c.subcellularLocations){
        const v = sl.location?.value || '';
        if (v) locs.push(v);
      }
    }
  }
  let keywords = Array.isArray(data.keywords) ? data.keywords.map(k => k.value).filter(Boolean) : [];
  if (!locs.length && !keywords.length){
    try {
      const tsvUrl = `https://rest.uniprot.org/uniprotkb/stream?compressed=false&format=tsv&query=accession:${encodeURIComponent(id)}&fields=cc_subcellular_location,keyword`;
      const tsvResp = await fetch(tsvUrl, { method: 'GET' });
      if (tsvResp.ok){
        const txt = await tsvResp.text();
        const lines = txt.split(/\r?\n/).filter(Boolean);
        if (lines.length >= 2){
          const header = lines[0].split('\t');
          const idxLoc = header.findIndex(h => /Subcellular location/i.test(h));
          const idxKw = header.findIndex(h => /Keyword/i.test(h));
          const parts = lines[1].split('\t');
          if (idxLoc >= 0 && parts[idxLoc]){
            const raw = parts[idxLoc];
            raw.split(/;|\.|\//).forEach(s => { const v = s.trim(); if (v) locs.push(v); });
          }
          if (idxKw >= 0 && parts[idxKw]){
            const rawk = parts[idxKw];
            rawk.split(/;|\.|\//).forEach(s => { const v = s.trim(); if (v) keywords.push(v); });
          }
        }
      }
    } catch {}
  }
  const normalized = normalizeProtein({
    title,
    symbol: geneSymbol,
    uniprot_id: id,
    mass,
    length: lengthAA,
    Domains: domains,
    uniprot_locations: Array.from(new Set(locs)),
    uniprot_keywords: Array.from(new Set(keywords)),
  });
  // Attach the full UniProt entry for saving to local DB
  return { ...normalized, raw_uniprot: data };
}
