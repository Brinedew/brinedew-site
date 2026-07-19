-- A 23-request Drain publication exhausted the Worker's 50 external
-- subrequest ceiling while delivering portrait DMs. Those attempts did not
-- reach Discord: the Worker refused the next fetch before it was sent. Requeue
-- only rows carrying that exact infrastructure error, including the one row
-- conservatively recorded as unknown by the generic POST catch.
UPDATE icono_request_notifications
SET discord_status = 'retry',
    discord_next_attempt_at = CURRENT_TIMESTAMP,
    discord_error = 'Requeued after bounded Discord delivery slicing was deployed.'
WHERE discord_message_id = ''
  AND discord_status IN ('retry', 'unknown')
  AND discord_error LIKE '%Too many subrequests by single Worker invocation%';
