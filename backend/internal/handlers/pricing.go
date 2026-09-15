package handlers

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"sort"
	"time"

	"github.com/jackc/pgx/v5"

	"parla-oyun-evi/backend/internal/auth"
)

// querier, hem *pgxpool.Pool hem de pgx.Tx tarafından karşılanan ortak
// arayüzdür; fiyat politikası okuma yardımcı fonksiyonları hem doğrudan
// havuzdan (GET uçları) hem de bir işlem (tx) içinden (oturum kapatma
// akışları) aynı şekilde çağrılabilsin diye kullanılır.
type querier interface {
	QueryRow(ctx context.Context, sql string, args ...any) pgx.Row
	Query(ctx context.Context, sql string, args ...any) (pgx.Rows, error)
}

type createPricingRuleRequest struct {
	KurusPerDakika int64 `json:"kurus_per_dakika"`
}

// GetActivePricingRule şu an geçerli olan fiyat kuralını döner.
func (a *API) GetActivePricingRule(w http.ResponseWriter, r *http.Request) {
	var id int64
	var kurusPerDakika int64
	var effectiveFrom time.Time
	err := a.DB.QueryRow(r.Context(), `
		SELECT id, kurus_per_dakika, effective_from FROM pricing_rules
		WHERE effective_from <= now() ORDER BY effective_from DESC LIMIT 1`,
	).Scan(&id, &kurusPerDakika, &effectiveFrom)
	if err != nil {
		writeError(w, http.StatusNotFound, "Aktif bir fiyat kuralı tanımlı değil, lütfen yöneticinize bildirin.")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"id": id, "kurus_per_dakika": kurusPerDakika,
		"effective_from": effectiveFrom.Format("2006-01-02 15:04:05"),
	})
}

type pricingRuleItem struct {
	ID             int64  `json:"id"`
	KurusPerDakika int64  `json:"kurus_per_dakika"`
	EffectiveFrom  string `json:"effective_from"`
}

// ListPricingRules tüm fiyat kurallarının (geçmiş dahil) geçmişini,
// en yeniden en eskiye doğru döner. Sadece yönetici erişebilir.
func (a *API) ListPricingRules(w http.ResponseWriter, r *http.Request) {
	rows, err := a.DB.Query(r.Context(), `
		SELECT id, kurus_per_dakika, effective_from
		FROM pricing_rules
		ORDER BY effective_from DESC`)
	if err != nil {
		writeServerError(w, http.StatusInternalServerError, "fiyat kuralları alınamadı", err)
		return
	}
	defer rows.Close()

	result := []pricingRuleItem{}
	for rows.Next() {
		var item pricingRuleItem
		var effectiveFrom time.Time
		if err := rows.Scan(&item.ID, &item.KurusPerDakika, &effectiveFrom); err != nil {
			writeServerError(w, http.StatusInternalServerError, "satır okunamadı", err)
			return
		}
		item.EffectiveFrom = effectiveFrom.Format("2006-01-02 15:04:05")
		result = append(result, item)
	}
	writeJSON(w, http.StatusOK, result)
}

// CreatePricingRule yeni bir fiyat kuralı ekler. Kural versiyonlanır: yeni
// kayıt eklemek geçmiş oturumların hesaplanmış tutarlarını etkilemez.
// effective_from veritabanında now() olarak atanır, yani kural kaydedildiği
// andan itibaren geçerli olur; o ana kadar kapanan oturumlar eski kuralla
// hesaplanmış olarak korunur.
func (a *API) CreatePricingRule(w http.ResponseWriter, r *http.Request) {
	claims, ok := auth.FromContext(r.Context())
	if !ok {
		writeError(w, http.StatusUnauthorized, "Yetkilendirme bilgisi bulunamadı, lütfen tekrar giriş yapın.")
		return
	}

	var req createPricingRuleRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "Gönderilen bilgiler okunamadı, lütfen sayfayı yenileyip tekrar deneyin.")
		return
	}
	if req.KurusPerDakika < 0 {
		writeError(w, http.StatusBadRequest, "Dakika ücreti negatif olamaz.")
		return
	}

	var id int64
	var effectiveFrom time.Time
	err := a.DB.QueryRow(r.Context(), `
		INSERT INTO pricing_rules (kurus_per_dakika, created_by) VALUES ($1, $2)
		RETURNING id, effective_from`,
		req.KurusPerDakika, claims.UserID,
	).Scan(&id, &effectiveFrom)
	if err != nil {
		writeServerError(w, http.StatusInternalServerError, "fiyat kuralı oluşturulamadı", err)
		return
	}
	writeJSON(w, http.StatusCreated, map[string]any{
		"id": id, "kurus_per_dakika": req.KurusPerDakika,
		"effective_from": effectiveFrom.Format("2006-01-02 15:04:05"),
	})
}

// ---------------------------------------------------------------------
// Blok (aralık) bazlı fiyat politikası — oturum kapatma ücretlendirmesi
// bunu kullanır. Yukarıdaki pricing_rules/kurus_per_dakika ise sadece
// paket satın alma fiyatlandırması için ayrı olarak kullanılmaya devam eder.
// ---------------------------------------------------------------------

type pricingTierItem struct {
	ID         int64 `json:"id"`
	Sira       int   `json:"sira"`
	MinDakika  int64 `json:"min_dakika"`
	MaxDakika  int64 `json:"max_dakika"`
	TutarKurus int64 `json:"tutar_kurus"`
}

type pricingPolicyItem struct {
	VersionID     int64             `json:"version_id"`
	EffectiveFrom string            `json:"effective_from"`
	Tiers         []pricingTierItem `json:"tiers"`
}

// politikayiOku, verilen versiyon id'sine ait blokları sıralı olarak döner.
func politikayiOku(ctx context.Context, q querier, versionID int64, effectiveFrom time.Time) (pricingPolicyItem, error) {
	rows, err := q.Query(ctx, `
		SELECT id, sira, min_dakika, max_dakika, tutar_kurus
		FROM pricing_tiers WHERE version_id = $1 ORDER BY sira ASC`, versionID)
	if err != nil {
		return pricingPolicyItem{}, err
	}
	defer rows.Close()

	policy := pricingPolicyItem{
		VersionID:     versionID,
		EffectiveFrom: effectiveFrom.Format("2006-01-02 15:04:05"),
		Tiers:         []pricingTierItem{},
	}
	for rows.Next() {
		var t pricingTierItem
		if err := rows.Scan(&t.ID, &t.Sira, &t.MinDakika, &t.MaxDakika, &t.TutarKurus); err != nil {
			return pricingPolicyItem{}, err
		}
		policy.Tiers = append(policy.Tiers, t)
	}
	if err := rows.Err(); err != nil {
		return pricingPolicyItem{}, err
	}
	return policy, nil
}

// aktifPolitikaVersiyonu, şu an geçerli fiyat politikası versiyonunun
// id ve geçerlilik başlangıcını döner.
func aktifPolitikaVersiyonu(ctx context.Context, q querier) (int64, time.Time, error) {
	var versionID int64
	var effectiveFrom time.Time
	err := q.QueryRow(ctx, `
		SELECT id, effective_from FROM pricing_tier_versions
		WHERE effective_from <= now() ORDER BY effective_from DESC LIMIT 1`,
	).Scan(&versionID, &effectiveFrom)
	return versionID, effectiveFrom, err
}

// tierUcretiniHesapla, verilen dakika süresinin düştüğü fiyat bloğunu aktif
// politikadan bulur ve ücreti döner. Oturum kapatma akışlarında (sessions.go)
// bir işlem (tx) içinden çağrılır ki hesaplama ile oturum güncellemesi aynı
// transaction'da tutarlı kalsın.
//
// Tanımlı bloklar en fazla son bloğun bitişine (turDakika) kadar bir "tur"
// oluşturur. Süre bu turu aşarsa ücret modüler (döngüsel) hesaplanır: tam tur
// sayısı kadar son bloğun ücreti eklenir, kalan süre ise normal blok
// aramasıyla fiyatlandırılır. Örnek: bloklar 0-30=50, 31-60=90 (tur=60 dk)
// iken 165 dk kalan müşteri 2 tam tur (2*90) + kalan 45 dk'nın bloğu (90) =
// 270 öder.
func tierUcretiniHesapla(ctx context.Context, q querier, dakika int64) (versionID int64, tierID int64, tutarKurus int64, err error) {
	if dakika < 0 {
		dakika = 0
	}
	versionID, _, err = aktifPolitikaVersiyonu(ctx, q)
	if err != nil {
		return 0, 0, 0, fmt.Errorf("aktif fiyat politikası bulunamadı: %w", err)
	}

	rows, err := q.Query(ctx, `
		SELECT id, min_dakika, max_dakika, tutar_kurus FROM pricing_tiers
		WHERE version_id = $1 ORDER BY sira ASC`, versionID)
	if err != nil {
		return 0, 0, 0, err
	}
	defer rows.Close()

	type tierRow struct {
		id                   int64
		minDakika, maxDakika int64
		tutar                int64
	}
	var tiers []tierRow
	for rows.Next() {
		var t tierRow
		if err = rows.Scan(&t.id, &t.minDakika, &t.maxDakika, &t.tutar); err != nil {
			return 0, 0, 0, err
		}
		tiers = append(tiers, t)
	}
	if err = rows.Err(); err != nil {
		return 0, 0, 0, err
	}
	if len(tiers) == 0 {
		return 0, 0, 0, fmt.Errorf("aktif fiyat politikasında blok tanımlı değil")
	}

	sonTier := tiers[len(tiers)-1]
	turDakika := sonTier.maxDakika

	kalanDakika := dakika
	tamTurSayisi := int64(0)
	if dakika > turDakika {
		tamTurSayisi = dakika / turDakika
		kalanDakika = dakika % turDakika
	}

	if kalanDakika == 0 {
		return versionID, sonTier.id, tamTurSayisi * sonTier.tutar, nil
	}
	for _, t := range tiers {
		if kalanDakika >= t.minDakika && kalanDakika <= t.maxDakika {
			return versionID, t.id, tamTurSayisi*sonTier.tutar + t.tutar, nil
		}
	}
	return 0, 0, 0, fmt.Errorf("süreye (%d dk) uygun bir fiyat bloğu bulunamadı", dakika)
}

// GetActivePricingPolicy şu an geçerli blok fiyat politikasını döner. Kasa
// ekranındaki canlı tutar önizlemesi bunu kullanır.
func (a *API) GetActivePricingPolicy(w http.ResponseWriter, r *http.Request) {
	versionID, effectiveFrom, err := aktifPolitikaVersiyonu(r.Context(), a.DB)
	if err != nil {
		writeError(w, http.StatusNotFound, "Aktif bir fiyat politikası tanımlı değil, lütfen yöneticinize bildirin.")
		return
	}
	policy, err := politikayiOku(r.Context(), a.DB, versionID, effectiveFrom)
	if err != nil {
		writeServerError(w, http.StatusInternalServerError, "fiyat politikası alınamadı", err)
		return
	}
	writeJSON(w, http.StatusOK, policy)
}

// ListPricingTierVersions tüm blok fiyat politikalarının (geçmiş dahil)
// geçmişini, en yeniden en eskiye doğru döner. Sadece yönetici erişebilir.
func (a *API) ListPricingTierVersions(w http.ResponseWriter, r *http.Request) {
	rows, err := a.DB.Query(r.Context(), `
		SELECT id, effective_from FROM pricing_tier_versions ORDER BY effective_from DESC`)
	if err != nil {
		writeServerError(w, http.StatusInternalServerError, "fiyat politikaları alınamadı", err)
		return
	}
	type versionRow struct {
		id            int64
		effectiveFrom time.Time
	}
	var versions []versionRow
	for rows.Next() {
		var v versionRow
		if err := rows.Scan(&v.id, &v.effectiveFrom); err != nil {
			rows.Close()
			writeServerError(w, http.StatusInternalServerError, "satır okunamadı", err)
			return
		}
		versions = append(versions, v)
	}
	rows.Close()

	result := make([]pricingPolicyItem, 0, len(versions))
	for _, v := range versions {
		policy, err := politikayiOku(r.Context(), a.DB, v.id, v.effectiveFrom)
		if err != nil {
			writeServerError(w, http.StatusInternalServerError, "fiyat politikası alınamadı", err)
			return
		}
		result = append(result, policy)
	}
	writeJSON(w, http.StatusOK, result)
}

type createPricingTierRequest struct {
	MinDakika  int64 `json:"min_dakika"`
	MaxDakika  int64 `json:"max_dakika"`
	TutarKurus int64 `json:"tutar_kurus"`
}

type createPricingPolicyRequest struct {
	Tiers []createPricingTierRequest `json:"tiers"`
}

// CreatePricingTierVersion yeni bir blok fiyat politikası (tiers seti) ekler.
// Versiyonlanır: yeni kayıt eklemek geçmiş kapanmış oturumların hesaplanmış
// tutarlarını etkilemez, kaydedildiği andan itibaren geçerli olur.
// Bloklar 0 dakikadan başlayıp aralıksız ve çakışmasız olmalıdır; her blokta
// (son blok dahil) üst sınır zorunludur — üst sınırsız blok yoktur, son
// bloğun bitişi bir "tur" tanımlar ve bunu aşan süreler tierUcretiniHesapla
// içinde modüler (döngüsel) olarak fiyatlandırılır.
func (a *API) CreatePricingTierVersion(w http.ResponseWriter, r *http.Request) {
	claims, ok := auth.FromContext(r.Context())
	if !ok {
		writeError(w, http.StatusUnauthorized, "Yetkilendirme bilgisi bulunamadı, lütfen tekrar giriş yapın.")
		return
	}

	var req createPricingPolicyRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "Gönderilen bilgiler okunamadı, lütfen sayfayı yenileyip tekrar deneyin.")
		return
	}
	if len(req.Tiers) == 0 {
		writeError(w, http.StatusBadRequest, "en az bir fiyat bloğu tanımlanmalıdır")
		return
	}
	sort.Slice(req.Tiers, func(i, j int) bool { return req.Tiers[i].MinDakika < req.Tiers[j].MinDakika })

	if req.Tiers[0].MinDakika != 0 {
		writeError(w, http.StatusBadRequest, "ilk blok 0 dakikadan başlamalıdır")
		return
	}
	for i, t := range req.Tiers {
		if t.MinDakika < 0 {
			writeError(w, http.StatusBadRequest, "blok başlangıç dakikası negatif olamaz")
			return
		}
		if t.TutarKurus < 0 {
			writeError(w, http.StatusBadRequest, "blok ücreti negatif olamaz")
			return
		}
		if t.MaxDakika < t.MinDakika {
			writeError(w, http.StatusBadRequest, "blok üst sınırı alt sınırından küçük olamaz")
			return
		}
		if i < len(req.Tiers)-1 && req.Tiers[i+1].MinDakika != t.MaxDakika+1 {
			writeError(w, http.StatusBadRequest, "bloklar aralıksız ve çakışmasız olmalıdır (her blok bir öncekinin bittiği dakikadan devam etmelidir)")
			return
		}
	}
	// Blok süreleri sabittir (30 dk, 60 dk, 90 dk, 2 saat, 3 saat, 5 saat,
	// 10 saat); Fiyat Politikası ekranında yalnızca ücretler güncellenir.
	// Aynı liste frontend'de (pages/FiyatPolitikasi.tsx) ve varsayılan
	// fiyatları yazan 0015 migration'ında da tanımlıdır.
	sabitBlokBitisleri := []int64{30, 60, 90, 120, 180, 300, 600}
	if len(req.Tiers) != len(sabitBlokBitisleri) {
		writeError(w, http.StatusBadRequest, "Fiyat blokları sabittir, yalnızca ücretler güncellenebilir.")
		return
	}
	for i, t := range req.Tiers {
		if t.MaxDakika != sabitBlokBitisleri[i] {
			writeError(w, http.StatusBadRequest, "Fiyat blokları sabittir, yalnızca ücretler güncellenebilir.")
			return
		}
	}

	ctx := r.Context()
	tx, err := a.DB.Begin(ctx)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "İşlem başlatılamadı, lütfen tekrar deneyin.")
		return
	}
	defer tx.Rollback(ctx)

	var versionID int64
	var effectiveFrom time.Time
	if err := tx.QueryRow(ctx,
		`INSERT INTO pricing_tier_versions (created_by) VALUES ($1) RETURNING id, effective_from`,
		claims.UserID,
	).Scan(&versionID, &effectiveFrom); err != nil {
		writeServerError(w, http.StatusInternalServerError, "fiyat politikası oluşturulamadı", err)
		return
	}

	result := pricingPolicyItem{
		VersionID:     versionID,
		EffectiveFrom: effectiveFrom.Format("2006-01-02 15:04:05"),
		Tiers:         make([]pricingTierItem, 0, len(req.Tiers)),
	}
	for i, t := range req.Tiers {
		var id int64
		if err := tx.QueryRow(ctx, `
			INSERT INTO pricing_tiers (version_id, sira, min_dakika, max_dakika, tutar_kurus)
			VALUES ($1, $2, $3, $4, $5) RETURNING id`,
			versionID, i, t.MinDakika, t.MaxDakika, t.TutarKurus,
		).Scan(&id); err != nil {
			writeServerError(w, http.StatusInternalServerError, "fiyat bloğu oluşturulamadı", err)
			return
		}
		result.Tiers = append(result.Tiers, pricingTierItem{
			ID: id, Sira: i, MinDakika: t.MinDakika, MaxDakika: t.MaxDakika, TutarKurus: t.TutarKurus,
		})
	}

	if err := tx.Commit(ctx); err != nil {
		writeError(w, http.StatusInternalServerError, "İşlem tamamlanamadı, lütfen tekrar deneyin.")
		return
	}
	writeJSON(w, http.StatusCreated, result)
}
