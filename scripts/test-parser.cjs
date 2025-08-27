// Test the order-agnostic parser with the actual essay content
const fs = require('fs');

// Simple JavaScript version for testing (since we can't run TypeScript directly)
const MARKER = /<span[^>]*\bdata-lineage-section=["']?([0-9]+(?:\.[0-9]+)*)["']?[^>]*>\s*<\/span>/ig;

function buildTreeIgnoringOrder(src) {
  console.log('Building tree from content...');
  
  // 1) collect ranges
  const ranges = [];
  let m;
  const hits = [];
  
  // Reset regex state
  MARKER.lastIndex = 0;
  while ((m = MARKER.exec(src)) !== null) {
    hits.push({ id: m[1], s: m.index, e: MARKER.lastIndex });
  }
  
  for (let i = 0; i < hits.length; i++) {
    const cur = hits[i];
    const nextS = i + 1 < hits.length ? hits[i + 1].s : src.length;
    const content = src.slice(cur.e, nextS);
    ranges.push({ 
      id: cur.id, 
      depth: cur.id.split(".").length, 
      content 
    });
  }

  console.log(`Found ${ranges.length} sections`);

  // 2) create all nodes
  const byId = new Map();
  for (const r of ranges) {
    byId.set(r.id, {
      id: r.id,
      depth: r.depth,
      title: deriveTitle(r.content),
      content: r.content,
      children: [],
    });
  }

  // Ensure parents exist
  for (const id of Array.from(byId.keys())) {
    const parts = id.split(".");
    while (parts.length > 1) {
      parts.pop();
      const pid = parts.join(".");
      if (!byId.has(pid)) {
        console.log(`Creating placeholder parent: ${pid}`);
        byId.set(pid, { 
          id: pid, 
          depth: parts.length, 
          content: "", 
          children: [] 
        });
      }
    }
  }

  // 3) build relationships
  const numericCmp = (a, b) => {
    const A = a.split(".").map(Number);
    const B = b.split(".").map(Number);
    for (let i = 0; i < Math.max(A.length, B.length); i++) {
      const ai = A[i] || 0;
      const bi = B[i] || 0;
      if (ai !== bi) return ai - bi;
    }
    return 0;
  };

  // Clear children
  for (const n of byId.values()) {
    n.children = [];
  }

  // Build edges
  for (const [id, node] of byId) {
    const parts = id.split(".");
    if (parts.length === 1) continue;
    
    const parentId = parts.slice(0, -1).join(".");
    const parent = byId.get(parentId);
    
    if (parent) {
      parent.children.push(node);
    } else {
      console.warn(`Parent ${parentId} not found for ${id}`);
    }
  }

  // Sort children
  for (const n of byId.values()) {
    n.children.sort((a, b) => numericCmp(a.id, b.id));
  }

  // Return roots
  const roots = Array.from(byId.values())
    .filter(n => n.depth === 1)
    .sort((a, b) => numericCmp(a.id, b.id));
  
  console.log(`Built tree with ${roots.length} root nodes`);
  return roots;
}

function deriveTitle(content) {
  const lines = content.split('\n');
  for (const line of lines.slice(0, 5)) {
    const match = line.match(/^\s{0,3}(#{1,6}|\-|\*)\s*(.+)$/);
    if (match && match[2].trim()) {
      let title = match[2].trim();
      // Remove bracketed signposting
      title = title.replace(/^\[.*?\]\s*/, '');
      title = title.replace(/\s*\[.*?\]$/, '');
      return title || undefined;
    }
  }
  return undefined;
}

function printTree(nodes, indent = 0) {
  for (const node of nodes) {
    const space = '  '.repeat(indent);
    const title = node.title || 'No title';
    const contentPreview = node.content.slice(0, 80).replace(/\n/g, ' ').trim();
    console.log(`${space}${node.id}: "${title}" - ${contentPreview}...`);
    printTree(node.children, indent + 1);
  }
}

// Test with the actual essay
console.log('=== Testing Order-Agnostic Parser with Real Essay ===');

try {
  const essayContent = fs.readFileSync('content/posts/the-price-of-not-being-cancer-v3.md', 'utf8');
  console.log(`Essay content length: ${essayContent.length} characters`);
  
  const tree = buildTreeIgnoringOrder(essayContent);
  
  console.log('\n=== PARSED TREE STRUCTURE ===');
  printTree(tree);
  
  console.log('\n=== SUMMARY ===');
  console.log(`Root sections: ${tree.length}`);
  
  let totalNodes = 0;
  function countNodes(nodes) {
    totalNodes += nodes.length;
    for (const node of nodes) {
      countNodes(node.children);
    }
  }
  countNodes(tree);
  console.log(`Total nodes: ${totalNodes}`);
  
} catch (error) {
  console.error('Error:', error.message);
}