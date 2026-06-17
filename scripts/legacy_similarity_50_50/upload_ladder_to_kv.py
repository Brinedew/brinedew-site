#!/usr/bin/env python3
"""
Upload top-K ladder data to Cloudflare KV.

Usage:
    # Preview upload (dry run)
    python upload_ladder_to_kv.py
    
    # Actually upload
    python upload_ladder_to_kv.py --upload
"""
import json
import subprocess
import argparse
from pathlib import Path

def main():
    parser = argparse.ArgumentParser(description='Upload ladder to KV')
    parser.add_argument('--upload', action='store_true', help='Actually upload (default is dry run)')
    parser.add_argument('--input', type=str, default='topk_ladder.json', help='Input file')
    args = parser.parse_args()
    
    input_path = Path(__file__).parent / args.input
    print(f"Loading {input_path}...")
    ladder = json.load(open(input_path))
    
    print(f"Loaded {len(ladder)} proteins")
    
    if not args.upload:
        print("\n[DRY RUN] Would upload the following (first 3):")
        for i, (target, neighbors) in enumerate(ladder.items()):
            if i >= 3:
                break
            key = f"ladder:{target}"
            value = json.dumps(neighbors)
            print(f"  {key}: {value[:100]}...")
        print(f"\n[DRY RUN] Run with --upload to actually upload")
        return
    
    # Create a JSON file with all key-value pairs for bulk upload
    # Format: [{key, value}, {key, value}, ...]
    bulk_file = Path(__file__).parent / 'ladder_bulk.json'
    bulk_data = [
        {"key": f"ladder:{target}", "value": json.dumps(neighbors)}
        for target, neighbors in ladder.items()
    ]
    
    with open(bulk_file, 'w') as f:
        json.dump(bulk_data, f)
    
    print(f"Created bulk file with {len(bulk_data)} entries")
    print("Uploading to KV...")
    
    # Use wrangler kv:bulk put
    result = subprocess.run([
        'wrangler', 'kv:bulk', 'put',
        '--binding=KV',
        str(bulk_file)
    ], cwd=str(Path(__file__).parent.parent), capture_output=True, text=True)
    
    if result.returncode != 0:
        print(f"Error: {result.stderr}")
    else:
        print(result.stdout)
        print("Upload complete!")
    
    # Cleanup
    bulk_file.unlink()

if __name__ == '__main__':
    main()
