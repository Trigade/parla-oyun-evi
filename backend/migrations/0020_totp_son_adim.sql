-- TOTP kodunun tekrar kullanılmasını (replay) engeller: kullanıcının başarıyla
-- doğruladığı son TOTP zaman adımı saklanır, yalnızca bundan büyük adım kabul
-- edilir (bkz. handlers/auth.go). TOTP sıfırlanınca NULL'a çekilir.
ALTER TABLE users
    ADD COLUMN totp_son_adim BIGINT;
