import fs from 'fs';
import path from 'path';

const htmlFiles = [
  'content/apps/scriptotic/index.md',
];

htmlFiles.forEach(filepath => {
  if (!fs.existsSync(filepath)) {
    console.log(`❌ File not found: ${filepath}`);
    return;
  }
  
  console.log(`🔧 Processing: ${filepath}`);
  
  let content = fs.readFileSync(filepath, 'utf8');
  
  // Check if file contains raw HTML
  if (content.includes('<style>') || content.includes('<div') || content.includes('<form')) {
    console.log('   Found raw HTML content, converting...');
    
    // Extract the large HTML block starting with <style>
    const htmlStartIndex = content.indexOf('<style>');
    
    if (htmlStartIndex !== -1) {
      // Find where the HTML content ends (before the next markdown section)
      const htmlEndIndex = content.indexOf('\n## ', htmlStartIndex);
      const endIndex = htmlEndIndex !== -1 ? htmlEndIndex : content.length;
      
      const htmlContent = content.substring(htmlStartIndex, endIndex).trim();
      
      // Replace the HTML block with a simple description and link
      const replacement = `
This page contains an interactive web application for converting YouTube videos to text transcripts.

> **Note**: The interactive transcript generator has been temporarily converted to a separate component during the Quartz migration. The functionality includes:
> - YouTube URL input with validation
> - Speaker name identification  
> - Multiple output formats (Text, JSON, SRT)
> - Real-time processing status
> - Voxtral Mini 3B AI model integration

**Features:**
- Advanced speech recognition with automatic language detection
- Support for multiple speakers with custom naming
- Export options: Plain text, JSON metadata, or SRT subtitle format
- Real-time progress tracking

**Technical Requirements:**
- Backend: RTX 4080 (12GB VRAM) or similar GPU
- AI Model: Voxtral Mini 3B via vLLM  
- Platform: Windows + WSL2 + Python Flask API

**Source Code**: Available at [GitHub Repository](https://github.com/brinedew/scriptotic)

For urgent transcription needs, contact [hello@brinedew.bio](mailto:hello@brinedew.bio).
`;
      
      const newContent = content.substring(0, htmlStartIndex) + replacement + content.substring(endIndex);
      
      // Write the updated content
      fs.writeFileSync(filepath, newContent);
      console.log('   ✅ Converted HTML to markdown description');
    }
  } else {
    console.log('   ℹ️  No problematic HTML found');
  }
});

console.log('\n✅ HTML content conversion complete!');