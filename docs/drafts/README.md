# Drafts Directory

This folder contains work-in-progress content that isn't ready for publication.

## How it works

- Content here is **gitignored** - won't appear on the live site
- Write drafts here, edit freely across devices via Syncthing
- When ready to publish: move to appropriate folder in `docs/`
- Git will then track the file and CI will build it to the live site

## Workflow

1. **Draft**: Write in `docs/drafts/my-post.md`
2. **Edit**: Sync across devices, iterate freely
3. **Publish**: Move to `docs/posts/my-post.md` 
4. **Deploy**: Git commit + push → live in ~60 seconds

## Categories

Use subfolders to organize:

```
docs/drafts/
├── posts/           # Blog post drafts
├── wiki/            # Wiki page drafts  
├── concepts/        # New concept explorations
└── random/          # Scratch notes, ideas
```