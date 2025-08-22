<%*
// Smart detection logic for wiki page type
const fileName = tp.file.title;
const existingTags = tp.file.tags || [];

// Check if already tagged as protein
const hasProteinTag = existingTags.includes("protein");

// Just ask protein or not
let isProtein;
if (hasProteinTag) {
  isProtein = true;
} else {
  isProtein = await tp.system.suggester(
    ["Yes - Protein page", "No - Regular wiki page"], 
    [true, false],
    false, 
    "Is this a protein page?"
  );
}

// Generate template based on type
let template = `---
title: ${fileName}`;

if (isProtein) {
  template += `
tags:
  - protein`;
} else {
  template += `
tags: []`;
}

template += `
date: <% tp.date.now("YYYY-MM-DD") %>
status: draft
aliases:
  - `;

// Add protein-specific properties
if (isProtein) {
  template += `
symbol: 
mass: 
length (aa): 
protein_type: 
Domains: 
pathways:
  - 
uniprot_id: 
Image link: `;
}

template += `
---
# ${fileName}

`;

// Add Meta Bind fields for proteins
if (isProtein) {
  template += `> [!info]+ Protein Data Entry
> **Symbol**: \`INPUT[text:symbol]\`
> **Mass (kDa)**: \`INPUT[number:mass]\` 
> **Length (aa)**: \`INPUT[number:length (aa)]\`
> **Type**: \`INPUT[select(tumor suppressor,kinase,transcription factor,growth factor,enzyme,receptor):protein_type]\`
> **Domains**: \`INPUT[text:Domains]\`
> **UniProt ID**: \`INPUT[text:uniprot_id]\`
> **Image URL**: \`INPUT[text:Image link]\`

**What it is.** 

**Why it matters here.** 

**Notes.** Type: \`VIEW[protein_type]\`; Pathways: \`VIEW[pathways]\`.`;
} else {
  template += `**What it is.** 

**Why it matters here.** 

**Notes.** `;
}

tR += template;
%>