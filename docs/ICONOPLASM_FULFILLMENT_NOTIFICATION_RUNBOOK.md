# Iconoplasm fulfillment notifications

**ARCHITECTURE FENCE [IPD-006]**

## Product contract

A Discord DM and a Ready item in the Request inbox are receipts for a completed
generation publication, not for an individual button press. Both surfaces are
grouped by durable publication ID, requester, and canonical gene after the
images have been generated. Separate publications for the same gene remain
separate receipts.

- Ten candidates for one gene produce one DM with ten previews.
- Ten candidates split across two genes produce two DMs, one per gene.
- One hundred candidates for one gene produce one DM with ten previews and a
  link to all one hundred on the gene page.
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

Drain already owns a durable `publication_id` tied one-to-one to a completed
generation session. The fulfillment API requires that ID, persists it with the
recipient-and-gene group size while moving requests to `delivery_pending`, and
the D1 trigger copies both values into the notification outbox. Request-time
`request_batch_id` remains provenance only. Historical rows are deliberately
migrated to unique `legacy-request:{id}` delivery groups; never guess old
grouping from row order or completion time.

`workers/iconoplasm-request-notifications.js` selects only complete
publication-recipient-and-gene group leaders, claims every outbox row in the
group, downloads no more than ten full
renditions, posts one nonce-enforced multipart DM, and applies the same delivery
result to every row. The per-file 10 MiB guard and 24 MiB aggregate guard bound
memory without reducing image quality. Reconciliation can mark each associated
request fulfilled only after that shared Discord receipt is confirmed.

Repeated fulfillment calls for the same publication reuse the same durable ID.
The sender must not deliver rows whose publication group is incomplete.

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
idempotent Discord nonces. After deployment, confirm the D1 migration applied
before the Worker started serving requests.
