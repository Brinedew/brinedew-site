# Gene-page images and account availability

The published card comes first, followed immediately by **Other candidate
images**. Caretaker tools and suggestions follow the images. This replaces the
older suggestions-first layout: comparing images should not require finding a
gallery below an unrelated form.

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

The existing exact-card publication boundary protects canonical image identity.
This change preserves that boundary and adds no alternative image authority,
database, cached candidate ledger, or provider fallback.

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

## Incident and verification

On September 5, 2026 at approximately 17:48 UTC, the live TRIM28 document and
detail response selected the published-card-only state. Account analytics
reported 5,995,756 D1 rows read, 54,091 rows written, and 15,340 Worker requests.
The read allowance was exhausted. The earlier consumption-prevention release
had stopped before migration at the headroom check. A frontend repair is not
evidence of database recovery; do not bypass that check to publish it.

Focused tests cover service versus session failure, guest/valid sessions,
unavailable versus empty galleries, explicit retries, and contextual sign-in.
Browser verification uses the affected browser with local changed assets and
clearly synthetic API responses for recovery, empty, and expired-session cases.
Those fixtures prove rendering and interaction, not restoration of production
candidate data. Fresh unmodified production checks remain required after the
normal deployment succeeds.
