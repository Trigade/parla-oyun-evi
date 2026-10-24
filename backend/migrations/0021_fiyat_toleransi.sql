-- Blok sınırı toleransı (dakika): fiyat politikası versiyonuna aittir.
-- Numara 0021: geliştirici DB'lerinde repoda olmayan bir 0018_fiyat_toleransi.sql
-- bu kolonu (DEFAULT 0) zaten eklemiş olabilir; müşteri sunucularında yoktur.
-- Bu yüzden IF NOT EXISTS kullanılır, ardından varsayılan ve mevcut değerler 10 yapılır.
-- Aralık (0-30) doğrulaması backend'de yapılır, CHECK eklenmez (çakışma riski).
ALTER TABLE pricing_tier_versions
    ADD COLUMN IF NOT EXISTS yuvarlama_tolerans_dakika INTEGER NOT NULL DEFAULT 10;
ALTER TABLE pricing_tier_versions
    ALTER COLUMN yuvarlama_tolerans_dakika SET DEFAULT 10;
UPDATE pricing_tier_versions SET yuvarlama_tolerans_dakika = 10 WHERE yuvarlama_tolerans_dakika = 0;
