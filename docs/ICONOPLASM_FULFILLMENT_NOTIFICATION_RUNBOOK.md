# Iconoplasm fulfillment notifications

**ARCHITECTURE FENCE [IPD-006]**

## Product contract

A Discord DM and a Ready item in the Request inbox are receipts for one reader
order. An order is everything that a reader requests on one gene before the
Drain delivers any of it: "Request random" clicks, taps on style cards and
"Request all favorites", from one dialog or several, up to 100 requests. The
receipt waits until every request in the order that can still finish has
finished, however many Drain sessions drew it (B-1145). A request placed after
part of the order was delivered starts a new order, and so a second receipt.

- A reader who taps three styles, clicks "Request random" twice and presses
  "Request all favorites" on one gene gets one DM. Until 2026-10-27 each tap
  was its own order and its own DM: B-1163 had joined repeated random clicks,
  and B-1179 then made each style tap a separate request.
- The boundary is state, never a clock: the Drain claiming a request does not
  close its order, because a request stays `open` until it is delivered.

- An order of ten produces one DM with ten previews.
- An order of one hundred, drawn by the Drain over many sessions, still
  produces one DM: ten previews and a link to all one hundred on the gene page.
- The queue is fair, not first come first served (B-1146, migration 0135): the
  Drain claims in turn order, one request per waiting reader per round, in
  sessions of ten. A reader who orders one style while someone's hundred wait
  is drawn in the next session.
- A request whose exact source disappears is cancelled, leaves its order's
  group, and the receipt goes out with the rest.

Until 2026-10-21 receipts were grouped by the publication that finished them
(migration 0062). An order drawn across two sessions then came back as two
messages; the nightly copy of 2026-10-20 had 54 such orders.

- The Request inbox mirrors that receipt as one item with a bounded preview
  mosaic and one group-level read acknowledgement.
- A group is not sent until all of its expected notification rows exist. This
  prevents staggered workstation completion from fragmenting one action into
  several messages.

Discord documents multipart message attachments and a maximum of ten rich
embeds per message in the [Message resource](https://docs.discord.com/developers/resources/message#create-message).
Its [File Attachments FAQ](https://support.discord.com/hc/en-us/articles/25444343291031-File-Attachments-FAQ)
documents grouped image mosaics and the ordinary upload size limit. The code
therefore treats ten as a hard preview-attachment ceiling and also applies a
24 MiB aggregate Worker-memory budget.

## Durable ownership

Placing an order persists one `request_batch_id` and `request_batch_size` on
every request in it. A reader's new-candidate request first looks for that
reader's newest open order on the gene (`readersOpenOrderOnGene` in the
stateful runtime) and joins it. The INSERT itself refuses the join if any
request of that order has left `open`, and the request then places a new order
(`order-<uuid>`, or the dialog's `client_batch_id` for style taps). When a
request reaches `delivery_pending`, the D1 trigger in
`migrations-iconoplasm/0134_delivery_groups_by_order.sql` creates its
notification with `fulfillment_publication_id` set to the order id (on a
notification this column is the delivery-group key) and `fulfillment_group_size`
set to the order's size minus its cancelled requests. A second trigger shrinks
the group when a request in a waiting order is cancelled. The request row keeps
the Drain's `publication_id`, which is provenance and the replay check. Never
guess grouping from row order or completion time.

`workers/iconoplasm-request-notifications.js` selects only complete
order-recipient-and-gene group leaders, claims every outbox row in the
group, downloads no more than ten full
renditions, posts one nonce-enforced multipart DM, and applies the same delivery
result to every row. The per-file 10 MiB guard and 24 MiB aggregate guard bound
memory without reducing image quality. Reconciliation can mark each associated
request fulfilled only after that shared Discord receipt is confirmed.

Repeated fulfillment calls for the same publication reuse the same durable ID
and write nothing to a notification unless it failed and goes back to retry.
The sender must not deliver rows whose order group is incomplete.

## Failure rules

- Missing or invalid preview bytes fail the whole receipt visibly; do not mark
  some requests delivered while hiding a broken asset.
- Retriable storage, rate-limit, and channel-opening failures return the whole
  group to the existing bounded backoff.
- An ambiguous message POST is terminal `unknown` for the whole group because
  retrying can duplicate a user-visible DM.
- Do not replace grouping with a debounce timer. Timers merge unrelated actions
  and split slow actions.
- Do not generate a hundred-image contact sheet. It makes the previews
  unreadable and moves a delivery-boundary problem into image processing.

## Verification

Run the notification tests and the architecture-fence suite. The behavioral
coverage must prove two-gene partitioning, the ten-attachment ceiling after one
hundred completions, incomplete-batch deferral, group-wide retries, and
idempotent Discord nonces. After a deployment that changes the notification
schema, confirm the D1 migration applied before the Worker serves requests.
