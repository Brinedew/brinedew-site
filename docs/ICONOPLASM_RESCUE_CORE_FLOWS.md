# Core-flow rescue — B-738

## Design from the user's job

Keep three surfaces with one durable command owner. The Website owns account,
request, caretaker and vote state. The workstation claims exact work, renders it
and publishes one result. The website and extension read the same immutable
published cards. Background work exists only to advance accepted work; browsing
must not repair publication or create operations traffic.

Use the existing route registry, immutable source contract, component library,
and shared image delivery policy. Additional wrappers, copied validation maps,
parallel auth transports, and components without live consumers are removable.
Code length is an outcome metric, not evidence of correctness or AI authorship.

## Critical user journeys

| Journey                              | Evidence and acceptance                                                                           |
| ------------------------------------ | ------------------------------------------------------------------------------------------------- |
| Guest opens Archive                  | Live four starters and locally saved visits render; no anonymous auth probe.                      |
| Open a gene from Archive             | Live INS opens a dossier in a new tab.                                                            |
| Return to personal Archive           | Preserve discoveries and scrolling; signed-in reload remains personal.                            |
| Search/browse genes                  | Maintain exact-symbol routes and stable archive ranges.                                           |
| Inspect portrait and candidates      | Live INS renders Bunny portraits; lazy candidates load on demand.                                 |
| Request print copy                   | Preserve exact published blot identity and reveal control.                                        |
| Sign in with Discord                 | Existing browser recovered signed-in access; do not expose credentials.                           |
| Reload after signing in              | Verify fresh pages and shared subdomain identity after deployment.                                |
| Temporary session failure            | Show connection interruption and retry; clear presence only on authoritative sign-out.            |
| Explicit sign-out                    | Invalidate server session and shared marker; do not report success on failure.                    |
| Request a free candidate             | Reproduced rejection on INS; imported Tags must remain usable with exact input binding.           |
| Claim and generate queued work       | Claim once, pin exact source, preserve through retry/restart and canonical changes.               |
| Receive generated candidate          | Publication and inbox share durable publication ID; no invented completion.                       |
| Generate/edit through Image API      | Keep configured provider/model and exact source; no paid test call without need.                  |
| Favorite an emulsion                 | Retain favorites and user-selected styles across requests.                                        |
| Vote on a candidate                  | Keep durable signed vote and single published winner.                                             |
| Caretaker edits prose/tags           | Category rows with inline add/edit/remove and private autosave; no syntax prerequisite.           |
| Caretaker selects history/visibility | Saving appends a revision; explicit selection changes canon.                                      |
| Explore Clans                        | Live personal clan progress and gene links render.                                                |
| Build a Studio diagram               | Live five-gene/four-connection document opens with editing and export controls.                   |
| Extension HTML/PDF hover             | Preserve installed-client contracts; store propagation requires separate installed-browser proof. |
| Agent retrieves a gene image         | Stable `/blot/{SYMBOL}.webp` and bounded resolver share published identity.                       |

Entries marked preserve/maintain are acceptance obligations, not claims that an
end-to-end live test has passed. The issue records final verification and gaps.

## Changes

- Separate exact saved input from historical knowledge of the tag author. Imported
  tags keep unknown history; new generation still binds verified content hashes.
- Generation exchanges its active lease for exactly one freshly validated source;
  rendering no longer requires a full-catalog replica bootstrap. The private
  material endpoint verifies ownership, version, expiry, current source lifecycle,
  immutable selection, and every byte hash before returning process-only material.
- One workstation source model validates both claims and completion receipts;
  one Website normalizer validates both newly selected and queued source fields.
- One direct session transport replaces hidden auth iframe/retry machinery.
  Unavailable verification is distinct from Guest. Guest startup remains static.
- Remove the unused generic account-sidebar implementation and its dead guards.
- The owner-approved September 5 follow-up replaces the dropdown with category
  rows, including empty and custom categories. Enter accepts an inline tag and
  keeps the add input focused; Escape cancels; clicking tag text edits it. The
  original structured fields and surviving flat-tag order travel together through
  encrypted persistence. At least one tag is required by the generation contract.
- Autosave keeps the open editor attached while history/settings refresh. Retry
  resumes the failed save stage with the same command ID instead of creating a
  duplicate revision; failures preserve the local draft and wait for explicit Retry.
- Signed caretaker supervotes use the approved distressed red raster seal across
  the label grid. The overlay changes no card dimensions and intercepts no clicks;
  normal FIT/MISFIT votes and their long-press/keyboard transfer controls remain.

## Regional delivery decision

Bunny served the observed live INS portrait/candidates on the current connection.
No country check is needed: the existing policy already chooses based on actual
delivery. Keep bounded first-party recovery for failures; one working apartment
connection cannot establish worldwide availability. No provider or billing change
is needed for this rescue.

## Verification boundaries

Focused source/lease/claim tests, workstation contract/bridge/executor tests,
component interaction tests, full Website tests/check/build, and Wrangler dry-run
cover different boundaries. A local browser fixture verifies menu interaction and
geometry, not real account mutation. A successful enqueue is not image generation.
Production deployment is not a store-installed extension update.

Evidence belongs in `artifacts/rescue-core-flows/`; B-738 records release results.
