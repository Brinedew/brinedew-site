import json
from pathlib import Path
import numpy as np

DUMP_PATH = Path('scripts/embedding_dump.json')
rows = json.loads(DUMP_PATH.read_text())[0]['results']
vectors = {}
for row in rows:
    raw = row['vector']
    buf = bytes((x + 256 if x < 0 else x) for x in raw)
    vec = np.frombuffer(buf, dtype='<f4')
    dim = int(row.get('dim') or vec.size)
    vectors[row['uniprot']] = vec[:dim]

pairs = []
keys = list(vectors.keys())
for i, a_id in enumerate(keys):
    a = vectors[a_id]
    na = np.linalg.norm(a)
    if na == 0:
        continue
    for j in range(i + 1, len(keys)):
        b_id = keys[j]
        b = vectors[b_id]
        nb = np.linalg.norm(b)
        if nb == 0:
            continue
        sim = float(np.dot(a, b) / (na * nb))
        pairs.append((sim, a_id, b_id))

pairs.sort(key=lambda x: x[0], reverse=True)
print('Top 10 most similar:')
for sim, a, b in pairs[:10]:
    print(f'{a}-{b}: {sim:.3f}')

pairs.sort(key=lambda x: x[0])
print('\nTop 10 most dissimilar:')
for sim, a, b in pairs[:10]:
    print(f'{a}-{b}: {sim:.3f}')
