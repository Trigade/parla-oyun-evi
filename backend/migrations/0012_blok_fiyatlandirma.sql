-- Oturum kapatma ücretlendirmesi, dakika başı sabit orandan blok (aralık)
-- bazlı sabit ücrete geçer: örn. 0-30 dk = 50 TL, 31-60 dk = 80 TL gibi.
-- Personel istediği kadar blok tanımlayabilir; son blok "max_dakika = NULL"
-- ile üst sınırsız (o dakikadan sonrasının tamamı) olarak işaretlenebilir.
--
-- Mevcut pricing_rules (dakika başı kuruş) tablosu KALDIRILMAZ: paket satın
-- alma fiyatlandırması (bir paketin toplam dakikasının satın alma anındaki
-- karşılığı) hâlâ dakika başı orana dayanır, bu değişikliğin kapsamı dışındadır.
--
-- Versiyonlama, pricing_rules ile aynı mantık: yeni bir politika (tiers seti)
-- kaydetmek geçmiş kapanmış oturumların tutarını etkilemez; her oturum
-- kapandığı andaki aktif politikanın id'sini donuk olarak saklar.

CREATE TABLE pricing_tier_versions (
    id             BIGSERIAL PRIMARY KEY,
    effective_from TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_by     BIGINT REFERENCES users(id)
);

CREATE TABLE pricing_tiers (
    id          BIGSERIAL PRIMARY KEY,
    version_id  BIGINT NOT NULL REFERENCES pricing_tier_versions(id) ON DELETE CASCADE,
    sira        INTEGER NOT NULL,
    min_dakika  INTEGER NOT NULL CHECK (min_dakika >= 0),
    -- NULL = üst sınır yok (bu blok min_dakika'dan itibaren tüm süreleri kapsar)
    max_dakika  INTEGER CHECK (max_dakika IS NULL OR max_dakika >= min_dakika),
    tutar_kurus BIGINT NOT NULL CHECK (tutar_kurus >= 0),
    UNIQUE (version_id, sira)
);

CREATE INDEX idx_pricing_tiers_version_id ON pricing_tiers(version_id);

ALTER TABLE sessions
    ADD COLUMN pricing_tier_version_id BIGINT REFERENCES pricing_tier_versions(id),
    ADD COLUMN pricing_tier_id         BIGINT REFERENCES pricing_tiers(id);
