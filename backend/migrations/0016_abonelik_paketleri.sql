-- Paketler "dakika bakiyesi" modelinden abonelik modeline geçti:
-- bir paket artık "haftada N gün, günde M dakika" hakkı verir ve aylık sabit
-- ücretle satılır (ör. 5 Günlük Paket: haftada 5 gün, günde 4 saat, 14.000 TL).
-- Paket ücreti satın alma anında dondurulur, paket satın alma tarihinden
-- itibaren 1 ay geçerlidir ve tahsilat (nakit/kart) ciroya dahil edilir.

ALTER TABLE package_definitions
    ADD COLUMN grup              TEXT NOT NULL DEFAULT 'Standart',
    ADD COLUMN haftalik_gun      INTEGER CHECK (haftalik_gun IS NULL OR (haftalik_gun >= 1 AND haftalik_gun <= 7)),
    ADD COLUMN gunluk_dakika     INTEGER CHECK (gunluk_dakika IS NULL OR gunluk_dakika > 0),
    ADD COLUMN aylik_ucret_kurus BIGINT  CHECK (aylik_ucret_kurus IS NULL OR aylik_ucret_kurus >= 0);

-- Eski dakika paketlerinde bu alan boş kalır; o yüzden "dakika" artık zorunlu değil.
ALTER TABLE package_definitions ALTER COLUMN dakika DROP NOT NULL;

-- Eski "dakika bakiyesi" paket türleri satışa kapatılır; geçmiş kayıtlar korunur.
UPDATE package_definitions SET aktif = false WHERE haftalik_gun IS NULL;

ALTER TABLE customer_packages
    ADD COLUMN grup          TEXT,
    ADD COLUMN haftalik_gun  INTEGER,
    ADD COLUMN gunluk_dakika INTEGER,
    ADD COLUMN odeme_tipi    TEXT CHECK (odeme_tipi IS NULL OR odeme_tipi IN ('nakit', 'kredi_karti'));

ALTER TABLE customer_packages ALTER COLUMN toplam_dakika DROP NOT NULL;
ALTER TABLE customer_packages ALTER COLUMN kalan_dakika  DROP NOT NULL;

-- Bir oturumun hangi pakete sayıldığı: haftalık gün ve günlük dakika hakkının
-- takibi bu bağ üzerinden yapılır (aynı gün içindeki girişler tek gün sayılır).
ALTER TABLE sessions ADD COLUMN customer_package_id BIGINT REFERENCES customer_packages(id);
CREATE INDEX idx_sessions_customer_package ON sessions (customer_package_id);

-- Varsayılan paketler yalnızca hiç abonelik paketi tanımlı değilse eklenir;
-- böylece daha önce paket tanımlamış bir kurulumda mevcut tanımlar korunur.
INSERT INTO package_definitions (ad, grup, haftalik_gun, gunluk_dakika, aylik_ucret_kurus)
SELECT v.ad, v.grup, v.haftalik_gun, v.gunluk_dakika, v.aylik_ucret_kurus
FROM (VALUES
    ('5 Günlük Paket',          'Standart', 5, 240, 1400000),
    ('4 Günlük Paket',          'Standart', 4, 240, 1300000),
    ('3 Günlük Paket',          'Standart', 3, 240, 1200000),
    ('2 Yaş Oyun Grubu Paketi', '2 Yaş',    3, 120,  800000)
) AS v(ad, grup, haftalik_gun, gunluk_dakika, aylik_ucret_kurus)
WHERE NOT EXISTS (SELECT 1 FROM package_definitions WHERE haftalik_gun IS NOT NULL);
