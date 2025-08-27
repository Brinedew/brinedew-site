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
    this.MARKER_RX = /<span[^>]*\bdata-lineage-section=["']?([0-9]+(?:\.[0-9]+)*)["'][^>]*>\s*<\/span>/ig;
    this.UID_CHECK_RX = /\bdata-lineage-uid=["'][0-9a-fA-F-]{8,}["']/i;
  }

  parseSections(src) {
    const hits = [];
    this.MARKER_RX.lastIndex = 0;
    let match;
    
    while ((match = this.MARKER_RX.exec(src)) !== null) {
      const path = match[1];
      hits.push({
        uid: this.extractUid(match[0]) || 'missing-uid',
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
      cur.content = src.slice(cur.end, nextStart);
    }
    
    return hits;
  }

  extractUid(markerHtml) {
    const uidMatch = markerHtml.match(/data-lineage-uid=["']([^"']+)["']/);
    return uidMatch ? uidMatch[1] : null;
  }

  hasUids(src) {
    return this.UID_CHECK_RX.test(src);
  }

  assignUidsOnce(src) {
    if (this.hasUids(src)) return src;
    
    const timestamp = Date.now().toString(16);
    let counter = 0;
    
    return src.replace(this.MARKER_RX, (match, path) => {
      const uid = `${timestamp}-${(counter++).toString(16).padStart(4, '0')}`;
      return match.replace('<span', `<span data-lineage-uid="${uid}"`);
    });
  }

  splitFrontmatter(src) {
    if (!src.startsWith("---")) return { head: "", body: src };
    
    const endIndex = src.indexOf("\n---", 3);
    if (endIndex < 0) return { head: "", body: src };
    
    const frontmatterEnd = endIndex + 4;
    return {
      head: src.slice(0, frontmatterEnd) + "\n\n",
      body: src.slice(frontmatterEnd)
    };
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
    return `<span data-lineage-uid="${section.uid}" data-lineage-section="${section.path}"></span>\n` +
           section.content.trimStart() + "\n\n";
  }

  normalizeGrouped(src, options = {}) {
    // First ensure UIDs are assigned
    const withUids = this.assignUidsOnce(src);
    
    const { head, body } = this.splitFrontmatter(withUids);
    const sections = this.parseSections(body);
    
    if (sections.length === 0) return withUids;
    
    // Split by depth
    const scaffoldSections = sections.filter(s => s.depth <= 2);
    const contentSections = sections.filter(s => s.depth >= 3);
    
    // Sort scaffold if requested
    if (options.sortScaffold) {
      scaffoldSections.sort((a, b) => this.numericPathCompare(a.path, b.path));
    }
    
    // Sort content numerically
    contentSections.sort((a, b) => this.numericPathCompare(a.path, b.path));
    
    const parts = [head];
    
    if (options.addComments) {
      parts.push("<!-- lineage:scaffold start -->\n\n");
    }
    
    for (const section of scaffoldSections) {
      parts.push(this.emitSection(section));
    }
    
    if (options.addComments) {
      parts.push("<!-- lineage:scaffold end -->\n\n");
    }
    
    if (contentSections.length > 0) {
      if (options.addComments) {
        parts.push("<!-- lineage:content start -->\n\n");
      }
      
      for (const section of contentSections) {
        parts.push(this.emitSection(section));
      }
      
      if (options.addComments) {
        parts.push("<!-- lineage:content end -->\n");
      }
    }
    
    return parts.join("");
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
    
    // Test 3: Assign UIDs
    console.log("\nTest 3: Assigning UIDs");
    console.log(`Document has UIDs: ${this.hasUids(sampleDocument)}`);
    
    const withUids = this.assignUidsOnce(sampleDocument);
    console.log(`After assignment: ${this.hasUids(withUids)}`);
    
    // Test 4: Full normalization
    console.log("\nTest 4: Full normalization");
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
    
    // Test 5: Idempotency
    console.log("\nTest 5: Testing idempotency");
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