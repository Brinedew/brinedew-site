const fs = require('fs');
const path = require('path');

// Migration mapping: source path -> { target: newPath, tags: [...], aliases: [...] }
const migrationMap = {
  // Concepts
  'wiki/concepts/de-darwinization.md': {
    target: 'wiki/de-darwinization.md',
    tags: ['type/wiki', 'category/concept', 'topic/biology', 'topic/evolution', 'status/complete'],
    aliases: ['wiki/concepts/de-darwinization', 'concepts/de-darwinization']
  },
  'wiki/concepts/de-darwinization-v2.md': {
    target: 'wiki/de-darwinization-v2.md',
    tags: ['type/wiki', 'category/concept', 'topic/biology', 'topic/evolution', 'status/complete'],
    aliases: ['wiki/concepts/de-darwinization-v2', 'concepts/de-darwinization-v2']
  },
  
  // Mechanisms  
  'wiki/mechanisms/immune-surveillance.md': {
    target: 'wiki/immune-surveillance.md',
    tags: ['type/wiki', 'category/mechanism', 'topic/biology', 'topic/aging', 'status/stub'],
    aliases: ['wiki/mechanisms/immune-surveillance', 'mechanisms/immune-surveillance']
  },
  'wiki/mechanisms/p53-guardian.md': {
    target: 'wiki/p53-guardian.md', 
    tags: ['type/wiki', 'category/mechanism', 'protein/p53', 'topic/aging', 'topic/cancer', 'status/stub'],
    aliases: ['wiki/mechanisms/p53-guardian', 'mechanisms/p53-guardian']
  },
  'wiki/mechanisms/telomeres.md': {
    target: 'wiki/telomeres.md',
    tags: ['type/wiki', 'category/mechanism', 'topic/aging', 'mechanism/telomeres', 'status/stub'], 
    aliases: ['wiki/mechanisms/telomeres', 'mechanisms/telomeres']
  },
  'wiki/mechanisms/weismann-barrier.md': {
    target: 'wiki/weismann-barrier.md',
    tags: ['type/wiki', 'category/mechanism', 'topic/biology', 'topic/evolution', 'status/stub'],
    aliases: ['wiki/mechanisms/weismann-barrier', 'mechanisms/weismann-barrier']
  },
  
  // Theories
  'wiki/theories/Atavistic-theory-of-cancer.md': {
    target: 'wiki/atavistic-theory-of-cancer.md',
    tags: ['type/wiki', 'category/theory', 'topic/cancer', 'topic/evolution', 'theory/atavistic', 'status/stub'],
    aliases: ['wiki/theories/Atavistic-theory-of-cancer', 'theories/atavistic-theory-of-cancer']
  },
  'wiki/theories/antagonistic-pleiotropy-theory.md': {
    target: 'wiki/antagonistic-pleiotropy-theory.md', 
    tags: ['type/wiki', 'category/theory', 'topic/aging', 'theory/antagonistic-pleiotropy', 'status/complete'],
    aliases: ['wiki/theories/antagonistic-pleiotropy-theory', 'theories/antagonistic-pleiotropy-theory']
  },
  'wiki/theories/defensive-degeneration-theory.md': {
    target: 'wiki/defensive-degeneration-theory.md',
    tags: ['type/wiki', 'category/theory', 'topic/aging', 'theory/defensive-degeneration', 'status/stub'], 
    aliases: ['wiki/theories/defensive-degeneration-theory', 'theories/defensive-degeneration-theory']
  },
  'wiki/theories/disposable-soma-theory.md': {
    target: 'wiki/disposable-soma-theory.md',
    tags: ['type/wiki', 'category/theory', 'topic/aging', 'theory/disposable-soma', 'status/stub'],
    aliases: ['wiki/theories/disposable-soma-theory', 'theories/disposable-soma-theory']
  },
  'wiki/theories/selection-shadow-theory.md': {
    target: 'wiki/selection-shadow-theory.md',
    tags: ['type/wiki', 'category/theory', 'topic/aging', 'theory/selection-shadow', 'status/stub'],
    aliases: ['wiki/theories/selection-shadow-theory', 'theories/selection-shadow-theory']
  },
  'wiki/theories/tumor-suppressor-theory-of-aging.md': {
    target: 'wiki/tumor-suppressor-theory-of-aging.md',
    tags: ['type/wiki', 'category/theory', 'topic/aging', 'topic/cancer', 'theory/tumor-suppressor', 'status/stub'],
    aliases: ['wiki/theories/tumor-suppressor-theory-of-aging', 'theories/tumor-suppressor-theory-of-aging']
  },
  
  // Organisms - cancer lineages
  'wiki/organisms/cancer-lineages/ctvt.md': {
    target: 'wiki/ctvt.md',
    tags: ['type/wiki', 'category/organism', 'organism/cancer-cell-line', 'specific/ctvt', 'topic/cancer', 'status/stub'],
    aliases: ['wiki/organisms/cancer-lineages/ctvt', 'organisms/cancer-lineages/ctvt', 'cancer-lineages/ctvt']
  },
  'wiki/organisms/cancer-lineages/dftd.md': {
    target: 'wiki/dftd.md', 
    tags: ['type/wiki', 'category/organism', 'organism/cancer-cell-line', 'specific/dftd', 'topic/cancer', 'status/stub'],
    aliases: ['wiki/organisms/cancer-lineages/dftd', 'organisms/cancer-lineages/dftd', 'cancer-lineages/dftd']
  },
  'wiki/organisms/cancer-lineages/hela.md': {
    target: 'wiki/hela.md',
    tags: ['type/wiki', 'category/organism', 'organism/cancer-cell-line', 'specific/hela', 'topic/cancer', 'status/stub'], 
    aliases: ['wiki/organisms/cancer-lineages/hela', 'organisms/cancer-lineages/hela', 'cancer-lineages/hela']
  },
  
  // Proteins
  'wiki/proteins/oncogenes/oncogene-classification.md': {
    target: 'wiki/oncogene-classification.md',
    tags: ['type/wiki', 'category/protein', 'protein/oncogene', 'topic/cancer', 'status/stub'],
    aliases: ['wiki/proteins/oncogenes/oncogene-classification', 'proteins/oncogenes/oncogene-classification', 'oncogenes/oncogene-classification']
  }
};

function updateFrontmatter(content, targetPath, tags, aliases) {
  const lines = content.split('\n');
  
  // Find frontmatter boundaries
  let fmStart = -1, fmEnd = -1;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trim() === '---') {
      if (fmStart === -1) fmStart = i;
      else { fmEnd = i; break; }
    }
  }
  
  if (fmStart === -1 || fmEnd === -1) {
    throw new Error(`No valid frontmatter found in ${targetPath}`);
  }
  
  // Extract title and date from existing frontmatter
  let title = '', date = '';
  for (let i = fmStart + 1; i < fmEnd; i++) {
    const line = lines[i];
    if (line.startsWith('title:')) {
      title = line.substring(6).trim().replace(/['"]/g, '');
    } else if (line.startsWith('date:')) {
      date = line.substring(5).trim().replace(/['"]/g, '');
    }
  }
  
  // Build new frontmatter
  const newFrontmatter = [
    '---',
    `title: "${title}"`,
    `date: ${date}`,
    `tags: [${tags.join(', ')}]`,
    'aliases:',
    ...aliases.map(alias => `  - ${alias}`),
    '---'
  ];
  
  // Replace frontmatter and return updated content
  const bodyLines = lines.slice(fmEnd + 1);
  return [...newFrontmatter, '', ...bodyLines].join('\n');
}

function updateInternalLinks(content, migrationMap) {
  // Update relative links to work with flat structure
  let updated = content;
  
  // Update wiki links: [link](../folder/file.md) -> [link](file.md)
  updated = updated.replace(/\[([^\]]+)\]\(\.\.\/[^\/]+\/([^)]+)\.md\)/g, '[$1]($2.md)');
  
  // Update specific known links based on migration map
  for (const [oldPath, config] of Object.entries(migrationMap)) {
    const oldFile = path.basename(oldPath, '.md');
    const newFile = path.basename(config.target, '.md');
    
    if (oldFile !== newFile) {
      const linkRegex = new RegExp(`\\[([^\\]]+)\\]\\(${oldFile}\\.md\\)`, 'g');
      updated = updated.replace(linkRegex, `[$1](${newFile}.md)`);
    }
  }
  
  return updated;
}

async function executeMigration() {
  console.log('Starting wiki flattening migration...\n');
  
  for (const [sourcePath, config] of Object.entries(migrationMap)) {
    const sourceFile = `./content/${sourcePath}`;
    const targetFile = `./content/${config.target}`;
    
    if (!fs.existsSync(sourceFile)) {
      console.log(`⚠️  Source not found: ${sourcePath}`);
      continue;
    }
    
    try {
      // Read and update content
      const content = fs.readFileSync(sourceFile, 'utf8');
      let updatedContent = updateFrontmatter(content, config.target, config.tags, config.aliases);
      updatedContent = updateInternalLinks(updatedContent, migrationMap);
      
      // Write to target location
      fs.writeFileSync(targetFile, updatedContent);
      
      // Delete original
      fs.unlinkSync(sourceFile);
      
      console.log(`✓ Moved: ${sourcePath} -> ${config.target}`);
      
    } catch (error) {
      console.error(`❌ Error processing ${sourcePath}:`, error.message);
    }
  }
  
  console.log('\n✅ Migration completed!');
  console.log('Run: npx quartz build --serve to test the flattened structure');
}

// Execute if run directly
if (require.main === module) {
  executeMigration();
}

module.exports = { migrationMap, updateFrontmatter, updateInternalLinks };