# Iconoplasm product operating model

This is the product contract for the Iconoplasm website, extension, authoring
workstation, and public data plane. Read it before changing persistence,
freshness, caching, discovery, canon, or traffic behavior.

## Promise and audience

Iconoplasm makes molecular cell biology easier to remember by turning every
human gene/protein into a persistent character in one shared mnemonic world.

The primary users are life-science students and preclinical researchers reading
papers, databases, course material, and arbitrary webpages. They benefit because
people remember a striking character, story, faction, and social relationship
more readily than an isolated symbol and paragraph of molecular facts. The
extreme-mnemonic approach is inspired by Scott Alexander's writing about
memorable, interconnected mental models.

Iconoplasm is not a generic gene database. The database supports the memory
experience; it is not the product.

## User loop

1. The extension recognizes a gene/protein name in what the reader is already
   reading.
2. Hover shows the gene's stable portrait and identity without breaking reading
   flow.
3. A deliberate hover of about 900 ms becomes a discovery.
4. Click opens the gene dossier for the full character, biological traits,
   candidate portraits, requests, comments, and voting.
5. The homepage becomes the reader's personal discovery shelf. The optional
   shared overlay answers what the community has uncovered.
6. Votes and authoring produce a new canonical portrait. Publication propagates
   one coherent version to the site, extension, archive, and outside clients.

The `/genes` archive is a stable reference/crawl surface, not a replacement for
the personal shelf. `/clans` shows personal progress through the worldbuilding
factions.

## What each surface is for

| Surface              | User job                                                | State owner                                             |
| -------------------- | ------------------------------------------------------- | ------------------------------------------------------- |
| Extension hover      | Recognize a gene without leaving the page               | Published snapshot + bounded client cache               |
| Gene dossier         | Understand, compare, vote, comment, request, and author | Current public card plus authenticated personal actions |
| Homepage             | Resume the reader's own memory trail                    | Personal discovery shelf; optional shared overlay       |
| `/genes`             | Browse/search a complete stable reference               | Published release/archive                               |
| `/clans`             | See personal progress through the mnemonic world        | Personal discoveries grouped by clan                    |
| Local workstation    | Create and curate portraits protein-first               | Local authoring/control plane                           |
| Public APIs/releases | Let other clients consume the same canon                | Publish/distribution plane                              |

## Discovery contract

- Extension: a visible hover held for about 900 ms is deliberate enough to
  count. Signed-out discoveries remain in extension-local storage and merge
  after login.
- Website: opening a gene dossier is deliberate enough to count. Signed-out
  dossier visits remain in a compact browser-local shelf that can retain the
  full 19,023-gene catalog. They cost no Worker request. Each authenticated
  page session merges at most 200 pending symbols; only that successful batch
  is cleared locally, and the remainder stays for later sessions.
- The INS/RHO/PRL starter trio is onboarding, not evidence that the guest
  actually discovered those genes. A starter joins the pending login merge only
  if the guest opens its dossier.
- Personal discovery feedback may be immediate. Shared discovery popularity is
  an hourly published overlay and must never be repaired by a reader request.

## Change and freshness contract

| Change                       | Current viewer                                           | Other open viewers                           | Later sessions/clients                                                                                  |
| ---------------------------- | -------------------------------------------------------- | -------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| Personal discovery           | Immediate shelf feedback                                 | No effect                                    | Persists for that person after local or signed-in storage succeeds                                      |
| Vote                         | Immediate optimistic feedback, then authoritative result | Existing page remains coherent               | Gene page converges in seconds                                                                          |
| Canon selection              | Do not replace a portrait underneath active reading      | Existing card remains on its loaded snapshot | Site converges in seconds; extension/archive at the next published snapshot, normally within 15 minutes |
| Shared discovery count       | No interrupt                                             | No mutation                                  | Next hourly publication                                                                                 |
| New candidate/request result | Relevant account UI may refresh                          | Unrelated readers do not poll                | Account inbox polls only while a request is open                                                        |

The invariant is identity coherence: a gene must not become a different character
mid-hover or mid-read. Freshness is useful only at a boundary a person can
understand.

## Authority and data flow

1. **Authoring plane:** the local Iconoplasm repo and dataset own Essence,
   Manifestation, Vision, generation, candidate assets, and operator workflow.
2. **Publish plane:** one canonical selection engine owns eligibility,
   vote/tie-break behavior, manual overrides, audit history, and live canon
   pointers.
3. **Distribution plane:** the Website repo owns public cards, APIs, immutable
   assets, releases, change feeds, extension packaging, and reader interaction.

Readers consume publisher-owned immutable card/portrait metadata. A public read
must never scan D1 or mutate shared state to repair publication.

## Cost and resilience rules

- Model costs from user actions and scheduled ownership, not historical traffic
  from a different architecture.
- Anonymous startup is static-first.
- Public reads scale with sessions and published artifacts, not catalog-wide
  relational scans.
- Reads do not write.
- Poll only while a person is waiting for something that can change.
- Every background job has one declared owner and a bounded unit of work.
- Paid capacity is not a substitute for removing accidental work.

The executable envelopes and exact free-plan ceilings live in
`docs/ICONOPLASM_FIRST_PRINCIPLES_CAPACITY_MODEL.md`. Operational fences live in
`docs/ICONOPLASM_CAPACITY_AND_BACKGROUND_WORK_RUNBOOK.md`.

## Known anti-patterns

Treat these as hardening defects, not acceptable shortcuts:

- duplicated cron ownership;
- reader-triggered repair or cache writes;
- whole-list KV read/modify/write;
- per-request whole-catalog scans;
- anonymous requests that cannot persist;
- unbounded server-side guest buffers, queues, retries, polling, or merge loops;
- UI that exposes database/library shape instead of the reader's memory trail;
- separate reconstructions of canon that can disagree.

If code violates one of these rules, record the exact behavior and permanent
fix in Linear. Do not hide it behind a TTL, retry, paid plan, or “cheap enough”
claim.

## Project memory

- Linear project: `Iconoplasm (Gene Mnemonics Extension)`
- Current implementation work belongs in Linear issues with acceptance criteria
  stated as user behavior.
- Historical incident documents explain past failures but do not override this
  product contract.
- Completed issues must be closed; rejected scopes must be canceled and titled
  as such. “Today's work” is reserved for work actually being executed now.
