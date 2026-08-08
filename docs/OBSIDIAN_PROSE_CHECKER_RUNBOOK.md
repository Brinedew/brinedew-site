# Brinedew Prose Checker runbook

**ARCHITECTURE FENCE [BPC-001]**

## Protected decision

The plugin has two deliberately separate execution lanes:

1. Harper grammar runs locally after editor idle and may update while the user
   types.
2. DeepSeek prose agents run only after the user presses the prose-check button
   or invokes its command. Every selected atomic agent receives the same
   immutable complete-document snapshot in one request.

Plugin startup registers commands, views, editor extensions, and settings. It
must not read `OPENCODE_API_KEY`, probe the provider, inspect an active note, or
schedule remote work. Editing alone must never trigger a remote request.

The only permitted remote model is `deepseek-v4-flash-free` at
`https://opencode.ai/zen/v1`. A missing model, expired free period, invalid key,
or provider failure is reported on that agent or run. There is no paid model,
OpenCode Go, OpenRouter, or silent fallback path.

## Why this exists

Remote checks take roughly one to two minutes and duplicate the complete note
for every narrow error detector. Treating them like a live linter would flood
the provider, leak drafts without a deliberate action, make typing state race
remote snapshots, and worsen Obsidian startup. A fallback to a paid model could
also turn a discontinued free preview into an unbounded expense.

## Result contract

- Each request contains exactly one versioned agent definition and the complete
  raw Markdown snapshot. Agents are never combined into voice, cohesion, or
  another umbrella review.
- Returned offsets are advisory at most. A finding becomes visible only after
  its exact text plus adjacent context resolves uniquely outside protected
  Markdown ranges.
- Edits touching a finding remove it. Edits elsewhere map it forward. Late
  results are accepted only when their original text and context still match.
- Applying a suggestion changes only the anchored source range. Structural
  findings and syntax-crossing spans are explanation-only.
- Note contents, prompts, responses, replacements, and credentials never enter
  logs.

## Operational checks

Before release:

1. Run unit and contract tests, including the BPC-001 source assertions.
2. Build and sync only to the ignored isolated development vault.
3. Confirm plugin load produces zero OpenCode traffic and does not read the API
   key.
4. Trigger one manual check and verify catalog lookup precedes agent requests.
5. Remove the free model from the mocked catalog and prove the run stops without
   a chat request.

Do not activate this plugin in the main Website vault until the outstanding
cold-restart Obsidian investigation has captured its baseline.
