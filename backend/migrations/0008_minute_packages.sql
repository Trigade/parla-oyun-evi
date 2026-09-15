-- Aylık dakika paketleri: yönetici tarafından tanımlanan paket türleri
-- (ör. "1000 Dakika Paketi") ve müşterilerin bu paketlerden satın aldığı
-- kayıtlar. Fiyat, satın alma anındaki aktif dakika ücretinden hesaplanıp
-- dondurulur (pricing_rules gibi geçmişe dönük değişmez).
CREATE TABLE package_definitions (
    id          BIGSERIAL PRIMARY KEY,
    ad          TEXT NOT NULL,
    dakika      BIGINT NOT NULL CHECK (dakika > 0),
    aktif       BOOLEAN NOT NULL DEFAULT true,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE customer_packages (
    id                     BIGSERIAL PRIMARY KEY,
    customer_id            BIGINT NOT NULL REFERENCES customers(id),
    package_definition_id  BIGINT REFERENCES package_definitions(id),
    ad                     TEXT NOT NULL,
    toplam_dakika          BIGINT NOT NULL CHECK (toplam_dakika > 0),
    kalan_dakika           BIGINT NOT NULL CHECK (kalan_dakika >= 0),
    tutar_kurus            BIGINT NOT NULL CHECK (tutar_kurus >= 0),
    pricing_rule_id        BIGINT REFERENCES pricing_rules(id),
    satin_alma_zamani      TIMESTAMPTZ NOT NULL DEFAULT now(),
    gecerlilik_bitis       TIMESTAMPTZ NOT NULL,
    created_by             BIGINT REFERENCES users(id)
);

CREATE INDEX idx_customer_packages_customer ON customer_packages (customer_id);

-- Bir oturum kapatılırken paket bakiyesinden düşülen dakika, raporlarda ve
-- müşteri geçmişinde "bu oturumun ne kadarı paketten karşılandı" bilgisini
-- ayırt edebilmek için ayrıca tutulur.
ALTER TABLE sessions ADD COLUMN paketten_dusulen_dakika BIGINT NOT NULL DEFAULT 0;
