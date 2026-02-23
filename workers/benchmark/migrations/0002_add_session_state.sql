-- Add game state column to benchmark_sessions.
-- Stores JSON blob: { targetUniprot, guesses, hintCredits, revealedHints, won, clues }
ALTER TABLE benchmark_sessions ADD COLUMN state TEXT;
