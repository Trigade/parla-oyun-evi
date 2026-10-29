package handlers

import (
	"encoding/json"
	"net/http"
	"strconv"
	"time"

	"github.com/go-chi/chi/v5"
)

// dogrula create/update için ortak doğrulamadır. Grup boşsa "Standart" yapar;
// seçilen türün dışındaki kolonlar için nil döner (tür değişince NULL'lanır:
// bakiyede haftalık/günlük, abonelikte dakika). Hata varsa mesaj döner.
func (req *createPackageDefinitionRequest) dogrula() (haftalikGun, gunlukDakika, dakika *int64, hata string) {
	if req.Ad == "" || len(req.Ad) > 100 {
		return nil, nil, nil, "paket adı boş olamaz ve en fazla 100 karakter olabilir"
	}
	if req.Grup == "" {
		req.Grup = "Standart"
	}
	if len(req.Grup) > 50 {
		return nil, nil, nil, "yaş/grup en fazla 50 karakter olabilir"
	}
	bakiyeMi := req.Tur == "bakiye"
	if req.Tur != "" && req.Tur != "abonelik" && !bakiyeMi {
		return nil, nil, nil, "paket türü 'abonelik' veya 'bakiye' olmalıdır"
	}
	if bakiyeMi {
		if req.Dakika < 1 || req.Dakika > 100000 {
			return nil, nil, nil, "paket süresi 1 dakika ile 100.000 dakika arasında olmalıdır"
		}
		dakika = &req.Dakika
	} else {
		if req.HaftalikGun < 1 || req.HaftalikGun > 7 {
			return nil, nil, nil, "haftalık gün 1 ile 7 arasında olmalıdır"
		}
		if req.GunlukDakika < 1 || req.GunlukDakika > 1440 {
			return nil, nil, nil, "günlük süre 1 dakika ile 24 saat arasında olmalıdır"
		}
		haftalikGun, gunlukDakika = &req.HaftalikGun, &req.GunlukDakika
	}
	if req.AylikUcretKurus < 0 {
		return nil, nil, nil, "paket ücreti negatif olamaz"
	}
	return haftalikGun, gunlukDakika, dakika, ""
}

// UpdatePackageDefinition bir paket türünü düzenler (tür değişimi dahil). Sadece
// yönetici erişebilir. Mevcut satın almalar etkilenmez: PurchasePackage değerleri
// customer_packages'a kopyaladığı için eski satın almalar kendi değerlerini korur;
// onları düzeltmek için UpdateCustomerPackage kullanılır.
func (a *API) UpdatePackageDefinition(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseInt(chi.URLParam(r, "id"), 10, 64)
	if err != nil {
		writeError(w, http.StatusBadRequest, "Geçersiz paket numarası.")
		return
	}
	var req createPackageDefinitionRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "Gönderilen bilgiler okunamadı, lütfen sayfayı yenileyip tekrar deneyin.")
		return
	}
	haftalikGun, gunlukDakika, dakika, hata := req.dogrula()
	if hata != "" {
		writeError(w, http.StatusBadRequest, hata)
		return
	}

	ctx := r.Context()
	tx, err := a.DB.Begin(ctx)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "İşlem başlatılamadı, lütfen tekrar deneyin.")
		return
	}
	defer tx.Rollback(ctx)

	var eski packageDefinitionItem
	if err := eski.scan(tx.QueryRow(ctx,
		`SELECT `+paketTanimiKolonlari+` FROM package_definitions WHERE id = $1 FOR UPDATE`, id)); err != nil {
		writeError(w, http.StatusNotFound, "paket türü bulunamadı")
		return
	}
	var item packageDefinitionItem
	if err := item.scan(tx.QueryRow(ctx,
		`UPDATE package_definitions
		 SET ad = $2, grup = $3, dakika = $4, haftalik_gun = $5, gunluk_dakika = $6, aylik_ucret_kurus = $7
		 WHERE id = $1
		 RETURNING `+paketTanimiKolonlari,
		id, req.Ad, req.Grup, dakika, haftalikGun, gunlukDakika, req.AylikUcretKurus,
	)); err != nil {
		writeServerError(w, http.StatusInternalServerError, "paket türü güncellenemedi", err)
		return
	}
	if err := tx.Commit(ctx); err != nil {
		writeError(w, http.StatusInternalServerError, "İşlem tamamlanamadı, lütfen tekrar deneyin.")
		return
	}
	islemDetay(r, map[string]any{
		"package_definition_id": id,
		"eski_tur":              eski.Tur, "yeni_tur": item.Tur,
		"eski_ad": eski.Ad, "yeni_ad": item.Ad,
		"eski_grup": eski.Grup, "yeni_grup": item.Grup,
		"eski_dakika": eski.Dakika, "yeni_dakika": item.Dakika,
		"eski_haftalik_gun": eski.HaftalikGun, "yeni_haftalik_gun": item.HaftalikGun,
		"eski_gunluk_dakika": eski.GunlukDakika, "yeni_gunluk_dakika": item.GunlukDakika,
		"eski_fiyat_kurus": eski.AylikUcretKurus, "yeni_fiyat_kurus": item.AylikUcretKurus,
	})
	writeJSON(w, http.StatusOK, item)
}

type updateCustomerPackageRequest struct {
	Tur             string `json:"tur"` // "abonelik" | "bakiye"
	Ad              string `json:"ad"`
	HaftalikGun     int64  `json:"haftalik_gun"`
	GunlukDakika    int64  `json:"gunluk_dakika"`
	ToplamDakika    int64  `json:"toplam_dakika"`
	KalanDakika     int64  `json:"kalan_dakika"`
	GecerlilikBitis string `json:"gecerlilik_bitis"` // "2006-01-02"; o günün sonuna kadar geçerli
}

// dogrula türe göre alanları doğrular; seçilen türün dışındaki kolonlar nil kalır (NULL'lanır).
func (req *updateCustomerPackageRequest) dogrula() (haftalikGun, gunlukDakika, toplam, kalan *int64, bitis time.Time, hata string) {
	if req.Ad == "" || len(req.Ad) > 100 {
		return nil, nil, nil, nil, bitis, "paket adı boş olamaz ve en fazla 100 karakter olabilir"
	}
	switch req.Tur {
	case "bakiye":
		if req.ToplamDakika < 1 || req.ToplamDakika > 100000 {
			return nil, nil, nil, nil, bitis, "toplam süre 1 dakika ile 100.000 dakika arasında olmalıdır"
		}
		if req.KalanDakika < 0 || req.KalanDakika > req.ToplamDakika {
			return nil, nil, nil, nil, bitis, "kalan süre 0 ile toplam süre arasında olmalıdır"
		}
		toplam, kalan = &req.ToplamDakika, &req.KalanDakika
	case "abonelik":
		if req.HaftalikGun < 1 || req.HaftalikGun > 7 {
			return nil, nil, nil, nil, bitis, "haftalık gün 1 ile 7 arasında olmalıdır"
		}
		if req.GunlukDakika < 1 || req.GunlukDakika > 1440 {
			return nil, nil, nil, nil, bitis, "günlük süre 1 dakika ile 24 saat arasında olmalıdır"
		}
		haftalikGun, gunlukDakika = &req.HaftalikGun, &req.GunlukDakika
	default:
		return nil, nil, nil, nil, bitis, "paket türü 'abonelik' veya 'bakiye' olmalıdır"
	}
	gun, err := time.ParseInLocation("2006-01-02", req.GecerlilikBitis, BusinessLocation)
	if err != nil {
		return nil, nil, nil, nil, bitis, "geçerlilik bitişi geçerli bir tarih olmalıdır"
	}
	y, m, d := gun.Date()
	bitis = time.Date(y, m, d, 23, 59, 59, 0, BusinessLocation)
	return haftalikGun, gunlukDakika, toplam, kalan, bitis, ""
}

// UpdateCustomerPackage müşterinin satın aldığı paketi düzeltir (tür, ad, hak,
// bakiye, geçerlilik bitişi). Sadece yönetici erişebilir. tutar_kurus,
// odeme_tipi ve satin_alma_zamani bilerek değiştirilemez: kapanmış günlerin ciro
// raporlarını besledikleri için burada oynanırsa geçmiş rakamlar tutmaz.
func (a *API) UpdateCustomerPackage(w http.ResponseWriter, r *http.Request) {
	customerID, err := strconv.ParseInt(chi.URLParam(r, "id"), 10, 64)
	if err != nil {
		writeError(w, http.StatusBadRequest, "Geçersiz müşteri numarası.")
		return
	}
	paketID, err := strconv.ParseInt(chi.URLParam(r, "paketId"), 10, 64)
	if err != nil {
		writeError(w, http.StatusBadRequest, "Geçersiz paket numarası.")
		return
	}
	var req updateCustomerPackageRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "Gönderilen bilgiler okunamadı, lütfen sayfayı yenileyip tekrar deneyin.")
		return
	}
	haftalikGun, gunlukDakika, toplam, kalan, yeniBitis, hata := req.dogrula()
	if hata != "" {
		writeError(w, http.StatusBadRequest, hata)
		return
	}

	ctx := r.Context()
	tx, err := a.DB.Begin(ctx)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "İşlem başlatılamadı, lütfen tekrar deneyin.")
		return
	}
	defer tx.Rollback(ctx)

	const kolonlar = `id, ad, COALESCE(grup, ''), COALESCE(haftalik_gun, 0), COALESCE(gunluk_dakika, 0),
		COALESCE(toplam_dakika, 0), COALESCE(kalan_dakika, 0),
		tutar_kurus, COALESCE(odeme_tipi, ''), satin_alma_zamani, gecerlilik_bitis`
	tara := func(row interface{ Scan(...any) error }) (item customerPackageItem, bitis time.Time, err error) {
		var satinAlma time.Time
		err = row.Scan(&item.ID, &item.Ad, &item.Grup, &item.HaftalikGun, &item.GunlukDakika,
			&item.ToplamDakika, &item.KalanDakika, &item.TutarKurus, &item.OdemeTipi, &satinAlma, &bitis)
		item.doldur()
		item.SatinAlmaZamani = satinAlma.Format("2006-01-02 15:04")
		item.GecerlilikBitis = bitis.Format("2006-01-02 15:04")
		item.SuresiDolmusMu = time.Now().After(bitis)
		return
	}

	eski, eskiBitis, err := tara(tx.QueryRow(ctx,
		`SELECT `+kolonlar+` FROM customer_packages WHERE id = $1 AND customer_id = $2 FOR UPDATE`, paketID, customerID))
	if err != nil {
		writeError(w, http.StatusNotFound, "paket bulunamadı")
		return
	}
	item, bitis, err := tara(tx.QueryRow(ctx,
		`UPDATE customer_packages
		 SET ad = $3, haftalik_gun = $4, gunluk_dakika = $5, toplam_dakika = $6, kalan_dakika = $7, gecerlilik_bitis = $8
		 WHERE id = $1 AND customer_id = $2
		 RETURNING `+kolonlar,
		paketID, customerID, req.Ad, haftalikGun, gunlukDakika, toplam, kalan, yeniBitis))
	if err != nil {
		writeServerError(w, http.StatusInternalServerError, "paket güncellenemedi", err)
		return
	}
	if item.Tur == "abonelik" && !item.SuresiDolmusMu {
		gun, dk, oturum, err := abonelikKullanimi(ctx, tx, item.ID)
		if err != nil {
			writeServerError(w, http.StatusInternalServerError, "paket kullanımı alınamadı", err)
			return
		}
		item.abonelikHaklari = abonelikKalanHaklar(time.Now(), bitis, item.HaftalikGun, item.GunlukDakika, gun, dk, oturum > 0)
	}
	if err := tx.Commit(ctx); err != nil {
		writeError(w, http.StatusInternalServerError, "İşlem tamamlanamadı, lütfen tekrar deneyin.")
		return
	}
	islemDetay(r, map[string]any{
		"customer_id": customerID, "customer_package_id": paketID,
		"eski_tur": eski.Tur, "yeni_tur": item.Tur,
		"eski_ad": eski.Ad, "yeni_ad": item.Ad,
		"eski_haftalik_gun": eski.HaftalikGun, "yeni_haftalik_gun": item.HaftalikGun,
		"eski_gunluk_dakika": eski.GunlukDakika, "yeni_gunluk_dakika": item.GunlukDakika,
		"eski_toplam_dakika": eski.ToplamDakika, "yeni_toplam_dakika": item.ToplamDakika,
		"eski_kalan_dakika": eski.KalanDakika, "yeni_kalan_dakika": item.KalanDakika,
		"eski_gecerlilik_bitis": eskiBitis.Format("2006-01-02 15:04"), "yeni_gecerlilik_bitis": bitis.Format("2006-01-02 15:04"),
	})
	writeJSON(w, http.StatusOK, item)
}
