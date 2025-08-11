import fs from 'fs';
import path from 'path';

const issues = [];

function checkFile(filepath) {
  const content = fs.readFileSync(filepath, 'utf8');
  const filename = path.basename(filepath);
  const relativePath = path.relative('./content', filepath);
  
  // Check for Obsidian-specific syntax that might break
  if (content.includes('![[') && !content.includes('![[]]')) {
    issues.push(`${relativePath}: Contains Obsidian embeds ![[...]]`);
  }
  
  if (content.includes('%%')) {
    issues.push(`${relativePath}: Contains Obsidian comments %%...%%`);
  }
  
  if (content.includes('<iframe') && content.includes('scriptotic')) {
    issues.push(`${relativePath}: Contains iframe (might need HTML escape)`);
  }
  
  if (!content.startsWith('---')) {
    issues.push(`${relativePath}: Missing frontmatter`);
  }
  
  // Check for HTML files pretending to be markdown
  if (filepath.endsWith('.md') && (content.startsWith('<!DOCTYPE') || content.startsWith('<html'))) {
    issues.push(`${relativePath}: Is actually HTML, not Markdown`);
  }
  
  // Check for raw HTML content blocks
  if (content.includes('<div') || content.includes('<form') || content.includes('<script')) {
    issues.push(`${relativePath}: Contains raw HTML content that may not render properly`);
  }
  
  // Check for problematic Obsidian syntax
  if (content.includes('++') && content.includes('++')) {
    issues.push(`${relativePath}: Contains keyboard key syntax ++key++ (may need plugin)`);
  }
  
  if (content.includes('==') && content.includes('==')) {
    issues.push(`${relativePath}: Contains highlight syntax ==text== (may need plugin)`);
  }
  
  // Check for spaces in filenames (can cause URL issues)
  if (filename.includes(' ')) {
    issues.push(`${relativePath}: Filename contains spaces (may cause URL issues)`);
  }
}

// Scan all content
function scanDirectory(dir) {
  const files = fs.readdirSync(dir);
  files.forEach(file => {
    const fullPath = path.join(dir, file);
    if (fs.statSync(fullPath).isDirectory()) {
      scanDirectory(fullPath);
    } else if (fullPath.endsWith('.md')) {
      checkFile(fullPath);
    }
  });
}

console.log('🔍 Scanning content for issues...\n');
scanDirectory('./content');

if (issues.length === 0) {
  console.log('✅ No content issues found!');
} else {
  console.log(`❌ Found ${issues.length} issues:\n`);
  issues.forEach(issue => console.log(`   ${issue}`));
}

console.log('\n📊 Content statistics:');
const stats = {};
function countFiles(dir) {
  const files = fs.readdirSync(dir);
  files.forEach(file => {
    const fullPath = path.join(dir, file);
    if (fs.statSync(fullPath).isDirectory()) {
      countFiles(fullPath);
    } else {
      const ext = path.extname(file).toLowerCase();
      stats[ext] = (stats[ext] || 0) + 1;
    }
  });
}

countFiles('./content');
Object.entries(stats).sort().forEach(([ext, count]) => {
  console.log(`   ${ext || 'no extension'}: ${count} files`);
});