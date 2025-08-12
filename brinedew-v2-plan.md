# Complete Build Instructions: Brinedew.com v2 with Quartz

## IMPORTANT: Read this entire document first before starting any steps

You are building a v2 of brinedew.com that replaces MkDocs with Quartz 4, a static site generator optimized for Obsidian vaults. The user writes in Obsidian and pushes via git. Your job is to set up Quartz while preserving this workflow.

## Prerequisites Check

Before starting, verify these exist in the project:
- `/docs/` folder containing markdown files
- `/.github/workflows/` folder
- `/mkdocs.yml` file (current config we're replacing)
- `CNAME` file in `/docs/` containing `brinedew.com`

## Phase 1: Initial Setup and Installation

### Step 1.1: Create a new branch for v2
```bash
git checkout -b v2-quartz-migration
```

### Step 1.2: Install Node.js dependencies
Create a new file `package.json` in the root directory with this exact content:

```json
{
  "name": "brinedew-site",
  "version": "2.0.0",
  "description": "Brinedew knowledge base",
  "scripts": {
    "build": "quartz build",
    "serve": "quartz build --serve",
    "sync": "node scripts/sync-zotero.js"
  },
  "dependencies": {
    "@jackyzha0/quartz": "^4.3.0",
    "cytoscape": "^3.28.0"
  },
  "devDependencies": {
    "@types/node": "^20.10.0"
  }
}
```

Run:
```bash
npm install
```

### Step 1.3: Initialize Quartz
```bash
npx quartz create --strategy copy
```
When prompted, select "Copy an existing folder" and point it to your `docs` folder.

## Phase 2: Core Configuration

### Step 2.1: Create Quartz configuration
Create a new file `quartz.config.ts` in the root directory with this exact content:

```typescript
import { QuartzConfig } from "./quartz/cfg"
import * as Plugin from "./quartz/plugins"

const config: QuartzConfig = {
  configuration: {
    pageTitle: "Brinedew",
    enableSPA: true,
    enablePopovers: true,
    analytics: null,
    locale: "en-US",
    baseUrl: "brinedew.com",
    ignorePatterns: ["private", "templates", ".obsidian", "*.tmp"],
    defaultDateType: "created",
    theme: {
      fontOrigin: "googleFonts",
      cdnCaching: true,
      typography: {
        header: "Inter",
        body: "Source Serif Pro",
        code: "JetBrains Mono",
      },
      colors: {
        lightMode: {
          light: "#faf8f8",
          lightgray: "#e5e5e5",
          gray: "#b8b8b8",
          darkgray: "#4e4e4e",
          dark: "#2b2b2b",
          secondary: "#0050a0",
          tertiary: "#84a59d",
          highlight: "rgba(143, 159, 169, 0.15)",
        },
        darkMode: {
          light: "#1a1a1a",
          lightgray: "#393639",
          gray: "#646464",
          darkgray: "#d4d4d4",
          dark: "#ebebec",
          secondary: "#7aa2f7",
          tertiary: "#84a59d",
          highlight: "rgba(143, 159, 169, 0.15)",
        },
      },
    },
  },
  plugins: {
    transformers: [
      Plugin.FrontMatter(),
      Plugin.CreatedModifiedDate({
        priority: ["frontmatter", "filesystem"],
      }),
      Plugin.Latex({ renderEngine: "katex" }),
      Plugin.SyntaxHighlighting({
        theme: {
          light: "github-light",
          dark: "github-dark",
        },
      }),
      Plugin.ObsidianFlavoredMarkdown({ enableInHtmlEmbed: true }),
      Plugin.GitHubFlavoredMarkdown(),
      Plugin.TableOfContents({
        maxDepth: 3,
        minEntries: 1,
        showByDefault: true,
        collapseByDefault: false,
      }),
      Plugin.CrawlLinks({ markdownLinkResolution: "shortest" }),
      Plugin.Description({ descriptionLength: 150 }),
    ],
    filters: [Plugin.RemoveDrafts()],
    emitters: [
      Plugin.AliasRedirects(),
      Plugin.ComponentResources(),
      Plugin.ContentPage({
        head: {
          scripts: [
            {
              src: "https://unpkg.com/cytoscape@3.28.0/dist/cytoscape.min.js",
              loadTime: "afterDOMReady",
              moduleType: "module",
            }
          ]
        }
      }),
      Plugin.FolderPage(),
      Plugin.TagPage(),
      Plugin.ContentIndex({
        enableSiteMap: true,
        enableRSS: true,
      }),
      Plugin.Assets(),
      Plugin.Static(),
      Plugin.NotFoundPage(),
    ],
  },
}

export default config
```

### Step 2.2: Create custom layout component
Create directory structure:
```bash
mkdir -p quartz/components/custom
```

Create file `quartz/components/custom/Citation.tsx`:
```typescript
import { QuartzComponent, QuartzComponentConstructor, QuartzComponentProps } from "../types"
import { classNames } from "../util/lang"

interface CitationData {
  doi?: string
  zoteroKey?: string
  title?: string
  authors?: string[]
  year?: string
}

export const Citation: QuartzComponent = ({ displayClass, cite }: QuartzComponentProps & { cite: CitationData }) => {
  const [showPopover, setShowPopover] = React.useState(false)
  const [metadata, setMetadata] = React.useState<CitationData | null>(null)
  
  React.useEffect(() => {
    if (cite.doi) {
      fetch(`https://api.crossref.org/works/${cite.doi}`)
        .then(r => r.json())
        .then(data => {
          setMetadata({
            title: data.message.title?.[0],
            authors: data.message.author?.map((a: any) => `${a.given} ${a.family}`),
            year: data.message.published?.['date-parts']?.[0]?.[0]
          })
        })
    } else if (cite.zoteroKey) {
      // Zotero integration - using public library
      fetch(`https://api.zotero.org/users/biokozlov/items/${cite.zoteroKey}?format=json`)
        .then(r => r.json())
        .then(data => {
          setMetadata({
            title: data.data.title,
            authors: data.data.creators?.map((c: any) => `${c.firstName} ${c.lastName}`),
            year: data.data.date
          })
        })
    }
  }, [cite])
  
  return (
    <span 
      className={classNames(displayClass, "citation")}
      onMouseEnter={() => setShowPopover(true)}
      onMouseLeave={() => setShowPopover(false)}
    >
      <sup>[{metadata?.year || cite.year || '...'}]</sup>
      {showPopover && metadata && (
        <div className="citation-popover">
          <h4>{metadata.title}</h4>
          <p>{metadata.authors?.join(', ')}</p>
          <div className="citation-actions">
            <button onClick={() => navigator.clipboard.writeText(
              `@article{${cite.doi || cite.zoteroKey},\n  title={${metadata.title}},\n  author={${metadata.authors?.join(' and ')}},\n  year={${metadata.year}}\n}`
            )}>Copy BibTeX</button>
          </div>
        </div>
      )}
    </span>
  )
}

Citation.css = `
.citation {
  position: relative;
  cursor: help;
  color: var(--secondary);
}

.citation-popover {
  position: absolute;
  bottom: 100%;
  left: 0;
  background: var(--light);
  border: 1px solid var(--lightgray);
  border-radius: 4px;
  padding: 0.75rem;
  box-shadow: 0 4px 6px rgba(0,0,0,0.1);
  width: 300px;
  z-index: 1000;
  margin-bottom: 0.25rem;
}

.citation-popover h4 {
  margin: 0 0 0.5rem 0;
  font-size: 0.9rem;
}

.citation-popover p {
  margin: 0 0 0.5rem 0;
  font-size: 0.8rem;
  color: var(--gray);
}

.citation-actions button {
  background: var(--lightgray);
  border: none;
  padding: 0.25rem 0.5rem;
  border-radius: 2px;
  font-size: 0.75rem;
  cursor: pointer;
}

.citation-actions button:hover {
  background: var(--gray);
}
`

export default (() => Citation) satisfies QuartzComponentConstructor
```

### Step 2.3: Create custom CSS
Create file `quartz/styles/custom.scss`:
```scss
// Import base styles
@use "./base.scss";

// LessWrong/Gwern aesthetic adjustments
:root {
  --content-width: 750px;
  --right-sidebar-width: 250px;
}

// Typography improvements
article {
  font-size: 1.1rem;
  line-height: 1.7;
  
  h1 { 
    font-size: 2.5rem;
    margin-top: 2rem;
  }
  
  h2 { 
    font-size: 1.8rem;
    margin-top: 2.5rem;
    padding-top: 1rem;
    border-top: 1px solid var(--lightgray);
  }
  
  h3 { 
    font-size: 1.4rem;
    margin-top: 2rem;
  }
}

// Command palette styling
.search-button {
  position: fixed;
  bottom: 2rem;
  right: 2rem;
  background: var(--dark);
  color: var(--light);
  padding: 0.75rem 1.5rem;
  border-radius: 2rem;
  border: 1px solid var(--lightgray);
  cursor: pointer;
  display: flex;
  align-items: center;
  gap: 0.5rem;
  z-index: 100;
  
  &:hover {
    transform: translateY(-2px);
    box-shadow: 0 4px 12px rgba(0,0,0,0.15);
  }
  
  kbd {
    background: var(--lightgray);
    padding: 0.125rem 0.375rem;
    border-radius: 0.25rem;
    font-size: 0.875rem;
  }
}

// NetLogo embed styling
.netlogo-embed {
  margin: 2rem 0;
  border: 1px solid var(--lightgray);
  border-radius: 8px;
  overflow: hidden;
  
  iframe {
    width: 100%;
    height: 600px;
    border: none;
  }
  
  .model-info {
    padding: 1rem;
    background: var(--light);
    border-top: 1px solid var(--lightgray);
    
    summary {
      cursor: pointer;
      font-weight: 600;
    }
    
    pre {
      margin-top: 0.5rem;
      padding: 0.5rem;
      background: var(--highlight);
      border-radius: 4px;
      font-size: 0.875rem;
    }
  }
  
  .download-data {
    display: inline-block;
    margin-top: 0.5rem;
    padding: 0.5rem 1rem;
    background: var(--secondary);
    color: white;
    text-decoration: none;
    border-radius: 4px;
    
    &:hover {
      opacity: 0.9;
    }
  }
}

// Graph view enhancements
#graph-container {
  height: 500px;
  border: 1px solid var(--lightgray);
  border-radius: 8px;
  margin: 2rem 0;
}

// Dark mode as default
body {
  background: var(--light);
  color: var(--dark);
}

// Remove default Quartz header if you want minimal
.page-header {
  border-bottom: 1px solid var(--lightgray);
  padding-bottom: 1rem;
  margin-bottom: 2rem;
}

// Backlinks styling
.backlinks {
  margin-top: 4rem;
  padding-top: 2rem;
  border-top: 1px solid var(--lightgray);
  
  h3 {
    font-size: 1.2rem;
    margin-bottom: 1rem;
  }
  
  ul {
    list-style: none;
    padding: 0;
    
    li {
      margin-bottom: 0.5rem;
      
      a {
        color: var(--secondary);
        text-decoration: none;
        
        &:hover {
          text-decoration: underline;
        }
      }
    }
  }
}
```

## Phase 3: GitHub Actions Workflow

### Step 3.1: Create new deployment workflow
Create file `.github/workflows/deploy-quartz.yml`:
```yaml
name: Deploy Quartz to GitHub Pages

on:
  push:
    branches: ["v2-quartz-migration", "main"]
  workflow_dispatch:

permissions:
  contents: read
  pages: write
  id-token: write

concurrency:
  group: "pages"
  cancel-in-progress: false

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - name: Checkout repository
        uses: actions/checkout@v4
        with:
          fetch-depth: 0  # Fetch all history for git info

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'

      - name: Install dependencies
        run: npm ci

      - name: Build Quartz site
        run: npx quartz build

      - name: Ensure CNAME file exists
        run: |
          if [ -f "docs/CNAME" ]; then
            cp docs/CNAME public/CNAME
          elif [ -f "CNAME" ]; then
            cp CNAME public/CNAME
          else
            echo "brinedew.com" > public/CNAME
          fi

      - name: Upload artifact
        uses: actions/upload-pages-artifact@v3
        with:
          path: ./public

  deploy:
    environment:
      name: github-pages
      url: ${{ steps.deployment.outputs.page_url }}
    runs-on: ubuntu-latest
    needs: build
    steps:
      - name: Deploy to GitHub Pages
        id: deployment
        uses: actions/deploy-pages@v4
```

## Phase 4: Content Migration

### Step 4.1: Create migration script
Create file `scripts/migrate-content.js`:
```javascript
const fs = require('fs');
const path = require('path');

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
processDirectory('./docs');
console.log('Migration complete!');
```

Run the migration:
```bash
node scripts/migrate-content.js
```

### Step 4.2: Create example NetLogo embed
Create file `docs/models/evolution-demo.md`:
```markdown
---
title: "Evolution Simulation Demo"
tags: ["simulation", "evolution", "netlogo"]
---

# Evolution Simulation Demo

This is a simple NetLogo model demonstrating evolutionary dynamics.

<div class="netlogo-embed">
  <iframe src="https://netlogoweb.org/launch#https://netlogoweb.org/assets/modelslib/Sample%20Models/Biology/Evolution/Genetic%20Drift/GenDrift%20T%20interact.nlogo"></iframe>
  <div class="model-info">
    <details>
      <summary>Model Parameters</summary>
      <pre>
Population Size: 100
Mutation Rate: 0.01
Generations: 500
Selection Type: Directional
      </pre>
    </details>
    <a href="#" class="download-data" onclick="alert('Data export will be implemented with custom model')">📊 Download Data</a>
  </div>
</div>

## Model Description

This model shows how genetic drift affects allele frequencies in populations of different sizes. The key parameters are:

- **Population Size**: Affects the strength of genetic drift
- **Mutation Rate**: Introduces new variation
- **Selection Coefficient**: Determines fitness differences

## Key Insights

1. Smaller populations experience stronger drift
2. Selection is more effective in larger populations
3. Neutral alleles can fix by chance alone

## Related Concepts

- [[antagonistic-pleiotropy]]
- [[mutation-accumulation]]
- [[disposable-soma-theory]]
```

### Step 4.3: Create Zotero integration script
Create file `scripts/sync-zotero.js`:
```javascript
const fs = require('fs');
const https = require('https');

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
    
    fs.writeFileSync('docs/references.md', referencesContent);
    console.log(`✓ Synced ${bibliography.length} references from Zotero`);
    
  } catch (error) {
    console.error('Error syncing Zotero:', error);
  }
}

generateBibliography();
```

## Phase 5: Local Testing

### Step 5.1: Build and test locally
```bash
# Install dependencies if not already done
npm install

# Build the site
npx quartz build --serve
```

This will start a local server at `http://localhost:8080`. Open this in your browser.

### Step 5.2: Testing checklist
Verify these features work:
- [ ] Dark mode is default
- [ ] Hovercards appear on internal links
- [ ] Search works (press `/` or click search button)
- [ ] Graph view displays
- [ ] NetLogo embed loads
- [ ] Mobile responsive
- [ ] All existing content displays correctly
- [ ] Navigation between pages works
- [ ] Backlinks show at bottom of pages

### Step 5.3: Fix any issues
Common issues and fixes:

**Issue**: Build fails with "Cannot find module"
```bash
npm install
npx quartz build
```

**Issue**: Content not showing
Check that all markdown files have frontmatter. Run:
```bash
node scripts/migrate-content.js
```

**Issue**: Styles not applying
Clear cache and rebuild:
```bash
rm -rf public/
npx quartz build --serve
```

## Phase 6: Deploy to Production

### Step 6.1: Commit all changes
```bash
git add .
git commit -m "Migrate to Quartz v2"
```

### Step 6.2: Push to test branch
```bash
git push origin v2-quartz-migration
```

### Step 6.3: Monitor GitHub Actions
1. Go to https://github.com/Brinedew/brinedew-site/actions
2. Watch the "Deploy Quartz to GitHub Pages" workflow
3. Should complete in 2-3 minutes

### Step 6.4: Test on GitHub Pages URL
Visit: https://brinedew.github.io/brinedew-site/
Verify everything works correctly.

### Step 6.5: Merge to main branch (GO LIVE)
Once you approve the test version:
```bash
git checkout main
git merge v2-quartz-migration
git push origin main
```

### Step 6.6: Verify Cloudflare
1. The site should automatically update at brinedew.com within 5 minutes
2. If not, go to Cloudflare dashboard
3. Purge cache: Caching → Configuration → Purge Everything
4. Wait 2 minutes and check again

## Phase 7: Post-Migration Cleanup

### Step 7.1: Remove old MkDocs files
After confirming v2 works:
```bash
rm mkdocs.yml
rm -rf site/  # old build directory
rm .github/workflows/mkdocs.yml  # old workflow
```

### Step 7.2: Update .gitignore
Add these lines to `.gitignore`:
```
node_modules/
.quartz-cache/
public/
.obsidian/workspace.json
```

### Step 7.3: Document the new setup
Create `README.md`:
```markdown
# Brinedew Knowledge Base

Built with [Quartz](https://quartz.jzhao.xyz/) for Obsidian.

## Local Development
\`\`\`bash
npm install
npx quartz build --serve
\`\`\`

## Deployment
Push to main branch → GitHub Actions → GitHub Pages → Cloudflare → brinedew.com

## Adding Content
1. Write in Obsidian
2. Use [[wikilinks]] for internal links
3. Push via Obsidian Git plugin
4. Site rebuilds automatically

## Features
- Dark mode default
- Citation hovercards
- NetLogo simulations
- Full-text search
- Graph view
- Backlinks
\`\`\`
```

## Troubleshooting

### If build fails
1. Check Node version: `node --version` (should be 18+)
2. Clear and reinstall: `rm -rf node_modules package-lock.json && npm install`
3. Check for syntax errors in markdown files

### If styles look wrong
1. Hard refresh browser: Ctrl+Shift+R
2. Check browser console for errors
3. Verify custom.scss is being imported

### If deploy fails
1. Check GitHub Actions logs
2. Ensure CNAME file exists
3. Verify GitHub Pages is enabled in repo settings

### If domain doesn't update
1. Check Cloudflare DNS settings
2. Purge Cloudflare cache
3. Wait 10 minutes (DNS propagation)

## Success Criteria

You'll know the migration is successful when:
1. ✅ Site loads at localhost:8080
2. ✅ Dark mode is active by default
3. ✅ Hovering on links shows preview cards
4. ✅ Search works with `/` shortcut
5. ✅ NetLogo demo loads
6. ✅ Site deploys to GitHub Pages
7. ✅ brinedew.com shows the new version

## IMPORTANT FINAL NOTES

- DO NOT delete the old branch until you've confirmed everything works for at least 24 hours
- Keep the `docs/CNAME` file - it's critical for custom domain
- The first build might take 5-10 minutes as it processes all content
- Quartz stores cache in `.quartz-cache/` - delete this if you have weird issues

END OF INSTRUCTIONS