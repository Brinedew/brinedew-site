import fs from 'fs';
import path from 'path';

function addFrontmatter(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');
  
  // Check if already has frontmatter
  if (content.startsWith('---')) {
    return;
  }
  
  // Extract title from first H1 or filename
  const titleMatch = content.match(/^#\s+(.+)$/m);
  const title = titleMatch ? titleMatch[1] : path.basename(filePath, '.md');
  
  // Add minimal frontmatter
  const frontmatter = `---
title: "${title}"
date: ${new Date().toISOString().split('T')[0]}
---

`;
  
  fs.writeFileSync(filePath, frontmatter + content);
  console.log(`✓ Migrated: ${filePath}`);
}

// Recursively process all markdown files
function processDirectory(dir) {
  const files = fs.readdirSync(dir);
  
  files.forEach(file => {
    const filePath = path.join(dir, file);
    const stat = fs.statSync(filePath);
    
    if (stat.isDirectory() && !file.startsWith('.')) {
      processDirectory(filePath);
    } else if (file.endsWith('.md')) {
      addFrontmatter(filePath);
    }
  });
}

// Run migration
processDirectory('./content');
console.log('Migration complete!');