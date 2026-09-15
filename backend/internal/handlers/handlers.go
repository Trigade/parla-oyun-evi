package handlers

import (
	"context"
	"encoding/json"
	"log"
	"net/http"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"parla-oyun-evi/backend/internal/auth"
	"parla-oyun-evi/backend/internal/ratelimit"
)

type API struct {
	DB           *pgxpool.Pool
	Auth         *auth.TokenIssuer
	LoginLimiter *ratelimit.Limiter
	// TrustProxy, backend bir reverse proxy (ör. Caddy) arkasında
	// çalışıyorsa true olmalıdır: hız sınırlama için istemci IP'si
	// RemoteAddr (her istekte proxy'nin IP'si) yerine proxy'nin eklediği
	// X-Forwarded-For başlığından okunur. Proxy yoksa false kalmalıdır,
	// aksi halde istemci bu başlığı sahteleyerek sınırı atlatabilir.
	TrustProxy bool
}

// BusinessLocation, "Bugün/Bu Hafta/Bu Ay" gibi rapor tarih aralıklarının
// yorumlanacağı zaman dilimidir. Sunucu (Postgres + backend) UTC çalışsa
// bile, kasa ekranındaki kullanıcı Türkiye saatine göre "bugün" der;
// tarih string'leri (from/to) UTC yerine bu dilime göre ayrıştırılmalıdır
// — aksi halde gün sınırları 3 saat kayar ve gece yarısına yakın kapanan
// oturumlar yanlış güne sayılır/eksik görünür.
var BusinessLocation = loadBusinessLocation()

func loadBusinessLocation() *time.Location {
	loc, err := time.LoadLocation("Europe/Istanbul")
	if err != nil {
		log.Printf("UYARI: Europe/Istanbul saat dilimi yüklenemedi (%v), sabit +03:00 kullanılıyor", err)
		return time.FixedZone("+03:00", 3*60*60)
	}
	return loc
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

func writeError(w http.ResponseWriter, status int, msg string) {
	writeJSON(w, status, map[string]string{"hata": msg})
}

// writeServerError, ham veritabanı/sürücü hatasını (kısıt adı, sorgu parçası
// gibi iç detaylar içerebilir) istemciye hiç göndermeden sadece sunucu
// loguna yazar; istemciye yalnızca genel, güvenli bir mesaj döner.
func writeServerError(w http.ResponseWriter, status int, publicMsg string, err error) {
	log.Printf("%s: %v", publicMsg, err)
	writeJSON(w, status, map[string]string{"hata": publicMsg})
}

// Health veritabanı bağlantısını da kontrol eden basit bir healthcheck endpoint'idir.
func (a *API) Health(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(r.Context(), 2*time.Second)
	defer cancel()
	if err := a.DB.Ping(ctx); err != nil {
		writeError(w, http.StatusServiceUnavailable, "veritabanına ulaşılamıyor")
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"durum": "ok"})
}

// RoundDownToTen tutarı (kuruş cinsinden) en yakın 10 birime aşağı yuvarlar.
// Örnek: 12300 kuruş (123 TL) -> 12000 kuruş (120 TL).
func RoundDownToTen(kurus int64) int64 {
	lira := kurus / 100
	roundedLira := (lira / 10) * 10
	return roundedLira * 100
}
