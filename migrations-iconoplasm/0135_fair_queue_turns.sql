-- Fair turns for the portrait queue (B-1146). Since B-1145 one order can hold
-- 100 styles, and first-come-first-served made a reader who ordered one style
-- wait behind all 100 of someone else's. A request now takes a turn when it is
-- queued: a reader with nothing waiting starts just behind the queue's head, a
-- reader with requests waiting continues after their own last turn, and the
-- Drain claims in turn order. Every waiting reader gets one portrait per round.
--
-- Turn 0 goes first: diagnostic matrices insert without a turn, and so does
-- anything queued by an older Worker during the deploy.
--
-- Both indexes hold only waiting rows, so each costs a request one entry while
-- it waits and nothing after.

ALTER TABLE icono_generation_requests ADD COLUMN queue_turn INTEGER NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_icono_generation_requests_waiting_turn
  ON icono_generation_requests (queue_turn, id)
  WHERE status = 'open';

CREATE INDEX IF NOT EXISTS idx_icono_generation_requests_reader_waiting_turn
  ON icono_generation_requests (requester_user_id, queue_turn)
  WHERE status = 'open';

-- Requests already waiting keep their first-come order.
UPDATE icono_generation_requests
SET queue_turn = id
WHERE status = 'open' AND request_origin <> 'diagnostic_matrix';
