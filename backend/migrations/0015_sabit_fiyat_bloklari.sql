-- Fiyat blokları sabitlendi: 30 dk, 60 dk, 90 dk, 2 saat, 3 saat, 5 saat,
-- 10 saat. Fiyat Politikası ekranında artık yalnızca ücretler güncellenir;
-- backend (CreatePricingTierVersion) farklı bir blok yapısını reddeder.
--
-- Varsayılan ücretler (250 / 370 / 550 / 650 / 900 / 1450 / 2500 TL) yalnızca
-- aktif politika bu sabit blok yapısında DEĞİLSE (hiç politika yoksa ya da
-- eski, elle girilmiş farklı bloklar varsa) yeni bir versiyon olarak yazılır.
-- Aktif politika zaten sabit yapıdaysa girilmiş ücretlere dokunulmaz.
-- Versiyonlama sayesinde geçmiş kapanmış oturumların tutarları etkilenmez.
DO $$
DECLARE
    aktif_id     BIGINT;
    sabit_yapida BOOLEAN;
    yeni_id      BIGINT;
BEGIN
    SELECT id INTO aktif_id
    FROM pricing_tier_versions
    WHERE effective_from <= now()
    ORDER BY effective_from DESC
    LIMIT 1;

    IF aktif_id IS NOT NULL THEN
        SELECT array_agg(min_dakika ORDER BY sira) = ARRAY[0, 31, 61, 91, 121, 181, 301]
           AND array_agg(max_dakika ORDER BY sira) = ARRAY[30, 60, 90, 120, 180, 300, 600]
        INTO sabit_yapida
        FROM pricing_tiers
        WHERE version_id = aktif_id;
    END IF;

    IF sabit_yapida IS NOT TRUE THEN
        INSERT INTO pricing_tier_versions (created_by) VALUES (NULL)
        RETURNING id INTO yeni_id;

        INSERT INTO pricing_tiers (version_id, sira, min_dakika, max_dakika, tutar_kurus) VALUES
            (yeni_id, 0,   0,  30,  25000),
            (yeni_id, 1,  31,  60,  37000),
            (yeni_id, 2,  61,  90,  55000),
            (yeni_id, 3,  91, 120,  65000),
            (yeni_id, 4, 121, 180,  90000),
            (yeni_id, 5, 181, 300, 145000),
            (yeni_id, 6, 301, 600, 250000);
    END IF;
END $$;
