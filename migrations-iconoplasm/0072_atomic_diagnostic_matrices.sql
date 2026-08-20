-- A diagnostic matrix is one experiment, not a stream of independently
-- visible queue writes. Remove interrupted legacy builders; the runtime now
-- creates the run, every request, every cell, and the ready gate in one D1
-- batch transaction.

DELETE FROM icono_diagnostic_matrix_cells
WHERE run_id IN (
  SELECT id FROM icono_diagnostic_matrix_runs WHERE queue_state = 'building'
);

DELETE FROM icono_generation_requests
WHERE diagnostic_run_id IN (
  SELECT id FROM icono_diagnostic_matrix_runs WHERE queue_state = 'building'
);

DELETE FROM icono_diagnostic_matrix_runs
WHERE queue_state = 'building';
