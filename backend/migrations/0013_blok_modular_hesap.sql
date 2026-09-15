-- "Sınırsız" (max_dakika = NULL) son blok kaldırıldı. Bunun yerine, tanımlı
-- en yüksek blok aralığı (son bloğun max_dakika'sı) bir "tur" kabul edilir;
-- bu turdan uzun kalan oturumlarda ücret modüler (döngüsel) hesaplanır:
-- örn. bloklar 0-30=50, 31-60=90 ise (tur=60 dk), 165 dk kalan bir müşteri
-- 2 tam tur (2*90) + kalan 45 dk'nın düştüğü blok (90) = 270 öder.
--
-- Bu nedenle her blokta (son blok dahil) üst sınır artık zorunludur.

-- Daha önce test amacıyla girilmiş olabilecek üst sınırsız (NULL) satırları,
-- geçmiş kaydı bozmadan geçerli hale getirir (tek dakikalık dejenere blok).
UPDATE pricing_tiers SET max_dakika = min_dakika WHERE max_dakika IS NULL;

ALTER TABLE pricing_tiers
    ALTER COLUMN max_dakika SET NOT NULL;

ALTER TABLE pricing_tiers
    DROP CONSTRAINT pricing_tiers_check;

ALTER TABLE pricing_tiers
    ADD CONSTRAINT pricing_tiers_max_dakika_check CHECK (max_dakika >= min_dakika);
