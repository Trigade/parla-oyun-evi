-- Ekran bazlı esnek izin sistemi.
-- is_admin: tam yetki (kullanıcı yönetimi, fiyat kuralları, gün sonu, dashboard, müşteriler).
-- permissions: is_admin=false olan personel için hangi ekranlara erişebileceğini belirler.
--   Geçerli değerler: 'gun_sonu', 'dashboard', 'musteriler'. 'kasa_ekrani' herkese açıktır.
ALTER TABLE users ADD COLUMN is_admin BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE users ADD COLUMN permissions TEXT[] NOT NULL DEFAULT '{}';

UPDATE users SET is_admin = true WHERE role = 'yonetici';
