# Add draft: true to all existing content files
# Run from Website root directory

# Get all markdown files except templates and internal files
$contentFiles = Get-ChildItem -Path "content" -Include "*.md" -Recurse | Where-Object {
    # Exclude these directories/files
    $_.FullName -notmatch "Templates" -and
    $_.FullName -notmatch "\.obsidian" -and
    $_.FullName -notmatch "_backups" -and
    $_.Name -ne "CLAUDE.md" -and
    # Exclude these files that should stay published (site structure)
    $_.Name -notin @("index.md", "About.md") -and
    $_.FullName -notmatch "apps[/\\]index\.md" -and
    $_.FullName -notmatch "apps[/\\]scriptotic[/\\]index\.md"
}

Write-Host "Found $($contentFiles.Count) content files to update"

foreach ($file in $contentFiles) {
    $content = Get-Content -Path $file.FullName -Raw
    
    # Skip if already has draft property
    if ($content -match "^draft:" -or $content -match "`ndraft:") {
        Write-Host "Skipping $($file.Name) - already has draft property"
        continue
    }
    
    # Find the frontmatter end (second ---)
    if ($content -match '(?s)^---\s*\n(.*?)\n---') {
        $frontmatter = $matches[1]
        $afterFrontmatter = $content.Substring($matches[0].Length)
        
        # Add draft: true to frontmatter
        $newFrontmatter = $frontmatter + "`ndraft: true"
        $newContent = "---`n$newFrontmatter`n---$afterFrontmatter"
        
        # Write with UTF-8 No BOM
        $Utf8NoBom = New-Object System.Text.UTF8Encoding $false
        [System.IO.File]::WriteAllText($file.FullName, $newContent, $Utf8NoBom)
        
        Write-Host "Updated: $($file.Name)"
    } else {
        Write-Host "Warning: No frontmatter found in $($file.Name)"
    }
}

Write-Host ""
Write-Host "Done! All content files now have draft: true"
Write-Host "Next steps:"
Write-Host "1. Check which posts should be published on your live site"
Write-Host "2. Change draft: true to draft: false for published posts"
Write-Host "3. Or remove draft property entirely (defaults to published)"