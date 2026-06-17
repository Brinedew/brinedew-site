# -*- coding: utf-8 -*-
"""
Bulk rename "type" tags to "content" tags in Obsidian/Quartz vault.
- Finds all "type/xxx" tags in YAML frontmatter
- Renames them to "content/xxx" 
- Creates timestamped backups before making changes
- Follows same pattern as clean_tags.py

Usage: python rename-type-to-content.py [content_directory]
"""

import sys, re, os, shutil, datetime
from pathlib import Path
import yaml

# --- Configuration ---
SCRIPT_DIR = Path(__file__).resolve().parent
DEFAULT_CONTENT_DIR = (SCRIPT_DIR.parent / "content").resolve()
CONTENT_DIR = Path(sys.argv[1]).resolve() if len(sys.argv) > 1 else DEFAULT_CONTENT_DIR
BACKUP_ROOT = (SCRIPT_DIR / "tag_cleanup_backups").resolve()
MD_EXTENSIONS = {".md", ".markdown"}

# YAML frontmatter pattern
FRONTMATTER_PATTERN = re.compile(r'^---\r?\n(.*?)\r?\n---\r?\n', re.DOTALL | re.MULTILINE)

def create_backup(content_dir, backup_root):
    """Create timestamped backup of all markdown files"""
    timestamp = datetime.datetime.now().strftime("%Y%m%d-%H%M%S")
    backup_dir = backup_root / f"{timestamp}-type-to-content"
    
    print(f"Creating backup at: {backup_dir}")
    
    for file_path in content_dir.rglob("*"):
        if file_path.suffix.lower() in MD_EXTENSIONS and file_path.is_file():
            relative_path = file_path.relative_to(content_dir)
            backup_file = backup_dir / relative_path
            backup_file.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(file_path, backup_file)
    
    print(f"Backup complete: {len(list(backup_dir.rglob('*.md')))} files backed up")
    return backup_dir

def process_file(file_path):
    """Process a single markdown file to rename type/* tags to content/*"""
    try:
        with open(file_path, 'r', encoding='utf-8') as f:
            content = f.read()
        
        # Extract frontmatter
        frontmatter_match = FRONTMATTER_PATTERN.match(content)
        if not frontmatter_match:
            return False, "No frontmatter found"
        
        frontmatter_text = frontmatter_match.group(1)
        rest_of_file = content[frontmatter_match.end():]
        
        # Parse YAML frontmatter
        try:
            frontmatter_data = yaml.safe_load(frontmatter_text)
        except yaml.YAMLError as e:
            return False, f"YAML parse error: {e}"
        
        if not frontmatter_data:
            return False, "Empty frontmatter"
        
        # Check if we have tags to process
        if 'tags' not in frontmatter_data:
            return False, "No tags field"
        
        tags = frontmatter_data['tags']
        if not tags:
            return False, "Empty tags"
        
        # Convert tags to list if it's a single string
        if isinstance(tags, str):
            tags = [tags]
        elif not isinstance(tags, list):
            return False, f"Unexpected tags format: {type(tags)}"
        
        # Rename type/* tags to content/*
        modified = False
        new_tags = []
        
        for tag in tags:
            if isinstance(tag, str) and tag.startswith('type/'):
                new_tag = tag.replace('type/', 'content/', 1)
                new_tags.append(new_tag)
                modified = True
                print(f"  {file_path.name}: {tag} -> {new_tag}")
            else:
                new_tags.append(tag)
        
        if not modified:
            return False, "No type/* tags found"
        
        # Update frontmatter
        frontmatter_data['tags'] = new_tags
        
        # Reconstruct file
        new_frontmatter = yaml.dump(frontmatter_data, default_flow_style=False, allow_unicode=True)
        new_content = f"---\n{new_frontmatter}---\n{rest_of_file}"
        
        # Write back to file
        with open(file_path, 'w', encoding='utf-8') as f:
            f.write(new_content)
        
        return True, f"Renamed {len([t for t in tags if isinstance(t, str) and t.startswith('type/')])} tags"
        
    except Exception as e:
        return False, f"Error processing file: {e}"

def main():
    print(f"Bulk rename type/* to content/* tags")
    print(f"Content directory: {CONTENT_DIR}")
    
    if not CONTENT_DIR.exists():
        print(f"Error: Content directory does not exist: {CONTENT_DIR}")
        return 1
    
    # Find all markdown files
    md_files = list(CONTENT_DIR.rglob("*.md"))
    print(f"Found {len(md_files)} markdown files")
    
    # Create backup first
    backup_dir = create_backup(CONTENT_DIR, BACKUP_ROOT)
    
    # Process files
    modified_count = 0
    error_count = 0
    
    print("\nProcessing files...")
    for file_path in md_files:
        success, message = process_file(file_path)
        if success:
            modified_count += 1
        elif "No type/* tags found" not in message and "No tags field" not in message:
            print(f"  Warning: {file_path.name}: {message}")
            error_count += 1
    
    print(f"\nSummary:")
    print(f"  Files processed: {len(md_files)}")
    print(f"  Files modified: {modified_count}")
    print(f"  Errors: {error_count}")
    print(f"  Backup location: {backup_dir}")
    
    if error_count > 0:
        print(f"\nThere were {error_count} errors. Check the messages above.")
        return 1
    
    print(f"\nSuccess! All type/* tags have been renamed to content/*")
    return 0

if __name__ == "__main__":
    sys.exit(main())