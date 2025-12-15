import { resolveStructureRepresentation } from './structure-utils.js';

const MAX_GUESSES = 10;
const DEFAULT_HINT_COST = 1;
const HINT_REWARD_ON_INCORRECT = 1;

const LOCKED_HINT_PLACEHOLDER = 'Hint locked';

// B-217: Domain names can sometimes include the protein's descriptive name.
// For clue cards, filter out domain hints that contain "too-specific" full_name tokens.
//
// This is intentionally unigram-based (with a fairly aggressive stopword list) so we can
// catch things like "ankyrin", "histone", etc., while ignoring generic biology words.
const DOMAIN_SPOILER_TOKEN_STOPWORDS = new Set([
  // Generic words that appear in lots of names/domains
  'protein', 'proteins', 'domain', 'domains', 'family', 'subunit', 'type', 'like', 'related',
  'putative', 'probable', 'homolog', 'homologue', 'isoform', 'fragment', 'chain', 'region',
  'repeat', 'binding', 'associated', 'containing', 'contains', 'component', 'complex', 'signal',
  'predicted', 'unknown', 'uncharacterized', 'cell', 'human', 'mitochondrial', 'cytoplasmic',
  'nuclear', 'membrane', 'secreted', 'enzyme', 'factor', 'receptor',

  // High-frequency overlap tokens observed in InterPro names (noise, not spoilers)
  'finger', 'zinc', 'kinase', 'olfactory', 'ribosomal', 'alpha', 'immunoglobulin', 'phosphatase',
  'beta', 'tyrosine', 'interacting', 'dehydrogenase', 'rich', 'ubiquitin', 'inhibitor',
  'transmembrane', 'transporter', 'leucine', 'synthase', 'channel', 'atpase', 'prolyl',
  'interleukin', 'isomerase', 'transcription',
]);

function getDomainSpoilerTokensFromFullName(fullName) {
  if (typeof fullName !== 'string' || !fullName.trim()) {
    return [];
  }
  const tokens = new Set();
  const matches = fullName.toLowerCase().match(/[a-z0-9]+/g) || [];
  for (const raw of matches) {
    const token = raw.trim();
    if (!token) continue;
    if (token.length < 4) continue;
    if (/^\d+$/.test(token)) continue;
    if (DOMAIN_SPOILER_TOKEN_STOPWORDS.has(token)) continue;
    tokens.add(token);
  }
  return Array.from(tokens);
}

function domainContainsToken(domainTextLower, tokenLower) {
  if (!domainTextLower || !tokenLower) {
    return false;
  }
  // Token must be delimited by non-alnum or string ends.
  const re = new RegExp(`(^|[^a-z0-9])${tokenLower.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^a-z0-9]|$)`);
  return re.test(domainTextLower);
}

function shouldFilterDomainHint(domainText, spoilerTokens) {
  if (!Array.isArray(spoilerTokens) || spoilerTokens.length === 0 || typeof domainText !== 'string') {
    return false;
  }
  const domainLower = domainText.toLowerCase();
  return spoilerTokens.some((token) => domainContainsToken(domainLower, token));
}

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
  // B-212: similarity is now returned as integer percentage (0-99) from getBlendedSimilarity
  // No need to multiply by 100 anymore
  const percent = similarity;
  const isLadder = Boolean(options.isLadder);
  const ladderRank = options.ladderRank || null;
  const domainIntersection = guessProtein.domains.filter((domain) => targetProtein.domains.includes(domain));
  // Use 10% tolerance for length matching instead of bins - more precise for gameplay (B-204)
  const lengthBinMatch = isLengthWithinTolerance(targetProtein.length, guessProtein.length);
  const tmMatch = Boolean(guessProtein.tmh) === Boolean(targetProtein.tmh);
  const secretedMatch = Boolean(guessProtein.secreted) === Boolean(targetProtein.secreted);
  const tissueMatch = Boolean(guessProtein.tissue?.label) && guessProtein.tissue.label === targetProtein.tissue.label;
  return {
    percent,
    similarity,
    isLadder,
    ladderRank,
    domainMatches: domainIntersection,
    lengthBinMatch,
    tmMatch,
    secretedMatch,
    tissueMatch
  };
}

/**
 * B-214: Atheoretical matching - compare all section text values between target and guess.
 * No field-specific logic except:
 *   - Length uses 10% tolerance (not exact match)
 * 
 * Returns matches keyed by section ID for highlighting.
 */
export function collectMatchedHintTexts(target, guessProtein, score) {
  const matches = {};
  if (!target || !guessProtein) {
    return matches;
  }

  // Build sections for both proteins using the exact same logic that renders them
  const targetSections = buildProteinSections(target, { forClue: false });
  const guessSections = buildProteinSections(guessProtein, { forClue: false });

  // Index guess texts by section ID for fast lookup
  const guessBySectionId = {};
  for (const section of guessSections) {
    if (!section.id || !Array.isArray(section.items)) continue;
    guessBySectionId[section.id] = new Set(
      section.items
        .map(item => (typeof item.text === 'string' ? item.text : String(item.text ?? '')).toLowerCase().trim())
        .filter(Boolean)
    );
  }

  // For each target section, find matching texts from guess
  for (const section of targetSections) {
    if (!section.id || !Array.isArray(section.items)) continue;
    const guessTexts = guessBySectionId[section.id];
    if (!guessTexts || guessTexts.size === 0) continue;

    // Special case: length uses 10% tolerance instead of exact match
    if (section.id === 'length') {
      if (isLengthWithinTolerance(target?.length, guessProtein?.length)) {
        const targetItem = section.items[0];
        if (targetItem?.text) {
          matches.length = [targetItem.text];
        }
      }
      continue;
    }

    // Atheoretical: any exact text match (case-insensitive) counts
    const sectionMatches = [];
    for (const item of section.items) {
      const text = typeof item.text === 'string' ? item.text : String(item.text ?? '');
      const normalized = text.toLowerCase().trim();
      if (normalized && guessTexts.has(normalized)) {
        sectionMatches.push(text); // Keep original casing for display
      }
    }

    if (sectionMatches.length > 0) {
      matches[section.id] = sectionMatches;
    }
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
  const domainSpoilerTokens = forClue ? getDomainSpoilerTokensFromFullName(protein?.full_name) : [];
  
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
    const domainItems = displayDomains
      .map((domain, idx) => {
        if (forClue && shouldFilterDomainHint(domain, domainSpoilerTokens)) {
          return null;
        }
        return {
          id: forClue ? `hint-domain-${idx}` : undefined,
          text: domain,
        };
      })
      .filter(Boolean);

    pushSection({
      id: 'domains',
      label: 'Domains',
      items: domainItems,
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
