# Brinedew Prose Checker

Brinedew Prose Checker is a desktop Obsidian plugin with two deliberately
separate lanes:

- Harper 2.7 provides fast local spelling and grammar diagnostics after editor
  idle.
- Sixty atomic DeepSeek agents are available for explicit whole-note checks.
  The proof-of-concept defaults to three enabled agents; the rest remain
  searchable in “Run one agent” and can be enabled individually.

The remote lane is never a live linter. Each agent receives one immutable
full-document snapshot, checks one named error, and returns exact text anchors.
Results appear independently as agents finish.

## Commands

- **Check active note with all enabled agents**
- **Check active note with one agent…**
- **Open prose-check progress**

The Markdown pane header also contains one scan button. Left-click runs every
enabled agent. Right-click opens the one-agent picker.

## Provider contract

The plugin reads `OPENCODE_API_KEY` from the desktop process environment only
when a manual check starts. It probes and calls only:

```text
https://opencode.ai/zen/v1
deepseek-v4-flash-free
```

Missing credentials, model removal, free-period expiry, and provider failures
stop the affected run. There is no paid, Go, OpenRouter, or alternate-model
fallback. See the repository runbook and `BPC-001` architecture fence.

## Development

From the Website repository:

```powershell
pnpm --filter @brinedew/obsidian-prose-checker check
pnpm --filter @brinedew/obsidian-prose-checker test
pnpm --filter @brinedew/obsidian-prose-checker build
pnpm --filter @brinedew/obsidian-prose-checker sync:dev-vault
```

The sync command writes only to the ignored isolated development vault under
the Website artifact archive. It never changes the Website vault's `.obsidian`
directory.

## Optional prompt evaluation

The repository contains a heavy, opt-in prompt-tuning harness. It is not part of
the proof-of-concept build or smoke test. The normal live smoke makes exactly
three agent calls:

```powershell
pnpm --filter @brinedew/obsidian-prose-checker smoke:provider
```

The optional full evaluation runs each fixture repeatedly and writes only
aggregate metrics to the ignored artifact archive:

```powershell
pnpm --filter @brinedew/obsidian-prose-checker evaluate:agents
```

The optional gate requires recall of at least 85%, false positives at most 10%,
exact-anchor validity of at least 95%, and repeated-run disagreement at most 15
percentage points. Prompt changes increment that agent's version.

## Attribution

The local grammar engine is the published `harper.js` package. Interaction and
integration design is derived from Harper's Obsidian plugin. Harper is Copyright
2024 Elijah Potter and Harper contributors and is licensed under Apache-2.0.
