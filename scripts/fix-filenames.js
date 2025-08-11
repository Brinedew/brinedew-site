import fs from 'fs';
import path from 'path';

function sanitizeFilename(filename) {
  // Convert spaces to hyphens, lowercase, remove special chars
  return filename
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^\w\-\.]/g, '');
}

function getAllMarkdownFiles(dir) {
  let files = [];
  const items = fs.readdirSync(dir);
  
  items.forEach(item => {
    const fullPath = path.join(dir, item);
    if (fs.statSync(fullPath).isDirectory()) {
      files = files.concat(getAllMarkdownFiles(fullPath));
    } else if (item.endsWith('.md')) {
      files.push(fullPath);
    }
  });
  
  return files;
}

function updateInternalLinks(oldName, newName) {
  // Update all [[wikilinks]] that reference the old filename
  const allFiles = getAllMarkdownFiles('./content');
  const oldLink = oldName.replace('.md', '');
  const newLink = newName.replace('.md', '');
  
  allFiles.forEach(filepath => {
    try {
      let content = fs.readFileSync(filepath, 'utf8');
      let updated = false;
      
      // Update wikilinks [[Old Name]]
      const wikilinkRegex = new RegExp(`\\[\\[${oldLink.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\]\\]`, 'g');
      if (content.match(wikilinkRegex)) {
        content = content.replace(wikilinkRegex, `[[${newLink}]]`);
        updated = true;
      }
      
      // Update markdown links [text](Old Name.md)
      const markdownLinkRegex = new RegExp(`\\]\\(${oldName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\)`, 'g');
      if (content.match(markdownLinkRegex)) {
        content = content.replace(markdownLinkRegex, `](${newName})`);
        updated = true;
      }
      
      if (updated) {
        fs.writeFileSync(filepath, content);
        console.log(`Updated links in: ${path.relative('./content', filepath)}`);
      }
    } catch (error) {
      console.warn(`Could not update links in ${filepath}: ${error.message}`);
    }
  });
}

function processDirectory(dir) {
  const files = fs.readdirSync(dir);
  
  files.forEach(file => {
    const oldPath = path.join(dir, file);
    
    if (fs.statSync(oldPath).isDirectory()) {
      processDirectory(oldPath);
    } else if (file.endsWith('.md') && file.includes(' ')) {
      const newName = sanitizeFilename(file);
      const newPath = path.join(dir, newName);
      
      console.log(`Processing: ${file} → ${newName}`);
      
      // Update internal links in ALL files before renaming
      updateInternalLinks(file, newName);
      
      // Rename file
      fs.renameSync(oldPath, newPath);
      console.log(`✅ Renamed: ${file} → ${newName}`);
    }
  });
}

console.log('🔧 Starting filename sanitization...\n');
processDirectory('./content');
console.log('\n✅ Filename sanitization complete!');