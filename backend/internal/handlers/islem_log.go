package handlers

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"log"
	"net/http"
	"regexp"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
)

// İşlem kaydı: yalnızca geliştirici için (deploy/log-goster.ps1 ile okunur).
// Bilerek hiçbir okuma ucu yoktur. İstek gövdesi, şifre ve tam TC/telefon
// kaydedilmez; tek istisna giriş isteğindeki kullanıcı adıdır. Handler'lar
// islemDetay ile iş ayrıntısını (ör. paketten düşme) kayda ekleyebilir.

const (
	islemLogSaklamaGun = 365
	hataMesajiSiniri   = 1024
)

type islemBilgiKey struct{}

// islemBilgi, middleware'in context'e koyduğu tutucudur; handler'lar detayı buraya yazar.
type islemBilgi struct{ detay map[string]any }

// islemDetay, o isteğin işlem kaydına iş ayrıntısı ekler (middleware yoksa etkisizdir).
// Hassas veri (şifre, tam TC/telefon) verilmemelidir.
func islemDetay(r *http.Request, d map[string]any) {
	b, ok := r.Context().Value(islemBilgiKey{}).(*islemBilgi)
	if !ok {
		return
	}
	if b.detay == nil {
		b.detay = map[string]any{}
	}
	for k, v := range d {
		b.detay[k] = v
	}
}

// sinirliTampon yalnızca ilk hataMesajiSiniri baytı tutar; büyük (ör. PDF) yanıtlar şişirmez.
type sinirliTampon struct{ b []byte }

func (t *sinirliTampon) Write(p []byte) (int, error) {
	if kalan := hataMesajiSiniri - len(t.b); kalan > 0 {
		t.b = append(t.b, p[:min(kalan, len(p))]...)
	}
	return len(p), nil
}

// islemSonucu, durum kodunu yapildi / reddedildi / hata olarak sınıflar.
func islemSonucu(durum int) string {
	switch {
	case durum >= 500:
		return "hata"
	case durum >= 400:
		return "reddedildi"
	}
	return "yapildi"
}

// islemKaydedilsin: GET dışındakiler, hatalı GET'ler ve dışa aktarımlar (/export).
func islemKaydedilsin(yontem, yol string, durum int) bool {
	if yol == "/api/health" {
		return false
	}
	return yontem != http.MethodGet || durum >= 400 || strings.HasSuffix(yol, "/export")
}

// maskele, TC/telefon gibi değerin ilk 3 ve son 2 hanesini bırakır.
func maskele(s string) string {
	if len(s) <= 5 {
		return strings.Repeat("*", len(s))
	}
	return s[:3] + strings.Repeat("*", len(s)-5) + s[len(s)-2:]
}

// maskeliYol, /customers/by-tc/{tc} ve /customers/by-phone/{telefon} yollarındaki değeri maskeler.
func maskeliYol(yol string) string {
	parcalar := strings.Split(yol, "/")
	for i := 0; i < len(parcalar)-1; i++ {
		if parcalar[i] == "by-tc" || parcalar[i] == "by-phone" {
			parcalar[i+1] = maskele(parcalar[i+1])
		}
	}
	return strings.Join(parcalar, "/")
}

var gecerliKullaniciAdi = regexp.MustCompile(`^[A-Za-z0-9_.-]{1,64}$`)

// girisKullaniciAdi, kimlik doğrulamasız gelen kullanıcı adını yalnızca güvenli
// karakterlerse olduğu gibi döner; aksi halde (ör. CSV/formül enjeksiyonu) "(gecersiz)".
func girisKullaniciAdi(s string) string {
	if gecerliKullaniciAdi.MatchString(s) {
		return s
	}
	return "(gecersiz)"
}

// hataMetni, >=400 yanıt gövdesindeki {"hata": "..."} alanını döner.
func hataMetni(govde []byte) string {
	var v struct {
		Hata string `json:"hata"`
	}
	_ = json.Unmarshal(govde, &v)
	return v.Hata
}

// IslemLog, /api altındaki istekleri islem_log tablosuna yazan middleware'dir.
func (a *API) IslemLog(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		basla := time.Now()
		// Giriş isteğinde yalnızca kullanıcı adı okunur; gövde handler için geri konur.
		var kullaniciAdi string
		if r.Method == http.MethodPost && r.URL.Path == "/api/auth/login" {
			govde, _ := io.ReadAll(r.Body)
			r.Body = io.NopCloser(bytes.NewReader(govde))
			var v struct {
				Username string `json:"username"`
			}
			_ = json.Unmarshal(govde, &v)
			kullaniciAdi = v.Username
			if len(kullaniciAdi) > 64 {
				kullaniciAdi = kullaniciAdi[:64]
			}
		}

		bilgi := &islemBilgi{}
		tampon := &sinirliTampon{}
		ww := middleware.NewWrapResponseWriter(w, r.ProtoMajor)
		ww.Tee(tampon)
		next.ServeHTTP(ww, r.WithContext(context.WithValue(r.Context(), islemBilgiKey{}, bilgi)))

		durum := ww.Status()
		if durum == 0 {
			durum = http.StatusOK
		}
		if !islemKaydedilsin(r.Method, r.URL.Path, durum) {
			return
		}
		desen := r.URL.Path
		if rc := chi.RouteContext(r.Context()); rc != nil && rc.RoutePattern() != "" {
			desen = rc.RoutePattern()
		}
		var userID *int64
		if h := r.Header.Get("Authorization"); strings.HasPrefix(h, "Bearer ") {
			// Kısa ömürlü TOTP token'ları da kullanıcıyı verir (RequireAuth'tan bağımsız çözülür).
			if c, err := a.Auth.Parse(strings.TrimPrefix(h, "Bearer ")); err == nil {
				userID = &c.UserID
			}
		}
		var mesaj string
		if durum >= 400 {
			mesaj = hataMetni(tampon.b)
		}
		var detay *string
		if len(bilgi.detay) > 0 {
			if b, err := json.Marshal(bilgi.detay); err == nil {
				s := string(b)
				detay = &s
			}
		}
		yontem, gercekYol, ip, sureMs := r.Method, maskeliYol(r.URL.Path), a.clientIP(r), int(time.Since(basla).Milliseconds())

		// shortcut: kayıt yanıttan sonra arka planda yazılır; uygulama tam o anda
		// kapanırsa son birkaç kayıt kaybolabilir. Kuyruk/kalıcılık gerekirse yükseltilir.
		go func() {
			ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
			defer cancel()
			_, err := a.DB.Exec(ctx,
				`INSERT INTO islem_log (user_id, kullanici_adi, yontem, yol, gercek_yol, durum_kodu, sonuc, mesaj, ip, sure_ms, detay)
				 VALUES ($1, NULLIF($2, ''), $3, $4, $5, $6, $7, NULLIF($8, ''), $9, $10, $11::jsonb)`,
				userID, kullaniciAdi, yontem, desen, gercekYol, durum, islemSonucu(durum), mesaj, ip, sureMs, detay)
			if err != nil {
				log.Printf("işlem kaydı yazılamadı: %v", err)
			}
		}()
	})
}

// IslemLogTemizlik, açılışta ve günde bir kez 365 günden eski kayıtları siler.
func (a *API) IslemLogTemizlik(ctx context.Context) {
	ticker := time.NewTicker(24 * time.Hour)
	defer ticker.Stop()
	for {
		if _, err := a.DB.Exec(ctx, `DELETE FROM islem_log WHERE zaman < now() - make_interval(days => $1)`, islemLogSaklamaGun); err != nil && ctx.Err() == nil {
			log.Printf("eski işlem kayıtları silinemedi: %v", err)
		}
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
		}
	}
}
