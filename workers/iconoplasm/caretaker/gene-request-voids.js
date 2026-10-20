// B-1137: a gene request names the two roles as they were when it was sent and
// stays pending only while both are still active. Every batch that changes a
// role ends with these statements, so a request never outlives the roles it
// names. Each statement checks the roles itself, after the change, so a change
// that did not apply voids nothing.
//
// When the caretaker a request was sent to leaves the gene and nobody holds it
// any more, each person who asked for it gets a "freed" message: the waiting
// list costs nothing extra.

const OPEN = `('pending_acceptance', 'active', 'suspended')`

// `role` is the role that changed ({ caretaker_assignment_id, gene_symbol }),
// or null for an account that had none (a first claim). `accountId` is its
// holder, whose own pending request is voided once its role is no longer the
// one the request named.
export function geneRequestVoidStatements(db, { role, accountId, now, reason }) {
  const statements = []
  if (role?.caretaker_assignment_id && role?.gene_symbol) {
    statements.push(
      db
        .prepare(
          `INSERT INTO icono_caretaker_gene_request_notifications
             (notification_key, request_id, kind, recipient_account_id, gene_symbol)
           SELECT request_id || ':freed', request_id, 'freed', requester_account_id, gene_symbol
             FROM icono_caretaker_gene_requests
            WHERE gene_symbol = ?1 AND status = 'pending' AND holder_assignment_id = ?2
              AND expires_at > ?3
              AND EXISTS (SELECT 1 FROM icono_caretaker_assignments
                           WHERE caretaker_assignment_id = ?2 AND status = 'ended')
              AND NOT EXISTS (SELECT 1 FROM icono_caretaker_assignments
                               WHERE gene_symbol = ?1 AND status IN ${OPEN})
           ON CONFLICT (notification_key) DO NOTHING`,
        )
        .bind(role.gene_symbol, role.caretaker_assignment_id, now),
      db
        .prepare(
          `UPDATE icono_caretaker_gene_requests
              SET status = 'void', void_reason = ?4, decided_at = ?3
            WHERE gene_symbol = ?1 AND status = 'pending' AND holder_assignment_id = ?2
              AND NOT EXISTS (SELECT 1 FROM icono_caretaker_assignments
                               WHERE caretaker_assignment_id = ?2 AND status = 'active')`,
        )
        .bind(role.gene_symbol, role.caretaker_assignment_id, now, reason),
    )
  }
  if (accountId) {
    statements.push(
      db
        .prepare(
          `UPDATE icono_caretaker_gene_requests
              SET status = 'void', void_reason = ?3, decided_at = ?2
            WHERE requester_account_id = ?1 AND status = 'pending'
              AND (COALESCE(requester_assignment_id, '') <> COALESCE(
                     (SELECT caretaker_assignment_id FROM icono_caretaker_assignments
                       WHERE account_id = ?1 AND status = 'active' LIMIT 1), '')
                   OR EXISTS (SELECT 1 FROM icono_caretaker_assignments
                               WHERE account_id = ?1
                                 AND status IN ('pending_acceptance', 'suspended')))`,
        )
        .bind(accountId, now, reason),
    )
  }
  return statements
}
