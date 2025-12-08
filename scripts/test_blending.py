#!/usr/bin/env python3
"""
Comprehensive test battery for ESM2 + HiG2Vec blended similarity.
Tests:
1. Spearman correlation between embedding spaces
2. Blending balance (correlations to components)
3. Top-k neighbor overlap (Jaccard similarity)
4. Eyeball test on sample proteins
"""
import json
import random
import numpy as np
import torch
from pathlib import Path
from scipy.stats import spearmanr

# Load data
print("Loading data...")
proteins_file = Path(r"D:\Coding\Datasets\GeneGuessr\output\proteins.json")
with open(proteins_file) as f:
    proteins = json.load(f)

print(f"Loaded {len(proteins)} proteins")

# Load embeddings
print("Loading ESM2 embeddings...")
esm2_file = Path(r"D:\Coding\Datasets\GeneGuessr\cache\ESM2-vectors\ESM2-3B-Human-Gene-Embeddings.pt")
esm2_data = torch.load(esm2_file)
gene_to_esm2 = {gene: vec.to(torch.float16).to(torch.float32).numpy() for gene, vec in esm2_data.items()}

print("Loading HiG2Vec embeddings...")
hig2vec_file = Path(r"D:\Coding\Datasets\GeneGuessr\cache\Hig2Vec\hig2vec_human_200dim.pth")
hig2vec_pt = torch.load(hig2vec_file)
objects = hig2vec_pt['objects']
embeddings = hig2vec_pt['embeddings']
gene_to_hig2vec = {obj: embeddings[i].numpy() for i, obj in enumerate(objects) if not obj.startswith('GO:')}

# Build lookups
gene_to_protein = {p["gene"]: p for p in proteins}

# Filter to proteins with both embeddings
common_genes = set(gene_to_esm2.keys()) & set(gene_to_hig2vec.keys()) & set(gene_to_protein.keys())
print(f"Proteins with both embeddings: {len(common_genes)}")

def cosine_similarity(v1, v2):
    dot = np.dot(v1, v2)
    norm1 = np.linalg.norm(v1)
    norm2 = np.linalg.norm(v2)
    if norm1 == 0 or norm2 == 0:
        return 0.0
    return dot / (norm1 * norm2)

# Global statistics for z-score normalization
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

def get_similarities(gene, weight=0.5):
    """Get similarity vectors for a gene."""
    if gene not in common_genes:
        return None, None, None
    
    esm2_sims = []
    hig2vec_sims = []
    blended_sims = []
    genes = []
    
    for other_gene in common_genes:
        if other_gene == gene:
            continue
        
        esm2_cosine = cosine_similarity(gene_to_esm2[gene], gene_to_esm2[other_gene])
        hig2vec_cosine = cosine_similarity(gene_to_hig2vec[gene], gene_to_hig2vec[other_gene])
        
        esm2_norm = normalize_with_zscore(esm2_cosine, 'esm2')
        hig2vec_norm = normalize_with_zscore(hig2vec_cosine, 'hig2vec')
        blended = weight * esm2_norm + (1 - weight) * hig2vec_norm
        
        esm2_sims.append(esm2_norm)
        hig2vec_sims.append(hig2vec_norm)
        blended_sims.append(blended)
        genes.append(other_gene)
    
    return np.array(esm2_sims), np.array(hig2vec_sims), np.array(blended_sims), genes

def get_top_k_indices(similarities, k=20):
    """Get indices of top-k similarities."""
    return set(np.argsort(similarities)[-k:])

print("\n" + "="*80)
print("TEST 1: EMBEDDING SPACE CORRELATION")
print("="*80)

# Sample 1000 random pairs
sample_genes = random.sample(list(common_genes), min(1000, len(common_genes)))
esm2_distances = []
hig2vec_distances = []

print(f"Computing distances for {len(sample_genes)} × {len(sample_genes)} pairs...")
for i, gene1 in enumerate(sample_genes):
    if i % 100 == 0:
        print(f"  {i}/{len(sample_genes)} genes processed...")
    for gene2 in sample_genes:
        if gene1 >= gene2:
            continue
        esm2_sim = cosine_similarity(gene_to_esm2[gene1], gene_to_esm2[gene2])
        hig2vec_sim = cosine_similarity(gene_to_hig2vec[gene1], gene_to_hig2vec[gene2])
        esm2_distances.append(1 - esm2_sim)
        hig2vec_distances.append(1 - hig2vec_sim)

rho_space, _ = spearmanr(esm2_distances, hig2vec_distances)
print(f"\nSpearman ρ(ESM2 distances, HiG2Vec distances) = {rho_space:.4f}")
print(f"→ Low correlation expected (different modalities)")

print("\n" + "="*80)
print("TEST 2: BLENDING BALANCE")
print("="*80)

# Sample proteins and measure blend correlation to components
sample_test_genes = random.sample(list(common_genes), min(100, len(common_genes)))
esm2_correlations = []
hig2vec_correlations = []

print(f"Computing per-protein blend correlations for {len(sample_test_genes)} proteins...")
for i, gene in enumerate(sample_test_genes):
    if i % 20 == 0:
        print(f"  {i}/{len(sample_test_genes)} proteins processed...")
    
    esm2_sims, hig2vec_sims, blended_sims, _ = get_similarities(gene, weight=0.5)
    if esm2_sims is None:
        continue
    
    rho_esm2, _ = spearmanr(blended_sims, esm2_sims)
    rho_hig2vec, _ = spearmanr(blended_sims, hig2vec_sims)
    
    esm2_correlations.append(rho_esm2)
    hig2vec_correlations.append(rho_hig2vec)

mean_rho_esm2 = np.mean(esm2_correlations)
mean_rho_hig2vec = np.mean(hig2vec_correlations)

print(f"\nMedian ρ(blend, ESM2)    = {np.median(esm2_correlations):.4f}")
print(f"Median ρ(blend, HiG2Vec) = {np.median(hig2vec_correlations):.4f}")
print(f"Mean ρ(blend, ESM2)      = {mean_rho_esm2:.4f}")
print(f"Mean ρ(blend, HiG2Vec)   = {mean_rho_hig2vec:.4f}")

if abs(mean_rho_esm2 - mean_rho_hig2vec) < 0.15:
    print("→ BALANCED: Both embeddings contribute roughly equally")
elif mean_rho_hig2vec > mean_rho_esm2:
    print("→ HiG2Vec-dominant: Functional similarity drives ranking")
else:
    print("→ ESM2-dominant: Structural similarity drives ranking")

print("\n" + "="*80)
print("TEST 3: TOP-K NEIGHBOR OVERLAP (JACCARD)")
print("="*80)

# Measure Jaccard similarity of top-20 neighbors
jaccard_esm2 = []
jaccard_hig2vec = []

print(f"Computing Jaccard overlap for {len(sample_test_genes)} proteins...")
for i, gene in enumerate(sample_test_genes):
    if i % 20 == 0:
        print(f"  {i}/{len(sample_test_genes)} proteins processed...")
    
    esm2_sims, hig2vec_sims, blended_sims, _ = get_similarities(gene, weight=0.5)
    if esm2_sims is None:
        continue
    
    top_esm2 = get_top_k_indices(esm2_sims, k=20)
    top_hig2vec = get_top_k_indices(hig2vec_sims, k=20)
    top_blended = get_top_k_indices(blended_sims, k=20)
    
    j_esm2 = len(top_blended & top_esm2) / len(top_blended | top_esm2)
    j_hig2vec = len(top_blended & top_hig2vec) / len(top_blended | top_hig2vec)
    
    jaccard_esm2.append(j_esm2)
    jaccard_hig2vec.append(j_hig2vec)

mean_j_esm2 = np.mean(jaccard_esm2)
mean_j_hig2vec = np.mean(jaccard_hig2vec)

print(f"\nMean Jaccard(blend ∩ ESM2)    = {mean_j_esm2:.3f} ({mean_j_esm2*100:.1f}% overlap)")
print(f"Mean Jaccard(blend ∩ HiG2Vec) = {mean_j_hig2vec:.3f} ({mean_j_hig2vec*100:.1f}% overlap)")

if mean_j_esm2 > 0.4 and mean_j_hig2vec > 0.4:
    print("→ BALANCED: Good overlap with both embeddings")
elif mean_j_hig2vec > mean_j_esm2 + 0.2:
    print("→ HiG2Vec-dominant: Blended neighbors mostly from HiG2Vec")
elif mean_j_esm2 > mean_j_hig2vec + 0.2:
    print("→ ESM2-dominant: Blended neighbors mostly from ESM2")
else:
    print("→ MIXED: Blended neighbors combine both modalities")

print("\n" + "="*80)
print("TEST 4: EYEBALL TEST - BIOLOGICAL NEIGHBORS")
print("="*80)

# Sample diverse proteins
sample_proteins = [
    ("TP53", "Tumor suppressor p53"),
    ("INS", "Insulin"),
    ("APOE", "Apolipoprotein E"),
    ("HBB", "Hemoglobin subunit beta"),
    ("BRCA1", "Breast cancer susceptibility protein"),
    ("CD4", "T-cell surface glycoprotein"),
]

for gene, description in sample_proteins:
    if gene not in common_genes:
        print(f"\n{gene}: Not in dataset")
        continue
    
    esm2_sims, hig2vec_sims, blended_sims, genes = get_similarities(gene, weight=0.5)
    if esm2_sims is None:
        continue
    
    # Get top 5 for each metric
    esm2_top_idx = np.argsort(esm2_sims)[-5:][::-1]
    hig2vec_top_idx = np.argsort(hig2vec_sims)[-5:][::-1]
    blended_top_idx = np.argsort(blended_sims)[-5:][::-1]
    
    print(f"\n{gene} ({description})")
    print(f"  ESM2 top-5:    {', '.join([f'{genes[i]}({esm2_sims[i]:.3f})' for i in esm2_top_idx])}")
    print(f"  HiG2Vec top-5: {', '.join([f'{genes[i]}({hig2vec_sims[i]:.3f})' for i in hig2vec_top_idx])}")
    print(f"  Blended top-5: {', '.join([f'{genes[i]}({blended_sims[i]:.3f})' for i in blended_top_idx])}")

print("\n" + "="*80)
print("SUMMARY")
print("="*80)
print(f"Embedding space correlation:  ρ = {rho_space:.4f}")
print(f"Blend→ESM2 correlation:       ρ̄ = {mean_rho_esm2:.4f}")
print(f"Blend→HiG2Vec correlation:    ρ̄ = {mean_rho_hig2vec:.4f}")
print(f"Top-20 Jaccard w/ ESM2:       J̄ = {mean_j_esm2:.3f}")
print(f"Top-20 Jaccard w/ HiG2Vec:    J̄ = {mean_j_hig2vec:.3f}")
print("\nBlending appears:", end=" ")
if abs(mean_rho_esm2 - mean_rho_hig2vec) < 0.15 and abs(mean_j_esm2 - mean_j_hig2vec) < 0.2:
    print("BALANCED ✓")
elif mean_rho_hig2vec > mean_rho_esm2 + 0.15:
    print("HiG2Vec-dominant")
else:
    print("ESM2-dominant")
