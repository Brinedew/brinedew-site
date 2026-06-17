import json, os, re

content_dir = r'D:\Coding\Website\content'
drafts = []
for root, dirs, files in os.walk(content_dir):
    for f in files:
        if f.endswith('.md'):
            path = os.path.join(root, f)
            with open(path, 'r', encoding='utf-8') as fh:
                content = fh.read()
            if 'draft: true' in content:
                date_m = re.search(r'^date:\s*(.+)$', content, re.MULTILINE)
                title_m = re.search(r'^title:\s*(.+)$', content, re.MULTILINE)
                drafts.append({
                    'path': os.path.relpath(path, content_dir),
                    'title': title_m.group(1).strip() if title_m else os.path.basename(path),
                    'date': date_m.group(1).strip() if date_m else '',
                })
drafts.sort(key=lambda x: x['date'] or '9999', reverse=True)
for d in drafts:
    print(f"{d['date']:15s} {d['title'][:50]:50s} ({d['path']})")
