#!/usr/bin/env python3
"""Test unclipped linear z-scores."""
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
    'esm2': {'mean': 0.953, 'std': 0.032},
    'hig2vec': {'mean': 0.010, 'std': 0.385}
}

def cosine(v1, v2):
    return np.dot(v1, v2) / (np.linalg.norm(v1) * np.linalg.norm(v2))

def get_metric_unclipped(c, t):
    """Unclipped: just 0.5 + z/8"""
    s = STATS[t]
    z = (c - s['mean']) / s['std']
    return 0.5 + z / 8.0  # No clipping!

def blend_metric(g1, g2):
    esm2_cos = cosine(gene_to_esm2[g1], gene_to_esm2[g2])
    hig2vec_cos = cosine(gene_to_hig2vec[g1], gene_to_hig2vec[g2])
    return 0.5 * get_metric_unclipped(esm2_cos, 'esm2') + 0.5 * get_metric_unclipped(hig2vec_cos, 'hig2vec')

print("Unclipped linear z-scores (0.5 + z/8):\n")

# BRCA1
brca1_metrics = [blend_metric('BRCA1', g) for g in ['ZNF451', 'RNF8', 'NSD3', 'NSD1', 'JADE3']]
print(f"BRCA1 metrics: {[f'{m:.4f}' for m in brca1_metrics]}")
print(f"BRCA1 spread: {max(brca1_metrics) - min(brca1_metrics):.4f}")

# HBB
hbb_metrics = [blend_metric('HBB', g) for g in ['HBD', 'HBG2', 'HBG1', 'HBE1']]
print(f"\nHBB metrics: {[f'{m:.4f}' for m in hbb_metrics]}")
print(f"HBB→HBD: {hbb_metrics[0]:.4f}")

# Check for outliers
import random
random.seed(42)
sample_genes = random.sample(list(set(gene_to_esm2.keys()) & set(gene_to_hig2vec.keys())), 1000)
random_metrics = []
for i in range(5000):
    g1, g2 = random.sample(sample_genes, 2)
    random_metrics.append(blend_metric(g1, g2))

print(f"\nRandom pairs: median={np.median(random_metrics):.4f}, min={np.min(random_metrics):.4f}, max={np.max(random_metrics):.4f}")
print(f"Any out of [0,1]? {np.any(np.array(random_metrics) < 0)} or {np.any(np.array(random_metrics) > 1)}")
