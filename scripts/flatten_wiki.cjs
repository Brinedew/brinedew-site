#!/usr/bin/env node
/**
 * Flatten Obsidian wiki folders into a flat `wiki/` with tags, aliases, link-rewrites.
 * Safe-by-default: dry-run unless --write. Produces reports for conflicts & actions.
 *
 * USAGE (Windows, Node 22+):
 *   cd D:\\Coding\\Website\\content
 *   node ..\\flatten-wiki.cjs --dry-run
 *   node ..\\flatten-wiki.cjs --write           # apply moves + rewrites
 *   node ..\\flatten-wiki.cjs --cleanup         # remove emptied directories (after write)
 *   node ..\\flatten-wiki.cjs --write --cleanup # do both in one go
 *
 * DEPENDENCIES:
 *   npm i gray-matter js-yaml
 *
 * WHAT IT DOES:
 *   1) Scans wiki subdirectories for md and backup files and builds a move-map to flat wiki/*.md
 *   2) For each file: merges tags, adds aliases for old paths, rewrites internal links
 *   3) Dedupes exact-content duplicates (hashing content minus frontmatter)
 *   4) Index pages become <folder>.md (e.g., wiki/theories/index.md → wiki/theories.md)
 *   5) Backup files (*.md.backup) are moved into wiki/_backups/ (ignored by site)
 *   6) Writes reports to wiki/_reports/ (actions.json, conflicts.md)
 *   7) Optionally prunes empty directories under wiki/
 *
 * INVARIANTS:
 *   - No content loss: duplicates kept or parked in _conflicts
 *   - Old URLs preserved via aliases (both with and without .md)
 *   - Tags enriched using configurable folder→tags mapping
 */

const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const crypto = require('crypto');
const matter = require('gray-matter');
const yaml = require('js-yaml');

// ---------------------- CONFIG ----------------------
const ROOT = path.resolve('D:/Coding/Website/content'); // change if needed
const WIKI_DIR = path.join(ROOT, 'wiki');
const BACKUPS_DIR = path.join(WIKI_DIR, '_backups');
const CONFLICTS_DIR = path.join(WIKI_DIR, '_conflicts');
const REPORTS_DIR = path.join(WIKI_DIR, '_reports');

const DRY_RUN = !process.argv.includes('--write');
const DO_CLEANUP = process.argv.includes('--cleanup');

// Tag enrichment rules by source path prefix (posix). Most specific first.
// You can extend/modify freely.
const TAG_RULES = [
  { prefix: 'wiki/organisms/cancer-lineages', add: ['topic/cancer-lineages', 'category/organism'] },
  { prefix: 'wiki/organisms/model-organisms', add: ['topic/model-organisms', 'category/organism'] },
  { prefix: 'wiki/organisms/comparative', add: ['topic/comparative', 'category/organism'] },
  { prefix: 'wiki/organisms', add: ['category/organism'] },
  { prefix: 'wiki/proteins/oncogenes', add: ['topic/oncogenes', 'category/protein'] },
  { prefix: 'wiki/proteins', add: ['category/protein'] },
  { prefix: 'wiki/theories', add: ['category/theory'] },
  { prefix: 'wiki/mechanisms', add: ['category/mechanism'] },
  { prefix: 'wiki/concepts', add: ['category/concept'] },
];

const BASE_TAGS = ['content/wiki']; // always present

// Files that should be treated as backups and moved out of the build path.
const BACKUP_PATTERNS = [
  /\.md\.backup$/i,
  /\.backup$/i,
  /~$/,
  /\.bak$/i,
  /\.orig$/i,
];

// Report accumulators
const report = {
  dryRun: DRY_RUN,
  plannedMoves: [],
  writtenFiles: [],
  skipped: [],
  backupsMoved: [],
  duplicatesRemoved: [],
  conflicts: [],
  linkRewrites: [],
  tagChanges: [],
  aliasChanges: [],
  removedDirs: [],
};

// ---------------------- UTIL ----------------------
const toPosix = (p) => p.split('\\').join('/');
const fromRoot = (absPath) => toPosix(path.relative(ROOT, absPath));
const toRootAbs = (rel) => path.join(ROOT, rel);

async function ensureDir(dir) {
  await fsp.mkdir(dir, { recursive: true });
}

function looksBackup(relPosix) {
  return BACKUP_PATTERNS.some((rx) => rx.test(relPosix));
}

function isIndexMd(relPosix) {
  return relPosix.toLowerCase().endsWith('/index.md');
}

function basenameNoExt(relPosix) {
  const base = path.posix.basename(relPosix);
  return base.replace(/\.md$/i, '');
}

function parentDirName(relPosix) {
  const dir = path.posix.dirname(relPosix);
  return path.posix.basename(dir);
}

function addUnique(arr, values) {
  const set = new Set(arr || []);
  for (const v of values) set.add(v);
  return Array.from(set);
}

function sha256(s) {
  return crypto.createHash('sha256').update(s).digest('hex');
}

function normalizeForHash(raw) {
  const fm = matter(raw);
  const body = fm.content.replace(/\r\n/g, '\n').trim();
  return body;
}

function computeTarget(relPosix) {
  // relPosix like 'wiki/theories/antagonistic-pleiotropy-theory.md'
  if (looksBackup(relPosix)) return { kind: 'backup' };
  if (isIndexMd(relPosix)) {
    const slug = parentDirName(relPosix);
    return { kind: 'index', target: `wiki/${slug}.md` };
  }
  const slug = basenameNoExt(relPosix);
  return { kind: 'regular', target: `wiki/${slug}.md` };
}

function tagsFor(relPosix) {
  const tags = new Set(BASE_TAGS);
  for (const rule of TAG_RULES) {
    if (toPosix(relPosix).startsWith(rule.prefix)) {
      for (const t of rule.add) tags.add(t);
    }
  }
  return Array.from(tags);
}

function aliasSetFor(relPosix) {
  // Aliases preserve old URLs with and without .md, both with and without leading 'wiki/'.
  const withoutExt = relPosix.replace(/\.md(\.[^/]+)?$/i, '');
  const withMd = relPosix.replace(/(\.[^/]+)?$/i, '.md');
  const noWiki = withoutExt.replace(/^wiki\//, '');
  const noWikiMd = withMd.replace(/^wiki\//, '');
  const uniq = new Set([withoutExt, withMd, noWiki, noWikiMd]);
  // For index.md, also alias the folder path variants
  if (isIndexMd(relPosix)) {
    const dir = relPosix.replace(/\/index\.md$/i, '');
    const dirNoWiki = dir.replace(/^wiki\//, '');
    uniq.add(dir);
    uniq.add(dirNoWiki);
  }
  return Array.from(uniq);
}

async function walk(dirAbs) {
  const out = [];
  const entries = await fsp.readdir(dirAbs, { withFileTypes: true });
  for (const e of entries) {
    const abs = path.join(dirAbs, e.name);
    if (e.isDirectory()) {
      out.push(...await walk(abs));
    } else if (e.isFile()) {
      const rel = fromRoot(abs);
      if (rel.startsWith('wiki/') && /\.md(\.backup)?$/i.test(rel)) out.push(rel);
    }
  }
  return out;
}

function buildMoveMap(allRel) {
  // First pass: compute intended target for each source
  const mapping = new Map(); // key: sourceRel → value: {kind,target}
  for (const rel of allRel) {
    mapping.set(rel, computeTarget(rel));
  }
  return mapping;
}

function buildAliasMap(mapping) {
  // Map old keys (without extension variants) to new targets for link rewriting
  // Key format: path without leading ROOT, posix, without trailing .md
  const aliasMap = new Map(); // key: oldPathNoExt → value: { newSlug, newRel }
  for (const [src, info] of mapping.entries()) {
    if (info.kind === 'backup') continue;
    const tgt = info.target; // e.g., wiki/ctvt.md
    const newSlug = basenameNoExt(tgt); // ctvt

    // Source may have index
    const keys = new Set();
    const srcNoExt = src.replace(/\.md(\.backup)?$/i, '');
    keys.add(srcNoExt);
    keys.add(srcNoExt.replace(/^wiki\//, ''));

    if (isIndexMd(src)) {
      const dir = src.replace(/\/index\.md$/i, '');
      keys.add(dir);
      keys.add(dir.replace(/^wiki\//, ''));
    }

    for (const k of keys) aliasMap.set(k, { newSlug, newRel: tgt });
  }
  return aliasMap;
}

function rewriteLinksMarkdown(body, aliasMap) {
  let rewrites = 0;

  // Rewrite Markdown links: [text](wiki/old/path.md) or relative paths
  body = body.replace(/\[([^\]]*)\]\(([^)]+)\)/g, (m, text, link) => {
    try {
      const orig = link;
      if (/^(https?:|mailto:|#)/i.test(link)) return m; // external or anchor
      // normalize, strip .md if present
      let linkNoHash = link;
      let hash = '';
      const hashIdx = link.indexOf('#');
      if (hashIdx !== -1) {
        hash = link.slice(hashIdx);
        linkNoHash = link.slice(0, hashIdx);
      }
      const normalized = toPosix(path.posix.normalize(linkNoHash)).replace(/^\.\/?/, '');
      const key = normalized.replace(/\.md$/i, '');
      const hit = aliasMap.get(key) || aliasMap.get(key.replace(/^wiki\//, ''));
      if (!hit) return m;
      const newLink = `${hit.newRel}${hash}`; // keep as posix
      rewrites++;
      return `[${text}](${newLink})`;
    } catch (_) {
      return m;
    }
  });

  // Rewrite Obsidian wiki-links: [[path/to/file|Label]] and [[path#Anchor]]
  body = body.replace(/\[\[([^\]|#]+)(?:#([^\]|]+))?(?:\|([^\]]+))?\]\]/g, (m, rawPath, anchor, label) => {
    const key = toPosix(rawPath).replace(/^\.\/?/, '');
    const hit = aliasMap.get(key) || aliasMap.get(key.replace(/^wiki\//, ''));
    if (!hit) return m;
    const finalLabel = label || hit.newSlug;
    const anchorPart = anchor ? `#${anchor}` : '';
    rewrites++;
    return `[[${hit.newSlug}${anchorPart}|${finalLabel}]]`;
  });

  return { body, rewrites };
}

async function removeEmptyDirs(dirAbs) {
  const entries = await fsp.readdir(dirAbs, { withFileTypes: true });
  let isEmpty = true;
  for (const e of entries) {
    const p = path.join(dirAbs, e.name);
    if (e.isDirectory()) {
      const emptyChild = await removeEmptyDirs(p);
      if (emptyChild) {
        if (!DRY_RUN && DO_CLEANUP) await fsp.rmdir(p).catch(() => {});
        if (DO_CLEANUP) report.removedDirs.push(fromRoot(p));
      } else {
        isEmpty = false;
      }
    } else if (e.isFile()) {
      // consider report/backup/conflict dirs as non-empty blockers
      isEmpty = false;
    }
  }
  // Don’t remove the root wiki dir
  if (dirAbs === WIKI_DIR) return false;
  return isEmpty;
}

// ---------------------- MAIN ----------------------
(async function main() {
  await Promise.all([ensureDir(BACKUPS_DIR), ensureDir(CONFLICTS_DIR), ensureDir(REPORTS_DIR)]);

  const all = await walk(WIKI_DIR);
  const mapping = buildMoveMap(all);
  const aliasMap = buildAliasMap(mapping);

  // Preload content hashes to identify duplicates by content
  const contentHash = new Map(); // key: rel → hash
  for (const rel of all) {
    const abs = toRootAbs(rel);
    const raw = await fsp.readFile(abs, 'utf8');
    const h = sha256(normalizeForHash(raw));
    contentHash.set(rel, h);
  }

  // Track which targets we’ve already written to
  const occupied = new Map(); // key: targetRel → { srcRel, hash }

  for (const rel of all) {
    const info = mapping.get(rel);
    if (!info) continue;

    // Handle backups early
    if (info.kind === 'backup') {
      const srcAbs = toRootAbs(rel);
      const destAbs = path.join(BACKUPS_DIR, rel.replace(/^wiki\//, ''));
      report.backupsMoved.push({ from: rel, to: fromRoot(destAbs) });
      if (!DRY_RUN) {
        await ensureDir(path.dirname(destAbs));
        await fsp.rename(srcAbs, destAbs).catch(async () => {
          // fallback to copy+unlink if cross-device
          const data = await fsp.readFile(srcAbs);
          await fsp.writeFile(destAbs, data);
          await fsp.unlink(srcAbs);
        });
      }
      continue;
    }

    // Regular/index markdown
    const srcAbs = toRootAbs(rel);
    const raw = await fsp.readFile(srcAbs, 'utf8');
    const fm = matter(raw);

    // Enrich tags
    const beforeTags = fm.data?.tags || [];
    const afterTags = addUnique(beforeTags, tagsFor(rel));
    if (JSON.stringify(beforeTags) !== JSON.stringify(afterTags)) {
      report.tagChanges.push({ file: rel, added: afterTags.filter(t => !beforeTags.includes(t)) });
    }

    // Aliases: include legacy paths
    const beforeAliases = fm.data?.aliases || [];
    const newAliases = addUnique(beforeAliases, aliasSetFor(rel));
    if (JSON.stringify(beforeAliases) !== JSON.stringify(newAliases)) {
      report.aliasChanges.push({ file: rel, added: newAliases.filter(a => !beforeAliases.includes(a)) });
    }

    // Rewrite links in body
    const { body, rewrites } = rewriteLinksMarkdown(fm.content, aliasMap);
    if (rewrites > 0) report.linkRewrites.push({ file: rel, count: rewrites });

    // Stringify final content
    const finalStr = matter.stringify(body, { ...fm.data, tags: afterTags, aliases: newAliases }, { lineWidth: 10000 });

    const tgtRel = info.target; // e.g., wiki/ctvt.md
    const tgtAbs = toRootAbs(tgtRel);

    const thisHash = sha256(normalizeForHash(finalStr));
    const occ = occupied.get(tgtRel);
    if (occ) {
      if (occ.hash === thisHash) {
        // Exact-content duplicate → drop this copy, but we keep its aliases merged
        report.duplicatesRemoved.push({ kept: occ.srcRel, dropped: rel });
        continue; // don't write
      } else {
        // Conflict: two different contents want same target
        const base = basenameNoExt(tgtRel);
        const alt1 = path.join(CONFLICTS_DIR, `${base}__A.md`);
        const alt2 = path.join(CONFLICTS_DIR, `${base}__B.md`);
        report.conflicts.push({ target: tgtRel, a: occ.srcRel, b: rel, parked: [fromRoot(alt1), fromRoot(alt2)] });
        if (!DRY_RUN) {
          await fsp.writeFile(alt1, await fsp.readFile(toRootAbs(occ.srcRel), 'utf8'));
          await fsp.writeFile(alt2, finalStr);
        }
        continue; // skip writing to tgtRel for now
      }
    }

    // Not occupied yet → plan to write
    report.plannedMoves.push({ from: rel, to: tgtRel });
    if (!DRY_RUN) {
      await ensureDir(path.dirname(tgtAbs));
      await fsp.writeFile(tgtAbs, finalStr, 'utf8');
      // Remove original file
      await fsp.unlink(srcAbs);
    }
    occupied.set(tgtRel, { srcRel: rel, hash: thisHash });
    report.writtenFiles.push(tgtRel);
  }

  // Cleanup pass: remove empty dirs under wiki/ (only when requested)
  if (DO_CLEANUP) {
    await removeEmptyDirs(WIKI_DIR);
  }

  // Write reports
  const actionsJson = path.join(REPORTS_DIR, `actions_${Date.now()}.json`);
  const conflictsMd = path.join(REPORTS_DIR, `conflicts_${Date.now()}.md`);

  if (!DRY_RUN) {
    await fsp.writeFile(actionsJson, JSON.stringify(report, null, 2), 'utf8');
    let md = '# Migration Conflicts\n\n';
    if (report.conflicts.length === 0) {
      md += 'No content conflicts.\n';
    } else {
      for (const c of report.conflicts) {
        md += `- Target **${c.target}** had conflicting sources: ${c.a} vs ${c.b}. Parked at ${c.parked[0]} and ${c.parked[1]}\n`;
      }
    }
    await fsp.writeFile(conflictsMd, md, 'utf8');
  } else {
    // Even in dry-run, emit a preview report to console
    console.log(JSON.stringify(report, null, 2));
  }

  console.log(`\nDone. DRY_RUN=${DRY_RUN} CLEANUP=${DO_CLEANUP}`);
})();
