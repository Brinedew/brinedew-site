#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

// Read the markdown file
const filePath = 'content/posts/the-price-of-not-being-cancer-v3.md';
const content = fs.readFileSync(filePath, 'utf8');

console.log(`Original file size: ${Buffer.byteLength(content, 'utf8')} bytes`);

// Extract frontmatter (everything up to the first span marker)
const firstSpanMatch = content.match(/<span data-lineage-section="[^"]+"><\/span>/);
if (!firstSpanMatch) {
    console.error('No span markers found!');
    process.exit(1);
}

const frontmatterEndIndex = firstSpanMatch.index;
const frontmatter = content.substring(0, frontmatterEndIndex);
const bodyContent = content.substring(frontmatterEndIndex);

console.log(`Frontmatter size: ${frontmatter.length} bytes`);

// Split content by span markers
const spanMarkerRegex = /<span data-lineage-section="([^"]+)"><\/span>/g;
const sections = [];
let lastIndex = 0;
let match;

while ((match = spanMarkerRegex.exec(bodyContent)) !== null) {
    // If we have content from the previous section, save it
    if (lastIndex < match.index) {
        const prevContent = bodyContent.substring(lastIndex, match.index);
        if (sections.length > 0) {
            sections[sections.length - 1].content = prevContent;
        }
    }
    
    // Create new section
    const sectionId = match[1];
    const depth = sectionId.split('.').length;
    const marker = match[0];
    
    sections.push({
        id: sectionId,
        depth: depth,
        marker: marker,
        content: '' // Will be filled by next iteration or end of file
    });
    
    lastIndex = match.index + match[0].length;
}

// Handle final section content
if (lastIndex < bodyContent.length) {
    const finalContent = bodyContent.substring(lastIndex);
    if (sections.length > 0) {
        sections[sections.length - 1].content = finalContent;
    }
}

console.log(`Found ${sections.length} sections`);

// Helper function to sort section IDs naturally
function sortSectionIds(a, b) {
    const aParts = a.id.split('.').map(Number);
    const bParts = b.id.split('.').map(Number);
    
    for (let i = 0; i < Math.max(aParts.length, bParts.length); i++) {
        const aVal = aParts[i] || 0;
        const bVal = bParts[i] || 0;
        if (aVal !== bVal) {
            return aVal - bVal;
        }
    }
    return 0;
}

// Group sections by depth
const shallowSections = sections.filter(s => s.depth <= 2).sort(sortSectionIds);
const deepSections = sections.filter(s => s.depth >= 3).sort(sortSectionIds);

console.log(`Shallow sections (depth 1-2): ${shallowSections.length}`);
console.log(`Deep sections (depth 3+): ${deepSections.length}`);

// Reconstruct the file
let newContent = frontmatter;

// Add shallow sections first
for (const section of shallowSections) {
    newContent += section.marker + section.content;
}

// Add deep sections after
for (const section of deepSections) {
    newContent += section.marker + section.content;
}

console.log(`New file size: ${Buffer.byteLength(newContent, 'utf8')} bytes`);

// Verify sizes match
const originalSize = Buffer.byteLength(content, 'utf8');
const newSize = Buffer.byteLength(newContent, 'utf8');

if (originalSize === newSize) {
    console.log('✅ File sizes match exactly!');
    
    // Write the rearranged file
    const backupPath = filePath + '.backup';
    fs.writeFileSync(backupPath, content); // Create backup
    fs.writeFileSync(filePath, newContent); // Write rearranged version
    
    console.log(`✅ File rearranged successfully!`);
    console.log(`✅ Backup saved to: ${backupPath}`);
    console.log('');
    console.log('Structure summary:');
    console.log(`- Frontmatter: ${frontmatter.trim().split('\n').length} lines`);
    console.log(`- Shallow sections: ${shallowSections.map(s => s.id).join(', ')}`);
    console.log(`- Deep sections: ${deepSections.map(s => s.id).join(', ')}`);
    
} else {
    console.error(`❌ File size mismatch! Original: ${originalSize}, New: ${newSize}`);
    console.error('Something went wrong - not writing the file');
    process.exit(1);
}