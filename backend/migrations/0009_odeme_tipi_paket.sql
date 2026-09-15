-- Abonelik/paket bakiyesinden tam karşılanan oturumlar için ayrı bir ödeme
-- tipi: nakit/kredi kartı tahsilatından ayırt edilebilsin diye.
ALTER TABLE sessions DROP CONSTRAINT sessions_odeme_tipi_check;
ALTER TABLE sessions ADD CONSTRAINT sessions_odeme_tipi_check
    CHECK (odeme_tipi IN ('nakit', 'kredi_karti', 'paket'));
