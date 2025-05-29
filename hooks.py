"""
MkDocs hook to automatically convert all non-alphanumeric characters to hyphens in URLs
while keeping original file/folder names unchanged.
"""

import re


def slugify_url(url):
    """Convert all non-alphanumeric characters to hyphens in URLs."""
    # Keep only alphanumeric characters and replace everything else with hyphens
    url = re.sub(r'[^a-zA-Z0-9]+', '-', url)
    # Convert to lowercase
    url = url.lower()
    # Remove leading/trailing hyphens
    url = url.strip('-')
    return url


def on_page_context(context, page, config, nav):
    """Hook to modify page URLs before rendering."""
    if page.url:
        # Split URL into parts and slugify each part
        parts = page.url.strip('/').split('/')
        slugified_parts = [slugify_url(part) for part in parts if part]
        
        # Reconstruct the URL
        if slugified_parts:
            page.url = '/'.join(slugified_parts) + '/'
        else:
            page.url = ''
    
    return context