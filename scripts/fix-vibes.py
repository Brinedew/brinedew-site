import re
with open('content/posts/vibes-are-principal-components.md', 'r', encoding='utf-8') as f:
    content = f.read()
# Remove both frontmatter blocks and the blockquote
content = re.sub(r'^---.*?---\s*\n*', '', content, 1, re.DOTALL)
content = re.sub(r'^>.*?\n\n', '', content, 1, re.DOTALL)
content = re.sub(r'^---.*?---\s*\n*', '', content, 1, re.DOTALL)
content = content.strip()
new_fm = '---\ndraft: true\ntitle: "Vibes are principal components"\ndate: 2025-08-10\n---\n\n'
with open('content/posts/vibes-are-principal-components.md', 'w', encoding='utf-8') as f:
    f.write(new_fm + content)
print('Done')
