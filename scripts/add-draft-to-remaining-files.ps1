# Add draft: true to all remaining files without draft properties
# These are currently defaulting to published

$Utf8NoBom = New-Object System.Text.UTF8Encoding $false

# Find all .md files without draft property
$filesWithoutDraft = @()
Get-ChildItem -Path "content" -Include "*.md" -Recurse | Where-Object {
    $_.FullName -notmatch "Templates" -and
    $_.FullName -notmatch "\.obsidian" -and
    $_.FullName -notmatch "\.trash"
} | ForEach-Object {
    $content = Get-Content -Path $_.FullName -Raw -ErrorAction SilentlyContinue
    if ($content -and $content -notmatch "draft:") {
        $filesWithoutDraft += $_.FullName
    }
}

Write-Host "Found $($filesWithoutDraft.Count) files without draft properties:"
$filesWithoutDraft | ForEach-Object { Write-Host "  $_" }
Write-Host ""

foreach ($file in $filesWithoutDraft) {
    $content = Get-Content -Path $file -Raw
    Write-Host "Processing: $file"
    
    # Handle files with no frontmatter at all
    if ($content -notmatch '^---\s*\n') {
        $newContent = "---`ndraft: true`n---`n`n$content"
        [System.IO.File]::WriteAllText($file, $newContent, $Utf8NoBom)
        Write-Host "  Added frontmatter with draft: true" -ForegroundColor Green
        continue
    }
    
    # Handle files with existing frontmatter
    if ($content -match '(?s)^---\s*\n(.*?)\n---(.*)') {
        $frontmatter = $matches[1]
        $body = $matches[2]
        
        $newFrontmatter = $frontmatter + "`ndraft: true"
        $newContent = "---`n$newFrontmatter`n---$body"
        [System.IO.File]::WriteAllText($file, $newContent, $Utf8NoBom)
        Write-Host "  Added draft: true to existing frontmatter" -ForegroundColor Green
    } else {
        Write-Host "  Warning: Could not parse frontmatter" -ForegroundColor Yellow
    }
}

Write-Host ""
Write-Host "Done! All files now have explicit draft properties."
Write-Host "Only files with draft: false will appear on live site."