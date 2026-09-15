package auth

import (
	"context"
	"errors"
	"net/http"
	"slices"
	"strings"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"golang.org/x/crypto/bcrypt"
)

type contextKey string

const claimsContextKey contextKey = "auth_claims"

// Geçerli ekran izinleri. "kasa_ekrani" herkese açıktır, listede yer almaz.
const (
	PermGunSonu    = "gun_sonu"
	PermDashboard  = "dashboard"
	PermMusteriler = "musteriler"
)

var ValidPermissions = []string{PermGunSonu, PermDashboard, PermMusteriler}

// Purpose değerleri: tam yetkili oturum token'ları için boş string kalır
// (geriye dönük uyumluluk — eski token'larda bu alan hiç yoktu). TOTP giriş
// akışının ara adımlarında kullanılan kısa ömürlü token'lar bu alanla
// işaretlenir ki RequireAuth onları normal uçlarda reddedebilsin.
const (
	PurposeTOTPSetup   = "totp_setup"
	PurposeTOTPPending = "totp_pending"
)

type Claims struct {
	UserID      int64    `json:"user_id"`
	IsAdmin     bool     `json:"is_admin"`
	Permissions []string `json:"permissions"`
	Purpose     string   `json:"purpose,omitempty"`
	jwt.RegisteredClaims
}

// HashPassword bcrypt ile şifreyi hash'ler; düz metin şifre asla saklanmaz.
func HashPassword(password string) (string, error) {
	hash, err := bcrypt.GenerateFromPassword([]byte(password), bcrypt.DefaultCost)
	if err != nil {
		return "", err
	}
	return string(hash), nil
}

func CheckPassword(hash, password string) bool {
	return bcrypt.CompareHashAndPassword([]byte(hash), []byte(password)) == nil
}

// TokenIssuer JWT üretimi/doğrulaması için gizli anahtarı taşır.
type TokenIssuer struct {
	Secret []byte
	TTL    time.Duration
}

func (t *TokenIssuer) Issue(userID int64, isAdmin bool, permissions []string) (string, error) {
	claims := Claims{
		UserID:      userID,
		IsAdmin:     isAdmin,
		Permissions: permissions,
		RegisteredClaims: jwt.RegisteredClaims{
			ExpiresAt: jwt.NewNumericDate(time.Now().Add(t.TTL)),
			IssuedAt:  jwt.NewNumericDate(time.Now()),
		},
	}
	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	return token.SignedString(t.Secret)
}

// totpFlowTTL, TOTP kurulum/doğrulama akışının ara adımlarında kullanılan
// token'ların geçerlilik süresidir — tam oturum TTL'inden çok daha kısa
// tutulur, çünkü bu token'lar sadece giriş işlemi tamamlanana kadar geçerli
// olmalıdır.
const totpFlowTTL = 10 * time.Minute

// IssueLimited, TOTP giriş akışının ara adımları için (kurulum veya kod
// bekleniyor) kısa ömürlü, sınırlı bir token üretir. Bu token normal API
// uçlarında RequireAuth tarafından reddedilir; sadece TOTP uçlarında geçerlidir.
func (t *TokenIssuer) IssueLimited(userID int64, purpose string) (string, error) {
	claims := Claims{
		UserID:  userID,
		Purpose: purpose,
		RegisteredClaims: jwt.RegisteredClaims{
			ExpiresAt: jwt.NewNumericDate(time.Now().Add(totpFlowTTL)),
			IssuedAt:  jwt.NewNumericDate(time.Now()),
		},
	}
	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	return token.SignedString(t.Secret)
}

func (t *TokenIssuer) Parse(tokenString string) (*Claims, error) {
	claims := &Claims{}
	token, err := jwt.ParseWithClaims(tokenString, claims, func(token *jwt.Token) (any, error) {
		if _, ok := token.Method.(*jwt.SigningMethodHMAC); !ok {
			return nil, errors.New("beklenmeyen imzalama yöntemi")
		}
		return t.Secret, nil
	})
	if err != nil || !token.Valid {
		return nil, errors.New("geçersiz veya süresi dolmuş token")
	}
	return claims, nil
}

// RequireAuth gelen isteklerde Authorization: Bearer <token> başlığını
// doğrular ve claims'i context'e ekler. Vardiya boyunca uzun ömürlü
// tek bir oturum düşünüldüğü için token TTL'i görece uzun tutulur.
func (t *TokenIssuer) RequireAuth(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		header := r.Header.Get("Authorization")
		if !strings.HasPrefix(header, "Bearer ") {
			http.Error(w, `{"hata":"yetkilendirme başlığı eksik"}`, http.StatusUnauthorized)
			return
		}
		tokenString := strings.TrimPrefix(header, "Bearer ")
		claims, err := t.Parse(tokenString)
		if err != nil {
			http.Error(w, `{"hata":"`+err.Error()+`"}`, http.StatusUnauthorized)
			return
		}
		if claims.Purpose != "" {
			http.Error(w, `{"hata":"TOTP doğrulaması tamamlanmadan bu işlem yapılamaz"}`, http.StatusUnauthorized)
			return
		}
		ctx := context.WithValue(r.Context(), claimsContextKey, claims)
		next.ServeHTTP(w, r.WithContext(ctx))
	})
}

// RequireAdmin sadece is_admin=true olan kullanıcıların erişimine izin verir.
// Kullanıcı yönetimi ve fiyat kuralları gibi hassas işlemler için kullanılır;
// bu yetki personel izin listesi üzerinden verilemez, sadece is_admin bayrağıyla açılır.
func RequireAdmin(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		claims, ok := FromContext(r.Context())
		if !ok || !claims.IsAdmin {
			http.Error(w, `{"hata":"bu işlem için yönetici yetkisi gerekir"}`, http.StatusForbidden)
			return
		}
		next.ServeHTTP(w, r)
	})
}

// RequirePermission, is_admin=true olan kullanıcılara ya da izin listesinde
// verilen ekran iznine sahip personele erişim verir.
func RequirePermission(perm string) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			claims, ok := FromContext(r.Context())
			if !ok || (!claims.IsAdmin && !slices.Contains(claims.Permissions, perm)) {
				http.Error(w, `{"hata":"bu ekrana erişim yetkiniz yok"}`, http.StatusForbidden)
				return
			}
			next.ServeHTTP(w, r)
		})
	}
}

func FromContext(ctx context.Context) (*Claims, bool) {
	claims, ok := ctx.Value(claimsContextKey).(*Claims)
	return claims, ok
}
