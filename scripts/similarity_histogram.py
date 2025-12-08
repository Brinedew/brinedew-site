#!/usr/bin/env python3
"""
Generate histogram of similarity scores across random protein pairings.
Tests the blended ESM2+HiG2Vec similarity metric.
"""
import json
import random
import numpy as np
import matplotlib.pyplot as plt
from pathlib import Path

# Load proteins
proteins_file = Path(r"D:\Coding\Datasets\GeneGuessr\output\proteins.json")
with open(proteins_file) as f:
    proteins = json.load(f)

protein_list = [p["uniprot"] for p in proteins]
print(f"Loaded {len(protein_list)} proteins")

# Load embeddings
esm2_file = Path(r"D:\Coding\Datasets\GeneGuessr\cache\ESM2-vectors\ESM2-3B-Human-Gene-Embeddings.pt")
hig2vec_file = Path(__file__).parent.parent / "workers" / "embeddings-200-2024-08-08.json"

print("Loading ESM2 embeddings...")
import torch
esm2_data = torch.load(esm2_file)
# ESM2 file is a dict mapping gene names to tensors
# Convert to float16 then back to float32 to match worker quantization
gene_to_esm2 = {gene: vec.to(torch.float16).to(torch.float32).numpy() for gene, vec in esm2_data.items()}

print("Loading HiG2Vec embeddings...")
hig2vec_file = Path(r"D:\Coding\Datasets\GeneGuessr\cache\Hig2Vec\hig2vec_human_200dim.pth")
hig2vec_pt = torch.load(hig2vec_file)
# HiG2Vec file has 'objects' list (genes + GO terms) and 'embeddings' tensor
objects = hig2vec_pt['objects']
embeddings = hig2vec_pt['embeddings']
# Filter to genes only (exclude GO: terms)
hig2vec_data = {obj: embeddings[i].numpy() for i, obj in enumerate(objects) if not obj.startswith('GO:')}

# Build lookup by UniProt
uniprot_to_gene = {p["uniprot"]: p["gene"] for p in proteins}

def cosine_similarity(v1, v2):
    """Compute cosine similarity between two vectors."""
    dot = np.dot(v1, v2)
    norm1 = np.linalg.norm(v1)
    norm2 = np.linalg.norm(v2)
    if norm1 == 0 or norm2 == 0:
        return 0.0
    return dot / (norm1 * norm2)

# Global statistics for z-score normalization (from 10k random pair analysis)
EMBEDDING_STATS = {
    'esm2': {'mean': 0.953, 'std': 0.032},
    'hig2vec': {'mean': 0.010, 'std': 0.385}
}

# Beta calibration constants (fitted offline)
BETA_CAL = {'A': 3.415631, 'B': -3.366470, 'C': 0.005369}

def get_metric_similarity(cosine, embedding_type):
    """Stage 1: Linear z-score mapping (preserves tail resolution)."""
    stats = EMBEDDING_STATS[embedding_type]
    z = (cosine - stats['mean']) / stats['std']
    return 0.5 + z / 8.0

def to_display_score(p_metric):
    """Stage 2: Beta calibration for display."""
    eps = 1e-9
    s = max(eps, min(1 - eps, p_metric))
    x = BETA_CAL['A'] * np.log(s) + BETA_CAL['B'] * np.log(1 - s) + BETA_CAL['C']
    return 1 / (1 + np.exp(-x))

def normalize_with_zscore(cosine, embedding_type):
    """Full pipeline: metric → display."""
    p_metric = get_metric_similarity(cosine, embedding_type)
    return to_display_score(p_metric)

def get_similarities_all(uniprot1, uniprot2, esm2_weight=0.5):
    """Calculate ESM2, HiG2Vec, and blended similarities for two proteins."""
    gene1 = uniprot_to_gene.get(uniprot1)
    gene2 = uniprot_to_gene.get(uniprot2)
    
    if not gene1 or not gene2:
        return None, None, None
    
    # Get ESM2 similarity
    esm2_sim = None
    if gene1 in gene_to_esm2 and gene2 in gene_to_esm2:
        esm2_cosine = cosine_similarity(gene_to_esm2[gene1], gene_to_esm2[gene2])
        esm2_sim = normalize_with_zscore(esm2_cosine, 'esm2')
    
    # Get HiG2Vec similarity
    hig2vec_sim = None
    if gene1 in hig2vec_data and gene2 in hig2vec_data:
        hig2vec_cosine = cosine_similarity(
            hig2vec_data[gene1],
            hig2vec_data[gene2]
        )
        hig2vec_sim = normalize_with_zscore(hig2vec_cosine, 'hig2vec')
    
    # Blend
    blended_sim = None
    if esm2_sim is not None and hig2vec_sim is not None:
        blended_sim = esm2_weight * esm2_sim + (1 - esm2_weight) * hig2vec_sim
    
    return esm2_sim, hig2vec_sim, blended_sim

# Generate random pairings
print("Calculating similarities for 10,000 random pairs...")
esm2_similarities = []
hig2vec_similarities = []
blended_similarities = []
attempts = 0
max_attempts = 50000

while len(blended_similarities) < 10000 and attempts < max_attempts:
    attempts += 1
    p1, p2 = random.sample(protein_list, 2)
    esm2_sim, hig2vec_sim, blended_sim = get_similarities_all(p1, p2, esm2_weight=0.5)
    if blended_sim is not None:
        esm2_similarities.append(esm2_sim)
        hig2vec_similarities.append(hig2vec_sim)
        blended_similarities.append(blended_sim)
    
    if len(blended_similarities) % 1000 == 0:
        print(f"  {len(blended_similarities)}/10000 pairs calculated...")

print(f"Completed {len(blended_similarities)} similarity calculations")

# Create three histograms in column layout
fig, axes = plt.subplots(3, 1, figsize=(12, 16))
bins = np.arange(0, 1.01, 0.01)  # 1% bins from 0 to 1

# ESM2 histogram
axes[0].hist(esm2_similarities, bins=bins, edgecolor='black', alpha=0.7, color='steelblue')
axes[0].set_xlabel('ESM2 Similarity (z-score normalized)', fontsize=12)
axes[0].set_ylabel('Frequency', fontsize=12)
axes[0].set_title(f'ESM2 Structural Similarity Distribution\n({len(esm2_similarities):,} random protein pairs)', fontsize=14)
axes[0].grid(True, alpha=0.3)
mean_esm2 = np.mean(esm2_similarities)
median_esm2 = np.median(esm2_similarities)
std_esm2 = np.std(esm2_similarities)
axes[0].axvline(mean_esm2, color='red', linestyle='--', linewidth=2, label=f'Mean: {mean_esm2:.4f}')
axes[0].axvline(median_esm2, color='orange', linestyle='--', linewidth=2, label=f'Median: {median_esm2:.4f}')
axes[0].legend()
axes[0].text(0.02, 0.98, f'Std Dev: {std_esm2:.4f}', transform=axes[0].transAxes, 
             verticalalignment='top', fontsize=10, bbox=dict(boxstyle='round', facecolor='wheat', alpha=0.5))

# HiG2Vec histogram
axes[1].hist(hig2vec_similarities, bins=bins, edgecolor='black', alpha=0.7, color='forestgreen')
axes[1].set_xlabel('HiG2Vec Similarity (z-score normalized)', fontsize=12)
axes[1].set_ylabel('Frequency', fontsize=12)
axes[1].set_title(f'HiG2Vec Functional Similarity Distribution\n({len(hig2vec_similarities):,} random protein pairs)', fontsize=14)
axes[1].grid(True, alpha=0.3)
mean_hig2vec = np.mean(hig2vec_similarities)
median_hig2vec = np.median(hig2vec_similarities)
std_hig2vec = np.std(hig2vec_similarities)
axes[1].axvline(mean_hig2vec, color='red', linestyle='--', linewidth=2, label=f'Mean: {mean_hig2vec:.4f}')
axes[1].axvline(median_hig2vec, color='orange', linestyle='--', linewidth=2, label=f'Median: {median_hig2vec:.4f}')
axes[1].legend()
axes[1].text(0.02, 0.98, f'Std Dev: {std_hig2vec:.4f}', transform=axes[1].transAxes, 
             verticalalignment='top', fontsize=10, bbox=dict(boxstyle='round', facecolor='wheat', alpha=0.5))

# Blended histogram
axes[2].hist(blended_similarities, bins=bins, edgecolor='black', alpha=0.7, color='purple')
axes[2].set_xlabel('Blended Similarity (ESM2 + HiG2Vec, weight=0.5)', fontsize=12)
axes[2].set_ylabel('Frequency', fontsize=12)
axes[2].set_title(f'Blended Similarity Distribution\n({len(blended_similarities):,} random protein pairs)', fontsize=14)
axes[2].grid(True, alpha=0.3)

# Add statistics for blended
mean_sim = np.mean(blended_similarities)
median_sim = np.median(blended_similarities)
std_sim = np.std(blended_similarities)
min_sim = np.min(blended_similarities)
max_sim = np.max(blended_similarities)
axes[2].axvline(mean_sim, color='red', linestyle='--', linewidth=2, label=f'Mean: {mean_sim:.4f}')
axes[2].axvline(median_sim, color='orange', linestyle='--', linewidth=2, label=f'Median: {median_sim:.4f}')
axes[2].legend()
axes[2].text(0.02, 0.98, f'Std Dev: {std_sim:.4f}', transform=axes[2].transAxes, 
             verticalalignment='top', fontsize=10, bbox=dict(boxstyle='round', facecolor='wheat', alpha=0.5))

# Save
output_file = Path(__file__).parent / "similarity_histogram.png"
plt.tight_layout()
plt.savefig(output_file, dpi=150, bbox_inches='tight')
print(f"\nHistogram saved to: {output_file}")

print(f"\nESM2 Statistics:")
print(f"  Mean: {mean_esm2:.4f}")
print(f"  Median: {median_esm2:.4f}")
print(f"  Std Dev: {std_esm2:.4f}")
print(f"  Min: {np.min(esm2_similarities):.4f}")
print(f"  Max: {np.max(esm2_similarities):.4f}")

print(f"\nHiG2Vec Statistics:")
print(f"  Mean: {mean_hig2vec:.4f}")
print(f"  Median: {median_hig2vec:.4f}")
print(f"  Std Dev: {std_hig2vec:.4f}")
print(f"  Min: {np.min(hig2vec_similarities):.4f}")
print(f"  Max: {np.max(hig2vec_similarities):.4f}")

print(f"\nBlended Statistics:")
print(f"  Mean: {mean_sim:.4f}")
print(f"  Median: {median_sim:.4f}")
print(f"  Std Dev: {std_sim:.4f}")
print(f"  Min: {min_sim:.4f}")
print(f"  Max: {max_sim:.4f}")
