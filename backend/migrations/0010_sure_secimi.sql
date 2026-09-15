-- Müşteri girişinde kasiyer isterse önceden bir süre seçebilir (ör. 10/20/30/60
-- dk); seçilmezse (NULL) mevcut davranış korunur: kalış süresi çıkışta olduğu
-- gibi hesaplanır. Seçilen süre dolduğunda kasa ekranında otomatik uyarı
-- gösterebilmek için oturuma kaydedilir.
ALTER TABLE sessions ADD COLUMN sure_secimi_dakika BIGINT CHECK (sure_secimi_dakika > 0);
