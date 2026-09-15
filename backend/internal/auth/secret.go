package auth

import (
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"os"
	"path/filepath"
)

// LoadOrCreateJWTSecret JWT imzalama anahtarını döner. Önce JWT_SECRET ortam
// değişkenine bakar (üretim/dağıtım ortamlarında tercih edilen yol budur).
// Ayarlanmamışsa, herkese bilinen sabit bir varsayılana düşmek yerine
// kriptografik olarak güvenli, rastgele 32 baytlık bir anahtar üretir ve
// dataDir altındaki bir dosyada saklar; böylece backend her yeniden
// başlatıldığında aynı anahtar kullanılmaya devam eder ve mevcut oturumlar
// bozulmaz, ama anahtar hiçbir zaman kaynak koda/known-default'a gömülü olmaz.
func LoadOrCreateJWTSecret(dataDir string) ([]byte, error) {
	if secret := os.Getenv("JWT_SECRET"); secret != "" {
		return []byte(secret), nil
	}

	if err := os.MkdirAll(dataDir, 0o700); err != nil {
		return nil, fmt.Errorf("veri dizini oluşturulamadı: %w", err)
	}
	secretPath := filepath.Join(dataDir, "jwt_secret.local")

	if existing, err := os.ReadFile(secretPath); err == nil && len(existing) > 0 {
		return existing, nil
	}

	raw := make([]byte, 32)
	if _, err := rand.Read(raw); err != nil {
		return nil, fmt.Errorf("rastgele anahtar üretilemedi: %w", err)
	}
	encoded := []byte(hex.EncodeToString(raw))
	if err := os.WriteFile(secretPath, encoded, 0o600); err != nil {
		return nil, fmt.Errorf("anahtar dosyaya yazılamadı: %w", err)
	}
	return encoded, nil
}
