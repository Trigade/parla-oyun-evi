package handlers

import (
	"context"
	"encoding/json"
	"net/http"
	"strconv"
	"time"

	"github.com/go-chi/chi/v5"

	"parla-oyun-evi/backend/internal/auth"
)

// Paketler abonelik modelidir: bir paket "haftada N gün, günde M dakika"
// hakkı verir ve aylık sabit ücretle satılır. Hak kullanımı oturumlar
// üzerinden izlenir (sessions.customer_package_id): aynı takvim gününde
// yapılan birden fazla giriş haftalık haktan tek gün düşer, günlük dakika
// hakkı ise o gün pakete sayılan dakikaların toplamıdır. Hafta Pazartesi
// günü başlar (Europe/Istanbul).

// haftaBasi, verilen anın içinde bulunduğu haftanın Pazartesi 00:00'ını
// (işletme saat dilimine göre) döner.
func haftaBasi(t time.Time) time.Time {
	yerel := t.In(BusinessLocation)
	gunFarki := (int(yerel.Weekday()) + 6) % 7 // Pazartesi = 0
	yil, ay, gun := yerel.Date()
	return time.Date(yil, ay, gun, 0, 0, 0, 0, BusinessLocation).AddDate(0, 0, -gunFarki)
}

type packageDefinitionItem struct {
	ID              int64  `json:"id"`
	Ad              string `json:"ad"`
	Grup            string `json:"grup"`
	HaftalikGun     int64  `json:"haftalik_gun"`
	GunlukDakika    int64  `json:"gunluk_dakika"`
	AylikUcretKurus int64  `json:"aylik_ucret_kurus"`
	Aktif           bool   `json:"aktif"`
}

// ListPackageDefinitions satın alınabilecek (aktif) paket türlerini döner.
// Eski dakika bakiyesi paketleri (haftalik_gun boş) listelenmez.
func (a *API) ListPackageDefinitions(w http.ResponseWriter, r *http.Request) {
	rows, err := a.DB.Query(r.Context(), `
		SELECT id, ad, grup, haftalik_gun, gunluk_dakika, aylik_ucret_kurus, aktif
		FROM package_definitions
		WHERE aktif = true AND haftalik_gun IS NOT NULL
		ORDER BY aylik_ucret_kurus DESC, ad ASC`)
	if err != nil {
		writeServerError(w, http.StatusInternalServerError, "paket türleri alınamadı", err)
		return
	}
	defer rows.Close()

	result := []packageDefinitionItem{}
	for rows.Next() {
		var item packageDefinitionItem
		if err := rows.Scan(&item.ID, &item.Ad, &item.Grup, &item.HaftalikGun,
			&item.GunlukDakika, &item.AylikUcretKurus, &item.Aktif); err != nil {
			writeServerError(w, http.StatusInternalServerError, "satır okunamadı", err)
			return
		}
		result = append(result, item)
	}
	writeJSON(w, http.StatusOK, result)
}

type createPackageDefinitionRequest struct {
	Ad              string `json:"ad"`
	Grup            string `json:"grup"`
	HaftalikGun     int64  `json:"haftalik_gun"`
	GunlukDakika    int64  `json:"gunluk_dakika"`
	AylikUcretKurus int64  `json:"aylik_ucret_kurus"`
}

// CreatePackageDefinition yeni bir paket türü tanımlar. Sadece yönetici erişebilir.
func (a *API) CreatePackageDefinition(w http.ResponseWriter, r *http.Request) {
	var req createPackageDefinitionRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "Gönderilen bilgiler okunamadı, lütfen sayfayı yenileyip tekrar deneyin.")
		return
	}
	if req.Ad == "" || len(req.Ad) > 100 {
		writeError(w, http.StatusBadRequest, "paket adı boş olamaz ve en fazla 100 karakter olabilir")
		return
	}
	if req.Grup == "" {
		req.Grup = "Standart"
	}
	if len(req.Grup) > 50 {
		writeError(w, http.StatusBadRequest, "yaş/grup en fazla 50 karakter olabilir")
		return
	}
	if req.HaftalikGun < 1 || req.HaftalikGun > 7 {
		writeError(w, http.StatusBadRequest, "haftalık gün 1 ile 7 arasında olmalıdır")
		return
	}
	if req.GunlukDakika < 1 || req.GunlukDakika > 1440 {
		writeError(w, http.StatusBadRequest, "günlük süre 1 dakika ile 24 saat arasında olmalıdır")
		return
	}
	if req.AylikUcretKurus < 0 {
		writeError(w, http.StatusBadRequest, "aylık ücret negatif olamaz")
		return
	}

	var item packageDefinitionItem
	err := a.DB.QueryRow(r.Context(),
		`INSERT INTO package_definitions (ad, grup, haftalik_gun, gunluk_dakika, aylik_ucret_kurus)
		 VALUES ($1, $2, $3, $4, $5)
		 RETURNING id, ad, grup, haftalik_gun, gunluk_dakika, aylik_ucret_kurus, aktif`,
		req.Ad, req.Grup, req.HaftalikGun, req.GunlukDakika, req.AylikUcretKurus,
	).Scan(&item.ID, &item.Ad, &item.Grup, &item.HaftalikGun, &item.GunlukDakika,
		&item.AylikUcretKurus, &item.Aktif)
	if err != nil {
		writeServerError(w, http.StatusInternalServerError, "paket türü oluşturulamadı", err)
		return
	}
	writeJSON(w, http.StatusCreated, item)
}

type customerPackageItem struct {
	ID              int64  `json:"id"`
	Ad              string `json:"ad"`
	Grup            string `json:"grup"`
	HaftalikGun     int64  `json:"haftalik_gun"`
	GunlukDakika    int64  `json:"gunluk_dakika"`
	TutarKurus      int64  `json:"tutar_kurus"`
	OdemeTipi       string `json:"odeme_tipi"`
	SatinAlmaZamani string `json:"satin_alma_zamani"`
	GecerlilikBitis string `json:"gecerlilik_bitis"`
	SuresiDolmusMu  bool   `json:"suresi_dolmus_mu"`
}

// ListCustomerPackages bir müşterinin satın aldığı abonelik paketlerini
// (en yeniden en eskiye) döner.
func (a *API) ListCustomerPackages(w http.ResponseWriter, r *http.Request) {
	idStr := chi.URLParam(r, "id")
	id, err := strconv.ParseInt(idStr, 10, 64)
	if err != nil {
		writeError(w, http.StatusBadRequest, "Geçersiz müşteri numarası.")
		return
	}

	rows, err := a.DB.Query(r.Context(), `
		SELECT id, ad, COALESCE(grup, ''), COALESCE(haftalik_gun, 0), COALESCE(gunluk_dakika, 0),
			tutar_kurus, COALESCE(odeme_tipi, ''), satin_alma_zamani, gecerlilik_bitis
		FROM customer_packages
		WHERE customer_id = $1 AND haftalik_gun IS NOT NULL
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
		if err := rows.Scan(&item.ID, &item.Ad, &item.Grup, &item.HaftalikGun, &item.GunlukDakika,
			&item.TutarKurus, &item.OdemeTipi, &satinAlma, &bitis); err != nil {
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
	PackageDefinitionID int64  `json:"package_definition_id"`
	OdemeTipi           string `json:"odeme_tipi"`
}

// PurchasePackage bir müşteriye paket tanımlar: haftalık gün, günlük dakika
// ve ücret satın alma anındaki tanımdan kopyalanıp dondurulur (paket türü
// sonradan değişse bile bu satın alma etkilenmez). Paket satın alındığı andan
// itibaren 1 ay geçerlidir. Tahsilat tipi (nakit/kart) kaydedilir ve tutar
// o günün cirosuna dahil edilir.
func (a *API) PurchasePackage(w http.ResponseWriter, r *http.Request) {
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
	if req.OdemeTipi != "nakit" && req.OdemeTipi != "kredi_karti" {
		writeError(w, http.StatusBadRequest, "Ödeme tipi 'Nakit' veya 'Kredi Kartı' olmalıdır.")
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

	var paketAdi, grup string
	var haftalikGun, gunlukDakika, aylikUcretKurus int64
	if err := tx.QueryRow(ctx,
		`SELECT ad, grup, haftalik_gun, gunluk_dakika, aylik_ucret_kurus
		 FROM package_definitions WHERE id = $1 AND aktif = true AND haftalik_gun IS NOT NULL`,
		req.PackageDefinitionID,
	).Scan(&paketAdi, &grup, &haftalikGun, &gunlukDakika, &aylikUcretKurus); err != nil {
		writeError(w, http.StatusNotFound, "paket türü bulunamadı")
		return
	}

	var item customerPackageItem
	var satinAlma, bitis time.Time
	if err := tx.QueryRow(ctx, `
		INSERT INTO customer_packages
			(customer_id, package_definition_id, ad, grup, haftalik_gun, gunluk_dakika,
			 tutar_kurus, odeme_tipi, gecerlilik_bitis, created_by)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, now() + interval '1 month', $9)
		RETURNING id, ad, grup, haftalik_gun, gunluk_dakika, tutar_kurus, odeme_tipi,
			satin_alma_zamani, gecerlilik_bitis`,
		customerID, req.PackageDefinitionID, paketAdi, grup, haftalikGun, gunlukDakika,
		aylikUcretKurus, req.OdemeTipi, claims.UserID,
	).Scan(&item.ID, &item.Ad, &item.Grup, &item.HaftalikGun, &item.GunlukDakika,
		&item.TutarKurus, &item.OdemeTipi, &satinAlma, &bitis); err != nil {
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

// paketDurumu, bir müşterinin aktif paketini ve bu paketteki güncel hak
// kullanımını anlatır. Kasa ekranı bunu gösterir, oturum kapatma akışı da
// aşan süreyi hesaplamak için aynı bilgiyi kullanır.
type paketDurumu struct {
	Var                   bool   `json:"var"`
	CustomerPackageID     int64  `json:"customer_package_id,omitempty"`
	Ad                    string `json:"ad,omitempty"`
	Grup                  string `json:"grup,omitempty"`
	HaftalikGun           int64  `json:"haftalik_gun,omitempty"`
	GunlukDakika          int64  `json:"gunluk_dakika,omitempty"`
	BuHaftaKullanilanGun  int64  `json:"bu_hafta_kullanilan_gun"`
	BugunKullanilanDakika int64  `json:"bugun_kullanilan_dakika"`
	KalanGunlukDakika     int64  `json:"kalan_gunluk_dakika"`
	BugunPaketeSayildiMi  bool   `json:"bugun_pakete_sayildi_mi"`
	GunHakkiDolduMu       bool   `json:"gun_hakki_doldu_mu"`
	GecerlilikBitis       string `json:"gecerlilik_bitis,omitempty"`
}

// aktifPaketDurumu, müşterinin süresi dolmamış en son satın aldığı abonelik
// paketini ve hak kullanımını hesaplar. Paket yoksa Var=false döner.
func aktifPaketDurumu(ctx context.Context, q querier, customerID int64) (paketDurumu, error) {
	var d paketDurumu
	var bitis time.Time
	err := q.QueryRow(ctx, `
		SELECT id, ad, COALESCE(grup, ''), haftalik_gun, gunluk_dakika, gecerlilik_bitis
		FROM customer_packages
		WHERE customer_id = $1 AND haftalik_gun IS NOT NULL AND gecerlilik_bitis > now()
		ORDER BY satin_alma_zamani DESC
		LIMIT 1`,
		customerID,
	).Scan(&d.CustomerPackageID, &d.Ad, &d.Grup, &d.HaftalikGun, &d.GunlukDakika, &bitis)
	if err != nil {
		return paketDurumu{}, nil
	}
	d.Var = true
	d.GecerlilikBitis = bitis.Format("2006-01-02 15:04")

	var bugunkuOturumSayisi int64
	if err := q.QueryRow(ctx, `
		SELECT
			COUNT(DISTINCT (giris_zamani AT TIME ZONE 'Europe/Istanbul')::date)
				FILTER (WHERE giris_zamani >= $2),
			COALESCE(SUM(paketten_dusulen_dakika) FILTER (
				WHERE (giris_zamani AT TIME ZONE 'Europe/Istanbul')::date
					= (now() AT TIME ZONE 'Europe/Istanbul')::date), 0),
			COUNT(*) FILTER (
				WHERE (giris_zamani AT TIME ZONE 'Europe/Istanbul')::date
					= (now() AT TIME ZONE 'Europe/Istanbul')::date)
		FROM sessions
		WHERE customer_package_id = $1`,
		d.CustomerPackageID, haftaBasi(time.Now()),
	).Scan(&d.BuHaftaKullanilanGun, &d.BugunKullanilanDakika, &bugunkuOturumSayisi); err != nil {
		return paketDurumu{}, err
	}

	d.BugunPaketeSayildiMi = bugunkuOturumSayisi > 0
	d.KalanGunlukDakika = d.GunlukDakika - d.BugunKullanilanDakika
	if d.KalanGunlukDakika < 0 {
		d.KalanGunlukDakika = 0
	}
	// Bugün zaten pakete sayılmış bir giriş varsa yeni bir gün hakkı
	// tüketilmez; o yüzden gün hakkı yalnızca yeni bir gün için dolmuş sayılır.
	d.GunHakkiDolduMu = !d.BugunPaketeSayildiMi && d.BuHaftaKullanilanGun >= d.HaftalikGun
	return d, nil
}

// GetCustomerPackageStatus kasa ekranı için müşterinin paket durumunu döner.
func (a *API) GetCustomerPackageStatus(w http.ResponseWriter, r *http.Request) {
	idStr := chi.URLParam(r, "id")
	id, err := strconv.ParseInt(idStr, 10, 64)
	if err != nil {
		writeError(w, http.StatusBadRequest, "Geçersiz müşteri numarası.")
		return
	}
	durum, err := aktifPaketDurumu(r.Context(), a.DB, id)
	if err != nil {
		writeServerError(w, http.StatusInternalServerError, "paket durumu alınamadı", err)
		return
	}
	writeJSON(w, http.StatusOK, durum)
}
