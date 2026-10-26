-- İşlem kaydı: hangi işlemin yapıldığı / yapılamadığı ve nedeni.
-- Yalnızca geliştirici okur (deploy/log-goster.ps1); uygulamada ve API'de görünmez.
-- user_id'ye FK konmaz: kullanıcı silinse de kayıt kalsın.
-- detay: müşteri/oturum/paket işlemlerinin iş ayrıntısı (kalan dakika önce/sonra vb.); şifre ve tam TC/telefon içermez.
CREATE TABLE islem_log (
    id            BIGSERIAL PRIMARY KEY,
    zaman         TIMESTAMPTZ NOT NULL DEFAULT now(),
    user_id       BIGINT NULL,
    kullanici_adi TEXT NULL,
    yontem        TEXT NOT NULL,
    yol           TEXT NOT NULL,
    gercek_yol    TEXT NOT NULL,
    durum_kodu    INT NOT NULL,
    sonuc         TEXT NOT NULL CHECK (sonuc IN ('yapildi', 'reddedildi', 'hata')),
    mesaj         TEXT NULL,
    ip            TEXT NULL,
    sure_ms       INT NOT NULL DEFAULT 0,
    detay         JSONB NULL
);
CREATE INDEX idx_islem_log_zaman ON islem_log (zaman);
