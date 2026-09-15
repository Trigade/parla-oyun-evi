-- Güvenlik/bütünlük düzeltmesi: bir müşterinin aynı anda birden fazla açık
-- oturumu olmasını *veritabanı seviyesinde* imkansız kılar. Önceki kod bunu
-- yalnızca uygulama katmanında (kilitsiz bir SELECT ile) kontrol ediyordu;
-- iki eşzamanlı istek (çift tıklama, iki kasiyerin aynı TC'yi aynı anda
-- girmesi) bu kontrolü aynı anda geçip iki açık oturum oluşturabiliyordu.
-- Kısmi bir unique index, ikinci INSERT'i atomik olarak reddeder.
CREATE UNIQUE INDEX idx_sessions_one_open_per_customer ON sessions(customer_id) WHERE durum = 'acik';

-- Aynı mantıkla: "Gün Başı" iki kez neredeyse eşzamanlı tıklanırsa (ya da iki
-- kasiyer aynı anda basarsa) uygulama katmanındaki kilitsiz SELECT+INSERT
-- ikisinin de geçmesine izin verip iki açık iş günü oluşturabiliyordu. Aynı
-- anda en fazla bir açık gün olabileceğinden, sabit bir ifade üzerinde
-- kısmi unique index bunu veritabanı seviyesinde imkansız kılar.
CREATE UNIQUE INDEX idx_business_days_single_open ON business_days ((1)) WHERE durum = 'acik';
