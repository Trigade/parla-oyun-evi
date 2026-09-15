-- Başlangıç şeması: müşteri, oturum, fiyatlandırma kuralı, kullanıcı, audit log
-- Not: Tüm parasal tutarlar kuruş cinsinden BIGINT olarak tutulur (FLOAT kullanılmaz).

CREATE TABLE users (
    id            BIGSERIAL PRIMARY KEY,
    username      TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    role          TEXT NOT NULL CHECK (role IN ('kasiyer', 'yonetici')),
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE customers (
    id            BIGSERIAL PRIMARY KEY,
    tc_kimlik_no  TEXT NOT NULL UNIQUE,
    ad            TEXT NOT NULL,
    soyad         TEXT NOT NULL,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Fiyatlandırma kuralı versiyonlanır: bir oturum kapanırken o anda
-- aktif olan (effective_from en yakın geçmişteki) kural kullanılır ve
-- sonuç oturuma donuk (immutable) olarak yazılır. Geçmiş kural
-- değişse bile kapanmış oturumların tutarı bundan etkilenmez.
CREATE TABLE pricing_rules (
    id                BIGSERIAL PRIMARY KEY,
    kurus_per_dakika  BIGINT NOT NULL CHECK (kurus_per_dakika >= 0),
    effective_from    TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_by        BIGINT REFERENCES users(id)
);

CREATE TABLE sessions (
    id                  BIGSERIAL PRIMARY KEY,
    customer_id         BIGINT NOT NULL REFERENCES customers(id),
    giris_zamani         TIMESTAMPTZ NOT NULL DEFAULT now(),
    cikis_zamani         TIMESTAMPTZ,
    durum                TEXT NOT NULL DEFAULT 'acik' CHECK (durum IN ('acik', 'kapali', 'iptal')),

    pricing_rule_id      BIGINT REFERENCES pricing_rules(id),
    toplam_dakika        INTEGER,

    -- Orijinal (ham) hesaplanan tutar, tam dakika üzerinden, yuvarlama uygulanmamış.
    orijinal_tutar_kurus BIGINT,
    -- Kasiyerin "Yuvarla" butonuyla oluşturduğu, fiilen tahsil edilen tutar.
    -- Yuvarlama yapılmadıysa orijinal_tutar_kurus ile aynıdır.
    tahsil_tutar_kurus   BIGINT,

    odeme_tipi           TEXT CHECK (odeme_tipi IN ('nakit', 'kredi_karti')),

    -- Gün sonu işleminde açık kalan bir oturum elle kapatıldıysa işaretlenir.
    manuel_kapatildi     BOOLEAN NOT NULL DEFAULT false,
    kapatan_user_id      BIGINT REFERENCES users(id),

    created_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_sessions_customer_id ON sessions(customer_id);
CREATE INDEX idx_sessions_durum ON sessions(durum);
CREATE INDEX idx_sessions_cikis_zamani ON sessions(cikis_zamani);

-- Denetim izi: ödeme tipi düzeltmesi, manuel oturum kapatma, fiyat kuralı
-- değişikliği gibi geriye dönük etkisi olan işlemler burada izlenir.
CREATE TABLE audit_log (
    id           BIGSERIAL PRIMARY KEY,
    user_id      BIGINT REFERENCES users(id),
    action       TEXT NOT NULL,
    target_table TEXT NOT NULL,
    target_id    BIGINT NOT NULL,
    detail       JSONB,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
