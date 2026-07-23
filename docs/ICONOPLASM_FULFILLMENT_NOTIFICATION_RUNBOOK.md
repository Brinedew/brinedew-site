# Iconoplasm fulfillment notifications

**ARCHITECTURE FENCE [IPD-006]**

## Product contract

A Discord DM is a receipt for one user action, not the archive of every image
that action generated. Delivery is grouped by requester, durable batch ID,
canonical gene, and request kind.

- Ten candidates for one gene produce one DM with ten previews.
- Ten candidates split across two genes produce two DMs, one per gene.
- One hundred candidates for one gene produce one DM with ten previews and a
  link to all one hundred on the gene page.
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

The browser creates one `client_batch_id` per queue action. The API validates
it and persists it as `request_batch_id` on every generated request, together
with `request_batch_size`. The D1 delivery-pending trigger copies both values
into the notification outbox. Historical requests are deliberately migrated to
unique `legacy-request:{id}` batches; never guess old grouping from row order or
completion time.

`workers/iconoplasm-request-notifications.js` selects only complete group
leaders, claims every outbox row in the group, downloads no more than ten
medium renditions, posts one nonce-enforced multipart DM, and applies the same
delivery result to every row. Reconciliation can mark each associated request
fulfilled only after that shared Discord receipt is confirmed.

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
