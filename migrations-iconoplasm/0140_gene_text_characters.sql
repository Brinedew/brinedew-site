-- B-1156: the factory's prose is on Bunny Storage, and the next migration drops
-- the D1 copy. The caretaker admin still shows the Original's length beside a
-- caretaker version (that is how the versions cut at 4,000 characters were
-- found, B-1097), so the row keeps the count, filled here from the copy while it
-- is still in D1 and kept by the factory writer from now on.
--
-- Online: adding a nullable column changes nothing for the installed Worker,
-- which never names it. The fill writes each of the ~20,155 rows once; no index
-- covers the column.
ALTER TABLE icono_gene_texts ADD COLUMN text_characters INTEGER;
UPDATE icono_gene_texts SET text_characters = length(text);
