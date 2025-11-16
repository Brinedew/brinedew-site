import json
from pathlib import Path
import numpy as np
import matplotlib.pyplot as plt

DUMP_PATH = Path('scripts/embedding_dump.json')
if not DUMP_PATH.exists():
    raise SystemExit(f'Missing dump at {DUMP_PATH}')
with DUMP_PATH.open('r', encoding='utf-8') as f:
    payload = json.load(f)
results = payload[0]['results']
vectors = {}
for row in results:
    raw = row['vector']
    buf = bytes((x + 256 if x < 0 else x) for x in raw)
    vec = np.frombuffer(buf, dtype='<f4')
    dim = int(row.get('dim') or vec.size)
    vectors[row['uniprot']] = vec[:dim]

pairs = []
keys = list(vectors.keys())
for i in range(len(keys)):
    a = vectors[keys[i]]
    na = np.linalg.norm(a)
    if na == 0:
        continue
    for j in range(i + 1, len(keys)):
        b = vectors[keys[j]]
        nb = np.linalg.norm(b)
        if nb == 0:
            continue
        sim = float(np.dot(a, b) / (na * nb))
        pairs.append(sim)

if not pairs:
    raise SystemExit('No pairwise similarities computed')

fig, ax = plt.subplots(figsize=(8, 4.5))
ax.hist(pairs, bins=20, color='#8ecae6', edgecolor='#023047')
ax.set_xlabel('Cosine similarity')
ax.set_ylabel('Pair count')
ax.set_title(f'Pairwise HiG2Vec similarities (n={len(keys)})')
ax.grid(alpha=0.2, linestyle='--')
fig.tight_layout()
output_path = Path('scripts/embedding_similarity_histogram.png')
fig.savefig(output_path, dpi=150)
print(f'Saved histogram to {output_path}')
print(f'Min: {min(pairs):.3f}, Median: {np.median(pairs):.3f}, Max: {max(pairs):.3f}')
