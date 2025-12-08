#!/usr/bin/env python3
"""Find optimal temperatures for metric stage."""
import json
import numpy as np
import torch
from pathlib import Path

# Load data
proteins = json.load(open(r"D:\Coding\Datasets\GeneGuessr\output\proteins.json"))
esm2_data = torch.load(r"D:\Coding\Datasets\GeneGuessr\cache\ESM2-vectors\ESM2-3B-Human-Gene-Embeddings.pt")
hig2vec_pt = torch.load(r"D:\Coding\Datasets\GeneGuessr\cache\Hig2Vec\hig2vec_human_200dim.pth")

gene_to_esm2 = {g: v.to(torch.float16).to(torch.float32).numpy() for g, v in esm2_data.items()}
gene_to_hig2vec = {obj: hig2vec_pt['embeddings'][i].numpy() 
                   for i, obj in enumerate(hig2vec_pt['objects']) 
                   if not obj.startswith('GO:')}

STATS_BASE = {
    'esm2': {'mean': 0.953, 'std': 0.032},
    'hig2vec': {'mean': 0.010, 'std': 0.385}
}

def cosine(v1, v2):
    return np.dot(v1, v2) / (np.linalg.norm(v1) * np.linalg.norm(v2))

def get_metric(c, t, temp):
    s = STATS_BASE[t]
    z = (c - s['mean']) / s['std']
    return 1 / (1 + np.exp(-temp * z))

def blend_metric(g1, g2, esm2_temp, hig2vec_temp):
    esm2_cos = cosine(gene_to_esm2[g1], gene_to_esm2[g2])
    hig2vec_cos = cosine(gene_to_hig2vec[g1], gene_to_hig2vec[g2])
    esm2_metric = get_metric(esm2_cos, 'esm2', esm2_temp)
    hig2vec_metric = get_metric(hig2vec_cos, 'hig2vec', hig2vec_temp)
    return 0.5 * esm2_metric + 0.5 * hig2vec_metric

print("Temperature sweep to find metric-space values:")
print("ESM2_temp | HiG2Vec_temp | HBB→HBD metric | BRCA1 spread")
print("----------|--------------|----------------|-------------")

for esm2_temp in [1.8, 2.0, 2.2, 2.4]:
    for hig2vec_temp in [1.4, 1.6, 1.8, 2.0]:
        hbb_hbd = blend_metric('HBB', 'HBD', esm2_temp, hig2vec_temp)
        brca1_top = blend_metric('BRCA1', 'ZNF451', esm2_temp, hig2vec_temp)
        brca1_bot = blend_metric('BRCA1', 'JADE3', esm2_temp, hig2vec_temp)
        spread = brca1_top - brca1_bot
        
        # Only show promising combinations
        if hbb_hbd > 0.96 and spread > 0.002:
            print(f"  {esm2_temp:.1f}     |     {hig2vec_temp:.1f}      | {hbb_hbd:.6f}       | {spread:.6f}")

print("\nGoal: HBB→HBD metric > 0.97 (so gamma=0.5 gets it to 0.99)")
print("      BRCA1 spread > 0.002 (so they stay distinct)")
