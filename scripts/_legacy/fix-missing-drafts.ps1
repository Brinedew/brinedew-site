# Fix specific files that are missing draft properties
# These files are showing up on live site when they shouldn't

$Utf8NoBom = New-Object System.Text.UTF8Encoding $false

# Files that definitely need draft: true
$filesToFix = @(
    "content/CLAUDE.md",  # Internal development notes
    "content/posts/criticism-of-dwarkesh-podcast.md",  # Raw transcript, no frontmatter
    "content/posts/vibes-are-principal-components.md",  # Explicitly marked as raw/unedited
    "content/wiki/index.md"  # Has broken links, needs updating before publish
)

foreach ($file in $filesToFix) {
    if (-not (Test-Path $file)) {
        Write-Host "File not found: $file" -ForegroundColor Yellow
        continue
    }
    
    $content = Get-Content -Path $file -Raw
    Write-Host "Processing: $file"
    
    # Handle files with no frontmatter at all (like criticism-of-dwarkesh-podcast.md)
    if ($content -notmatch '^---\s*\n') {
        $newContent = "---`ndraft: true`n---`n`n$content"
        [System.IO.File]::WriteAllText($file, $newContent, $Utf8NoBom)
        Write-Host "  Added frontmatter with draft: true" -ForegroundColor Green
        continue
    }
    
    # Handle files with frontmatter but no draft property
    if ($content -match '(?s)^---\s*\n(.*?)\n---(.*)') {
        $frontmatter = $matches[1]
        $body = $matches[2]
        
        if ($frontmatter -notmatch 'draft:') {
            $newFrontmatter = $frontmatter + "`ndraft: true"
            $newContent = "---`n$newFrontmatter`n---$body"
            [System.IO.File]::WriteAllText($file, $newContent, $Utf8NoBom)
            Write-Host "  Added draft: true to existing frontmatter" -ForegroundColor Green
        } else {
            Write-Host "  Already has draft property" -ForegroundColor Gray
        }
    } else {
        Write-Host "  Warning: Could not parse frontmatter" -ForegroundColor Yellow
    }
}

Write-Host ""
Write-Host "Done! These files are now properly marked as drafts."
Write-Host "They won't appear on the live site until you remove draft: true"