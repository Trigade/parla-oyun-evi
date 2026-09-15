package handlers

import (
	"context"
	"encoding/json"
	"net/http"
	"strconv"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"

	"parla-oyun-evi/backend/internal/auth"
)

// dusPaketVeHesapla bir oturum kapatılırken müşterinin süresi dolmamış paket
// bakiyelerinden mümkün olduğunca dakika düşer (en yakın zamanda dolacak
// paketten başlayarak). Kalan (paketle karşılanamayan) dakika, çağıran tarafça
// normal dakika ücretinden tahsil edilir. Satırlar FOR UPDATE ile kilitlenir
// ki eşzamanlı iki oturum kapatma aynı bakiyeyi iki kez kullanamasın.
func dusPaketVeHesapla(ctx context.Context, tx pgx.Tx, customerID int64, toplamDakika int64) (int64, error) {
	if toplamDakika <= 0 {
		return 0, nil
	}

	rows, err := tx.Query(ctx, `
		SELECT id, kalan_dakika FROM customer_packages
		WHERE customer_id = $1 AND kalan_dakika > 0 AND gecerlilik_bitis > now()
		ORDER BY gecerlilik_bitis ASC
		FOR UPDATE`,
		customerID,
	)
	if err != nil {
		return 0, err
	}
	type paketSatir struct {
		id     int64
		dakika int64
	}
	var paketler []paketSatir
	for rows.Next() {
		var p paketSatir
		if err := rows.Scan(&p.id, &p.dakika); err != nil {
			rows.Close()
			return 0, err
		}
		paketler = append(paketler, p)
	}
	rows.Close()

	kalanIhtiyac := toplamDakika
	var toplamDusulen int64
	for _, p := range paketler {
		if kalanIhtiyac <= 0 {
			break
		}
		kullanilacak := p.dakika
		if kullanilacak > kalanIhtiyac {
			kullanilacak = kalanIhtiyac
		}
		if _, err := tx.Exec(ctx,
			`UPDATE customer_packages SET kalan_dakika = kalan_dakika - $1 WHERE id = $2`,
			kullanilacak, p.id,
		); err != nil {
			return 0, err
		}
		kalanIhtiyac -= kullanilacak
		toplamDusulen += kullanilacak
	}
	return toplamDusulen, nil
}

type packageDefinitionItem struct {
	ID     int64  `json:"id"`
	Ad     string `json:"ad"`
	Dakika int64  `json:"dakika"`
	Aktif  bool   `json:"aktif"`
}

// ListPackageDefinitions satın alınabilecek (aktif) paket türlerini döner.
// Satın Alma ekranında seçim listesini besler.
func (a *API) ListPackageDefinitions(w http.ResponseWriter, r *http.Request) {
	rows, err := a.DB.Query(r.Context(), `
		SELECT id, ad, dakika, aktif FROM package_definitions
		WHERE aktif = true
		ORDER BY dakika ASC`)
	if err != nil {
		writeServerError(w, http.StatusInternalServerError, "paket türleri alınamadı", err)
		return
	}
	defer rows.Close()

	result := []packageDefinitionItem{}
	for rows.Next() {
		var item packageDefinitionItem
		if err := rows.Scan(&item.ID, &item.Ad, &item.Dakika, &item.Aktif); err != nil {
			writeServerError(w, http.StatusInternalServerError, "satır okunamadı", err)
			return
		}
		result = append(result, item)
	}
	writeJSON(w, http.StatusOK, result)
}

type createPackageDefinitionRequest struct {
	Ad     string `json:"ad"`
	Dakika int64  `json:"dakika"`
}

// paketSatisiBakimda true iken yeni paket satışı ve paket türü tanımlama
// reddedilir (Satın Alma ekranı şimdilik bakımda). Mevcut paket bakiyeleri
// oturum kapatmada kullanılmaya devam eder. Yeniden açmak için false yapın;
// frontend'deki PAKET_SATISI_BAKIMDA (pages/SatinAlma.tsx) da güncellenmeli.
const paketSatisiBakimda = true

const paketSatisiBakimdaMesaji = "Paket satışı şu an bakımda, bu işlem geçici olarak kapalı."

// CreatePackageDefinition yeni bir paket türü tanımlar (ör. "1000 Dakika").
// Sadece yönetici erişebilir; fiyat, satın alma anında güncel dakika
// ücretinden hesaplandığından burada tutulmaz.
func (a *API) CreatePackageDefinition(w http.ResponseWriter, r *http.Request) {
	if paketSatisiBakimda {
		writeError(w, http.StatusServiceUnavailable, paketSatisiBakimdaMesaji)
		return
	}
	var req createPackageDefinitionRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "Gönderilen bilgiler okunamadı, lütfen sayfayı yenileyip tekrar deneyin.")
		return
	}
	if req.Ad == "" || len(req.Ad) > 100 {
		writeError(w, http.StatusBadRequest, "paket adı boş olamaz ve en fazla 100 karakter olabilir")
		return
	}
	if req.Dakika <= 0 {
		writeError(w, http.StatusBadRequest, "dakika miktarı 0'dan büyük olmalıdır")
		return
	}

	var item packageDefinitionItem
	err := a.DB.QueryRow(r.Context(),
		`INSERT INTO package_definitions (ad, dakika) VALUES ($1, $2)
		 RETURNING id, ad, dakika, aktif`,
		req.Ad, req.Dakika,
	).Scan(&item.ID, &item.Ad, &item.Dakika, &item.Aktif)
	if err != nil {
		writeServerError(w, http.StatusInternalServerError, "paket türü oluşturulamadı", err)
		return
	}
	writeJSON(w, http.StatusCreated, item)
}

type customerPackageItem struct {
	ID              int64  `json:"id"`
	Ad              string `json:"ad"`
	ToplamDakika    int64  `json:"toplam_dakika"`
	KalanDakika     int64  `json:"kalan_dakika"`
	TutarKurus      int64  `json:"tutar_kurus"`
	SatinAlmaZamani string `json:"satin_alma_zamani"`
	GecerlilikBitis string `json:"gecerlilik_bitis"`
	SuresiDolmusMu  bool   `json:"suresi_dolmus_mu"`
}

// ListCustomerPackages bir müşterinin satın aldığı tüm paketleri (en yeniden
// en eskiye) döner. Müşteriler ekranında ve Satın Alma ekranında bakiye
// gösterimi için kullanılır.
func (a *API) ListCustomerPackages(w http.ResponseWriter, r *http.Request) {
	idStr := chi.URLParam(r, "id")
	id, err := strconv.ParseInt(idStr, 10, 64)
	if err != nil {
		writeError(w, http.StatusBadRequest, "Geçersiz müşteri numarası.")
		return
	}

	rows, err := a.DB.Query(r.Context(), `
		SELECT id, ad, toplam_dakika, kalan_dakika, tutar_kurus, satin_alma_zamani, gecerlilik_bitis
		FROM customer_packages
		WHERE customer_id = $1
		ORDER BY satin_alma_zamani DESC`,
		id,
	)
	if err != nil {
		writeServerError(w, http.StatusInternalServerError, "paketler alınamadı", err)
		return
	}
	defer rows.Close()

	result := []customerPackageItem{}
	for rows.Next() {
		var item customerPackageItem
		var satinAlma, bitis time.Time
		if err := rows.Scan(&item.ID, &item.Ad, &item.ToplamDakika, &item.KalanDakika,
			&item.TutarKurus, &satinAlma, &bitis); err != nil {
			writeServerError(w, http.StatusInternalServerError, "satır okunamadı", err)
			return
		}
		item.SatinAlmaZamani = satinAlma.Format("2006-01-02 15:04")
		item.GecerlilikBitis = bitis.Format("2006-01-02 15:04")
		item.SuresiDolmusMu = time.Now().After(bitis)
		result = append(result, item)
	}
	writeJSON(w, http.StatusOK, result)
}

type purchasePackageRequest struct {
	PackageDefinitionID int64 `json:"package_definition_id"`
}

// PurchasePackage bir müşteriye paket tanımlar: dakika miktarı seçilen paket
// türünden alınır, tutar ise satın alma anındaki aktif dakika ücretinden
// hesaplanıp donuk olarak kaydedilir (fiyat kuralı sonradan değişse bile bu
// satın almanın tutarı etkilenmez — pricing_rules ile aynı mantık).
// Paket, satın alındığı andan itibaren 1 ay geçerlidir.
func (a *API) PurchasePackage(w http.ResponseWriter, r *http.Request) {
	if paketSatisiBakimda {
		writeError(w, http.StatusServiceUnavailable, paketSatisiBakimdaMesaji)
		return
	}
	claims, ok := auth.FromContext(r.Context())
	if !ok {
		writeError(w, http.StatusUnauthorized, "Yetkilendirme bilgisi bulunamadı, lütfen tekrar giriş yapın.")
		return
	}

	idStr := chi.URLParam(r, "id")
	customerID, err := strconv.ParseInt(idStr, 10, 64)
	if err != nil {
		writeError(w, http.StatusBadRequest, "Geçersiz müşteri numarası.")
		return
	}

	var req purchasePackageRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "Gönderilen bilgiler okunamadı, lütfen sayfayı yenileyip tekrar deneyin.")
		return
	}

	ctx := r.Context()
	tx, err := a.DB.Begin(ctx)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "İşlem başlatılamadı, lütfen tekrar deneyin.")
		return
	}
	defer tx.Rollback(ctx)

	var musteriVarMi int64
	if err := tx.QueryRow(ctx, `SELECT id FROM customers WHERE id = $1 AND deleted_at IS NULL`, customerID).Scan(&musteriVarMi); err != nil {
		writeError(w, http.StatusNotFound, "müşteri bulunamadı")
		return
	}

	var paketAdi string
	var dakika int64
	if err := tx.QueryRow(ctx,
		`SELECT ad, dakika FROM package_definitions WHERE id = $1 AND aktif = true`, req.PackageDefinitionID,
	).Scan(&paketAdi, &dakika); err != nil {
		writeError(w, http.StatusNotFound, "paket türü bulunamadı")
		return
	}

	var pricingRuleID int64
	var kurusPerDakika int64
	if err := tx.QueryRow(ctx,
		`SELECT id, kurus_per_dakika FROM pricing_rules
		 WHERE effective_from <= now() ORDER BY effective_from DESC LIMIT 1`,
	).Scan(&pricingRuleID, &kurusPerDakika); err != nil {
		writeError(w, http.StatusInternalServerError, "Aktif bir fiyat kuralı tanımlı değil, lütfen yöneticinize bildirin.")
		return
	}

	tutarKurus := dakika * kurusPerDakika

	var item customerPackageItem
	var satinAlma, bitis time.Time
	if err := tx.QueryRow(ctx, `
		INSERT INTO customer_packages
			(customer_id, package_definition_id, ad, toplam_dakika, kalan_dakika, tutar_kurus, pricing_rule_id, gecerlilik_bitis, created_by)
		VALUES ($1, $2, $3, $4, $4, $5, $6, now() + interval '1 month', $7)
		RETURNING id, ad, toplam_dakika, kalan_dakika, tutar_kurus, satin_alma_zamani, gecerlilik_bitis`,
		customerID, req.PackageDefinitionID, paketAdi, dakika, tutarKurus, pricingRuleID, claims.UserID,
	).Scan(&item.ID, &item.Ad, &item.ToplamDakika, &item.KalanDakika, &item.TutarKurus, &satinAlma, &bitis); err != nil {
		writeServerError(w, http.StatusInternalServerError, "paket satın alınamadı", err)
		return
	}

	if err := tx.Commit(ctx); err != nil {
		writeError(w, http.StatusInternalServerError, "İşlem tamamlanamadı, lütfen tekrar deneyin.")
		return
	}

	item.SatinAlmaZamani = satinAlma.Format("2006-01-02 15:04")
	item.GecerlilikBitis = bitis.Format("2006-01-02 15:04")
	writeJSON(w, http.StatusCreated, item)
}
