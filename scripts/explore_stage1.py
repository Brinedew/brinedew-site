#!/usr/bin/env python3
"""
Explore different Stage 1 approaches to maximize tail discrimination.
"""
import json
import numpy as np
import torch
from pathlib import Path
import random

# Load data
proteins = json.load(open(r"D:\Coding\Datasets\GeneGuessr\output\proteins.json"))
esm2_data = torch.load(r"D:\Coding\Datasets\GeneGuessr\cache\ESM2-vectors\ESM2-3B-Human-Gene-Embeddings.pt")
hig2vec_pt = torch.load(r"D:\Coding\Datasets\GeneGuessr\cache\Hig2Vec\hig2vec_human_200dim.pth")

gene_to_esm2 = {g: v.to(torch.float16).to(torch.float32).numpy() for g, v in esm2_data.items()}
gene_to_hig2vec = {obj: hig2vec_pt['embeddings'][i].numpy() 
                   for i, obj in enumerate(hig2vec_pt['objects']) 
                   if not obj.startswith('GO:')}

STATS = {
    'esm2': {'mean': 0.953, 'std': 0.032},
    'hig2vec': {'mean': 0.010, 'std': 0.385}
}

def cosine(v1, v2):
    return np.dot(v1, v2) / (np.linalg.norm(v1) * np.linalg.norm(v2))

# Get raw z-scores for key pairs
print("Raw z-scores for BRCA1 neighbors:")
for gene in ['ZNF451', 'RNF8', 'NSD3', 'NSD1', 'JADE3']:
    esm2_cos = cosine(gene_to_esm2['BRCA1'], gene_to_esm2[gene])
    hig2vec_cos = cosine(gene_to_hig2vec['BRCA1'], gene_to_hig2vec[gene])
    esm2_z = (esm2_cos - STATS['esm2']['mean']) / STATS['esm2']['std']
    hig2vec_z = (hig2vec_cos - STATS['hig2vec']['mean']) / STATS['hig2vec']['std']
    print(f"  {gene}: ESM2 cos={esm2_cos:.4f} z={esm2_z:.2f}, HiG2Vec cos={hig2vec_cos:.4f} z={hig2vec_z:.2f}")

print("\nRaw z-scores for HBB neighbors:")
for gene in ['HBD', 'HBG2', 'HBG1', 'HBE1']:
    esm2_cos = cosine(gene_to_esm2['HBB'], gene_to_esm2[gene])
    hig2vec_cos = cosine(gene_to_hig2vec['HBB'], gene_to_hig2vec[gene])
    esm2_z = (esm2_cos - STATS['esm2']['mean']) / STATS['esm2']['std']
    hig2vec_z = (hig2vec_cos - STATS['hig2vec']['mean']) / STATS['hig2vec']['std']
    print(f"  HBB→{gene}: ESM2 cos={esm2_cos:.4f} z={esm2_z:.2f}, HiG2Vec cos={hig2vec_cos:.4f} z={hig2vec_z:.2f}")

# Key insight: what's the actual spread in z-scores?
print("\n\nZ-score spreads:")
brca1_esm2_zs = []
brca1_hig2vec_zs = []
for gene in ['ZNF451', 'RNF8', 'NSD3', 'NSD1', 'JADE3']:
    esm2_cos = cosine(gene_to_esm2['BRCA1'], gene_to_esm2[gene])
    hig2vec_cos = cosine(gene_to_hig2vec['BRCA1'], gene_to_hig2vec[gene])
    brca1_esm2_zs.append((esm2_cos - STATS['esm2']['mean']) / STATS['esm2']['std'])
    brca1_hig2vec_zs.append((hig2vec_cos - STATS['hig2vec']['mean']) / STATS['hig2vec']['std'])

print(f"BRCA1 ESM2 z-scores: {[f'{z:.3f}' for z in brca1_esm2_zs]}")
print(f"  Spread: {max(brca1_esm2_zs) - min(brca1_esm2_zs):.4f}")
print(f"BRCA1 HiG2Vec z-scores: {[f'{z:.3f}' for z in brca1_hig2vec_zs]}")
print(f"  Spread: {max(brca1_hig2vec_zs) - min(brca1_hig2vec_zs):.4f}")

# The problem: even in raw z-scores, BRCA1's top-5 neighbors are very close
# This is fundamental to the embeddings, not our transform

print("\n\nCompare with wider z-score range proteins:")
# Find proteins with more spread in their top neighbors
random.seed(42)
sample_genes = random.sample(list(set(gene_to_esm2.keys()) & set(gene_to_hig2vec.keys())), 100)

spreads = []
for gene in sample_genes:
    # Get all similarities to this gene
    sims = []
    for other in sample_genes:
        if other == gene:
            continue
        esm2_cos = cosine(gene_to_esm2[gene], gene_to_esm2[other])
        hig2vec_cos = cosine(gene_to_hig2vec[gene], gene_to_hig2vec[other])
        esm2_z = (esm2_cos - STATS['esm2']['mean']) / STATS['esm2']['std']
        hig2vec_z = (hig2vec_cos - STATS['hig2vec']['mean']) / STATS['hig2vec']['std']
        blended = 0.5 * (0.5 + esm2_z/8) + 0.5 * (0.5 + hig2vec_z/8)
        sims.append((other, blended))
    
    # Get top 5
    top5 = sorted(sims, key=lambda x: x[1], reverse=True)[:5]
    spread = top5[0][1] - top5[4][1]
    spreads.append((gene, spread, top5))

# Show genes with best and worst spread
spreads.sort(key=lambda x: x[1], reverse=True)
print("Genes with BEST top-5 spread (metric space):")
for gene, spread, top5 in spreads[:5]:
    print(f"  {gene}: spread={spread:.4f}")
    
print("\nGenes with WORST top-5 spread (metric space):")
for gene, spread, top5 in spreads[-5:]:
    print(f"  {gene}: spread={spread:.4f}")
