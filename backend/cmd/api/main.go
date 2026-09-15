package main

import (
	"context"
	"errors"
	"fmt"
	"log"
	"net"
	"net/http"
	"net/url"
	"os"
	"os/signal"
	"path"
	"path/filepath"
	"slices"
	"strings"
	"syscall"
	"time"
	// Europe/Istanbul saat dilimi, işletim sisteminde tzdata olmasa bile
	// (ör. minimal Docker imajı) yüklenebilsin diye binary'e gömülür.
	_ "time/tzdata"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"

	"parla-oyun-evi/backend/internal/auth"
	"parla-oyun-evi/backend/internal/db"
	"parla-oyun-evi/backend/internal/handlers"
	"parla-oyun-evi/backend/internal/migrate"
	"parla-oyun-evi/backend/internal/ratelimit"
	"parla-oyun-evi/backend/migrations"
)

// contentSecurityPolicy, sunulan frontend'in yalnızca kendi dosyalarını ve
// Google Fonts'u yükleyebilmesine izin verir; olası bir XSS'in dışarıdan
// script çekmesini veya veriyi başka bir adrese göndermesini engeller.
const contentSecurityPolicy = "default-src 'self'; script-src 'self'; " +
	"style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; " +
	"font-src 'self' https://fonts.gstatic.com; img-src 'self' data: blob:; " +
	"connect-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'"

// ekIzinliOriginler, CORS_ALLOWED_ORIGINS ortam değişkeninde virgülle
// verilen, localhost/LAN dışındaki izinli origin'lerdir (ör. ayrı bir
// alan adından sunulan frontend). Normal kurulumda frontend ve API aynı
// origin'den sunulduğu için boş kalır.
var ekIzinliOriginler = listeOku(os.Getenv("CORS_ALLOWED_ORIGINS"))

func listeOku(deger string) []string {
	var sonuc []string
	for _, parca := range strings.Split(deger, ",") {
		if p := strings.TrimRight(strings.TrimSpace(parca), "/"); p != "" {
			sonuc = append(sonuc, p)
		}
	}
	return sonuc
}

func envBool(ad string) bool {
	switch strings.ToLower(strings.TrimSpace(os.Getenv(ad))) {
	case "1", "true", "yes", "on", "evet":
		return true
	}
	return false
}

// izinliOrigin, CORS Origin başlığının yerel ağ (LAN), localhost veya
// CORS_ALLOWED_ORIGINS listesinden gelip gelmediğini kontrol eder. Herhangi
// bir Origin'i koşulsuz yansıtmak yerine gerçek kullanım alanını (kasa
// cihazı + aynı LAN'daki telefon/tablet) sınırlayan basit bir allowlist'tir.
func izinliOrigin(origin string) bool {
	if slices.Contains(ekIzinliOriginler, origin) {
		return true
	}
	u, err := url.Parse(origin)
	if err != nil || u.Hostname() == "" {
		return false
	}
	host := u.Hostname()
	if host == "localhost" {
		return true
	}
	ip := net.ParseIP(host)
	if ip == nil {
		return false
	}
	if ip.IsLoopback() {
		return true
	}
	privateBlocks := []string{"10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16"}
	for _, block := range privateBlocks {
		_, cidr, _ := net.ParseCIDR(block)
		if cidr.Contains(ip) {
			return true
		}
	}
	return false
}

// spaHandler, derlenmiş frontend'i (vite build çıktısı) sunar. Diskte
// bulunan dosyalar olduğu gibi döner; bulunamayan her yol (ör. /gun-sonu
// sayfası yenilendiğinde) React Router'ın işleyebilmesi için index.html'e
// düşer. Hash'li /assets/ dosyaları uzun süre, index.html ise hiç
// önbelleğe alınmaz — böylece yeni sürüm yayınlandığında hemen görünür.
func spaHandler(dir string) http.Handler {
	fsys := http.Dir(dir)
	fileServer := http.FileServer(fsys)
	index := filepath.Join(dir, "index.html")
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		p := path.Clean("/" + r.URL.Path)
		if f, err := fsys.Open(p); err == nil {
			st, statErr := f.Stat()
			f.Close()
			if statErr == nil && !st.IsDir() {
				if strings.HasPrefix(p, "/assets/") {
					w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
				}
				fileServer.ServeHTTP(w, r)
				return
			}
		}
		w.Header().Set("Cache-Control", "no-cache")
		http.ServeFile(w, r, index)
	})
}

// healthcheck, Docker HEALTHCHECK için çalışan sunucunun /api/health ucunu
// yoklar (minimal imajda curl/wget bulunmadığından binary'nin kendisi kullanılır).
func healthcheck() int {
	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}
	client := http.Client{Timeout: 3 * time.Second}
	resp, err := client.Get("http://127.0.0.1:" + port + "/api/health")
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		return 1
	}
	resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		fmt.Fprintln(os.Stderr, "health durumu:", resp.StatusCode)
		return 1
	}
	return 0
}

func main() {
	if len(os.Args) > 1 && os.Args[1] == "healthcheck" {
		os.Exit(healthcheck())
	}

	ctx := context.Background()
	// APP_ENV=production iken geliştirme kolaylığı sağlayan varsayılanlara
	// (sabit DB şifresi, diske yazılan JWT anahtarı) düşülmez; eksik ayar
	// sessizce çalışmak yerine açılışta hata verir.
	uretim := os.Getenv("APP_ENV") == "production"

	databaseURL := os.Getenv("DATABASE_URL")
	if databaseURL == "" {
		if uretim {
			log.Fatal("DATABASE_URL ortam değişkeni üretim ortamında zorunludur")
		}
		databaseURL = "postgres://parla:parla_dev_password@localhost:5432/parla_oyun_evi?sslmode=disable"
		log.Println("UYARI: DATABASE_URL ortam değişkeni ayarlanmamış, yerel geliştirme varsayılanı kullanılıyor")
	}

	pool, err := db.Connect(ctx, databaseURL)
	if err != nil {
		log.Fatalf("veritabanına bağlanılamadı: %v", err)
	}
	defer pool.Close()

	if envBool("AUTO_MIGRATE") {
		applied, err := migrate.Run(ctx, pool, migrations.FS)
		if err != nil {
			log.Fatalf("migration uygulanamadı: %v", err)
		}
		for _, name := range applied {
			log.Printf("migration uygulandı: %s", name)
		}
		log.Printf("veritabanı şeması güncel (%d yeni migration)", len(applied))
	}

	if uretim && len(os.Getenv("JWT_SECRET")) < 32 {
		log.Fatal("JWT_SECRET üretim ortamında zorunludur ve en az 32 karakter olmalıdır")
	}
	// JWT_SECRET ortam değişkeni ayarlanmamışsa, herkesçe bilinen sabit bir
	// varsayılana düşmek yerine kalıcı/rastgele bir anahtar üretilir ve
	// diskte saklanır (bkz. auth.LoadOrCreateJWTSecret) — bilinen bir
	// anahtarla admin JWT'si sahtelenmesini engeller.
	jwtSecret, err := auth.LoadOrCreateJWTSecret(".")
	if err != nil {
		log.Fatalf("JWT gizli anahtarı hazırlanamadı: %v", err)
	}
	if os.Getenv("JWT_SECRET") == "" {
		log.Println("UYARI: JWT_SECRET ortam değişkeni ayarlanmamış; kalıcı rastgele anahtar backend/jwt_secret.local dosyasında saklanıyor")
	}
	tokenIssuer := &auth.TokenIssuer{Secret: jwtSecret, TTL: 12 * time.Hour}

	loginLimiter := ratelimit.New(10, 5*time.Minute)
	api := &handlers.API{DB: pool, Auth: tokenIssuer, LoginLimiter: loginLimiter, TrustProxy: envBool("TRUST_PROXY")}

	r := chi.NewRouter()
	r.Use(middleware.Logger)
	r.Use(middleware.Recoverer)
	r.Use(func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			h := w.Header()
			h.Set("X-Content-Type-Options", "nosniff")
			h.Set("X-Frame-Options", "DENY")
			h.Set("Referrer-Policy", "strict-origin-when-cross-origin")
			h.Set("Content-Security-Policy", contentSecurityPolicy)
			next.ServeHTTP(w, r)
		})
	})
	// İstek gövdesi boyutu sınırlanır: sınırsız uzunlukta alan (ör. ad/soyad)
	// kabul eden uçlara karşı basit bir DoS/depolama-şişmesi önlemi.
	r.Use(func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			r.Body = http.MaxBytesReader(w, r.Body, 1<<20) // 1 MiB
			next.ServeHTTP(w, r)
		})
	})
	r.Use(func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			// Origin, herhangi bir site yerine yalnızca localhost/özel IP
			// aralıklarından veya CORS_ALLOWED_ORIGINS listesinden geldiğinde
			// yansıtılır (bkz. izinliOrigin).
			if origin := r.Header.Get("Origin"); origin != "" && izinliOrigin(origin) {
				w.Header().Set("Access-Control-Allow-Origin", origin)
				w.Header().Set("Vary", "Origin")
			}
			w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PATCH, DELETE, OPTIONS")
			w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization")
			w.Header().Set("Access-Control-Expose-Headers", "Content-Disposition")
			if r.Method == http.MethodOptions {
				w.WriteHeader(http.StatusNoContent)
				return
			}
			next.ServeHTTP(w, r)
		})
	})

	r.Route("/api", func(r chi.Router) {
		r.Get("/health", api.Health)
		r.Post("/auth/login", api.Login)
		// TOTP kurulum/doğrulama uçları kendi kısa ömürlü, amaca özel
		// token'larını (Purpose alanı) doğrudan kendileri çözümler; bu yüzden
		// tokenIssuer.RequireAuth zincirinin dışında, /auth/login gibi genel
		// erişime açık tutulur (bkz. handlers/auth.go: totpFlowUser).
		r.Post("/auth/totp/setup-init", api.SetupInitTOTP)
		r.Post("/auth/totp/setup-confirm", api.SetupConfirmTOTP)
		r.Post("/auth/totp/verify-login", api.VerifyLoginTOTP)

		// Kimlik doğrulaması gereken uçlar (kasiyer + yönetici)
		r.Group(func(r chi.Router) {
			r.Use(tokenIssuer.RequireAuth)

			r.Post("/sessions/start", api.StartSession)
			r.Get("/sessions/open", api.ListOpenSessions)
			r.Post("/sessions/{id}/close", api.CloseSession)
			r.Post("/sessions/{id}/pay-early", api.PayEarlySession)
			r.Post("/sessions/{id}/check-out", api.CheckOutSession)
			r.Post("/sessions/{id}/extend-duration", api.ExtendSessionDuration)
			r.Get("/pricing-rules/active", api.GetActivePricingRule)
			r.Get("/pricing-tiers/active", api.GetActivePricingPolicy)
			r.Get("/customers/by-tc/{tc}", api.LookupCustomerByTC)
			r.Get("/customers/by-phone/{telefon}", api.LookupCustomerByPhone)
			r.Get("/customers/{id}/packages", api.ListCustomerPackages)

			// "gun_sonu" izni (veya is_admin) gereken uçlar
			r.Group(func(r chi.Router) {
				r.Use(auth.RequirePermission(auth.PermGunSonu))
				r.Post("/sessions/{id}/manual-close", api.ManualCloseSession)
				r.Get("/business-day/current", api.GetCurrentBusinessDay)
				r.Post("/business-day/start", api.StartBusinessDay)
				r.Post("/business-day/{id}/end", api.EndBusinessDay)
			})

			// "dashboard" izni (veya is_admin) gereken uçlar
			r.Group(func(r chi.Router) {
				r.Use(auth.RequirePermission(auth.PermDashboard))
				r.Get("/reports", api.GetReport)
				r.Get("/reports/export", api.ExportSessionsPDF)
			})

			// "musteriler" izni (veya is_admin) gereken uçlar
			r.Group(func(r chi.Router) {
				r.Use(auth.RequirePermission(auth.PermMusteriler))
				r.Get("/customers", api.ListCustomers)
				r.Patch("/customers/{id}", api.UpdateCustomer)
				r.Get("/customers/{id}/sessions", api.GetCustomerSessions)
				r.Get("/customers/{id}/export", api.ExportCustomerPDF)
				r.Get("/package-definitions", api.ListPackageDefinitions)
				r.Post("/customers/{id}/packages", api.PurchasePackage)
			})

			// Sadece is_admin=true (fiyat kuralları, kullanıcı yönetimi)
			r.Group(func(r chi.Router) {
				r.Use(auth.RequireAdmin)

				r.Get("/pricing-rules", api.ListPricingRules)
				r.Post("/pricing-rules", api.CreatePricingRule)
				r.Get("/pricing-tiers", api.ListPricingTierVersions)
				r.Post("/pricing-tiers", api.CreatePricingTierVersion)
				r.Get("/users", api.ListUsers)
				r.Post("/users", api.CreateUser)
				r.Patch("/users/{id}", api.UpdateUser)
				r.Delete("/users/{id}", api.DeleteUser)
				r.Post("/users/{id}/totp-reset", api.ResetUserTOTP)
				r.Delete("/customers/{id}", api.DeleteCustomer)
				r.Post("/package-definitions", api.CreatePackageDefinition)
			})
		})
	})

	// STATIC_DIR verilmişse derlenmiş frontend de aynı sunucudan sunulur
	// (üretim imajı). Geliştirmede boş kalır; frontend'i Vite dev server sunar.
	if dir := os.Getenv("STATIC_DIR"); dir != "" {
		if _, err := os.Stat(filepath.Join(dir, "index.html")); err != nil {
			log.Fatalf("STATIC_DIR içinde index.html bulunamadı: %v", err)
		}
		r.Handle("/*", spaHandler(dir))
		log.Printf("frontend %s dizininden sunuluyor", dir)
	}

	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}
	// Zaman aşımları, bağlantıyı yavaşça açık tutarak sunucuyu kilitleyen
	// istemcilere (slowloris) karşıdır. WriteTimeout, gün sonu/müşteri PDF
	// üretimine yetecek kadar geniş tutulur.
	srv := &http.Server{
		Addr:              ":" + port,
		Handler:           r,
		ReadHeaderTimeout: 10 * time.Second,
		ReadTimeout:       30 * time.Second,
		WriteTimeout:      2 * time.Minute,
		IdleTimeout:       2 * time.Minute,
	}

	// Docker "stop" (SIGTERM) veya Ctrl+C geldiğinde yarım kalan istekler
	// (ör. bir ödeme kapatma) kesilmeden tamamlanır, sonra sunucu kapanır.
	stopCtx, stop := signal.NotifyContext(ctx, os.Interrupt, syscall.SIGTERM)
	defer stop()
	kapandi := make(chan struct{})
	go func() {
		defer close(kapandi)
		<-stopCtx.Done()
		log.Println("kapatma sinyali alındı, açık istekler tamamlanıyor")
		shutdownCtx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
		defer cancel()
		if err := srv.Shutdown(shutdownCtx); err != nil {
			log.Printf("sunucu düzgün kapatılamadı: %v", err)
		}
	}()

	log.Printf("backend %s portunda dinliyor", port)
	if err := srv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
		log.Fatalf("sunucu başlatılamadı: %v", err)
	}
	<-kapandi
}
