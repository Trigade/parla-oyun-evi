-- TOTP (Google Authenticator) ile iki adımlı doğrulama: her kullanıcı için
-- zorunlu, ilk girişte kendi kendine kurulum yapılır (bkz. handlers/auth.go).
-- totp_secret, kullanıcı QR kodu okutup ilk kodu doğrulayana kadar
-- totp_enabled=false kalır; bu süre boyunca sadece kurulum uçlarına erişilebilir.
ALTER TABLE users
    ADD COLUMN totp_secret  TEXT,
    ADD COLUMN totp_enabled BOOLEAN NOT NULL DEFAULT false;
