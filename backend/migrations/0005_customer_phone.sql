-- Müşteri kaydına telefon (zorunlu) ve veli telefonu (opsiyonel) eklenir.
-- Telefon numarası, TC kimlik no gibi kayıt tekilliği için kullanılır.
ALTER TABLE customers ADD COLUMN telefon TEXT;
ALTER TABLE customers ADD COLUMN veli_telefon TEXT;

CREATE UNIQUE INDEX idx_customers_telefon_unique ON customers(telefon) WHERE telefon IS NOT NULL AND telefon <> '';
