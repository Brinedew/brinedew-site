#!/usr/bin/env python3
"""
Precompute top-K neighbors for each protein.

This generates a JSON file mapping each protein to its K closest neighbors
(by blended metric score). The online Worker uses this to apply rank-based
display scoring: top neighbors get 99%, 98%, 97%, etc.

Usage:
    python precompute_topk_ladder.py [--k 9] [--output topk_ladder.json]
"""
import json
import numpy as np
import torch
from pathlib import Path
from collections import defaultdict
import argparse
from tqdm import tqdm

# Same stats as production (protein-store.js)
STATS = {
    'esm2': {'mean': 0.953, 'std': 0.032},
    'hig2vec': {'mean': 0.010, 'std': 0.385}
}

def cosine_batch(v, matrix):
    """Compute cosine similarity between vector v and all rows in matrix."""
    v_norm = v / np.linalg.norm(v)
    norms = np.linalg.norm(matrix, axis=1, keepdims=True)
    norms[norms == 0] = 1  # Avoid division by zero
    matrix_norm = matrix / norms
    return matrix_norm @ v_norm

def get_metric(c, embed_type):
    """Stage 1: Linear z-score mapping (same as protein-store.js)."""
    s = STATS[embed_type]
    z = (c - s['mean']) / s['std']
    return 0.5 + z / 8.0

def main():
    parser = argparse.ArgumentParser(description='Precompute top-K neighbors')
    parser.add_argument('--k', type=int, default=9, help='Number of neighbors to store')
    parser.add_argument('--output', type=str, default='topk_ladder.json', help='Output file')
    args = parser.parse_args()
    
    K = args.k
    
    print("Loading embeddings...")
    esm2_data = torch.load(r"D:\Coding\Datasets\GeneGuessr\cache\ESM2-vectors\ESM2-3B-Human-Gene-Embeddings.pt")
    hig2vec_pt = torch.load(r"D:\Coding\Datasets\GeneGuessr\cache\Hig2Vec\hig2vec_human_200dim.pth")
    
    # Build lookup dicts
    gene_to_esm2 = {g: v.to(torch.float32).numpy() for g, v in esm2_data.items()}
    gene_to_hig2vec = {obj: hig2vec_pt['embeddings'][i].numpy() 
                       for i, obj in enumerate(hig2vec_pt['objects']) 
                       if not obj.startswith('GO:')}
    
    # Find common genes (these are the only ones playable in GeneGuessr)
    common_genes = sorted(set(gene_to_esm2.keys()) & set(gene_to_hig2vec.keys()))
    print(f"Common genes: {len(common_genes)}")
    
    # Build matrices for batch computation
    print("Building embedding matrices...")
    esm2_matrix = np.array([gene_to_esm2[g] for g in common_genes])
    hig2vec_matrix = np.array([gene_to_hig2vec[g] for g in common_genes])
    gene_to_idx = {g: i for i, g in enumerate(common_genes)}
    
    # Precompute top-K for each gene
    print(f"Computing top-{K} neighbors for {len(common_genes)} proteins...")
    ladder = {}
    
    for i, target in enumerate(tqdm(common_genes)):
        target_esm2 = esm2_matrix[i]
        target_hig2vec = hig2vec_matrix[i]
        
        # Batch cosine similarity
        esm2_cosines = cosine_batch(target_esm2, esm2_matrix)
        hig2vec_cosines = cosine_batch(target_hig2vec, hig2vec_matrix)
        
        # Convert to metric scores
        esm2_metrics = np.array([get_metric(c, 'esm2') for c in esm2_cosines])
        hig2vec_metrics = np.array([get_metric(c, 'hig2vec') for c in hig2vec_cosines])
        
        # Blend (50/50)
        blended = 0.5 * esm2_metrics + 0.5 * hig2vec_metrics
        
        # Set self-similarity to -inf so it's not included
        blended[i] = -np.inf
        
        # Get top-K indices (sorted descending)
        topk_idx = np.argsort(blended)[::-1][:K]
        
        # Store as list of {gene, metric}
        ladder[target] = [
            {'gene': common_genes[j], 'metric': float(blended[j])}
            for j in topk_idx
        ]
    
    # Save
    output_path = Path(__file__).parent / args.output
    with open(output_path, 'w') as f:
        json.dump(ladder, f, indent=2)
    
    print(f"\nSaved to {output_path}")
    print(f"File size: {output_path.stat().st_size / 1024 / 1024:.2f} MB")
    
    # Quick sanity check
    print("\n--- Sanity Check ---")
    test_targets = ['HBB', 'BRCA1', 'TP53']
    for t in test_targets:
        if t in ladder:
            neighbors = ladder[t]
            print(f"\n{t} top-{K}:")
            for rank, n in enumerate(neighbors, 1):
                display_pct = 100 - rank  # 99, 98, 97, ...
                print(f"  {rank}. {n['gene']:12s} metric={n['metric']:.4f} -> display={display_pct}%")

if __name__ == '__main__':
    main()
