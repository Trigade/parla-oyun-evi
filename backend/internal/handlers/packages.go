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
//
// Bunun yanında "saat bakiyeli" paketler de vardır (ör. 10 Saatlik Paket =
// 600 dakika, sabit fiyat): günlük/haftalık sınır yoktur, bakiye bitene kadar
// (satın alımdan 1 ay içinde) kullanılır. Tür ayrımı ayrı kolonla değil şöyle
// yapılır: bakiye paketlerde haftalik_gun/gunluk_dakika NULL, dakika
// (customer_packages'ta toplam_dakika/kalan_dakika) DOLUDUR. Bakiye pakette
// aylik_ucret_kurus kolonu "paket fiyatı" anlamına gelir. Eski (0008) bakiye
// tanımları fiyatsız ve pasif olduğu için satışta görünmez.

// bakiyedenDus, oturum süresinin paket bakiyesinden ne kadarının karşılanacağını
// hesaplar. Aşan süre varsa asiyor=true döner; "ucretsiz" modda bu durum
// reddedilir, "asim" modda aşan kısım normal fiyattan ücretlendirilir.
func bakiyedenDus(oturumDakika, kalanDakika int64) (dusulen, ucretlenecek int64, asiyor bool) {
	dusulen = min(oturumDakika, kalanDakika)
	return dusulen, oturumDakika - dusulen, oturumDakika > kalanDakika
}

// kalanDegerKurus, bakiye paketin kalan dakikasının değerini kuruş olarak
// (aşağı yuvarlayarak) hesaplar.
func kalanDegerKurus(tutarKurus, toplamDakika, kalanDakika int64) int64 {
	if toplamDakika <= 0 {
		return 0
	}
	return tutarKurus * kalanDakika / toplamDakika
}

// haftaBasi, verilen anın içinde bulunduğu haftanın Pazartesi 00:00'ını
// (işletme saat dilimine göre) döner.
func haftaBasi(t time.Time) time.Time {
	yerel := t.In(BusinessLocation)
	gunFarki := (int(yerel.Weekday()) + 6) % 7 // Pazartesi = 0
	yil, ay, gun := yerel.Date()
	return time.Date(yil, ay, gun, 0, 0, 0, 0, BusinessLocation).AddDate(0, 0, -gunFarki)
}

// abonelikHaklari, aboneliğin kalan hakkını anlatır (kasa/müşteri özeti için).
// Bakiye pakette yalnızca BitiseKalanGun dolar.
type abonelikHaklari struct {
	BugunKalanDakika  int64 `json:"bugun_kalan_dakika"`
	BuHaftaKalanGun   int64 `json:"bu_hafta_kalan_gun"`
	BuHaftaKalanDakika int64 `json:"bu_hafta_kalan_dakika"`
	BitiseKalanGun    int64 `json:"bitise_kalan_gun"`
}

// takvimGunFarki, iki anın işletme saat dilimindeki takvim günleri arasındaki farktır.
func takvimGunFarki(bas, son time.Time) int64 {
	b, s := bas.In(BusinessLocation), son.In(BusinessLocation)
	by, bm, bg := b.Date()
	sy, sm, sg := s.Date()
	return int64(time.Date(sy, sm, sg, 0, 0, 0, 0, time.UTC).Sub(time.Date(by, bm, bg, 0, 0, 0, 0, time.UTC)) / (24 * time.Hour))
}

// abonelikKalanHaklar saf hesaptır (zaman parametre). Bu haftanın kalan günü
// hem haftalık haktan hem de hafta sonuna (Pazar) ve paket bitişine kadar
// kalan takvim günlerinden büyük olamaz; bugün pakete sayılmışsa bugün
// zaten kullanılan günlerdedir, bu yüzden takvimden de düşülür.
func abonelikKalanHaklar(simdi, bitis time.Time, haftalikGun, gunlukDakika, buHaftaKullanilanGun, bugunKullanilanDakika int64, bugunSayildi bool) abonelikHaklari {
	bitiseKalanGun := max(0, takvimGunFarki(simdi, bitis))
	kalanGunluk := max(0, gunlukDakika-bugunKullanilanDakika)
	gunHakkiDoldu := !bugunSayildi && buHaftaKullanilanGun >= haftalikGun

	haftaSonuna := int64(7 - (int(simdi.In(BusinessLocation).Weekday())+6)%7) // bugün dahil, Pazar dahil
	takvim := min(haftaSonuna, bitiseKalanGun+1)
	if bugunSayildi {
		takvim--
	}
	h := abonelikHaklari{BitiseKalanGun: bitiseKalanGun}
	h.BuHaftaKalanGun = max(0, min(haftalikGun-buHaftaKullanilanGun, takvim))
	if gunHakkiDoldu {
		return h
	}
	h.BugunKalanDakika = kalanGunluk
	h.BuHaftaKalanDakika = h.BuHaftaKalanGun * gunlukDakika
	if bugunSayildi {
		h.BuHaftaKalanDakika += kalanGunluk
	}
	return h
}

type packageDefinitionItem struct {
	ID              int64  `json:"id"`
	Tur             string `json:"tur"` // "abonelik" | "bakiye"
	Ad              string `json:"ad"`
	Grup            string `json:"grup"`
	Dakika          int64  `json:"dakika,omitempty"` // yalnızca bakiye
	HaftalikGun     int64  `json:"haftalik_gun"`
	GunlukDakika    int64  `json:"gunluk_dakika"`
	AylikUcretKurus int64  `json:"aylik_ucret_kurus"`
	Aktif           bool   `json:"aktif"`
}

const paketTanimiKolonlari = `id, ad, grup, COALESCE(dakika, 0), COALESCE(haftalik_gun, 0),
	COALESCE(gunluk_dakika, 0), aylik_ucret_kurus, aktif`

// scan satırı okur ve haftalik_gun doluluğuna göre türü belirler.
func (item *packageDefinitionItem) scan(row interface{ Scan(...any) error }) error {
	if err := row.Scan(&item.ID, &item.Ad, &item.Grup, &item.Dakika, &item.HaftalikGun,
		&item.GunlukDakika, &item.AylikUcretKurus, &item.Aktif); err != nil {
		return err
	}
	item.Tur = "bakiye"
	if item.HaftalikGun > 0 {
		item.Tur = "abonelik"
	}
	return nil
}

// ListPackageDefinitions satın alınabilecek (aktif ve fiyatı dolu) abonelik
// ve saat bakiyeli paket türlerini döner. Eski fiyatsız tanımlar listelenmez.
func (a *API) ListPackageDefinitions(w http.ResponseWriter, r *http.Request) {
	rows, err := a.DB.Query(r.Context(), `
		SELECT `+paketTanimiKolonlari+`
		FROM package_definitions
		WHERE aktif = true AND aylik_ucret_kurus IS NOT NULL
			AND (haftalik_gun IS NOT NULL OR dakika IS NOT NULL)
		ORDER BY (haftalik_gun IS NULL), aylik_ucret_kurus DESC, ad ASC`)
	if err != nil {
		writeServerError(w, http.StatusInternalServerError, "paket türleri alınamadı", err)
		return
	}
	defer rows.Close()

	result := []packageDefinitionItem{}
	for rows.Next() {
		var item packageDefinitionItem
		if err := item.scan(rows); err != nil {
			writeServerError(w, http.StatusInternalServerError, "satır okunamadı", err)
			return
		}
		result = append(result, item)
	}
	writeJSON(w, http.StatusOK, result)
}

type createPackageDefinitionRequest struct {
	Tur             string `json:"tur"` // "abonelik" (varsayılan) | "bakiye"
	Ad              string `json:"ad"`
	Grup            string `json:"grup"`
	Dakika          int64  `json:"dakika"`
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
	bakiyeMi := req.Tur == "bakiye"
	if req.Tur != "" && req.Tur != "abonelik" && !bakiyeMi {
		writeError(w, http.StatusBadRequest, "paket türü 'abonelik' veya 'bakiye' olmalıdır")
		return
	}
	var haftalikGun, gunlukDakika, dakika *int64 // bakiyede haftalık/günlük, abonelikte dakika NULL kalır
	if bakiyeMi {
		if req.Dakika < 1 || req.Dakika > 100000 {
			writeError(w, http.StatusBadRequest, "paket süresi 1 dakika ile 100.000 dakika arasında olmalıdır")
			return
		}
		dakika = &req.Dakika
	} else {
		if req.HaftalikGun < 1 || req.HaftalikGun > 7 {
			writeError(w, http.StatusBadRequest, "haftalık gün 1 ile 7 arasında olmalıdır")
			return
		}
		if req.GunlukDakika < 1 || req.GunlukDakika > 1440 {
			writeError(w, http.StatusBadRequest, "günlük süre 1 dakika ile 24 saat arasında olmalıdır")
			return
		}
		haftalikGun, gunlukDakika = &req.HaftalikGun, &req.GunlukDakika
	}
	if req.AylikUcretKurus < 0 {
		writeError(w, http.StatusBadRequest, "paket ücreti negatif olamaz")
		return
	}

	var item packageDefinitionItem
	err := item.scan(a.DB.QueryRow(r.Context(),
		`INSERT INTO package_definitions (ad, grup, dakika, haftalik_gun, gunluk_dakika, aylik_ucret_kurus)
		 VALUES ($1, $2, $3, $4, $5, $6)
		 RETURNING `+paketTanimiKolonlari,
		req.Ad, req.Grup, dakika, haftalikGun, gunlukDakika, req.AylikUcretKurus,
	))
	if err != nil {
		writeServerError(w, http.StatusInternalServerError, "paket türü oluşturulamadı", err)
		return
	}
	writeJSON(w, http.StatusCreated, item)
}

type customerPackageItem struct {
	ID              int64  `json:"id"`
	Tur             string `json:"tur"` // "abonelik" | "bakiye"
	Ad              string `json:"ad"`
	Grup            string `json:"grup"`
	HaftalikGun     int64  `json:"haftalik_gun"`
	GunlukDakika    int64  `json:"gunluk_dakika"`
	ToplamDakika    int64  `json:"toplam_dakika,omitempty"` // yalnızca bakiye
	KalanDakika     int64  `json:"kalan_dakika,omitempty"`  // yalnızca bakiye
	KalanDegerKurus int64  `json:"kalan_deger_kurus,omitempty"`
	TutarKurus      int64  `json:"tutar_kurus"`
	OdemeTipi       string `json:"odeme_tipi"`
	SatinAlmaZamani string `json:"satin_alma_zamani"`
	GecerlilikBitis string `json:"gecerlilik_bitis"`
	SuresiDolmusMu  bool   `json:"suresi_dolmus_mu"`
	abonelikHaklari        // yalnızca süresi dolmamış abonelikte dolu
}

// doldur türü belirler; bakiye paketlerde kalan değeri de hesaplar.
func (item *customerPackageItem) doldur() {
	item.Tur = "abonelik"
	if item.HaftalikGun == 0 {
		item.Tur = "bakiye"
		item.KalanDegerKurus = kalanDegerKurus(item.TutarKurus, item.ToplamDakika, item.KalanDakika)
	}
}

// ListCustomerPackages bir müşterinin satın aldığı abonelik ve saat bakiyeli
// paketleri (en yeniden en eskiye) döner.
func (a *API) ListCustomerPackages(w http.ResponseWriter, r *http.Request) {
	idStr := chi.URLParam(r, "id")
	id, err := strconv.ParseInt(idStr, 10, 64)
	if err != nil {
		writeError(w, http.StatusBadRequest, "Geçersiz müşteri numarası.")
		return
	}

	rows, err := a.DB.Query(r.Context(), `
		SELECT id, ad, COALESCE(grup, ''), COALESCE(haftalik_gun, 0), COALESCE(gunluk_dakika, 0),
			COALESCE(toplam_dakika, 0), COALESCE(kalan_dakika, 0),
			tutar_kurus, COALESCE(odeme_tipi, ''), satin_alma_zamani, gecerlilik_bitis
		FROM customer_packages
		WHERE customer_id = $1 AND (haftalik_gun IS NOT NULL OR toplam_dakika IS NOT NULL)
		ORDER BY satin_alma_zamani DESC`,
		id,
	)
	if err != nil {
		writeServerError(w, http.StatusInternalServerError, "paketler alınamadı", err)
		return
	}
	defer rows.Close()

	result := []customerPackageItem{}
	bitisler := []time.Time{}
	for rows.Next() {
		var item customerPackageItem
		var satinAlma, bitis time.Time
		if err := rows.Scan(&item.ID, &item.Ad, &item.Grup, &item.HaftalikGun, &item.GunlukDakika,
			&item.ToplamDakika, &item.KalanDakika,
			&item.TutarKurus, &item.OdemeTipi, &satinAlma, &bitis); err != nil {
			writeServerError(w, http.StatusInternalServerError, "satır okunamadı", err)
			return
		}
		item.doldur()
		item.SatinAlmaZamani = satinAlma.Format("2006-01-02 15:04")
		item.GecerlilikBitis = bitis.Format("2006-01-02 15:04")
		item.SuresiDolmusMu = time.Now().After(bitis)
		result = append(result, item)
		bitisler = append(bitisler, bitis)
	}
	rows.Close()
	for i := range result {
		item := &result[i]
		if item.Tur != "abonelik" || item.SuresiDolmusMu {
			continue
		}
		gun, dk, oturum, err := abonelikKullanimi(r.Context(), a.DB, item.ID)
		if err != nil {
			writeServerError(w, http.StatusInternalServerError, "paket kullanımı alınamadı", err)
			return
		}
		item.abonelikHaklari = abonelikKalanHaklar(time.Now(), bitisler[i], item.HaftalikGun, item.GunlukDakika, gun, dk, oturum > 0)
	}
	writeJSON(w, http.StatusOK, result)
}

type purchasePackageRequest struct {
	PackageDefinitionID int64  `json:"package_definition_id"`
	OdemeTipi           string `json:"odeme_tipi"`
	// Yalnızca yönetici: paket ücreti yerine bu tutar tahsil edilir (tek seferlik).
	OzelTutarKurus *int64 `json:"ozel_tutar_kurus"`
}

// PurchasePackage bir müşteriye paket tanımlar: haftalık gün, günlük dakika
// (bakiye pakette toplam dakika) ve ücret satın alma anındaki tanımdan kopyalanıp dondurulur (paket türü
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
	if _, ok := ozelTutarYetkisi(w, r, req.OzelTutarKurus); !ok {
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

	// Bakiye pakette haftalik_gun/gunluk_dakika NULL kalır; dakika hem toplam
	// hem kalan bakiye olarak yazılır.
	var paketAdi, grup string
	var haftalikGun, gunlukDakika, dakika *int64
	var aylikUcretKurus int64
	if err := tx.QueryRow(ctx,
		`SELECT ad, grup, haftalik_gun, gunluk_dakika, dakika, aylik_ucret_kurus
		 FROM package_definitions
		 WHERE id = $1 AND aktif = true AND aylik_ucret_kurus IS NOT NULL
			AND (haftalik_gun IS NOT NULL OR dakika IS NOT NULL)`,
		req.PackageDefinitionID,
	).Scan(&paketAdi, &grup, &haftalikGun, &gunlukDakika, &dakika, &aylikUcretKurus); err != nil {
		writeError(w, http.StatusNotFound, "paket türü bulunamadı")
		return
	}
	if haftalikGun != nil {
		dakika = nil // abonelikte toplam/kalan dakika tutulmaz
	}

	tutarKurus := aylikUcretKurus
	if req.OzelTutarKurus != nil {
		tutarKurus = *req.OzelTutarKurus
	}

	var item customerPackageItem
	var satinAlma, bitis time.Time
	if err := tx.QueryRow(ctx, `
		INSERT INTO customer_packages
			(customer_id, package_definition_id, ad, grup, haftalik_gun, gunluk_dakika,
			 toplam_dakika, kalan_dakika, tutar_kurus, odeme_tipi, gecerlilik_bitis, created_by)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $7, $8, $9, now() + interval '1 month', $10)
		RETURNING id, ad, grup, COALESCE(haftalik_gun, 0), COALESCE(gunluk_dakika, 0),
			COALESCE(toplam_dakika, 0), COALESCE(kalan_dakika, 0), tutar_kurus, odeme_tipi,
			satin_alma_zamani, gecerlilik_bitis`,
		customerID, req.PackageDefinitionID, paketAdi, grup, haftalikGun, gunlukDakika,
		dakika, tutarKurus, req.OdemeTipi, claims.UserID,
	).Scan(&item.ID, &item.Ad, &item.Grup, &item.HaftalikGun, &item.GunlukDakika,
		&item.ToplamDakika, &item.KalanDakika, &item.TutarKurus, &item.OdemeTipi, &satinAlma, &bitis); err != nil {
		writeServerError(w, http.StatusInternalServerError, "paket satın alınamadı", err)
		return
	}
	if req.OzelTutarKurus != nil {
		if err := ozelTutarAuditYaz(ctx, tx, claims.UserID, "customer_packages", item.ID, aylikUcretKurus, tutarKurus); err != nil {
			writeServerError(w, http.StatusInternalServerError, "audit log yazılamadı", err)
			return
		}
	}

	if err := tx.Commit(ctx); err != nil {
		writeError(w, http.StatusInternalServerError, "İşlem tamamlanamadı, lütfen tekrar deneyin.")
		return
	}

	tur := "abonelik"
	if haftalikGun == nil {
		tur = "bakiye"
	}
	islemDetay(r, map[string]any{
		"customer_id": customerID, "package_definition_id": req.PackageDefinitionID, "customer_package_id": item.ID,
		"paket_adi": paketAdi, "paket_turu": tur, "tutar_kurus": tutarKurus, "odeme_tipi": req.OdemeTipi,
		"gecerlilik_bitis": bitis.Format("2006-01-02 15:04"),
	})
	if tur == "bakiye" {
		islemDetay(r, map[string]any{"toplam_dakika": item.ToplamDakika})
	}
	if req.OzelTutarKurus != nil {
		islemDetay(r, map[string]any{"ozel_tutar_kurus": *req.OzelTutarKurus, "normal_tutar_kurus": aylikUcretKurus})
	}
	item.doldur()
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
	Tur                   string `json:"tur,omitempty"` // "abonelik" | "bakiye"
	ToplamDakika          int64  `json:"toplam_dakika,omitempty"`
	KalanDakika           int64  `json:"kalan_dakika,omitempty"`
	KalanDegerKurus       int64  `json:"kalan_deger_kurus,omitempty"`
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
	abonelikHaklari
}

// aktifPaketDurumu, müşterinin süresi dolmamış en son satın aldığı kullanılabilir
// paketini (abonelik ya da bakiyesi bitmemiş saat bakiyeli paket) ve hak
// kullanımını hesaplar. Paket yoksa Var=false döner. Bakiye pakette
// KalanGunlukDakika kalan bakiyeye eşittir, böylece kasadaki "aşan süre"
// mantığı iki türde de aynı çalışır.
func aktifPaketDurumu(ctx context.Context, q querier, customerID int64) (paketDurumu, error) {
	var d paketDurumu
	var bitis time.Time
	var tutar int64
	err := q.QueryRow(ctx, `
		SELECT id, ad, COALESCE(grup, ''), COALESCE(haftalik_gun, 0), COALESCE(gunluk_dakika, 0),
			COALESCE(toplam_dakika, 0), COALESCE(kalan_dakika, 0), tutar_kurus, gecerlilik_bitis
		FROM customer_packages
		WHERE customer_id = $1 AND gecerlilik_bitis > now()
			AND (haftalik_gun IS NOT NULL OR kalan_dakika > 0)
		ORDER BY satin_alma_zamani DESC
		LIMIT 1`,
		customerID,
	).Scan(&d.CustomerPackageID, &d.Ad, &d.Grup, &d.HaftalikGun, &d.GunlukDakika,
		&d.ToplamDakika, &d.KalanDakika, &tutar, &bitis)
	if err != nil {
		return paketDurumu{}, nil
	}
	d.Var = true
	d.GecerlilikBitis = bitis.Format("2006-01-02 15:04")
	if d.HaftalikGun == 0 {
		d.Tur = "bakiye"
		d.KalanDegerKurus = kalanDegerKurus(tutar, d.ToplamDakika, d.KalanDakika)
		d.KalanGunlukDakika = d.KalanDakika
		d.BitiseKalanGun = max(0, takvimGunFarki(time.Now(), bitis))
		return d, nil
	}
	d.Tur = "abonelik"
	d.ToplamDakika, d.KalanDakika = 0, 0

	var bugunkuOturumSayisi int64
	var err2 error
	d.BuHaftaKullanilanGun, d.BugunKullanilanDakika, bugunkuOturumSayisi, err2 = abonelikKullanimi(ctx, q, d.CustomerPackageID)
	if err2 != nil {
		return paketDurumu{}, err2
	}

	d.BugunPaketeSayildiMi = bugunkuOturumSayisi > 0
	d.KalanGunlukDakika = d.GunlukDakika - d.BugunKullanilanDakika
	if d.KalanGunlukDakika < 0 {
		d.KalanGunlukDakika = 0
	}
	// Bugün zaten pakete sayılmış bir giriş varsa yeni bir gün hakkı
	// tüketilmez; o yüzden gün hakkı yalnızca yeni bir gün için dolmuş sayılır.
	d.GunHakkiDolduMu = !d.BugunPaketeSayildiMi && d.BuHaftaKullanilanGun >= d.HaftalikGun
	d.abonelikHaklari = abonelikKalanHaklar(time.Now(), bitis, d.HaftalikGun, d.GunlukDakika,
		d.BuHaftaKullanilanGun, d.BugunKullanilanDakika, d.BugunPaketeSayildiMi)
	return d, nil
}

// abonelikKullanimi bir abonelik paketinin bu haftaki kullanılan gün sayısını,
// bugün pakete düşülen dakikayı ve bugünkü oturum sayısını döner.
func abonelikKullanimi(ctx context.Context, q querier, paketID int64) (gun, bugunDakika, bugunOturum int64, err error) {
	err = q.QueryRow(ctx, `
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
		paketID, haftaBasi(time.Now()),
	).Scan(&gun, &bugunDakika, &bugunOturum)
	return
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
