package handlers

import (
	"context"
	"encoding/json"
	"net/http"
	"slices"
	"strconv"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"

	"parla-oyun-evi/backend/internal/auth"
)

type loginRequest struct {
	Username string `json:"username"`
	Password string `json:"password"`
	// CihazToken, daha önce "Bu cihazı hatırla" denmiş bir tarayıcıdan gelir.
	// Geçerliyse Authenticator kodu adımı atlanır (şifre yine doğrulanır).
	CihazToken string `json:"cihaz_token"`
}

// dummyPasswordHash: kullanıcı adı veritabanında bulunamadığında bile
// bcrypt karşılaştırması bu sabit hash'e karşı çalıştırılır. Böylece
// "kullanıcı yok" ve "kullanıcı var, şifre yanlış" yollarının işlem
// süresi ölçülebilir şekilde birbirinden ayrışmaz (zamanlama saldırısıyla
// kullanıcı adı varlığının tespit edilmesi engellenir).
const dummyPasswordHash = "$2a$10$C6UzMDM.H6dfI/f/IKcEeOgxQtdyBz.NFQr7RIfMwK6Tw2E4rHiqW"

// clientIP, hız sınırlama için isteğin geldiği IP'yi (port olmadan) döner.
// TrustProxy açıksa X-Forwarded-For'un en sağdaki değeri kullanılır: bu,
// güvenilen proxy'nin kendisinin eklediği değerdir; soldaki değerler
// istemci tarafından sahtelenebilir.
func (a *API) clientIP(r *http.Request) string {
	if a.TrustProxy {
		if xff := r.Header.Get("X-Forwarded-For"); xff != "" {
			parts := strings.Split(xff, ",")
			if ip := strings.TrimSpace(parts[len(parts)-1]); ip != "" {
				return ip
			}
		}
	}
	addr := r.RemoteAddr
	if i := strings.LastIndex(addr, ":"); i != -1 {
		return addr[:i]
	}
	return addr
}

// Login kullanıcı adı/şifreyi doğrular. Şifre doğruysa oturum hemen açılmaz:
// TOTP (Google Authenticator) her hesapta zorunlu olduğundan, kullanıcının
// totp_enabled durumuna göre ya kurulum akışına (totp_setup_required, henüz
// hiç TOTP kurmamışsa) ya da kod doğrulama akışına (totp_required, TOTP
// zaten kuruluysa) yönlendiren kısa ömürlü bir ara token döner. Tam oturum
// token'ı yalnızca /auth/totp/setup-confirm veya /auth/totp/verify-login
// başarılı olduğunda verilir.
func (a *API) Login(w http.ResponseWriter, r *http.Request) {
	ip := a.clientIP(r)
	if a.LoginLimiter != nil && !a.LoginLimiter.Izinli(ip) {
		writeError(w, http.StatusTooManyRequests, "çok fazla başarısız deneme, lütfen daha sonra tekrar deneyin")
		return
	}

	var req loginRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "Gönderilen bilgiler okunamadı, lütfen sayfayı yenileyip tekrar deneyin.")
		return
	}

	var userID int64
	var passwordHash string
	var isAdmin bool
	var permissions []string
	var totpEnabled bool
	err := a.DB.QueryRow(r.Context(),
		`SELECT id, password_hash, is_admin, permissions, totp_enabled FROM users WHERE username = $1`,
		req.Username,
	).Scan(&userID, &passwordHash, &isAdmin, &permissions, &totpEnabled)
	kullaniciBulunamadi := err != nil
	if kullaniciBulunamadi {
		// Var olmayan kullanıcı için de bcrypt karşılaştırması çalıştırılır
		// (yukarıdaki dummyPasswordHash'e karşı) — zamanlama farkını gizlemek içindir.
		passwordHash = dummyPasswordHash
	}
	if !auth.CheckPassword(passwordHash, req.Password) || kullaniciBulunamadi {
		writeError(w, http.StatusUnauthorized, "kullanıcı adı veya şifre hatalı")
		return
	}
	if a.LoginLimiter != nil {
		a.LoginLimiter.Basarili(ip)
	}

	if !totpEnabled {
		setupToken, err := a.Auth.IssueLimited(userID, auth.PurposeTOTPSetup)
		if err != nil {
			writeError(w, http.StatusInternalServerError, "Oturum belirteci oluşturulamadı, lütfen tekrar deneyin.")
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{
			"totp_setup_required": true,
			"setup_token":         setupToken,
		})
		return
	}

	// Hatırlanan bir cihazdan geliniyorsa kod sorulmaz: ikinci faktör, bu
	// cihazda daha önce girilen kodla bir kez doğrulanmıştı ve cihaz anahtarı
	// hâlâ geçerli (bkz. trusted_devices.go).
	if a.guvenilenCihazGecerliMi(r.Context(), userID, req.CihazToken) {
		a.finishLogin(w, r.Context(), userID, "")
		return
	}

	pendingToken, err := a.Auth.IssueLimited(userID, auth.PurposeTOTPPending)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "Oturum belirteci oluşturulamadı, lütfen tekrar deneyin.")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"totp_required": true,
		"pending_token": pendingToken,
	})
}

// totpFlowUser, TOTP akışı için gönderilen kısa ömürlü token'ı doğrular ve
// beklenen amaçla (purpose) eşleşmiyorsa/eşleşmeyen bir hesaba aitse false döner.
func (a *API) totpFlowUser(r *http.Request, wantPurpose string) (*auth.Claims, bool) {
	header := r.Header.Get("Authorization")
	if !strings.HasPrefix(header, "Bearer ") {
		return nil, false
	}
	claims, err := a.Auth.Parse(strings.TrimPrefix(header, "Bearer "))
	if err != nil || claims.Purpose != wantPurpose {
		return nil, false
	}
	return claims, true
}

// finishLogin, TOTP doğrulaması (kurulum ya da giriş) başarıyla tamamlandığında
// tam yetkili oturum token'ını üretip normal /auth/login yanıtıyla aynı
// şekilde döner.
// cihazToken boş değilse ("Bu cihazı hatırla" işaretlenmişse) yanıta eklenir;
// tarayıcı bunu saklar ve sonraki girişlerde gönderir.
func (a *API) finishLogin(w http.ResponseWriter, ctx context.Context, userID int64, cihazToken string) {
	var isAdmin bool
	var permissions []string
	if err := a.DB.QueryRow(ctx, `SELECT is_admin, permissions FROM users WHERE id = $1`, userID).
		Scan(&isAdmin, &permissions); err != nil {
		writeError(w, http.StatusInternalServerError, "Kullanıcı bilgileri okunamadı, lütfen tekrar deneyin.")
		return
	}
	token, err := a.Auth.Issue(userID, isAdmin, permissions)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "Oturum belirteci oluşturulamadı, lütfen tekrar deneyin.")
		return
	}
	yanit := map[string]any{
		"token":       token,
		"user_id":     userID,
		"is_admin":    isAdmin,
		"permissions": permissions,
	}
	if cihazToken != "" {
		yanit["cihaz_token"] = cihazToken
	}
	writeJSON(w, http.StatusOK, yanit)
}

type totpSetupInitResponse struct {
	Secret     string `json:"secret"`
	OtpauthURI string `json:"otpauth_uri"`
}

// SetupInitTOTP, henüz TOTP kurmamış bir kullanıcı için yeni bir sır üretir
// (veya QR sayfası yenilenirse aynı, henüz onaylanmamış sırrı tekrar döner)
// ve kimlik doğrulayıcı uygulamanın okuyacağı otpauth:// URI'sini verir.
// TOTP henüz etkinleşmez; bunun için setup-confirm'e doğru kod gönderilmelidir.
func (a *API) SetupInitTOTP(w http.ResponseWriter, r *http.Request) {
	claims, ok := a.totpFlowUser(r, auth.PurposeTOTPSetup)
	if !ok {
		writeError(w, http.StatusUnauthorized, "Oturum süresi dolmuş olabilir, lütfen tekrar giriş yapın.")
		return
	}

	var username string
	var existingSecret *string
	if err := a.DB.QueryRow(r.Context(),
		`SELECT username, totp_secret FROM users WHERE id = $1`, claims.UserID,
	).Scan(&username, &existingSecret); err != nil {
		writeError(w, http.StatusNotFound, "kullanıcı bulunamadı")
		return
	}

	secret := ""
	if existingSecret != nil {
		secret = *existingSecret
	}
	if secret == "" {
		var err error
		secret, err = auth.GenerateTOTPSecret()
		if err != nil {
			writeServerError(w, http.StatusInternalServerError, "TOTP sırrı üretilemedi", err)
			return
		}
		if _, err := a.DB.Exec(r.Context(),
			`UPDATE users SET totp_secret = $1 WHERE id = $2`, secret, claims.UserID,
		); err != nil {
			writeServerError(w, http.StatusInternalServerError, "TOTP sırrı kaydedilemedi", err)
			return
		}
	}

	writeJSON(w, http.StatusOK, totpSetupInitResponse{
		Secret:     secret,
		OtpauthURI: auth.TOTPProvisioningURI("Parla Oyun Evi", username, secret),
	})
}

type totpCodeRequest struct {
	Code string `json:"code"`
	// CihaziHatirla true ise bu tarayıcıya bir cihaz anahtarı verilir ve
	// süresi dolana kadar kod adımı atlanır.
	CihaziHatirla bool `json:"cihazi_hatirla"`
}

// cihaziHatirlaIstendiyse, istenmişse cihaz anahtarını üretir. Üretilemezse
// boş döner: giriş yine tamamlanır, kullanıcı bir dahaki sefere kodu girer.
func (a *API) cihaziHatirlaIstendiyse(r *http.Request, istendi bool, userID int64) string {
	if !istendi {
		return ""
	}
	token, err := a.guvenilenCihazKaydet(r.Context(), userID, r.UserAgent())
	if err != nil {
		return ""
	}
	return token
}

// SetupConfirmTOTP, kullanıcının kimlik doğrulayıcı uygulamadan okuduğu ilk
// kodu doğrular; doğruysa TOTP kalıcı olarak etkinleşir ve tam oturum
// token'ı verilerek giriş tamamlanır.
func (a *API) SetupConfirmTOTP(w http.ResponseWriter, r *http.Request) {
	claims, ok := a.totpFlowUser(r, auth.PurposeTOTPSetup)
	if !ok {
		writeError(w, http.StatusUnauthorized, "Oturum süresi dolmuş olabilir, lütfen tekrar giriş yapın.")
		return
	}
	ip := a.clientIP(r)
	if a.LoginLimiter != nil && !a.LoginLimiter.Izinli("totp:"+ip) {
		writeError(w, http.StatusTooManyRequests, "çok fazla başarısız deneme, lütfen daha sonra tekrar deneyin")
		return
	}

	var req totpCodeRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "Gönderilen bilgiler okunamadı, lütfen sayfayı yenileyip tekrar deneyin.")
		return
	}

	var secret *string
	if err := a.DB.QueryRow(r.Context(),
		`SELECT totp_secret FROM users WHERE id = $1`, claims.UserID,
	).Scan(&secret); err != nil || secret == nil {
		writeError(w, http.StatusConflict, "önce QR kodu okutup kurulumu başlatın")
		return
	}
	if !auth.VerifyTOTPCode(*secret, req.Code) {
		writeError(w, http.StatusUnauthorized, "kod hatalı veya süresi dolmuş")
		return
	}
	if a.LoginLimiter != nil {
		a.LoginLimiter.Basarili("totp:" + ip)
	}

	if _, err := a.DB.Exec(r.Context(),
		`UPDATE users SET totp_enabled = true WHERE id = $1`, claims.UserID,
	); err != nil {
		writeServerError(w, http.StatusInternalServerError, "TOTP etkinleştirilemedi", err)
		return
	}
	a.finishLogin(w, r.Context(), claims.UserID, a.cihaziHatirlaIstendiyse(r, req.CihaziHatirla, claims.UserID))
}

// VerifyLoginTOTP, TOTP'si zaten etkin bir kullanıcının girdiği 6 haneli
// kodu doğrular ve doğruysa tam oturum token'ı verir.
func (a *API) VerifyLoginTOTP(w http.ResponseWriter, r *http.Request) {
	claims, ok := a.totpFlowUser(r, auth.PurposeTOTPPending)
	if !ok {
		writeError(w, http.StatusUnauthorized, "Oturum süresi dolmuş olabilir, lütfen tekrar giriş yapın.")
		return
	}
	ip := a.clientIP(r)
	if a.LoginLimiter != nil && !a.LoginLimiter.Izinli("totp:"+ip) {
		writeError(w, http.StatusTooManyRequests, "çok fazla başarısız deneme, lütfen daha sonra tekrar deneyin")
		return
	}

	var req totpCodeRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "Gönderilen bilgiler okunamadı, lütfen sayfayı yenileyip tekrar deneyin.")
		return
	}

	var secret *string
	if err := a.DB.QueryRow(r.Context(),
		`SELECT totp_secret FROM users WHERE id = $1`, claims.UserID,
	).Scan(&secret); err != nil || secret == nil {
		writeError(w, http.StatusConflict, "TOTP kurulumu eksik, lütfen yöneticinize bildirin")
		return
	}
	if !auth.VerifyTOTPCode(*secret, req.Code) {
		writeError(w, http.StatusUnauthorized, "kod hatalı veya süresi dolmuş")
		return
	}
	if a.LoginLimiter != nil {
		a.LoginLimiter.Basarili("totp:" + ip)
	}

	a.finishLogin(w, r.Context(), claims.UserID, a.cihaziHatirlaIstendiyse(r, req.CihaziHatirla, claims.UserID))
}

// ResetUserTOTP bir kullanıcının TOTP kaydını siler (telefon kaybı/değişimi
// gibi durumlarda) — kullanıcı bir sonraki girişte kurulum akışına düşer ve
// yeniden QR kod okutur. Sadece yönetici erişebilir.
func (a *API) ResetUserTOTP(w http.ResponseWriter, r *http.Request) {
	idStr := chi.URLParam(r, "id")
	id, err := strconv.ParseInt(idStr, 10, 64)
	if err != nil {
		writeError(w, http.StatusBadRequest, "Geçersiz kullanıcı numarası.")
		return
	}
	tag, err := a.DB.Exec(r.Context(),
		`UPDATE users SET totp_secret = NULL, totp_enabled = false WHERE id = $1`, id,
	)
	if err != nil {
		writeServerError(w, http.StatusInternalServerError, "TOTP sıfırlanamadı", err)
		return
	}
	if tag.RowsAffected() == 0 {
		writeError(w, http.StatusNotFound, "kullanıcı bulunamadı")
		return
	}
	// TOTP sıfırlandığında hatırlanan cihazlar da iptal edilir; aksi halde o
	// cihazlar kod sorulmadan girmeye devam ederdi.
	if err := a.guvenilenCihazlariSil(r.Context(), id); err != nil {
		writeServerError(w, http.StatusInternalServerError, "hatırlanan cihazlar iptal edilemedi", err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"sifirlandi": true})
}

func validPermissions(perms []string) bool {
	for _, p := range perms {
		if !slices.Contains(auth.ValidPermissions, p) {
			return false
		}
	}
	return true
}

// roleFromIsAdmin sadece eski `role` sütununun CHECK kısıtını karşılamak
// için kullanılır; yetkilendirme mantığı artık is_admin/permissions üzerinden yürür.
func roleFromIsAdmin(isAdmin bool) string {
	if isAdmin {
		return "yonetici"
	}
	return "kasiyer"
}

type createUserRequest struct {
	Username    string   `json:"username"`
	Password    string   `json:"password"`
	IsAdmin     bool     `json:"is_admin"`
	Permissions []string `json:"permissions"`
}

// CreateUser sadece is_admin=true olan kullanıcılar tarafından çağrılabilir
// (bkz. router'daki RequireAdmin zinciri). is_admin=true olan hesaplar tüm
// ekranlara ve yönetim işlemlerine erişir; diğerleri sadece permissions
// listesinde belirtilen ekranları görebilir.
func (a *API) CreateUser(w http.ResponseWriter, r *http.Request) {
	var req createUserRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "Gönderilen bilgiler okunamadı, lütfen sayfayı yenileyip tekrar deneyin.")
		return
	}
	if req.Username == "" || len(req.Password) < 6 {
		writeError(w, http.StatusBadRequest, "kullanıcı adı zorunlu, şifre en az 6 karakter olmalı")
		return
	}
	if len(req.Username) > 64 || len(req.Password) > 200 {
		writeError(w, http.StatusBadRequest, "kullanıcı adı veya şifre çok uzun")
		return
	}
	if req.Permissions == nil {
		req.Permissions = []string{}
	}
	if !validPermissions(req.Permissions) {
		writeError(w, http.StatusBadRequest, "Geçersiz yetki/izin değeri gönderildi.")
		return
	}

	hash, err := auth.HashPassword(req.Password)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "Şifre işlenemedi, lütfen tekrar deneyin.")
		return
	}

	var id int64
	err = a.DB.QueryRow(r.Context(),
		`INSERT INTO users (username, password_hash, role, is_admin, permissions)
		 VALUES ($1, $2, $3, $4, $5) RETURNING id`,
		req.Username, hash, roleFromIsAdmin(req.IsAdmin), req.IsAdmin, req.Permissions,
	).Scan(&id)
	if err != nil {
		writeServerError(w, http.StatusConflict, "kullanıcı oluşturulamadı", err)
		return
	}

	writeJSON(w, http.StatusCreated, map[string]any{
		"id": id, "username": req.Username, "is_admin": req.IsAdmin, "permissions": req.Permissions,
	})
}

type userListItem struct {
	ID          int64    `json:"id"`
	Username    string   `json:"username"`
	IsAdmin     bool     `json:"is_admin"`
	Permissions []string `json:"permissions"`
	CreatedAt   string   `json:"created_at"`
	TotpEnabled bool     `json:"totp_enabled"`
}

// ListUsers tüm personel hesaplarını listeler. Sadece yönetici erişebilir.
func (a *API) ListUsers(w http.ResponseWriter, r *http.Request) {
	rows, err := a.DB.Query(r.Context(), `
		SELECT id, username, is_admin, permissions, created_at, totp_enabled
		FROM users ORDER BY created_at ASC`)
	if err != nil {
		writeServerError(w, http.StatusInternalServerError, "kullanıcılar alınamadı", err)
		return
	}
	defer rows.Close()

	result := []userListItem{}
	for rows.Next() {
		var u userListItem
		var createdAt time.Time
		if err := rows.Scan(&u.ID, &u.Username, &u.IsAdmin, &u.Permissions, &createdAt, &u.TotpEnabled); err != nil {
			writeServerError(w, http.StatusInternalServerError, "satır okunamadı", err)
			return
		}
		u.CreatedAt = createdAt.Format("2006-01-02 15:04")
		result = append(result, u)
	}
	writeJSON(w, http.StatusOK, result)
}

type updateUserRequest struct {
	Username    string   `json:"username"`
	Password    string   `json:"password,omitempty"`
	IsAdmin     bool     `json:"is_admin"`
	Permissions []string `json:"permissions"`
}

// UpdateUser bir personel hesabının kullanıcı adını, yetkilerini ve
// (belirtilmişse) şifresini günceller. Sadece yönetici erişebilir.
// Bir yöneticinin kendi is_admin bayrağını kaldırması engellenir; bu,
// sistemde hiç yönetici kalmaması riskini önler.
func (a *API) UpdateUser(w http.ResponseWriter, r *http.Request) {
	claims, ok := auth.FromContext(r.Context())
	if !ok {
		writeError(w, http.StatusUnauthorized, "Yetkilendirme bilgisi bulunamadı, lütfen tekrar giriş yapın.")
		return
	}

	idStr := chi.URLParam(r, "id")
	id, err := strconv.ParseInt(idStr, 10, 64)
	if err != nil {
		writeError(w, http.StatusBadRequest, "Geçersiz kullanıcı numarası.")
		return
	}

	var req updateUserRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "Gönderilen bilgiler okunamadı, lütfen sayfayı yenileyip tekrar deneyin.")
		return
	}
	if req.Username == "" {
		writeError(w, http.StatusBadRequest, "kullanıcı adı zorunlu")
		return
	}
	if req.Password != "" && len(req.Password) < 6 {
		writeError(w, http.StatusBadRequest, "şifre en az 6 karakter olmalı")
		return
	}
	if len(req.Username) > 64 || len(req.Password) > 200 {
		writeError(w, http.StatusBadRequest, "kullanıcı adı veya şifre çok uzun")
		return
	}
	if req.Permissions == nil {
		req.Permissions = []string{}
	}
	if !validPermissions(req.Permissions) {
		writeError(w, http.StatusBadRequest, "Geçersiz yetki/izin değeri gönderildi.")
		return
	}
	if id == claims.UserID && !req.IsAdmin {
		writeError(w, http.StatusBadRequest, "kendi yönetici yetkinizi kaldıramazsınız")
		return
	}

	if req.Password != "" {
		hash, err := auth.HashPassword(req.Password)
		if err != nil {
			writeError(w, http.StatusInternalServerError, "Şifre işlenemedi, lütfen tekrar deneyin.")
			return
		}
		_, err = a.DB.Exec(r.Context(), `
			UPDATE users SET username = $1, password_hash = $2, role = $3, is_admin = $4, permissions = $5
			WHERE id = $6`,
			req.Username, hash, roleFromIsAdmin(req.IsAdmin), req.IsAdmin, req.Permissions, id,
		)
		if err != nil {
			writeServerError(w, http.StatusConflict, "kullanıcı güncellenemedi", err)
			return
		}
	} else {
		tag, err := a.DB.Exec(r.Context(), `
			UPDATE users SET username = $1, role = $2, is_admin = $3, permissions = $4
			WHERE id = $5`,
			req.Username, roleFromIsAdmin(req.IsAdmin), req.IsAdmin, req.Permissions, id,
		)
		if err != nil {
			writeServerError(w, http.StatusConflict, "kullanıcı güncellenemedi", err)
			return
		}
		if tag.RowsAffected() == 0 {
			writeError(w, http.StatusNotFound, "kullanıcı bulunamadı")
			return
		}
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"id": id, "username": req.Username, "is_admin": req.IsAdmin, "permissions": req.Permissions,
	})
}

// DeleteUser bir personel hesabını siler. Sadece yönetici erişebilir;
// kullanıcının kendi hesabını silmesi engellenir.
func (a *API) DeleteUser(w http.ResponseWriter, r *http.Request) {
	claims, ok := auth.FromContext(r.Context())
	if !ok {
		writeError(w, http.StatusUnauthorized, "Yetkilendirme bilgisi bulunamadı, lütfen tekrar giriş yapın.")
		return
	}

	idStr := chi.URLParam(r, "id")
	id, err := strconv.ParseInt(idStr, 10, 64)
	if err != nil {
		writeError(w, http.StatusBadRequest, "Geçersiz kullanıcı numarası.")
		return
	}
	if id == claims.UserID {
		writeError(w, http.StatusBadRequest, "kendi hesabınızı silemezsiniz")
		return
	}

	tag, err := a.DB.Exec(r.Context(), `DELETE FROM users WHERE id = $1`, id)
	if err != nil {
		writeServerError(w, http.StatusInternalServerError, "kullanıcı silinemedi", err)
		return
	}
	if tag.RowsAffected() == 0 {
		writeError(w, http.StatusNotFound, "kullanıcı bulunamadı")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"silindi": true})
}
