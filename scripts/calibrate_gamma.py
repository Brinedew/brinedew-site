#!/usr/bin/env python3
"""Calibrate gamma to hit HBB→HBD = 99% while preserving BRCA1 discrimination."""
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

STATS = {
    'esm2': {'mean': 0.953, 'std': 0.032, 'temp': 1.5},
    'hig2vec': {'mean': 0.010, 'std': 0.385, 'temp': 1.2}
}

def cosine(v1, v2):
    return np.dot(v1, v2) / (np.linalg.norm(v1) * np.linalg.norm(v2))

def get_metric(c, t):
    s = STATS[t]
    z = (c - s['mean']) / s['std']
    return 1 / (1 + np.exp(-s['temp'] * z))

def blend_metric(g1, g2):
    """Return metric-space blended score (before display transform)."""
    esm2_cos = cosine(gene_to_esm2[g1], gene_to_esm2[g2])
    hig2vec_cos = cosine(gene_to_hig2vec[g1], gene_to_hig2vec[g2])
    esm2_metric = get_metric(esm2_cos, 'esm2')
    hig2vec_metric = get_metric(hig2vec_cos, 'hig2vec')
    return 0.5 * esm2_metric + 0.5 * hig2vec_metric

# Get metric scores
hbb_hbd_metric = blend_metric('HBB', 'HBD')
brca1_znf451_metric = blend_metric('BRCA1', 'ZNF451')
brca1_jade3_metric = blend_metric('BRCA1', 'JADE3')

print(f"Metric scores (before display transform):")
print(f"  HBB→HBD: {hbb_hbd_metric:.6f}")
print(f"  BRCA1→ZNF451: {brca1_znf451_metric:.6f}")
print(f"  BRCA1→JADE3: {brca1_jade3_metric:.6f}")
print(f"  BRCA1 spread: {brca1_znf451_metric - brca1_jade3_metric:.6f}")

# Try different gammas
print("\nGamma calibration:")
print("gamma | HBB→HBD | BRCA1 top | BRCA1 bottom | BRCA1 spread")
print("------|---------|-----------|--------------|-------------")

for gamma in [0.4, 0.45, 0.5, 0.55, 0.6, 0.65, 0.7]:
    hbb_disp = hbb_hbd_metric ** gamma
    brca1_top_disp = brca1_znf451_metric ** gamma
    brca1_bot_disp = brca1_jade3_metric ** gamma
    brca1_spread = brca1_top_disp - brca1_bot_disp
    print(f" {gamma:.2f}  | {hbb_disp:.4f}  | {brca1_top_disp:.4f}     | {brca1_bot_disp:.4f}      | {brca1_spread:.4f}")

print("\nRecommendation: Use gamma that gets HBB→HBD closest to 0.99 while keeping BRCA1 spread > 0.001")
