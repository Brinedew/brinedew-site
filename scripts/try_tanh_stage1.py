#!/usr/bin/env python3
"""
Try unclipped z-scores and see what spread we get.
"""
import json
import numpy as np
import torch
from pathlib import Path
from scipy.optimize import minimize
import random

# Load data
proteins = json.load(open(r"D:\Coding\Datasets\GeneGuessr\output\proteins.json"))
esm2_data = torch.load(r"D:\Coding\Datasets\GeneGuessr\cache\ESM2-vectors\ESM2-3B-Human-Gene-Embeddings.pt")
hig2vec_pt = torch.load(r"D:\Coding\Datasets\GeneGuessr\cache\Hig2Vec\hig2vec_human_200dim.pth")

gene_to_esm2 = {g: v.to(torch.float16).to(torch.float32).numpy() for g, v in esm2_data.items()}
gene_to_hig2vec = {obj: hig2vec_pt['embeddings'][i].numpy() 
                   for i, obj in enumerate(hig2vec_pt['objects']) 
                   if not obj.startswith('GO:')}

common_genes = set(gene_to_esm2.keys()) & set(gene_to_hig2vec.keys())

STATS = {
    'esm2': {'mean': 0.953, 'std': 0.032},
    'hig2vec': {'mean': 0.010, 'std': 0.385}
}

def cosine(v1, v2):
    return np.dot(v1, v2) / (np.linalg.norm(v1) * np.linalg.norm(v2))

def get_metric_unclipped(c, t):
    """Stage 1: Unclipped z-score, then use tanh for soft bounds."""
    s = STATS[t]
    z = (c - s['mean']) / s['std']
    # tanh gives us soft clipping that preserves more tail structure
    # Scale so z=3 -> ~0.95 (not 0.99)
    return 0.5 + 0.5 * np.tanh(z / 3.0)

def blend_metric(g1, g2):
    esm2_cos = cosine(gene_to_esm2[g1], gene_to_esm2[g2])
    hig2vec_cos = cosine(gene_to_hig2vec[g1], gene_to_hig2vec[g2])
    return 0.5 * get_metric_unclipped(esm2_cos, 'esm2') + 0.5 * get_metric_unclipped(hig2vec_cos, 'hig2vec')

print("With tanh(z/3) Stage 1:\n")

# Random pairs
random.seed(42)
sample_genes = random.sample(list(common_genes), 1000)
random_metrics = [blend_metric(g1, g2) for g1, g2 in zip(sample_genes[::2], sample_genes[1::2])]
print(f"Median random pair: {np.median(random_metrics):.4f}")

# BRCA1
brca1_metrics = [blend_metric('BRCA1', g) for g in ['ZNF451', 'RNF8', 'NSD3', 'NSD1', 'JADE3']]
print(f"BRCA1 metrics: {[f'{m:.4f}' for m in brca1_metrics]}")
print(f"BRCA1 spread: {max(brca1_metrics) - min(brca1_metrics):.4f}")

# HBB
hbb_metrics = [blend_metric('HBB', g) for g in ['HBD', 'HBG2', 'HBG1', 'HBE1']]
print(f"HBB→hemoglobins: {[f'{m:.4f}' for m in hbb_metrics]}")
print(f"HBB spread: {max(hbb_metrics) - min(hbb_metrics):.4f}")

# Now try different divisors
print("\n\nTrying different tanh scaling factors:")
for divisor in [2.0, 2.5, 3.0, 4.0, 5.0]:
    def get_metric_scaled(c, t, div=divisor):
        s = STATS[t]
        z = (c - s['mean']) / s['std']
        return 0.5 + 0.5 * np.tanh(z / div)
    
    def blend_scaled(g1, g2, div=divisor):
        esm2_cos = cosine(gene_to_esm2[g1], gene_to_esm2[g2])
        hig2vec_cos = cosine(gene_to_hig2vec[g1], gene_to_hig2vec[g2])
        return 0.5 * get_metric_scaled(esm2_cos, 'esm2', div) + 0.5 * get_metric_scaled(hig2vec_cos, 'hig2vec', div)
    
    brca1 = [blend_scaled('BRCA1', g) for g in ['ZNF451', 'RNF8', 'NSD3', 'NSD1', 'JADE3']]
    hbb_hbd = blend_scaled('HBB', 'HBD')
    spread = max(brca1) - min(brca1)
    print(f"  div={divisor}: BRCA1 spread={spread:.4f}, HBB→HBD={hbb_hbd:.4f}")
