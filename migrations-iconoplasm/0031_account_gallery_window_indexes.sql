CREATE INDEX IF NOT EXISTS idx_icono_gene_discoveries_user_last_symbol
  ON icono_gene_discoveries(user_id, last_encountered_at DESC, gene_symbol ASC);
