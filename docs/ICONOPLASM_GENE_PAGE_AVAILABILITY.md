# Gene-page images and account availability

The published card comes first, followed immediately by **Other candidate
images**. Caretaker tools and suggestions follow the images: comparing images
should not require finding a gallery below an unrelated form.

## Unknown is not empty

The exact published card can survive an outage of the live database. That
preserves the selected portrait and its scientific/character identity; it does
not prove that there are no other candidates. `detail_availability.live_candidates`
is authoritative about this distinction. Both the server renderer and client
renderer show an unavailable state when it is `temporarily_unavailable`.

An available collection with no alternative images says "No other candidate
images yet." An unavailable collection keeps its heading and an explicit retry.
Missing image references must not be mistaken for an empty collection either.
One click issues one fresh per-gene detail request. There is no polling, corpus
repair, generation, or publication on this path. A failed retry retains the
published card; a successful retry replaces only the candidate collection and
preserves open editors and unsent form text. The displayed published card stays
pinned for the open page, and candidate `is_current` markers use that displayed
portrait identity. A response for a page the reader has left cannot update the
new page.

The gene's stable object protects canonical image identity. Candidate
availability adds no alternative image authority, database, cached candidate
ledger, or provider fallback.

## Account failures belong to their action

Viewing candidate images does not require a login. Caretaker tools use the
signed-in account to edit the character and manage its versions.

`workers/iconoplasm/session-user.js` distinguishes an absent/expired session
from an unavailable session service. The latter produces 503 with a bounded
`Retry-After`, does not clear cookies, and cannot authorize any mutation. The
caretaker HTTP boundary and the general Iconoplasm boundary preserve this
distinction. Missing caretaker database bindings are service failures, too.

The caretaker panel translates an actual expired session into a contextual
sign-in link; service failures show a small tools-specific message and retry.
Raw internal authentication/error codes never serve as its initial UI text.

## Verification

The published-card-only state appears when D1 is unavailable, for example when
its daily read allowance is exhausted. A frontend repair is not evidence of
database recovery; do not bypass a release headroom check to publish one.

Focused tests cover service versus session failure, guest/valid sessions,
unavailable versus empty galleries, explicit retries, and contextual sign-in.
Browser verification uses the affected browser with local changed assets and
clearly synthetic API responses for recovery, empty, and expired-session cases.
Those fixtures prove rendering and interaction, not restoration of production
candidate data. Fresh unmodified production checks remain required after the
normal deployment succeeds.

## Maintenance reader recovery

While the stateful Worker carries `ICONOPLASM_SCHEMA_TRANSITION=1`, a
`data_maintenance` release may set
`ICONOPLASM_SCHEMA_TRANSITION_MODE=reader-recovery`
(`workers/b742-quarantine-gene-shell-inside-the-only-allowed-stateful-worker-do-not-duplicate.js`).
That mode permits only GET/HEAD reads for `/gene/:symbol`,
`/api/iconoplasm/site/genes/:symbol`, and exact content-addressed portrait
renditions. Gene routes read the one stable gene object
`genes/v3/<SYMBOL>.json`; they do not resolve live D1 rows.
Portrait bytes use the existing storage adapter so first-party delivery remains
available when Bunny is unreachable from the reader's network. Reader recovery
performs no image selection, publication repair or D1 lookup.

A gene with no stable object is a 404. An unreadable or invalid stable object
is a 503. Candidate images, caretaker identity, voting, generation, authoring, and other mutation routes remain behind the
schema-transition response. The page is explicitly noindex during maintenance,
and the rendered card marks live candidates and caretaker data as temporarily
unavailable. Reader recovery restores reading, not full service: full service
requires the admitted migration, normal stateful Worker activation,
background-capacity release, and fresh live acceptance.
