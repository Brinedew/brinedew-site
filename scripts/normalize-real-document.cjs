const fs = require('fs');

// Import our normalization logic (simplified version)
class LineageNormalizer {
  constructor() {
    this.NL_RX = /\r\n?/g;
    this.LINEAGE_WRAPPERS_RX = /(?:\n)?\s*<!--\s*lineage:(?:scaffold|content)\s+(?:start|end)\s*-->\s*(?:\n)?/gi;
    this.MARKER_RX = /<span(?=[^>]*\bdata-lineage-uid=["']?([0-9a-fA-F-]{8,})["']?)(?=[^>]*\bdata-lineage-section=["']?([0-9]+(?:\.[0-9]+)*)["']?)[^>]*>\s*<\/span>/ig;
    this.SECTION_ONLY_RX = /<span(?![^>]*\bdata-lineage-uid=)[^>]*\bdata-lineage-section=["']?([0-9]+(?:\.[0-9]+)*)["']?[^>]*>\s*<\/span>/ig;
  }

  prepareForParse(src) {
    return src.replace(this.NL_RX, "\n").replace(this.LINEAGE_WRAPPERS_RX, "");
  }

  assignUidsOnce(src) {
    let counter = 0;
    const timestamp = Date.now().toString(16);
    
    this.SECTION_ONLY_RX.lastIndex = 0;
    return src.replace(this.SECTION_ONLY_RX, (_match, path) => {
      const uid = `${timestamp}-${(counter++).toString(16).padStart(4, '0')}`;
      return `<span data-lineage-uid="${uid}" data-lineage-section="${path}"></span>`;
    });
  }

  splitFrontmatter(src) {
    const s = src.replace(this.NL_RX, "\n");
    if (!s.startsWith("---\n")) return { head: "", body: s };
    
    const end = s.indexOf("\n---\n", 4);
    if (end === -1) return { head: "", body: s };
    
    const fmEnd = end + 5;
    return { head: s.slice(0, fmEnd) + "\n", body: s.slice(fmEnd) };
  }

  parseSections(src) {
    const hits = [];
    this.MARKER_RX.lastIndex = 0;
    let match;
    
    while ((match = this.MARKER_RX.exec(src)) !== null) {
      const uid = match[1], path = match[2];
      hits.push({
        uid: uid,
        path: path,
        depth: path.split('.').length,
        start: match.index,
        end: this.MARKER_RX.lastIndex
      });
    }
    
    for (let i = 0; i < hits.length; i++) {
      const cur = hits[i];
      const nextStart = i + 1 < hits.length ? hits[i + 1].start : src.length;
      cur.content = src.slice(cur.end, nextStart);
    }
    
    return hits;
  }

  numericPathCompare(a, b) {
    const A = a.split(".").map(Number), B = b.split(".").map(Number);
    for (let i = 0; i < Math.max(A.length, B.length); i++) {
      const ai = A[i] || 0, bi = B[i] || 0;
      if (ai !== bi) return ai - bi;
    }
    return 0;
  }

  emitSection(section) {
    const canon = section.content.replace(this.NL_RX, "\n").replace(/^\n+/, "\n");
    return `<span data-lineage-uid="${section.uid}" data-lineage-section="${section.path}"></span>\n` +
           canon.trimEnd() + "\n\n";
  }

  normalizeGrouped(src, options = {}) {
    const { head, body } = this.splitFrontmatter(src);
    const cleanedBody = this.prepareForParse(body);
    const withUids = this.assignUidsOnce(cleanedBody);
    const sections = this.parseSections(withUids);
    
    if (sections.length === 0) return head + withUids;

    const scaffold = sections.filter(s => s.depth <= 2);
    const content  = sections.filter(s => s.depth >= 3);

    if (options.sortScaffold) scaffold.sort((a, b) => this.numericPathCompare(a.path, b.path));

    const out = [head];

    if (options.addComments) out.push(`<!-- lineage:scaffold start -->\n\n`);
    for (const s of scaffold) out.push(this.emitSection(s));
    if (options.addComments) out.push(`<!-- lineage:scaffold end -->\n\n`);

    if (content.length > 0) {
      if (options.addComments) out.push(`<!-- lineage:content start -->\n\n`);
      for (const s of content) out.push(this.emitSection(s));
      if (options.addComments) out.push(`<!-- lineage:content end -->\n`);
    }

    return out.join("");
  }
}

// Test on real document
const realDoc = fs.readFileSync('content/posts/the-price-of-not-being-cancer-v3.md', 'utf8');
const normalizer = new LineageNormalizer();

console.log("=== NORMALIZING REAL DOCUMENT ===\n");
console.log(`Original: ${realDoc.length} characters`);

// Apply normalization
const normalized = normalizer.normalizeGrouped(realDoc, { 
  sortScaffold: true, 
  addComments: true 
});

console.log(`Normalized: ${normalized.length} characters`);

// Test idempotency
const normalized2 = normalizer.normalizeGrouped(normalized, { 
  sortScaffold: true, 
  addComments: true 
});

console.log(`Second pass: ${normalized2.length} characters`);
console.log(`Idempotent: ${normalized === normalized2 ? '✅' : '❌'}`);

// Analyze structure
const scaffoldMatches = (normalized.match(/<!-- lineage:scaffold start -->([\s\S]*?)<!-- lineage:scaffold end -->/));
const contentMatches = (normalized.match(/<!-- lineage:content start -->([\s\S]*?)<!-- lineage:content end -->/));

if (scaffoldMatches && contentMatches) {
  const scaffoldSections = (scaffoldMatches[1].match(/<span[^>]*data-lineage-section/g) || []).length;
  const contentSections = (contentMatches[1].match(/<span[^>]*data-lineage-section/g) || []).length;
  
  console.log(`\nStructure verification:`);
  console.log(`Scaffold sections: ${scaffoldSections}`);
  console.log(`Content sections: ${contentSections}`);
  console.log(`Total sections: ${scaffoldSections + contentSections}`);
}

// Write normalized version to temp file for inspection
fs.writeFileSync('content/posts/the-price-of-not-being-cancer-v3-NORMALIZED.md', normalized);
console.log('\n✓ Normalized version saved to: the-price-of-not-being-cancer-v3-NORMALIZED.md');
console.log('✓ Ready for Lineage integration!');