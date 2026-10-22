# Caretaker manifestation authority

**Caretaker** and **manifestation** are product words. Do not use `curator`, a `latest`
manifestation, or a second command authority in code or UI. This page holds the rules a
caretaker feels.

Each gene's text lives in two plain tables in the main Iconoplasm D1, behind
`workers/iconoplasm/caretaker-texts.js`. `icono_gene_texts` holds the hash of the factory text and the Tags
the workstation writes (`PUT /api/iconoplasm/admin/genes/<SYMBOL>/text`), and which caretaker version the gene uses.
`icono_caretaker_text_versions` holds every look a caretaker kept (one working copy a day, sealed by the moments below). The factory's prose
lives on Bunny Storage under its hash (`texts/v1/<SYMBOL>/<sha256>.txt`,
`workers/lib/iconoplasm-factory-prose.js`, private to the Worker), written before its row; the row
keeps the hash, the length in characters (the caretaker admin shows it beside a version) and the
Tags (B-1156: the prose was 72 MiB of the 500 MB D1). The gene's text is the
chosen caretaker version unless it was withdrawn, and the factory text otherwise
(`readGeneText`); the workstation reads it back through `GET /api/iconoplasm/admin/texts`.
Claiming a gene, offers and tenure still run on the older caretaker commands until B-1065's B2b
moves them into the main database.

## The caretaker stewards the gene; the writer owns nothing

- No one owns a manifestation. The active caretaker of a gene may edit, show or hide, withdraw,
  restore any line on it, whoever wrote it. History names each version's writer.
- A former caretaker has no say over text they left, and a stranger has none: both are refused
  and nothing changes. Leaving always keeps what was written.
- Any active Brinedew account signed in through Discord may claim an available gene (server
  membership is no gate); an account holds one active or suspended gene and a gene has one
  caretaker. An administrator may offer a gene instead, and the account accepts or declines.
  Tenure runs `pending_acceptance` -> `active` or `ended`, and `active` <-> `suspended` ->
  `ended`; `ended` is final, a later tenure gets a new ID, and suspension is read-only.
- An active caretaker's supervote on a candidate image of their gene weighs 10, up or down. A new
  gene-page comment queues a Discord DM to the active caretaker; a Discord failure never rolls
  the comment back, and nobody is told of their own comment.

## History keeps one version per look; a save with Tags becomes the gene's text

- The editor saves at every pause into one working copy per caretaker per gene, overwritten in
  place (B-1160). The copy is sealed, and the next save starts a new version, when portraits are
  ordered from it (an order, a receipt or an in-site job names it), on the first save of a new day
  in the caretaker's own time zone (the panel sends `utc_offset_minutes`), on "Edit from here"
  from another version (`based_on_revision_id`), and when another caretaker takes over (each role
  has its own line). A save without Tags never overwrites a version with Tags. The order check is
  inside the overwrite's own UPDATE, so an order that lands mid-save still wins and "Made from
  version N" always names the exact words. Caretakers curate chip by chip (144 of 160 follow-up
  saves on 2026-10-20 changed only Tags), so a version per pause was noise: CTCF had 31, three of
  which made portraits. Migration 0142 folded the old versions the same way.
- Versions of a line are numbered 1, 2, 3 and so on. Writing after a withdrawal starts a new line.
- History shows one row per version: when, who, how many tags it added and removed against the
  row below, whether the text changed, and the portraits drawn from it. Selecting a row shows
  the tag changes as chips, the text diff, every portrait (opened in the gene page's viewer) and
  "Edit from here". The Original sits at the bottom.
- A save with Tags becomes the version new images are drawn from. A prose-only save is kept in
  History but changes nothing else.
- Withdrawing a line hides all its versions. The gene falls back to the newest tagged version
  still standing, then to the factory text. Restoring brings back the versions withdrawn with the
  line's newest one and makes the line's newest tagged version the gene's text again. Withdrawal
  is not a purge and does not touch backups. An erasure request arrives by email and the operator
  runs the account erase command in `docs/ICONOPLASM_OPERATIONS.md`; erasure and an
  administrator's "end and withdraw" withdraw that tenure's lines in the same batch.
- The factory line cannot be withdrawn and is the last fallback.
- Prose shows under the gene card only while its line is shown on the page (hidden by default)
  and renders as text under CSP, never as markup. The stable gene object is rebuilt only when the prose readers
  see changes; if that rebuild fails, the reply says `projection_pending` and the next publish
  catches up. Tags are never published; the caretaker's editor reads them through an
  authenticated route.

## Retries save once; the actor comes from the session

- A command ID is an idempotency key: the version ID is derived from the account and the command
  ID, so a retried autosave returns the version it already saved instead of saving twice.
- Two saves racing on one line both read the next number; the database's unique (line, version)
  key lets one in and answers the other `409 TEXT_VERSION_CONFLICT`. The panel keeps the text and
  the retry saves it again, so the later save wins.
- A user command takes its actor from the authenticated session; an actor ID in a body is ignored.
  A cross-site or non-JSON mutation is refused before parsing, and a body is at most 96 KiB. Only
  the gene's active caretaker may write; a past caretaker and a stranger get `404`, and a
  suspended tenure gets `409 ASSIGNMENT_NOT_ACTIVE`.
- `account_id` and `gene_id` are permanent. Symbols are aliases that can be renamed or merged, and
  tenure and history follow the gene ID. An erased author shows as a stable anonymous name.

## Where the seed text came from

- Each gene's system seed was imported once, on 2026-08-31, from the primary D1's old
  `icono_gene_essence.manifestation` column. That column had been written through a 4,000-character
  cut since June, so about 6,900 seeds are the first 4,000 characters of a longer text (B-977).
- The full original texts are in the workstation's `D:\Coding\Datasets\iconoplasm\prompts.db`
  (`manifestations` table), where its description batches still write; each finished text goes to
  the Website through the route below.
- Factory text changes only through the workstation's `PUT /api/iconoplasm/admin/texts`; a
  caretaker's prose changes only through their own save (B-831, B-949).

## The size limit

Prose is at most 10,000 code points and 16 KiB, checked the same way in the browser and on the
Website (`workers/lib/iconoplasm-manifestation-prose.js`). 99.9% of the original texts fit
(measured on `prompts.db`, B-977).

## The Tags helper only suggests

The editor's "Auto-extract tags from prose" and "Auto-correct prose from tags" buttons call
`POST /api/iconoplasm/caretaker/genes/<gene>/taggerize`
(`workers/iconoplasm/caretaker/taggerizer.js`). The route answers with a suggestion and
saves nothing; the editor fills it in, marks it unsaved and waits for the caretaker's
Save, which is the ordinary save with Tags. For prose, the
editor also sends the Tags last saved with it; the model is told only what changed and
returns find/replace edits, which the route applies, so text no edit touches stays
exactly as the caretaker wrote it. Only the gene's
active caretaker may call it. It runs Cloudflare Workers AI (`AI` binding, model id in
the module header) on the free plan's 10,000 Neurons a day, so each caretaker gets 30
calls per UTC day (`icono_taggerizer_daily_calls`, one upsert per call) and
`ICONOPLASM_TAGGERIZER_DISABLED = "1"` switches the route off and hides the buttons.

## Images use exact sources, and releases are proven in a browser

A caretaker can go from a candidate image to the saved version that made it. Each candidate on
the gene page shows "Made from version N", which opens that version in History, including after
later edits. The link comes from the stored source of the image and appears only in the
caretaker's own dossier (`candidate_sources`), never in the public gene object. An image from
before sources were recorded shows no link, and nothing is guessed for it.

An image request captures its source at acceptance: the gene's text ID (`readGeneText`), its
SHA-256 and length, recipe and model (`workers/lib/iconoplasm-generation-provenance.js`). A later
save, departure or withdrawal does not alter it, and a source that can no longer be read fails
closed; no newest-row fallback exists. Deployment is not proof: fresh logged-in browser tests cover edit, rollback, a handover (hide and restore the
predecessor's text), leaving, an exact image source and a conflict retry, on two genes.
