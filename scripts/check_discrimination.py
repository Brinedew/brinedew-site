#!/usr/bin/env python3
"""Quick check: BRCA1 discrimination and HBB→HBD target."""
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

# Two-stage normalization
STATS = {
    'esm2': {'mean': 0.953, 'std': 0.032, 'temp': 1.5},
    'hig2vec': {'mean': 0.010, 'std': 0.385, 'temp': 1.2}
}
GAMMA = 0.6

def cosine(v1, v2):
    return np.dot(v1, v2) / (np.linalg.norm(v1) * np.linalg.norm(v2))

def get_metric(c, t):
    s = STATS[t]
    z = (c - s['mean']) / s['std']
    return 1 / (1 + np.exp(-s['temp'] * z))

def to_display(p):
    return p ** GAMMA

def normalize(c, t):
    return to_display(get_metric(c, t))

def blend(g1, g2):
    esm2_cos = cosine(gene_to_esm2[g1], gene_to_esm2[g2])
    hig2vec_cos = cosine(gene_to_hig2vec[g1], gene_to_hig2vec[g2])
    esm2_norm = normalize(esm2_cos, 'esm2')
    hig2vec_norm = normalize(hig2vec_cos, 'hig2vec')
    return 0.5 * esm2_norm + 0.5 * hig2vec_norm

print("BRCA1 top-5 neighbors (checking discrimination):")
for gene in ['ZNF451', 'RNF8', 'NSD3', 'NSD1', 'JADE3']:
    score = blend('BRCA1', gene)
    print(f"  {gene}: {score:.4f}")

print("\nHBB neighbors (checking 99% target):")
for gene in ['HBD', 'HBG2', 'HBG1', 'HBE1']:
    score = blend('HBB', gene)
    print(f"  {gene}: {score:.4f}")
