ALTER TABLE customers ADD COLUMN deleted_at TIMESTAMPTZ;

-- Silinmiş müşteriler normal listeleme/arama akışlarında görünmemeli.
CREATE INDEX idx_customers_deleted_at ON customers (deleted_at);
