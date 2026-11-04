-- TC kimlik no artık isteğe bağlı: boş değer NULL tutulur. UNIQUE kısıtı kalır
-- (Postgres birden çok NULL'a izin verir).
ALTER TABLE customers ALTER COLUMN tc_kimlik_no DROP NOT NULL;
UPDATE customers SET tc_kimlik_no = NULL WHERE tc_kimlik_no = '';
