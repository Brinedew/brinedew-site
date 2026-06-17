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
        
        # Get frontmatter date
        date_m = re.search(r'^date:\s*(.+)$', content, re.MULTILINE)
        date_val = date_m.group(1).strip() if date_m else 'NO_DATE'
        
        # Check for *** divider
        has_hr = bool(re.search(r'^\*\*\*$', content, re.MULTILINE))
        
        # Count all words in the file (excluding frontmatter)
        body = re.sub(r'^---.*?---\s*', '', content, 1, re.DOTALL)
        # If it has ***, only count words before the first ***
        if has_hr:
            hr_match = re.search(r'^\*\*\*$', body, re.MULTILINE)
            if hr_match:
                body = body[:hr_match.start()]
        words = len(body.split())
        
        # Check for table
        has_table = '<table' in body or '|' in body
        
        results.append((words, relpath, date_val, has_hr, has_table))

results.sort(key=lambda x: -x[0])  # Sort by word count descending

print(f"{'Words':>6} | {'Date':12} | {'HR':3} | {'Tbl':3} | File")
print("-" * 80)
for words, path, date_val, has_hr, has_table in results:
    if words > 100:
        print(f"{words:>6} | {date_val:12} | {'Y' if has_hr else 'N':3} | {'Y' if has_table else 'N':3} | {path}")
