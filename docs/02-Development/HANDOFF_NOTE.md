# Development Session Handoff - 2025-07-08

## what i was working on

Converting the single "Price of Not Being Cancer" essay into a hierarchical wiki structure for longevity research. The goal was to create a cross-referenced knowledge base that splits concepts, theories, organisms, and mechanisms into separate interconnected pages instead of one massive 6,400-word essay.

## what got done

- **Created complete wiki structure** in `/docs/wiki/` with 11 top-level categories
- **Built 4 evolutionary aging theory articles**: selection shadow, antagonistic pleiotropy, disposable soma, defensive degeneration - all research-backed with proper citations and substantive content
- **Set up navigation system** using awesome-pages plugin with `.pages` files for ordering control
- **Created foundational concept pages**: de-darwinization (comprehensive version), CTVT cancer lineage article
- **Updated CLAUDE.md** to match conversational voice from root folder (removed corporate speak)
- **Established cross-reference structure** between wiki articles

Key files created:
- `/docs/wiki/index.md` - main wiki landing page with category overview
- `/docs/wiki/theories/*.md` - 4 complete theory articles + index
- `/docs/wiki/concepts/de-darwinization.md` - comprehensive concept article
- `/docs/wiki/organisms/cancer-lineages/ctvt.md` - detailed organism article
- Navigation files: multiple `.pages` files for awesome-pages plugin

## what's not working

- **Git push failed** due to authentication - changes are committed locally but not pushed to GitHub
- **CI build currently failing** because awesome-pages plugin can't find navigation structure (since changes aren't pushed yet)
- **Wiki structure incomplete** - only ~15% of intended content created, missing most organism, protein, paper, and researcher pages

## current state

- **System**: WSL on Windows, MkDocs Material with awesome-pages plugin already configured
- **Git status**: 1 commit ahead of origin/main, authentication failed on push
- **Last working commands**: 
  ```bash
  git add docs/wiki/ CLAUDE.md
  git commit -m "Add longevity research wiki structure..."
  # git push failed with authentication error
  ```
- **Files committed**: Complete wiki directory structure with navigation

## next steps

1. **Get changes pushed to GitHub** - you'll need to handle authentication or ask user to push the commit manually to trigger CI build
2. **Verify wiki appears correctly** on live site at brinedew.com/wiki/ after successful deployment
3. **Continue populating wiki content** - extract remaining concepts from the original cancer essay and create the missing organism, protein, and mechanism pages

## for context

- The **"Advanced" de-darwinization article** (224 lines with extensive citations) is the quality standard - this is meant to be a featured article that could influence scientific thinking, not a Wikipedia stub
- **Navigation structure** uses awesome-pages plugin (already installed in CI) with `.pages` files for control
- **Cross-referencing strategy** established - each article links to related concepts, theories, and examples
- **Voice guidelines** in root `/CLAUDE.md` - conversational but substantive, avoid corporate speak and TED talk hype

The foundation is solid. The next person needs to push the changes and continue content extraction from the original essay.

## design decisions made

- **Chose awesome-pages over manual nav** to avoid updating mkdocs.yml for every new page
- **Kept "Advanced" de-darwinization article** over "Basic" version - user emphasized need for featured-article quality that could convince skeptical scientists
- **Hierarchical structure** with categories and subcategories rather than flat organization
- **Research-backed content** with citations and quantitative data rather than superficial explanations