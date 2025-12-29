What Exists

A ready-to-use prompt queue lives at Website/image_generation_queue.txt. This is populated with prompts for proteins that are missing images.
The enrichment script writes that queue and standardizes image paths: Website/scripts/enrich-proteins.py:48 and Website/scripts/enrich-proteins.py:300.
The protein infobox uses a persona image from frontmatter or falls back to the UniProt-based static path: Website/quartz/components/ProteinInfobox.tsx:55.
Prompts: Where They Come From

Website/scripts/enrich-proteins.py generates a prompt per protein missing an image and appends it to Website/image_generation_queue.txt.
Data source: Datasets/cellulore/proteins_with_demographics.json
Where Final Images Go (for the Website)

Put final PNGs in Website/public/static/proteins/ named by UniProt ID, e.g., Website/public/static/proteins/P42574.png (the script ensures this directory; see Website/scripts/enrich-proteins.py:29).
The site’s infobox will use persona_image from frontmatter if present, otherwise it falls back to /static/proteins/<uniprot_id>.png: Website/quartz/components/ProteinInfobox.tsx:55.
Example frontmatter already doing this: Website/content/wiki/caspase-3-casp3-p42574.md:31 has persona_image: /static/proteins/P42574.png.
Frontmatter vs. “Proteins base”

Use frontmatter field persona_image to explicitly point to the web-served image (recommended): /static/proteins/<uniprot_id>.png.
If you prefer Obsidian attachments, set persona_image: [[Attachments/yourfile.png]] in the page. When you run the enrichment script, it copies that attachment to public/static/proteins/<uniprot_id>.png and rewrites persona_image to the correct web path (see Website/scripts/enrich-proteins.py:238, Website/scripts/enrich-proteins.py:248–259).
The image_link field is not used by the current infobox. Prefer persona_image.
Manual Workflow (simple and reliable)

Pick the UniProt ID from the page frontmatter (e.g., uniprot_id: P42574).
Generate the portrait image using a prompt from Website/image_generation_queue.txt or the Prompter UI.
Save the PNG as Website/public/static/proteins/<UniProtID>.png (e.g., Website/public/static/proteins/P42574.png).
In the page’s frontmatter, either leave it to fall back or set persona_image: /static/proteins/<UniProtID>.png for clarity.
Optional: Run python Website/scripts/enrich-proteins.py to refresh frontmatter and regenerate the prompt queue for remaining missing images.