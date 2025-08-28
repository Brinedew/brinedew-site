const fs = require('fs');

// Read the real document
const realDoc = fs.readFileSync('content/posts/the-price-of-not-being-cancer-v3.md', 'utf8');

console.log("=== TESTING NORMALIZATION ON REAL DOCUMENT ===\n");
console.log(`Original document length: ${realDoc.length} characters`);

// Count sections by depth
const sections = (realDoc.match(/<span[^>]*data-lineage-section="[^"]*"[^>]*>/g) || []);
console.log(`Total sections found: ${sections.length}`);

// Analyze depth distribution
const depths = {};
sections.forEach(section => {
  const match = section.match(/data-lineage-section="([^"]*)"/);
  if (match) {
    const path = match[1];
    const depth = path.split('.').length;
    depths[depth] = (depths[depth] || 0) + 1;
  }
});

console.log("Depth distribution:");
Object.entries(depths).sort().forEach(([depth, count]) => {
  console.log(`  Depth ${depth}: ${count} sections`);
});

const scaffoldCount = (depths[1] || 0) + (depths[2] || 0);
const contentCount = Object.entries(depths)
  .filter(([depth]) => parseInt(depth) >= 3)
  .reduce((sum, [_, count]) => sum + count, 0);

console.log(`\nScaffold sections (depth ≤ 2): ${scaffoldCount}`);
console.log(`Content sections (depth ≥ 3): ${contentCount}`);

// Test that document has UIDs
const hasUids = /<span[^>]*data-lineage-uid="[^"]*"/.test(realDoc);
console.log(`\nDocument already has UIDs: ${hasUids}`);

if (!hasUids) {
  console.log("✓ Document needs UID assignment - perfect test case!");
} else {
  console.log("! Document already has UIDs - will test idempotency");
}