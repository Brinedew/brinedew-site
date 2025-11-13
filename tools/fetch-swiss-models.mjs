#!/usr/bin/env node

/**
 * Fetch best SWISS-MODEL entries for each UniProt accession in data.json.
 *
 * Usage:
 *   node Website/tools/fetch-swiss-models.mjs
 *   node Website/tools/fetch-swiss-models.mjs --only P01116,P31751 --dry-run
 *
 * Flags:
 *   --input <path>   Path to data.json (defaults to Website/quartz/static/geneguessr/data.json)
 *   --output <path>  Where to write the updated JSON (defaults to input path)
 *   --only <list>    Comma-separated list of UniProt IDs to refresh
 *   --dry-run        Fetch and print results without modifying files
 */

import fs from 'node:fs';
import path from 'node:path';

const DEFAULT_DATA_PATH = path.resolve('Website/quartz/static/geneguessr/data.json');
const COVERAGE_THRESHOLD = Number(process.env.SWISS_MODEL_COVERAGE_THRESHOLD ?? '0.6');
const QMEAN_THRESHOLD = Number(process.env.SWISS_MODEL_QMEAN_THRESHOLD ?? '0.7');
const PDB_COVERAGE_THRESHOLD = Number(process.env.PDB_COVERAGE_THRESHOLD ?? '0.6');
const REQUEST_HEADERS = {
  'user-agent': 'GeneGuessr SwissModel fetcher (+https://github.com/brinedew/geneguessr)'
};

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const inputPath = path.resolve(args.input || DEFAULT_DATA_PATH);
  const outputPath = path.resolve(args.output || inputPath);
  const dryRun = Boolean(args['dry-run'] || args.dryRun);
  const filterSet = buildFilterSet(args.only);

  if (!fs.existsSync(inputPath)) {
    console.error(`Input file not found: ${inputPath}`);
    process.exit(1);
  }

  const data = JSON.parse(fs.readFileSync(inputPath, 'utf8'));
  let updated = 0;
  for (const entry of data) {
    const accession = entry?.uniprot;
    if (!accession) {
      continue;
    }
    if (filterSet && !filterSet.has(accession.toUpperCase())) {
      continue;
    }
    try {
      const swissJson = await fetchSwissModel(accession);
      if (!swissJson) {
        continue;
      }
      const bestModel = pickBestSwissModel(swissJson, Number(entry.length) || 0);
      if (!bestModel) {
        continue;
      }
      entry.structure = entry.structure || {};
      entry.structure.swiss_model = bestModel.record;
      if (bestModel.accepted && shouldPreferSwiss(entry, bestModel.record)) {
        entry.structure.primary_source = 'swissmodel';
        if (!entry.structure.structure_id) {
          entry.structure.structure_id = bestModel.record.model_id || bestModel.record.template || entry.structure.structure_id;
        }
      }
      updated += 1;
      console.log(`Fetched SWISS-MODEL for ${accession} (${bestModel.record.model_id || 'model'})${bestModel.accepted ? ' [accepted]' : ''}`);
    } catch (err) {
      console.warn(`Failed to update ${accession}:`, err.message || err);
    }
  }

  if (dryRun) {
    console.log(`Dry run complete. ${updated} proteins refreshed (no files written).`);
    return;
  }

  fs.writeFileSync(outputPath, JSON.stringify(data, null, 2));
  console.log(`Updated ${updated} proteins. Saved to ${outputPath}`);
}

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith('--')) {
      continue;
    }
    const key = token.slice(2);
    const next = argv[i + 1];
    if (next && !next.startsWith('--')) {
      out[key] = next;
      i += 1;
    } else {
      out[key] = true;
    }
  }
  return out;
}

function buildFilterSet(raw) {
  if (!raw) {
    return null;
  }
  const values = raw
    .split(',')
    .map((value) => value.trim().toUpperCase())
    .filter(Boolean);
  return values.length ? new Set(values) : null;
}

async function fetchSwissModel(uniprot) {
  const url = `https://swissmodel.expasy.org/repository/uniprot/${encodeURIComponent(uniprot)}.json?provider=swissmodel`;
  const response = await fetch(url, { headers: REQUEST_HEADERS });
  if (!response.ok) {
    console.warn(`SWISS-MODEL returned ${response.status} for ${uniprot}`);
    return null;
  }
  return response.json();
}

function pickBestSwissModel(json, proteinLength) {
  const structures = json?.result?.structures;
  if (!Array.isArray(structures) || structures.length === 0) {
    return null;
  }
  let fallback = null;
  for (const candidate of structures) {
    const record = normalizeSwissRecord(candidate, proteinLength);
    if (!record) {
      continue;
    }
    const acceptable = record.coverage >= COVERAGE_THRESHOLD &&
      (typeof record.qmean !== 'number' || record.qmean >= QMEAN_THRESHOLD);
    if (!fallback) {
      fallback = record;
    }
    if (acceptable) {
      return { record: { ...record, recommended: true }, accepted: true };
    }
  }
  if (fallback) {
    return { record: { ...fallback, recommended: false }, accepted: false };
  }
  return null;
}

function normalizeSwissRecord(model, proteinLength) {
  if (!model) {
    return null;
  }
  const coverage = typeof model.coverage === 'number'
    ? model.coverage
    : computeSwissCoverage(model, proteinLength);
  const qmean = extractSwissQuality(model);
  const chainIds = deriveChainIds(model);
  const residueRange = deriveResidueRange(model);
  const coordinatesUrl = model.coordinates || model.modelcif || model.coordinates_url;
  if (!coordinatesUrl) {
    return null;
  }
  return {
    provider: model.provider || 'swissmodel',
    model_id: model.md5 || model.template || model.coordinates,
    template: model.template,
    coordinates_url: coordinatesUrl,
    format: detectStructureFormat(coordinatesUrl, model.format),
    modelcif_url: model.modelcif,
    gmqe: toFiniteNumber(model.gmqe),
    identity: toFiniteNumber(model.identity),
    method: model.method,
    qmean,
    coverage,
    chain_ids: chainIds,
    uniprot_start: residueRange.start,
    uniprot_end: residueRange.end,
    template_qsqe: toFiniteNumber(model.template_qsqe),
    updated_at: model.created_date
  };
}

function deriveChainIds(model) {
  if (Array.isArray(model.chain_ids) && model.chain_ids.length) {
    return model.chain_ids;
  }
  if (Array.isArray(model.chains)) {
    return model.chains.map((chain) => chain && chain.id).filter(Boolean);
  }
  if (model.chain_id) {
    return [model.chain_id];
  }
  return [];
}

function deriveResidueRange(model) {
  let min = toFiniteNumber(model.uniprot_from ?? model.from);
  let max = toFiniteNumber(model.uniprot_to ?? model.to);
  if (Array.isArray(model.chains)) {
    for (const chain of model.chains) {
      if (!Array.isArray(chain?.segments)) {
        continue;
      }
      for (const segment of chain.segments) {
        const uniprot = segment?.uniprot;
        if (!uniprot) {
          continue;
        }
        const start = toFiniteNumber(uniprot.from);
        const end = toFiniteNumber(uniprot.to);
        if (Number.isFinite(start)) {
          min = Math.min(min ?? start, start);
        }
        if (Number.isFinite(end)) {
          max = Math.max(max ?? end, end);
        }
      }
    }
  }
  return { start: min ?? null, end: max ?? null };
}

function computeSwissCoverage(model, proteinLength) {
  if (!Number.isFinite(proteinLength) || proteinLength <= 0) {
    return 0;
  }
  const range = deriveResidueRange(model);
  if (!Number.isFinite(range.start) || !Number.isFinite(range.end)) {
    return 0;
  }
  const span = Math.max(0, Math.max(range.start, range.end) - Math.min(range.start, range.end) + 1);
  return Math.max(0, Math.min(1, span / proteinLength));
}

function extractSwissQuality(model) {
  const qmeanBlock = model.qmean || model.quality || {};
  const candidates = [
    model.qmean,
    model.qmeanDisCo_global,
    model.qmean_dis_co_global,
    qmeanBlock.qmeanDisCo_global,
    qmeanBlock.qmean_dis_co_global,
    qmeanBlock.qmean4_norm_score,
    qmeanBlock.avg_local_score
  ];
  for (const candidate of candidates) {
    const num = Number(candidate);
    if (Number.isFinite(num)) {
      return num;
    }
  }
  return null;
}

function detectStructureFormat(url, explicitFormat) {
  if (explicitFormat) {
    return explicitFormat;
  }
  if (typeof url !== 'string') {
    return 'pdb';
  }
  const lower = url.toLowerCase();
  if (lower.includes('.cif')) {
    return 'cif';
  }
  if (lower.includes('.bcif')) {
    return 'bcif';
  }
  return 'pdb';
}

function toFiniteNumber(value) {
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function parseChainsSpec(spec) {
  if (typeof spec !== 'string') {
    return [];
  }
  return spec
    .split(/[,;]/)
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const [chainToken, rangeToken] = part.split('=');
      if (!rangeToken) {
        return null;
      }
      const chains = (chainToken || '')
        .split('/')
        .map((c) => c.trim())
        .filter(Boolean);
      if (!chains.length) {
        return null;
      }
      const [startToken, endToken] = rangeToken.split('-');
      const start = Number.parseInt(startToken, 10);
      const end = Number.parseInt(endToken, 10);
      if (!Number.isFinite(start) || !Number.isFinite(end)) {
        return null;
      }
      return Math.max(0, Math.max(start, end) - Math.min(start, end) + 1);
    })
    .filter(Number.isFinite);
}

function shouldPreferSwiss(entry, swissRecord) {
  if (!swissRecord) {
    return false;
  }
  const structure = entry.structure || {};
  if (structure.primary_source === 'pdb') {
    const segments = parseChainsSpec(structure.pdb && structure.pdb.chains);
    const length = Number(entry.length) || 0;
    if (segments.length && length > 0) {
      const covered = segments.reduce((sum, len) => sum + len, 0);
      const coverage = Math.max(0, Math.min(1, covered / length));
      if (coverage >= PDB_COVERAGE_THRESHOLD) {
        return false;
      }
    }
  }
  return swissRecord.coverage >= COVERAGE_THRESHOLD &&
    (typeof swissRecord.qmean !== 'number' || swissRecord.qmean >= QMEAN_THRESHOLD);
}

await main().catch((err) => {
  console.error(err);
  process.exit(1);
});
