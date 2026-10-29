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

## When the database is down

Gene pages are static. The asset layer holds one document per published gene,
so a gene page costs no Worker request and reads no D1, and it carries its own
canonical URL. A gene's card is drawn from its stable object on the CDN, which
the page reads directly; the Worker serves none of it. So when D1 is down or out
of its daily allowance, readers still get every gene page and card. Votes,
generation, caretaker saves and the other writes fail until D1 is back.
