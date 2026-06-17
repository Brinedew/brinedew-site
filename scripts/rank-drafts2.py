import os, re

content_dir = r'D:\Coding\Website\content'
results = []

for root, dirs, files in os.walk(content_dir):
    for f in files:
        if not f.endswith('.md'): continue
        relpath = os.path.relpath(os.path.join(root, f), content_dir)
        if not (relpath.startswith('posts/') or relpath.startswith('wiki/')): continue
        if 'excalidraw' in relpath: continue
        
        with open(os.path.join(root, f), 'r', encoding='utf-8') as fh:
            content = fh.read()
        
        if 'draft: true' not in content: continue
        
        date_m = re.search(r'^date:\s*(.+)$', content, re.MULTILINE)
        date_val = date_m.group(1).strip() if date_m else 'NO_DATE'
        
        # Remove frontmatter
        body = re.sub(r'^---.*?---\s*', '', content, 1, re.DOTALL)
        
        has_hr = bool(re.search(r'^\*\*\*$', body, re.MULTILINE))
        
        if has_hr:
            # Words before ***
            hr_match = re.search(r'^\*\*\*$', body, re.MULTILINE)
            before_hr = body[:hr_match.start()]
            shown = len(before_hr.split())
        else:
            # Worker truncates at ~100 words for no-hr files
            shown = 100
        
        if shown > 100:
            results.append((shown, relpath, date_val))

results.sort(key=lambda x: -x[0])
print(f"{'Shown':>6} | {'Date':12} | File")
print("-" * 70)
for shown, path, date_val in results:
    print(f"{shown:>6} | {date_val:12} | {path}")
