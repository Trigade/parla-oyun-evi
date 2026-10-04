-- "Bu cihazı hatırla": kullanıcı güvendiği bir cihazda bu seçeneği işaretlerse
-- tarayıcıya uzun ve rastgele bir cihaz anahtarı verilir. Sunucuda anahtarın
-- kendisi değil yalnızca SHA-256 özeti saklanır; veritabanı sızsa bile
-- özetten anahtar üretilemez.
--
-- Anahtar tek başına giriş yapmaya yetmez: kullanıcı adı ve şifre yine
-- istenir, yalnızca Authenticator kodu adımı atlanır. Süre dolduğunda
-- (varsayılan 30 gün) kod yeniden sorulur. Yönetici, Kullanıcı Yönetimi
-- ekranından hatırlanan cihazları görüp iptal edebilir.
CREATE TABLE trusted_devices (
    id           BIGSERIAL PRIMARY KEY,
    user_id      BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash   TEXT NOT NULL UNIQUE,
    cihaz_adi    TEXT NOT NULL DEFAULT '',
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_used_at TIMESTAMPTZ,
    expires_at   TIMESTAMPTZ NOT NULL
);

CREATE INDEX idx_trusted_devices_user ON trusted_devices (user_id);
