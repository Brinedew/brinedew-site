#!/usr/bin/env python3
"""
Fit beta calibration constants for Stage 2 display transform.
Goal: median≈50%, HBB→HBD≈97-99%, BRCA1 spread≥1%
"""
import json
import numpy as np
import torch
from pathlib import Path
from scipy.optimize import minimize
import random

# Load data
print("Loading data...")
proteins = json.load(open(r"D:\Coding\Datasets\GeneGuessr\output\proteins.json"))
esm2_data = torch.load(r"D:\Coding\Datasets\GeneGuessr\cache\ESM2-vectors\ESM2-3B-Human-Gene-Embeddings.pt")
hig2vec_pt = torch.load(r"D:\Coding\Datasets\GeneGuessr\cache\Hig2Vec\hig2vec_human_200dim.pth")

gene_to_esm2 = {g: v.to(torch.float16).to(torch.float32).numpy() for g, v in esm2_data.items()}
gene_to_hig2vec = {obj: hig2vec_pt['embeddings'][i].numpy() 
                   for i, obj in enumerate(hig2vec_pt['objects']) 
                   if not obj.startswith('GO:')}

common_genes = set(gene_to_esm2.keys()) & set(gene_to_hig2vec.keys())
print(f"Common genes: {len(common_genes)}")

STATS = {
    'esm2': {'mean': 0.953, 'std': 0.032},
    'hig2vec': {'mean': 0.010, 'std': 0.385}
}

def cosine(v1, v2):
    return np.dot(v1, v2) / (np.linalg.norm(v1) * np.linalg.norm(v2))

def get_metric(c, t):
    """Stage 1: Linear z-score mapping."""
    s = STATS[t]
    z = (c - s['mean']) / s['std']
    z_clipped = max(-4, min(4, z))
    return 0.5 + z_clipped / 8.0

def blend_metric(g1, g2):
    """Get blended metric score (before display transform)."""
    esm2_cos = cosine(gene_to_esm2[g1], gene_to_esm2[g2])
    hig2vec_cos = cosine(gene_to_hig2vec[g1], gene_to_hig2vec[g2])
    return 0.5 * get_metric(esm2_cos, 'esm2') + 0.5 * get_metric(hig2vec_cos, 'hig2vec')

def beta_cal(s, A, B, C):
    """Beta calibration: p_cal = σ(A*log(s) + B*log(1-s) + C)"""
    eps = 1e-9
    s = max(eps, min(1 - eps, s))
    x = A * np.log(s) + B * np.log(1 - s) + C
    return 1 / (1 + np.exp(-x))

# Collect calibration data
print("\nCollecting calibration data...")

# Random pairs for median estimation
random.seed(42)
sample_genes = random.sample(list(common_genes), 1000)
random_metrics = []
for i in range(5000):
    g1, g2 = random.sample(sample_genes, 2)
    random_metrics.append(blend_metric(g1, g2))

median_metric = np.median(random_metrics)
print(f"Median random pair metric: {median_metric:.4f}")

# Key pairs
hbb_hbd = blend_metric('HBB', 'HBD')
print(f"HBB→HBD metric: {hbb_hbd:.4f}")

brca1_neighbors = ['ZNF451', 'RNF8', 'NSD3', 'NSD1', 'JADE3']
brca1_metrics = [blend_metric('BRCA1', g) for g in brca1_neighbors]
brca1_spread_metric = max(brca1_metrics) - min(brca1_metrics)
print(f"BRCA1 metrics: {[f'{m:.4f}' for m in brca1_metrics]}")
print(f"BRCA1 spread (metric): {brca1_spread_metric:.4f}")

# Optimization: find A, B, C such that
# 1. beta_cal(median_metric) ≈ 0.5
# 2. beta_cal(hbb_hbd) ≈ 0.97-0.99
# 3. spread in display space for BRCA1 ≥ 0.01

def objective(params):
    A, B, C = params
    
    # Ensure reasonable parameter ranges
    if A < 0.5 or A > 10 or B > 0 or B < -10:
        return 1000
    
    # Constraint 1: median → 0.5
    median_disp = beta_cal(median_metric, A, B, C)
    loss1 = (median_disp - 0.5) ** 2
    
    # Constraint 2: HBB→HBD → 0.97
    hbb_disp = beta_cal(hbb_hbd, A, B, C)
    loss2 = (hbb_disp - 0.97) ** 2
    
    # Constraint 3: Maximize BRCA1 spread (soft constraint)
    brca1_disps = [beta_cal(m, A, B, C) for m in brca1_metrics]
    brca1_spread = max(brca1_disps) - min(brca1_disps)
    # Reward larger spread (negative loss)
    loss3 = -brca1_spread * 10
    
    return 100 * loss1 + 100 * loss2 + loss3

print("\nOptimizing beta calibration constants...")
result = minimize(objective, [1.0, -0.5, 0.0], method='Nelder-Mead')
A, B, C = result.x

print(f"\nOptimal constants: A={A:.4f}, B={B:.4f}, C={C:.4f}")

# Evaluate
median_disp = beta_cal(median_metric, A, B, C)
hbb_disp = beta_cal(hbb_hbd, A, B, C)
brca1_disps = [beta_cal(m, A, B, C) for m in brca1_metrics]
brca1_spread = max(brca1_disps) - min(brca1_disps)

print(f"\nResults with fitted constants:")
print(f"  Median random pair: {median_disp:.4f} (target: 0.50)")
print(f"  HBB→HBD: {hbb_disp:.4f} (target: 0.98)")
print(f"  BRCA1 spread: {brca1_spread:.4f} (target: ≥0.01)")

print(f"\nBRCA1 top-5 display scores:")
for g, m, d in zip(brca1_neighbors, brca1_metrics, brca1_disps):
    print(f"  {g}: metric={m:.4f} → display={d:.4f} ({int(d*100)}%)")

print(f"\nHemoglobin family:")
for gene in ['HBD', 'HBG2', 'HBG1', 'HBE1']:
    m = blend_metric('HBB', gene)
    d = beta_cal(m, A, B, C)
    print(f"  HBB→{gene}: metric={m:.4f} → display={d:.4f} ({int(d*100)}%)")

# Output for JavaScript
print(f"\n// JavaScript constants for protein-store.js:")
print(f"const BETA_CAL = {{ A: {A:.6f}, B: {B:.6f}, C: {C:.6f} }};")
