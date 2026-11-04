-- Yönetici kapanışta süreyi düzelttiyse gerçek (hesaplanan) süre burada saklanır.
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS gercek_dakika BIGINT;
