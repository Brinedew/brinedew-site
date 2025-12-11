import { resolveStructureRepresentation } from './structure-utils.js';

const MAX_GUESSES = 10;
const DEFAULT_HINT_COST = 1;
const HINT_REWARD_ON_INCORRECT = 1;

const LOCKED_HINT_PLACEHOLDER = 'Hint locked';

function stripRefSeqAttribution(text) {
  if (typeof text !== 'string') {
    return text;
  }
  return text.replace(/\s*\[provided by RefSeq[^\]]*\]\s*$/i, '').trim();
}

function cleanGeneSummary(summary) {
  if (!summary) {
    return summary;
  }
  if (typeof summary === 'string') {
    return stripRefSeqAttribution(summary);
  }
  if (typeof summary === 'object' && typeof summary.text === 'string') {
    return {
      ...summary,
      text: stripRefSeqAttribution(summary.text)
    };
  }
  return summary;
}

export function sanitizeTargetProtein(protein, options = {}) {
  const geneSummary = cleanGeneSummary(protein?.gene_summary);

  // When identity is not revealed, don't send ANY hint-source fields.
  // The client gets hints via clue.sections which are properly masked server-side.
  // Sending raw arrays (synonyms, domains, clans, GO terms, pathways, etc.) leaks the answer.
  const sanitized = {
    uniprot: null,
    hgnc: null,
    full_name: null,
    length: protein?.length || null,
    tmh: Boolean(protein?.tmh),
    secreted: Boolean(protein?.secreted),
    tissue: protein?.tissue ? { ...protein.tissue } : { label: 'unknown', score: null },
    // All hint-source fields: only send when revealing identity
    domains: options.revealIdentity && Array.isArray(protein?.domains) ? [...protein.domains] : [],
    domain_names: options.revealIdentity && Array.isArray(protein?.domain_names) ? [...protein.domain_names] : [],
    clans: options.revealIdentity && Array.isArray(protein?.clans) ? [...protein.clans] : [],
    go_terms: options.revealIdentity ? cloneGoTerms(protein?.go_terms) : {},
    go_terms_named: options.revealIdentity ? cloneGoTerms(protein?.go_terms_named) : {},
    reactome_pathways: options.revealIdentity && Array.isArray(protein?.reactome_pathways) ? [...protein.reactome_pathways] : [],
    structure: options.revealIdentity && protein?.structure ? protein.structure : null,
    links: options.revealIdentity ? (protein?.links || {}) : {},
    gene_summary: options.revealIdentity ? (geneSummary || null) : null,
    subcell: options.revealIdentity && Array.isArray(protein?.subcell) ? [...protein.subcell] : [],
    synonyms: options.revealIdentity && Array.isArray(protein?.synonyms) ? [...protein.synonyms] : [],
    // CATH architecture (always visible as it's a clue, not an answer)
    cath_architecture: Array.isArray(protein?.cath_architecture) ? [...protein.cath_architecture] : [],
  };
  if (options.revealIdentity) {
    sanitized.uniprot = protein?.uniprot || null;
    sanitized.hgnc = protein?.hgnc || null;
    sanitized.full_name = protein?.full_name || null;
  }
  return sanitized;
}

export function buildClueSections(protein) {
  return buildProteinSections(protein, { forClue: true });
}

export function buildFeedbackSections(protein) {
  return buildProteinSections(protein, { forClue: false });
}

/**
 * Extract word lengths from text for redaction rendering.
 * Sends word boundaries without revealing content, so redaction bars
 * reflow identically to the underlying text on window resize.
 */
function getWordLengths(text) {
  if (!text) return [];
  // Split on whitespace, get length of each word
  return text.split(/\s+/).filter(w => w.length > 0).map(w => w.length);
}

export function maskClueSections(sections, revealedHints = new Set()) {
  return sections.map((section) => ({
    ...section,
    items: section.items.map((item) => {
      const textValue = typeof item.text === 'string' ? item.text : String(item.text ?? '');
      if (!item?.id) {
        return { ...item, revealed: true, fullText: textValue, highlighted: Boolean(item.highlighted) };
      }
      const revealed = revealedHints.has(item.id);
      return {
        ...item,
        fullText: textValue,
        highlighted: Boolean(item.highlighted),
        revealed,
        text: revealed ? textValue : null,
        // Send word lengths instead of total length - enables correct word-wrap reflow
        // without revealing actual content
        wordLengths: revealed ? undefined : getWordLengths(textValue),
        maskLength: revealed ? undefined : Math.max(textValue.length, LOCKED_HINT_PLACEHOLDER.length),
        placeholder: item.placeholder || LOCKED_HINT_PLACEHOLDER,
      };
    })
  }));
}

export function extractHintText(sections, hintId) {
  if (!hintId || !Array.isArray(sections)) {
    return null;
  }
  for (const section of sections) {
    if (!section?.items) continue;
    for (const item of section.items) {
      if (item?.id === hintId) {
        return typeof item.text === 'string' ? item.text : String(item.text ?? '');
      }
    }
  }
  return null;
}

export function scoreGuess(guessProtein, targetProtein, options = {}) {
  if (!guessProtein || !targetProtein) {
    return null;
  }
  const similarity = (typeof options.similarity === 'number')
    ? options.similarity
    : null;
  const percent = typeof similarity === 'number'
    ? Math.round(similarity * 100)
    : null;
  const isLadder = Boolean(options.isLadder);
  const domainIntersection = guessProtein.domains.filter((domain) => targetProtein.domains.includes(domain));
  const lengthBinMatch = determineLengthBin(guessProtein.length) === determineLengthBin(targetProtein.length);
  const tmMatch = Boolean(guessProtein.tmh) === Boolean(targetProtein.tmh);
  const secretedMatch = Boolean(guessProtein.secreted) === Boolean(targetProtein.secreted);
  const tissueMatch = Boolean(guessProtein.tissue?.label) && guessProtein.tissue.label === targetProtein.tissue.label;
  return {
    percent,
    similarity,
    isLadder,
    domainMatches: domainIntersection,
    lengthBinMatch,
    tmMatch,
    secretedMatch,
    tissueMatch
  };
}

export function collectMatchedHintTexts(target, guessProtein, score) {
  const matches = {};
  if (!target || !guessProtein) {
    return matches;
  }
  const intersect = (a, b) => {
    if (!a?.length || !b?.length) {
      return [];
    }
    const setB = new Set(b);
    return a.filter((item) => setB.has(item));
  };
  if (score?.domainMatches?.length) {
    matches.domains = score.domainMatches;
  }
  ['mf', 'cc', 'bp'].forEach((aspect) => {
    const overlap = intersect(formatGoTerms(target, aspect), formatGoTerms(guessProtein, aspect));
    if (overlap.length) {
      matches[`function-${aspect}`] = overlap;
    }
  });
  const reactomeMatches = intersect(formatReactomeList(target), formatReactomeList(guessProtein));
  if (reactomeMatches.length) {
    matches.reactome = reactomeMatches;
  }
  if (score?.tissueMatch) {
    matches.tissue = [target.tissue.label];
  }
  const propertyMatches = [];
  if (score?.tmMatch) {
    propertyMatches.push(target.tmh ? 'Transmembrane' : 'Soluble');
  }
  if (score?.secretedMatch) {
    propertyMatches.push(target.secreted ? 'Secreted' : 'Intracellular');
  }
  if (propertyMatches.length) {
    matches.properties = propertyMatches;
  }
  // Use lengthBinMatch logic (same as scoring) instead of isLengthWithinTolerance
  // This ensures length highlight on feedback card matches length reveal on clue card (B-204)
  if (score?.lengthBinMatch) {
    matches.length = [`${target.length} amino acid residues`];
  }
  // CATH architecture matches (intersection of arrays)
  const targetArchs = Array.isArray(target?.cath_architecture) ? target.cath_architecture : [];
  const guessArchs = Array.isArray(guessProtein?.cath_architecture) ? guessProtein.cath_architecture : [];
  const archIntersection = targetArchs.filter(arch => guessArchs.includes(arch));
  if (archIntersection.length) {
    matches.cath = archIntersection;
  }
  return matches;
}

function normalizeProtein(protein) {
  const safeArray = (value) => (Array.isArray(value) ? value : []);
  const normalizeGoTerms = (terms) => {
    if (!terms || typeof terms !== 'object') {
      return { bp: [], mf: [], cc: [] };
    }
    return {
      bp: safeArray(terms.bp),
      mf: safeArray(terms.mf),
      cc: safeArray(terms.cc),
    };
  };
  return {
    ...protein,
    domains: safeArray(protein.domains),
    go_slim: safeArray(protein.go_slim),
    go_terms: normalizeGoTerms(protein.go_terms),
    go_terms_named: normalizeGoTerms(protein.go_terms_named),
    structure: protein?.structure || null,
    structure_id: protein?.structure_id || null,
    alphafold_id: protein?.alphafold_id || null,
    synonyms: safeArray(protein.synonyms),
    subcell: safeArray(protein.subcell),
    tissue: protein?.tissue ? protein.tissue : { label: 'unknown', score: null },
    links: protein?.links || {}
  };
}

function cloneGoTerms(terms) {
  if (!terms || typeof terms !== 'object') {
    return { bp: [], mf: [], cc: [] };
  }
  return {
    bp: Array.isArray(terms.bp) ? [...terms.bp] : [],
    mf: Array.isArray(terms.mf) ? [...terms.mf] : [],
    cc: Array.isArray(terms.cc) ? [...terms.cc] : [],
  };
}

function determineLengthBin(len) {
  if (len < 400) return 0;
  if (len < 800) return 1;
  if (len < 1200) return 2;
  if (len < 1600) return 3;
  return 4;
}

function isLengthWithinTolerance(targetLength, guessLength, toleranceRatio = 0.1) {
  const target = Number(targetLength);
  const guess = Number(guessLength);
  if (!Number.isFinite(target) || !Number.isFinite(guess) || target <= 0) {
    return false;
  }
  const diff = Math.abs(target - guess);
  return diff <= target * toleranceRatio;
}

function formatGoTerms(protein, aspect) {
  const names = protein?.go_terms_named?.[aspect];
  if (Array.isArray(names) && names.length) {
    return names;
  }
  const raw = protein?.go_terms?.[aspect];
  return Array.isArray(raw) ? raw : [];
}

function formatReactomeList(protein) {
  return (protein?.reactome_pathways || [])
    .map((entry) => {
      if (!entry) return '';
      if (typeof entry === 'string') return entry;
      const trimmed = entry.name && entry.name.trim();
      return trimmed || entry.id || '';
    })
    .filter(Boolean);
}

function buildProteinSections(protein, options = {}) {
  const { forClue = false } = options;
  const goTermsByAspect = protein?.go_terms || {};
  const goTermNamesByAspect = protein?.go_terms_named || {};
  const domains = Array.isArray(protein?.domains) ? protein.domains : [];
  const domainNames = Array.isArray(protein?.domain_names) ? protein.domain_names : [];
  const clans = Array.isArray(protein?.clans) ? protein.clans : [];
  const reactomePaths = Array.isArray(protein?.reactome_pathways) ? protein.reactome_pathways : [];
  
  const sections = [];
  const filterTokens = [
    protein?.hgnc,
    ...(Array.isArray(protein?.synonyms) ? protein.synonyms : []),
  ]
    .filter(Boolean)
    .map((token) => token.toLowerCase());
  
  const shouldFilterText = (text) => {
    if (!forClue || !filterTokens.length || typeof text !== 'string') {
      return false;
    }
    const normalized = text.toLowerCase();
    return filterTokens.some((token) => token && normalized.includes(token));
  };
  
  const pushSection = (section, { skipFilter = false } = {}) => {
    const items = skipFilter ? section.items : section.items.filter((item) => !shouldFilterText(item.text));
    if (!items.length) {
      return;
    }
    sections.push({
      ...section,
      items,
    });
  };
  
  if (protein?.gene_summary && !forClue) {
    const summary = cleanGeneSummary(protein.gene_summary);
    const summaryText = typeof summary === 'string' ? summary : summary?.text;
    const summaryMeta = typeof summary === 'object' && summary?.text ? {
      source: summary.source,
      url: summary.url,
    } : null;
    
    pushSection({
      id: 'summary',
      label: '',
      type: 'summary',
      items: [{
        text: summaryText,
        meta: summaryMeta,
      }],
    }, { skipFilter: true });
  }
  
  // First publication year
  if (protein?.first_pub_year) {
    pushSection({
      id: 'first-pub',
      label: 'First publication',
      items: [{ id: forClue ? 'hint-first-pub' : undefined, text: `${protein.first_pub_year}` }],
    });
  }
  
  pushSection({
    id: 'length',
    label: 'Length',
    items: [{ id: forClue ? 'hint-length' : undefined, text: `${protein?.length} amino acid residues` }],
  });
  
  pushSection({
    id: 'properties',
    label: 'Properties',
    items: [
      {
        id: forClue ? 'hint-properties-tm' : undefined,
        text: protein?.tmh ? 'Transmembrane' : 'Soluble',
      },
      {
        id: forClue ? 'hint-properties-secreted' : undefined,
        text: protein?.secreted ? 'Secreted' : 'Intracellular',
      },
    ],
  });
  
  pushSection({
    id: 'tissue',
    label: 'Tissue specificity',
    items: [{ id: forClue ? 'hint-tissue' : undefined, text: protein?.tissue?.label }],
  });

  // Origin age (when this gene first appeared in evolution)
  if (protein?.origin_age) {
    pushSection({
      id: 'origin',
      label: 'Epoch of origin',
      items: [{ id: forClue ? 'hint-origin' : undefined, text: protein.origin_age }],
    });
  }

  // Clans (protein family classifications)
  if (clans.length) {
    pushSection({
      id: 'clans',
      label: 'Clans',
      items: clans.map((clan, idx) => ({
        id: forClue ? `hint-clan-${idx}` : undefined,
        text: clan.replace(/_/g, ' '),
      })),
    });
  }

  // Domains - prefer human-readable names, fall back to IPR IDs
  const displayDomains = domainNames.length ? domainNames : domains;
  if (displayDomains.length) {
    pushSection({
      id: 'domains',
      label: 'Domains',
      items: displayDomains.map((domain, idx) => ({
        id: forClue ? `hint-domain-${idx}` : undefined,
        text: domain,
      })),
    });
  }

  // CATH architecture (structural fold classification)
  const cathArchitectures = Array.isArray(protein?.cath_architecture) ? protein.cath_architecture : [];
  if (cathArchitectures.length) {
    pushSection({
      id: 'cath',
      label: 'Architecture',
      items: cathArchitectures.map((arch, idx) => ({
        id: forClue ? `hint-cath-arch-${idx}` : undefined,
        text: arch,
      })),
    });
  }
  
  // Pathways are pre-filtered and sorted by FDR in step_3_merge_columns.py
  const formattedReactome = reactomePaths
    .map((entry) => {
      if (!entry) return '';
      if (typeof entry === 'string') return entry;
      const name = entry.name && entry.name.trim();
      const id = entry.id || '';
      return name || id;
    })
    .filter(Boolean);

  if (formattedReactome.length) {
    pushSection({
      id: 'reactome',
      label: 'Pathways',
      items: forClue
        ? formattedReactome.map((path, idx) => ({ id: `hint-reactome-${idx}`, text: path }))
        : formattedReactome.map((path) => ({ text: path })),
    });
  }
  
  const goSectionMeta = [
    { aspect: 'mf', label: 'Molecular function' },
    { aspect: 'cc', label: 'Cellular component' },
    { aspect: 'bp', label: 'Biological process' },
  ];
  goSectionMeta.forEach(({ aspect, label }) => {
    const namedTerms = Array.isArray(goTermNamesByAspect[aspect]) ? goTermNamesByAspect[aspect] : null;
    const rawTerms = Array.isArray(goTermsByAspect[aspect]) ? goTermsByAspect[aspect] : [];
    const terms = namedTerms && namedTerms.length ? namedTerms : rawTerms;
    if (!terms.length) {
      return;
    }
    pushSection({
      id: `function-${aspect}`,
      label,
      items: forClue
        ? terms.map((term, idx) => ({ id: `hint-${aspect}-${idx}`, text: term }))
        : terms.map((term) => ({ text: term })),
    });
  });

  return sections;
}

function isAlphaFoldOnlyProtein(protein) {
  // After D1 refactor, structure_source is a flat field, not nested under protein.structure
  return protein?.structure_source === 'alphafold';
}

export {
  MAX_GUESSES,
  DEFAULT_HINT_COST,
  HINT_REWARD_ON_INCORRECT,
  cleanGeneSummary,
  isAlphaFoldOnlyProtein
};
