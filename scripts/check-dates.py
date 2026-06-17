import json
d = json.load(open('D:\\Coding\\Website\\public\\static\\contentIndex.json', 'r', encoding='utf-8'))
has_date = [(k, d[k].get('date')) for k in d if d[k].get('date')]
print(f'Total entries: {len(d)}')
print(f'Entries with dates: {len(has_date)}')
for k, v in has_date[:5]:
    print(f'  {k}: {v}')
if not has_date:
    print('NO entries have dates - dates are deleted from contentIndex.json (line 214)')
    print('This is BY DESIGN - dates are only used for RSS/sitemap, not contentIndex')
