#!/usr/bin/env python3
"""
Find the top 10 most similar and bottom 10 least similar gene pairs
based on HiG2Vec embedding cosine similarity.

This is a one-off analysis script, not part of the build pipeline.
"""

import torch
import numpy as np
from pathlib import Path
from typing import Dict, List, Tuple
import heapq

SCRIPT_DIR = Path(__file__).resolve().parent
ROOT = SCRIPT_DIR.parent.parent.parent
EMBEDDING_PATH = ROOT / "tools" / "thoteins" / "data" / "embeddings" / "hig2vec_human_200dim.pth"


def load_embeddings() -> Tuple[np.ndarray, List[str]]:
    """Load embeddings and return normalized vectors + object names."""
    model = torch.load(EMBEDDING_PATH, map_location="cpu")
    objects = model["objects"]  # List of token strings
    embeddings = model["embeddings"].detach().cpu().numpy().astype(np.float32)
    
    # Normalize for cosine similarity (dot product of normalized = cosine)
    norms = np.linalg.norm(embeddings, axis=1, keepdims=True)
    norms[norms == 0] = 1  # Avoid division by zero
    normalized = embeddings / norms
    
    return normalized, objects


def find_extremes(embeddings: np.ndarray, objects: List[str], top_k: int = 10):
    """
    Find top_k most similar and top_k least similar pairs.
    
    Uses a streaming approach to avoid O(n^2) memory for the full similarity matrix.
    """
    n = len(objects)
    print(f"Total embeddings: {n}")
    
    # Separate GO terms from gene symbols - use all non-GO tokens as genes
    gene_indices = []
    idx_to_symbol = {}
    for i, obj in enumerate(objects):
        if obj.startswith('GO:'):
            continue
        gene_indices.append(i)
        idx_to_symbol[i] = obj
    
    num_genes = len(gene_indices)
    print(f"Gene symbols: {num_genes}")
    print(f"Pairs to analyze: {num_genes * (num_genes - 1) // 2:,}")
    
    # Use heaps to track top/bottom k
    top_pairs = []  # (similarity, i, j) - min heap
    bottom_pairs = []  # (-similarity, i, j) - max heap (negated)
    
    # Get just the vectors for our genes
    gene_vecs = embeddings[gene_indices]
    
    # Compute all pairwise similarities for the subset
    total_pairs = 0
    
    for i in range(num_genes):
        for j in range(i + 1, num_genes):
            sim = float(np.dot(gene_vecs[i], gene_vecs[j]))
            total_pairs += 1
            
            idx_i = gene_indices[i]
            idx_j = gene_indices[j]
            
            # Update top pairs (most similar)
            if len(top_pairs) < top_k:
                heapq.heappush(top_pairs, (sim, idx_i, idx_j))
            elif sim > top_pairs[0][0]:
                heapq.heapreplace(top_pairs, (sim, idx_i, idx_j))
            
            # Update bottom pairs (least similar)
            if len(bottom_pairs) < top_k:
                heapq.heappush(bottom_pairs, (-sim, idx_i, idx_j))
            elif -sim > bottom_pairs[0][0]:
                heapq.heapreplace(bottom_pairs, (-sim, idx_i, idx_j))
    
    print(f"Total pairs analyzed: {total_pairs:,}")
    
    # Sort results
    top_pairs = sorted(top_pairs, reverse=True)
    bottom_pairs = sorted([(-s, i, j) for s, i, j in bottom_pairs])
    
    return top_pairs, bottom_pairs, idx_to_symbol


def main():
    print("Loading embeddings...")
    embeddings, objects = load_embeddings()
    print(f"Loaded {len(objects)} embeddings of dimension {embeddings.shape[1]}")
    
    top_pairs, bottom_pairs, idx_to_symbol = find_extremes(embeddings, objects, top_k=10)
    
    print("\n" + "=" * 80)
    print("TOP 10 MOST SIMILAR GENE PAIRS")
    print("=" * 80)
    for i, (sim, idx_a, idx_b) in enumerate(top_pairs, 1):
        sym_a = idx_to_symbol.get(idx_a, '?')
        sym_b = idx_to_symbol.get(idx_b, '?')
        print(f"{i:2d}. {sim*100:6.2f}%  {sym_a:20} <-> {sym_b}")
    
    print("\n" + "=" * 80)
    print("BOTTOM 10 LEAST SIMILAR GENE PAIRS")
    print("=" * 80)
    for i, (sim, idx_a, idx_b) in enumerate(bottom_pairs, 1):
        sym_a = idx_to_symbol.get(idx_a, '?')
        sym_b = idx_to_symbol.get(idx_b, '?')
        print(f"{i:2d}. {sim*100:6.2f}%  {sym_a:20} <-> {sym_b}")


if __name__ == "__main__":
    main()
