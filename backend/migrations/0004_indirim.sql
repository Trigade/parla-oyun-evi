-- Ödeme kapatılırken uygulanabilecek indirim (kuruş cinsinden, tutar veya
-- yüzde olarak girilip kuruşa çevrilir). Oturumun orijinal/tahsil tutarları
-- ile birlikte saklanır ki raporlarda ayrı bir kalem olarak görünebilsin.
ALTER TABLE sessions ADD COLUMN indirim_kurus BIGINT NOT NULL DEFAULT 0;
