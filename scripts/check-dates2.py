import json, os, re

d = json.load(open('D:\\Coding\\Website\\public\\static\\contentIndex.json', 'r', encoding='utf-8'))
for k in d:
    if 'vibes' in k or 'ctvt' in k or 'Repairman' in k or 'Labs' in k:
        entry = d[k]
        print(f'{k}: date key exists = {"date" in entry}')
print('---')
# Also check frontmatter dates directly
for root, dirs, files in os.walk('D:\\Coding\\Website\\content'):
    for f in files:
        if 'vibes' in f or 'ctvt' in f or 'Repairman' in f or 'Labs' in f:
            path = os.path.join(root, f)
            with open(path, 'r', encoding='utf-8') as fh:
                content = fh.read()
            date_m = re.search(r'^date:\s*(.+)$', content, re.MULTILINE)
            draft_m = re.search(r'^draft:\s*(.+)$', content, re.MULTILINE)
            print(f'{f}: date={date_m.group(1).strip() if date_m else "NONE"} draft={draft_m.group(1).strip() if draft_m else "NONE"}')
