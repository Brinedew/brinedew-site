const fs = require('fs');

// Import simplified normalization logic
class LineageNormalizerSimplified {
  constructor() {
    this.NL_RX = /\r\n?/g;
    this.LINEAGE_WRAPPERS_RX = /(?:\n)?\s*<!--\s*lineage:(?:scaffold|content)\s+(?:start|end)\s*-->\s*(?:\n)?/gi;
    this.MARKER_RX = /<span(?=[^>]*\bdata-lineage-section=["']?([0-9]+(?:\.[0-9]+)*)["']?)[^>]*>\s*<\/span>/ig;
  }

  prepareForParse(src) {
    return src.replace(this.NL_RX, "\n").replace(this.LINEAGE_WRAPPERS_RX, "");
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
      const path = match[1];
      hits.push({
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
    return `<span data-lineage-section="${section.path}"></span>\n` +
           canon.trimEnd() + "\n\n";
  }

  normalizeGrouped(src, options = {}) {
    const { head, body } = this.splitFrontmatter(src);
    const cleanedBody = this.prepareForParse(body);
    const sections = this.parseSections(cleanedBody);
    
    if (sections.length === 0) return head + cleanedBody;

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
const normalizer = new LineageNormalizerSimplified();

console.log("=== TESTING SIMPLIFIED PATH-ONLY APPROACH ===\n");
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
console.log(`Perfect idempotency: ${normalized === normalized2 ? '✅' : '❌'}`);

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

// Check for any remaining UIDs (should be none)
const hasOldUids = /<span[^>]*data-lineage-uid/.test(normalized);
console.log(`Contains old UIDs: ${hasOldUids ? '❌' : '✅ Clean!'}`);

// Show sample of simplified format
console.log(`\nSimplified format sample:`);
const sampleSections = normalized.match(/<span data-lineage-section="[^"]*"><\/span>/g);
if (sampleSections) {
  sampleSections.slice(0, 5).forEach(s => console.log(`  ${s}`));
}

// Write simplified version
fs.writeFileSync('content/posts/the-price-of-not-being-cancer-v3-SIMPLIFIED.md', normalized);
console.log('\n✅ Simplified path-only version saved!');
console.log('✅ Ready to replace original and test in Lineage!');