import fs from 'fs';
import https from 'https';

const ZOTERO_USER_ID = 'biokozlov';
const COLLECTION_ID = 'E34RX9IV';

function fetchZoteroData() {
  return new Promise((resolve, reject) => {
    const url = `https://api.zotero.org/users/${ZOTERO_USER_ID}/collections/${COLLECTION_ID}/items?format=json&limit=100`;
    
    https.get(url, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          reject(e);
        }
      });
    }).on('error', reject);
  });
}

async function generateBibliography() {
  try {
    const items = await fetchZoteroData();
    
    const bibliography = items.map(item => ({
      key: item.key,
      title: item.data.title || '',
      authors: item.data.creators?.map(c => `${c.firstName} ${c.lastName}`) || [],
      year: item.data.date?.substring(0, 4) || '',
      doi: item.data.DOI || '',
      url: item.data.url || '',
      tags: item.data.tags?.map(t => t.tag) || []
    }));
    
    // Create references page
    const referencesContent = `---
title: "References"
description: "Bibliography synced from Zotero"
---

# References

Last updated: ${new Date().toISOString().split('T')[0]}

${bibliography.map(ref => `
## ${ref.title}

- **Authors**: ${ref.authors.join(', ')}
- **Year**: ${ref.year}
- **DOI**: ${ref.doi ? `[${ref.doi}](https://doi.org/${ref.doi})` : 'N/A'}
- **Tags**: ${ref.tags.join(', ') || 'None'}
`).join('\n')}
`;
    
    fs.writeFileSync('content/references.md', referencesContent);
    console.log(`✓ Synced ${bibliography.length} references from Zotero`);
    
  } catch (error) {
    console.error('Error syncing Zotero:', error);
  }
}

generateBibliography();