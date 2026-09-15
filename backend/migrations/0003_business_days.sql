-- İş günü (gün başı / gün sonu) akışı: sabah "Gün Başı" ile açılır, akşam
-- tüm açık oturumlar kapatıldıktan sonra "Gün Sonu" ile kapatılır.
CREATE TABLE business_days (
    id              BIGSERIAL PRIMARY KEY,
    acilis_zamani   TIMESTAMPTZ NOT NULL DEFAULT now(),
    acilis_user_id  BIGINT REFERENCES users(id),
    kapanis_zamani  TIMESTAMPTZ,
    kapanis_user_id BIGINT REFERENCES users(id),
    durum           TEXT NOT NULL DEFAULT 'acik' CHECK (durum IN ('acik', 'kapali'))
);

CREATE INDEX idx_business_days_durum ON business_days(durum);
