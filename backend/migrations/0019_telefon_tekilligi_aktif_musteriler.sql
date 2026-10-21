-- Telefon tekilliği yalnızca aktif (silinmemiş) müşteriler için geçerli olur.
-- Eski index (0005) soft-delete ile silinmiş müşterileri de kapsıyordu; silinen
-- bir müşterinin telefonu başka bir müşteriye verilemiyor, ön kontroller
-- (deleted_at IS NULL) geçtiği halde INSERT unique violation veriyordu.
DROP INDEX IF EXISTS idx_customers_telefon_unique;

CREATE UNIQUE INDEX idx_customers_telefon_unique ON customers(telefon) WHERE telefon IS NOT NULL AND telefon <> '' AND deleted_at IS NULL;
