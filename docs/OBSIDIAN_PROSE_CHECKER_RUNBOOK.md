# Brinedew Prose Checker runbook

**ARCHITECTURE FENCE [BPC-001]**

## Protected decision

The plugin has three deliberately separate execution lanes:

1. Harper grammar runs locally after editor idle and may update while the user
   types.
2. DeepSeek prose agents run only after the user presses the prose-check button
   or invokes its command. Every selected atomic agent receives the same
   immutable complete-document snapshot in one request.
3. Echo (Fulcrum) reviews the selection, or the note body without its
   frontmatter, as a named writer (default Scott Alexander), only after the
   user presses the feather button or invokes its command. It sends three
   requests, one per level: macro (between paragraphs), meso (between
   sentences), micro (inside sentences). Each note Echo returns quotes a
   passage, comments on it and suggests a replacement. The plugin places each
   note on its passage: macro as a bar beside the paragraphs, meso as a tint,
   micro as an underline. Hovering shows the comment and the suggested change,
   with Accept and Reject per note. Notes whose quote cannot be found are
   listed in the Echo panel. Echo gets no style guide or rule list: its own
   writing of the persona is the point.

Plugin startup registers commands, views, editor extensions, and settings. It
must not read `OPENCODE_API_KEY` or `ECHO_API_KEY`, probe a provider, inspect an
active note, or schedule remote work. Editing alone must never trigger a remote
request.

The only permitted agent model is `deepseek-v4-flash-free` at
`https://opencode.ai/zen/v1`. A missing model, expired free period, invalid key,
or provider failure is reported on that agent or run. There is no paid model,
OpenCode Go, OpenRouter, or silent fallback path.

The only permitted Echo route is `https://echo.fulcrum.inc/api/v1` with model
`echo`.

## Full prompt observability

The person using the plugin can read every byte the plugin sends.

- Each Echo request body is built only from the settings (writer, reasoning
  effort, that level's request template) and the person's text. The plugin
  adds no system message, instruction, or wrapper of its own. The settings tab
  shows each template and the exact body it sends.
- Every remote request, from either lane, is recorded in memory exactly as sent
  (only the credential is replaced by its source name) together with the raw
  response. The Echo panel shows it under the result; each agent row in the
  progress view has a button that shows its requests.
- Echo applies its own server-side system prompt and puts the writer's name at
  the top of each user message (Echo API reference, read 2026-10-05). The panel
  says so, and shows Echo's input-token count so that overhead is visible.
- Request bodies are pretty-printed JSON, so what the inspector shows is the
  wire content byte-for-byte.

## Why this exists

Remote checks take seconds to minutes and duplicate the complete note for every
narrow error detector. Treating them like a live linter would flood the
provider, leak drafts without a deliberate action, make typing state race
remote snapshots, and worsen Obsidian startup. A fallback to a paid model could
also turn a discontinued free preview into an unbounded expense. Hidden
instructions added to a writer-voice request change its output in ways the
person cannot see or correct.

## Result contract

- Each agent request contains exactly one versioned agent definition and the
  complete raw Markdown snapshot. Agents are never combined into voice,
  cohesion, or another umbrella review; voice belongs to the Echo lane.
- Returned offsets are advisory at most. A finding becomes visible only after
  its exact text plus adjacent context resolves uniquely outside protected
  Markdown ranges.
- Edits touching a finding remove it. Edits elsewhere map it forward. Late
  results are accepted only when their original text and context still match.
- Applying a suggestion changes only the anchored source range. Structural
  findings and syntax-crossing spans are explanation-only.
- An Echo note anchors only where its quote occurs once in the note (ignoring
  emphasis markers, quote styles and line breaks). Accept replaces only that
  passage; editing the passage yourself removes the note. Notes are saved with
  the note's findings and come back when it is reopened unchanged.
- Note contents, prompts, responses, replacements, and credentials never enter
  logs or files. The request inspector holds them in memory for the session.

## Install into the Website vault

The vault's `.obsidian` folder is git-ignored and `community-plugins.json` is
device-local (`content/.stignore`). The manifest is desktop-only, so synced
phones skip the plugin.

1. Build: `pnpm --filter @brinedew/obsidian-prose-checker build`.
2. Copy `main.js`, `manifest.json`, `styles.css`, `harper-engine.cjs`,
   `LICENSE`, `NOTICE` and `versions.json` from `dist/` into
   `content/.obsidian/plugins/brinedew-prose-checker/`.
3. With Obsidian running:
   `obsidian plugin:reload id=brinedew-prose-checker`, or
   `obsidian plugin:enable id=brinedew-prose-checker filter=community` the
   first time.
4. Keys come from the Windows user environment. Obsidian reads it at launch,
   so after setting `ECHO_API_KEY` or `OPENCODE_API_KEY`, quit Obsidian and
   start it again from the Start menu.

## Operational checks

Before release:

1. Run the plugin tests, including the BPC-001 source assertions.
2. Confirm plugin load produces zero remote traffic and does not read either
   API key (the console line `remote requests: 0`).
3. Trigger one manual agent check and verify catalog lookup precedes agent
   requests.
4. Trigger one Echo review and confirm each level's request body in the panel
   equals its settings preview with the text substituted, and that notes
   appear at all three levels.
