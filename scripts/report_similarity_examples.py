import json
from pathlib import Path
import numpy as np

from pathlib import Path

DATA_PATH = Path(__file__).resolve().parents[1] / "tools" / "thoteins" / "data" / "geneguessr" / "proteins.json"

with DATA_PATH.open('r',encoding='utf-8') as f:
    proteins=json.load(f)
name_map={row['uniprot']:row.get('hgnc') or row.get('full_name') for row in proteins}
rows=json.loads(Path('scripts/embedding_dump.json').read_text())[0]['results']
vecs={}
for row in rows:
    raw=row['vector']
    buf=bytes((x+256 if x<0 else x) for x in raw)
    vec=np.frombuffer(buf,dtype='<f4')
    dim=int(row.get('dim') or vec.size)
    vecs[row['uniprot']]=vec[:dim]

pairs=[]
keys=list(vecs.keys())
for i,a_id in enumerate(keys):
    a=vecs[a_id]
    na=np.linalg.norm(a)
    if na==0:
        continue
    for j in range(i+1,len(keys)):
        b_id=keys[j]
        b=vecs[b_id]
        nb=np.linalg.norm(b)
        if nb==0:
            continue
        sim=float(np.dot(a,b)/(na*nb))
        pairs.append((sim,a_id,b_id))

pairs.sort(key=lambda x:abs(x[0]))
print('Pairs near zero:')
for sim,a,b in pairs[:10]:
    print(f'{a} ({name_map.get(a,"?")}) vs {b} ({name_map.get(b,"?")}) -> {sim:.3f}')

pairs.sort(key=lambda x:x[0])
print('\nMost negative:')
for sim,a,b in pairs[:5]:
    print(f'{a} ({name_map.get(a,"?")}) vs {b} ({name_map.get(b,"?")}) -> {sim:.3f}')
