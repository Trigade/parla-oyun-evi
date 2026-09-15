-- Süreli açılan oturumlarda (sure_secimi_dakika doluysa) kasiyer ödemeyi
-- müşteri daha içeride iken erkenden alabilir. Bu durumda oturum "acik"
-- kalmaya devam eder (İçeride Olanlar listesinde görünür), sadece ödendi
-- olarak işaretlenir; müşteri gerçekten çıktığında ayrı bir "çıkış yaptı"
-- işlemiyle cikis_zamani/durum güncellenir — tutar yeniden hesaplanmaz.
ALTER TABLE sessions ADD COLUMN on_odeme_yapildi_mi BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE sessions ADD COLUMN on_odeme_zamani TIMESTAMPTZ;
