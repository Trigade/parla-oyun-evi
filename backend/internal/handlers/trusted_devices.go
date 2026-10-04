package handlers

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
)

// Güvenilen cihazlar ("Bu cihazı hatırla"): girişte bu seçenek işaretlenirse
// tarayıcıya uzun ve rastgele bir cihaz anahtarı verilir. Sunucuda anahtarın
// kendisi değil yalnızca SHA-256 özeti saklanır. Anahtar tek başına giriş
// yapmaya yetmez — kullanıcı adı ve şifre yine istenir, yalnızca Authenticator
// kodu adımı atlanır.
const guvenilenCihazSuresi = 30 * 24 * time.Hour

func cihazTokenUret() (string, error) {
	ham := make([]byte, 32)
	if _, err := rand.Read(ham); err != nil {
		return "", err
	}
	return hex.EncodeToString(ham), nil
}

func cihazTokenOzeti(token string) string {
	toplam := sha256.Sum256([]byte(token))
	return hex.EncodeToString(toplam[:])
}

// cihazAdiCikar, tarayıcının User-Agent başlığından kullanıcıya gösterilecek
// kısa bir ad üretir (ör. "Chrome · Windows"); listede cihazı tanımak içindir.
func cihazAdiCikar(ua string) string {
	tarayici := "Bilinmeyen tarayıcı"
	switch {
	case strings.Contains(ua, "Edg/"):
		tarayici = "Edge"
	case strings.Contains(ua, "OPR/"):
		tarayici = "Opera"
	case strings.Contains(ua, "Chrome/"):
		tarayici = "Chrome"
	case strings.Contains(ua, "Firefox/"):
		tarayici = "Firefox"
	case strings.Contains(ua, "Safari/"):
		tarayici = "Safari"
	}
	cihaz := "bilinmeyen cihaz"
	switch {
	case strings.Contains(ua, "Windows"):
		cihaz = "Windows"
	case strings.Contains(ua, "Android"):
		cihaz = "Android"
	case strings.Contains(ua, "iPhone"), strings.Contains(ua, "iPad"):
		cihaz = "iPhone/iPad"
	case strings.Contains(ua, "Mac OS"):
		cihaz = "Mac"
	case strings.Contains(ua, "Linux"):
		cihaz = "Linux"
	}
	return tarayici + " · " + cihaz
}

// guvenilenCihazGecerliMi, cihaz anahtarının bu kullanıcıya ait ve süresi
// dolmamış olup olmadığını kontrol eder; geçerliyse son kullanım zamanını
// günceller (kullanıcıya "en son ne zaman kullanıldı" bilgisini göstermek için).
func (a *API) guvenilenCihazGecerliMi(ctx context.Context, userID int64, token string) bool {
	if token == "" {
		return false
	}
	var id int64
	err := a.DB.QueryRow(ctx, `
		UPDATE trusted_devices SET last_used_at = now()
		WHERE user_id = $1 AND token_hash = $2 AND expires_at > now()
		RETURNING id`,
		userID, cihazTokenOzeti(token),
	).Scan(&id)
	return err == nil
}

// guvenilenCihazKaydet yeni bir cihaz anahtarı üretip özetini saklar ve
// anahtarı (yalnızca bu bir kez) döner.
func (a *API) guvenilenCihazKaydet(ctx context.Context, userID int64, ua string) (string, error) {
	token, err := cihazTokenUret()
	if err != nil {
		return "", err
	}
	if _, err := a.DB.Exec(ctx, `
		INSERT INTO trusted_devices (user_id, token_hash, cihaz_adi, expires_at)
		VALUES ($1, $2, $3, now() + $4::interval)`,
		userID, cihazTokenOzeti(token), cihazAdiCikar(ua),
		fmt.Sprintf("%d hours", int(guvenilenCihazSuresi.Hours())),
	); err != nil {
		return "", err
	}
	// Süresi dolmuş kayıtlar birikmesin.
	_, _ = a.DB.Exec(ctx, `DELETE FROM trusted_devices WHERE expires_at < now()`)
	return token, nil
}

// guvenilenCihazlariSil bir kullanıcının tüm hatırlanan cihazlarını iptal
// eder (ör. TOTP sıfırlandığında: eski cihazlar kodsuz giriş yapmaya devam
// etmemeli).
func (a *API) guvenilenCihazlariSil(ctx context.Context, userID int64) error {
	_, err := a.DB.Exec(ctx, `DELETE FROM trusted_devices WHERE user_id = $1`, userID)
	return err
}

type trustedDeviceItem struct {
	ID         int64   `json:"id"`
	CihazAdi   string  `json:"cihaz_adi"`
	CreatedAt  string  `json:"created_at"`
	LastUsedAt *string `json:"last_used_at,omitempty"`
	ExpiresAt  string  `json:"expires_at"`
}

// ListUserDevices bir kullanıcının hatırlanan cihazlarını listeler.
// Sadece yönetici erişebilir (bkz. router).
func (a *API) ListUserDevices(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseInt(chi.URLParam(r, "id"), 10, 64)
	if err != nil {
		writeError(w, http.StatusBadRequest, "Geçersiz kullanıcı numarası.")
		return
	}

	rows, err := a.DB.Query(r.Context(), `
		SELECT id, cihaz_adi, created_at, last_used_at, expires_at
		FROM trusted_devices
		WHERE user_id = $1 AND expires_at > now()
		ORDER BY created_at DESC`, id)
	if err != nil {
		writeServerError(w, http.StatusInternalServerError, "cihazlar alınamadı", err)
		return
	}
	defer rows.Close()

	result := []trustedDeviceItem{}
	for rows.Next() {
		var item trustedDeviceItem
		var olusturma, bitis time.Time
		var sonKullanim *time.Time
		if err := rows.Scan(&item.ID, &item.CihazAdi, &olusturma, &sonKullanim, &bitis); err != nil {
			writeServerError(w, http.StatusInternalServerError, "satır okunamadı", err)
			return
		}
		item.CreatedAt = olusturma.Format("2006-01-02 15:04")
		item.ExpiresAt = bitis.Format("2006-01-02 15:04")
		if sonKullanim != nil {
			s := sonKullanim.Format("2006-01-02 15:04")
			item.LastUsedAt = &s
		}
		result = append(result, item)
	}
	writeJSON(w, http.StatusOK, result)
}

// DeleteUserDevice hatırlanan bir cihazı iptal eder: o cihazda bir sonraki
// girişte Authenticator kodu yeniden sorulur. Sadece yönetici erişebilir.
func (a *API) DeleteUserDevice(w http.ResponseWriter, r *http.Request) {
	userID, err := strconv.ParseInt(chi.URLParam(r, "id"), 10, 64)
	if err != nil {
		writeError(w, http.StatusBadRequest, "Geçersiz kullanıcı numarası.")
		return
	}
	cihazID, err := strconv.ParseInt(chi.URLParam(r, "cihazId"), 10, 64)
	if err != nil {
		writeError(w, http.StatusBadRequest, "Geçersiz cihaz numarası.")
		return
	}

	tag, err := a.DB.Exec(r.Context(),
		`DELETE FROM trusted_devices WHERE id = $1 AND user_id = $2`, cihazID, userID)
	if err != nil {
		writeServerError(w, http.StatusInternalServerError, "cihaz silinemedi", err)
		return
	}
	if tag.RowsAffected() == 0 {
		writeError(w, http.StatusNotFound, "cihaz bulunamadı")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"silindi": true})
}
