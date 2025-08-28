// Test script for lineage normalization functions
// Run with: node test-lineage-normalization.js

const fs = require('fs');
const path = require('path');

// Since we're using TypeScript, we'd normally need to compile first
// For now, let's create a simplified JavaScript version of the core functions
// to test the logic before integrating

// Sample problematic document (mixed depths)
const sampleDocument = `---
title: "Test Essay"
date: 2025-08-27
tags: [content/post]
---

# Test Essay

<span data-lineage-section="1"></span>
[Hook: This will grab attention...]

<span data-lineage-section="2.1.1"></span>
The main argument is that cellular trade-offs explain aging...

<span data-lineage-section="1.1"></span>  
[Signpost: Here's what we'll cover in section 1...]

<span data-lineage-section="1.2"></span>
[Transition: Moving from intro to main content...]

<span data-lineage-section="2"></span>
[Section 2 signpost: The evidence section...]

<span data-lineage-section="1.1.1"></span>
Cancer cells avoid death through multiple mechanisms...

<span data-lineage-section="2.1.2"></span>
This creates evolutionary pressure for organisms...

<span data-lineage-section="1.1.2"></span>
Normal cells have built-in death programs...
`;

// Expected normalized output (depths 1-2 first, then 3+)
const expectedOutput = `---
title: "Test Essay"
date: 2025-08-27
tags: [content/post]
---

# Test Essay

<!-- lineage:scaffold start -->

<span data-lineage-uid="test-uid-1" data-lineage-section="1"></span>
[Hook: This will grab attention...]

<span data-lineage-uid="test-uid-2" data-lineage-section="1.1"></span>
[Signpost: Here's what we'll cover in section 1...]

<span data-lineage-uid="test-uid-3" data-lineage-section="1.2"></span>
[Transition: Moving from intro to main content...]

<span data-lineage-uid="test-uid-4" data-lineage-section="2"></span>
[Section 2 signpost: The evidence section...]

<!-- lineage:scaffold end -->

<!-- lineage:content start -->

<span data-lineage-uid="test-uid-5" data-lineage-section="1.1.1"></span>
Cancer cells avoid death through multiple mechanisms...

<span data-lineage-uid="test-uid-6" data-lineage-section="1.1.2"></span>
Normal cells have built-in death programs...

<span data-lineage-uid="test-uid-7" data-lineage-section="2.1.1"></span>
The main argument is that cellular trade-offs explain aging...

<span data-lineage-uid="test-uid-8" data-lineage-section="2.1.2"></span>
This creates evolutionary pressure for organisms...

<!-- lineage:content end -->
`;

// Simplified JavaScript versions of core functions for testing
class LineageNormalizerTest {
  constructor() {
    // Preprocessing patterns for idempotency
    this.NL_RX = /\r\n?/g;
    this.LINEAGE_WRAPPERS_RX = /(?:\n)?\s*<!--\s*lineage:(?:scaffold|content)\s+(?:start|end)\s*-->\s*(?:\n)?/gi;
    
    // Single attribute approach - path is the identity
    this.MARKER_RX = /<span(?=[^>]*\bdata-lineage-section=["']?([0-9]+(?:\.[0-9]+)*)["']?)[^>]*>\s*<\/span>/ig;
  }

  prepareForParse(src) {
    return src.replace(this.NL_RX, "\n").replace(this.LINEAGE_WRAPPERS_RX, "");
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
    
    // Add content for each section
    for (let i = 0; i < hits.length; i++) {
      const cur = hits[i];
      const nextStart = i + 1 < hits.length ? hits[i + 1].start : src.length;
      cur.content = src.slice(cur.end, nextStart); // raw slice; trimming handled later
    }
    
    return hits;
  }

  // UID assignment removed - path is the identity

  splitFrontmatter(src) {
    const s = src.replace(this.NL_RX, "\n");
    if (!s.startsWith("---\n")) return { head: "", body: s };
    
    const end = s.indexOf("\n---\n", 4);
    if (end === -1) return { head: "", body: s };
    
    const fmEnd = end + 5;
    return { head: s.slice(0, fmEnd) + "\n", body: s.slice(fmEnd) };
  }

  numericPathCompare(a, b) {
    const aParts = a.split(".").map(Number);
    const bParts = b.split(".").map(Number);
    
    for (let i = 0; i < Math.max(aParts.length, bParts.length); i++) {
      const aPart = aParts[i] || 0;
      const bPart = bParts[i] || 0;
      if (aPart !== bPart) return aPart - bPart;
    }
    return 0;
  }

  emitSection(section) {
    // Normalize leading newlines to at most one LF so emission is stable
    const canon = section.content.replace(this.NL_RX, "\n").replace(/^\n+/, "\n");
    return `<span data-lineage-section="${section.path}"></span>\n` +
           canon.trimEnd() + "\n\n";
  }

  normalizeGrouped(src, options = {}) {
    // 1) Split frontmatter first, then clean the body portion
    const { head, body } = this.splitFrontmatter(src);
    const cleanedBody = this.prepareForParse(body);

    // 2) Parse sections (no UID assignment needed - path is the identity)
    const sections = this.parseSections(cleanedBody);
    if (sections.length === 0) return head + cleanedBody;  // nothing to do

    // 4) Partition
    const scaffold = sections.filter(s => s.depth <= 2);
    const content  = sections.filter(s => s.depth >= 3);

    if (options.sortScaffold) scaffold.sort((a, b) => this.numericPathCompare(a.path, b.path));
    // content order is preserved as edited; if you want numeric, sort here consistently

    // 5) Emit canonical form (LF only; wrappers injected once)
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

  runTests() {
    console.log("Testing Lineage Normalization Functions\n");
    
    // Test 1: Parse sections from mixed document  
    console.log("Test 1: Parsing sections from mixed document");
    const sections = this.parseSections(sampleDocument);
    console.log(`Found ${sections.length} sections:`);
    
    sections.forEach(s => {
      console.log(`  ${s.path} (depth ${s.depth}): ${s.content.trim().substring(0, 50)}...`);
    });
    
    // Test 2: Check depth grouping
    console.log("\nTest 2: Grouping by depth");
    const scaffoldSections = sections.filter(s => s.depth <= 2);
    const contentSections = sections.filter(s => s.depth >= 3);
    
    console.log(`Scaffold sections (depth ≤ 2): ${scaffoldSections.map(s => s.path).join(', ')}`);
    console.log(`Content sections (depth ≥ 3): ${contentSections.map(s => s.path).join(', ')}`);
    
    // Test 3: Full normalization
    console.log("\nTest 3: Full normalization");
    const normalized = this.normalizeGrouped(sampleDocument, { 
      sortScaffold: true, 
      addComments: true 
    });
    
    // Check structure
    const normalizedSections = this.parseSections(normalized);
    console.log(`Normalized document has ${normalizedSections.length} sections`);
    
    const firstContentIndex = normalizedSections.findIndex(s => s.depth >= 3);
    const lastScaffoldIndex = normalizedSections.map(s => s.depth <= 2).lastIndexOf(true);
    
    const scaffoldFirst = firstContentIndex === -1 || lastScaffoldIndex < firstContentIndex;
    console.log(`Scaffold sections come before content sections: ${scaffoldFirst}`);
    
    // Test 4: Idempotency
    console.log("\nTest 4: Testing idempotency");
    
    // Simplified debug for path-only approach
    console.log("DEBUG: Checking first normalized result...");
    const firstNormSections = this.parseSections(normalized);
    console.log(`First normalized has ${firstNormSections.length} sections`);
    
    const normalized2 = this.normalizeGrouped(normalized, { 
      sortScaffold: true, 
      addComments: true 
    });
    
    const isIdempotent = normalized === normalized2;
    console.log(`Normalization is idempotent: ${isIdempotent}`);
    
    if (!isIdempotent) {
      console.log("First normalization length:", normalized.length);
      console.log("Second normalization length:", normalized2.length);
      
      // Debug: show first few differences
      const lines1 = normalized.split('\n');
      const lines2 = normalized2.split('\n');
      console.log("\nFirst few differences:");
      for (let i = 0; i < Math.min(lines1.length, lines2.length, 20); i++) {
        if (lines1[i] !== lines2[i]) {
          console.log(`Line ${i+1}:`);
          console.log(`  First:  "${lines1[i]}"`);
          console.log(`  Second: "${lines2[i]}"`);
          break;
        }
      }
    }
    
    // Output sample result
    console.log("\n=== SAMPLE NORMALIZED OUTPUT ===");
    console.log(normalized.substring(0, 500) + "...");
    
    return {
      sectionsFound: sections.length,
      scaffoldFirst: scaffoldFirst,
      idempotent: isIdempotent,
      normalizedLength: normalized.length
    };
  }
}

// Run the tests
const tester = new LineageNormalizerTest();
const results = tester.runTests();

console.log("\n=== TEST RESULTS ===");
console.log(`✓ Found ${results.sectionsFound} sections`);
console.log(`${results.scaffoldFirst ? '✓' : '✗'} Scaffold sections grouped first`);
console.log(`${results.idempotent ? '✓' : '✗'} Normalization is idempotent`);
console.log(`✓ Output length: ${results.normalizedLength} characters`);

if (results.scaffoldFirst && results.idempotent && results.sectionsFound > 0) {
  console.log("\n🎉 All tests passed! The normalization logic is working correctly.");
} else {
  console.log("\n❌ Some tests failed. Check the implementation.");
}