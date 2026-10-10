-- B-1065: the one global vote counter. Since 0123 (#602) each person's votes
-- count against their own allowance (icono_vote_person_day), and no code writes
-- this table. Online: dropping a table nothing reads or writes.
DROP TABLE IF EXISTS icono_vote_daily_budget;
