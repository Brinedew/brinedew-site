-- B-1065: icono_vote_events fed the workstation's incremental vote mirror, which
-- nothing reads any more. #592 (0ea85426, deployed 2026-10-10) stopped every vote
-- writing a row into it and removed its two admin readers; account erasure was
-- its last statement, and it goes in the same release as this drop. 1,839 rows
-- on the 2026-10-06 nightly copy.
DROP TABLE IF EXISTS icono_vote_events;
