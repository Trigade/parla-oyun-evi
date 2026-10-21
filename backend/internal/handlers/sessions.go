package handlers

import (
	"encoding/json"
	"net/http"
	"strconv"
	"time"

	"github.com/go-chi/chi/v5"

	"parla-oyun-evi/backend/internal/auth"
)

type openSessionView struct {
	ID               int64     `json:"id"`
	CustomerID       int64     `json:"customer_id"`
	Ad               string    `json:"ad"`
	Soyad            string    `json:"soyad"`
	GirisZamani      time.Time `json:"giris_zamani"`
	GecenDakika      int64     `json:"gecen_dakika"`
	SureSecimiDakika *int64    `json:"sure_secimi_dakika,omitempty"`
	OnOdemeYapildiMi bool      `json:"on_odeme_yapildi_mi"`
	// Yalnızca erken ödemesi alınmış oturumlarda doludur (alınan tutar ve
	// ödeme tipi); Gün Sonu ekranı bu oturumları ödenmemiş gibi göstermesin diye.
	TahsilTutarKurus *int64  `json:"tahsil_tutar_kurus,omitempty"`
	OdemeTipi        *string `json:"odeme_tipi,omitempty"`
}

// ListOpenSessions kasa ekranındaki "içeride olanlar" listesini besler.
// Geçen süre sunucuda hesaplanıp döner; ekranda canlı sayaç istemci
// tarafında bu değerden itibaren ilerletilir. Kasiyer girişte bir süre
// seçtiyse (sure_secimi_dakika) bu da dönülür; ekran bu süre dolduğunda
// otomatik uyarı gösterir. on_odeme_yapildi_mi true ise müşteri hâlâ
// içeride ama ödemesi zaten erkenden alınmış demektir; bu durumda alınan
// tutar ve ödeme tipi de dönülür.
func (a *API) ListOpenSessions(w http.ResponseWriter, r *http.Request) {
	rows, err := a.DB.Query(r.Context(), `
		SELECT s.id, s.customer_id, c.ad, c.soyad, s.giris_zamani, s.sure_secimi_dakika, s.on_odeme_yapildi_mi,
			s.tahsil_tutar_kurus, s.odeme_tipi
		FROM sessions s
		JOIN customers c ON c.id = s.customer_id
		WHERE s.durum = 'acik'
		ORDER BY s.giris_zamani ASC`)
	if err != nil {
		writeServerError(w, http.StatusInternalServerError, "oturumlar alınamadı", err)
		return
	}
	defer rows.Close()

	result := []openSessionView{}
	for rows.Next() {
		var v openSessionView
		if err := rows.Scan(&v.ID, &v.CustomerID, &v.Ad, &v.Soyad, &v.GirisZamani, &v.SureSecimiDakika, &v.OnOdemeYapildiMi,
			&v.TahsilTutarKurus, &v.OdemeTipi); err != nil {
			writeServerError(w, http.StatusInternalServerError, "satır okunamadı", err)
			return
		}
		v.GecenDakika = int64(time.Since(v.GirisZamani).Minutes())
		result = append(result, v)
	}
	writeJSON(w, http.StatusOK, result)
}

type closeSessionRequest struct {
	OdemeTipi    string `json:"odeme_tipi"` // "nakit" | "kredi_karti" | "paket"
	Yuvarla      bool   `json:"yuvarla"`
	IndirimKurus int64  `json:"indirim_kurus"` // sabit tutar veya yüzdeden hesaplanmış, frontend gönderir
	// PaketModu, müşterinin abonelik paketi varsa kasiyerin verdiği karardır:
	//   ""         → paket kullanılmaz, tüm süre normal fiyatlandırılır
	//   "ucretsiz" → oturumun tamamı pakete sayılır, ücret alınmaz
	//   "asim"     → günlük hak kadarı pakete sayılır, aşan süre tahsil edilir
	//                (bu durumda odeme_tipi nakit/kredi_karti olmalıdır)
	PaketModu string `json:"paket_modu"`
}

// CloseSession oturumu çıkış anıyla kapatır: aktif fiyat kuralına göre tam
// dakika üzerinden orijinal tutarı hesaplar, istenirse yuvarlanmış tahsilat
// tutarını da ayrıca kaydeder. İndirim varsa (tutar veya yüzde — hesaplama
// frontend'de yapılıp kuruş olarak gönderilir) yuvarlamadan sonraki tutardan
// düşülür. Orijinal tutar her durumda korunur.
func (a *API) CloseSession(w http.ResponseWriter, r *http.Request) {
	idStr := chi.URLParam(r, "id")
	id, err := strconv.ParseInt(idStr, 10, 64)
	if err != nil {
		writeError(w, http.StatusBadRequest, "Geçersiz oturum numarası.")
		return
	}

	var req closeSessionRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "Gönderilen bilgiler okunamadı, lütfen sayfayı yenileyip tekrar deneyin.")
		return
	}
	if req.PaketModu != "" && req.PaketModu != "ucretsiz" && req.PaketModu != "asim" {
		writeError(w, http.StatusBadRequest, "Geçersiz paket seçimi.")
		return
	}
	if req.PaketModu == "ucretsiz" {
		// Tamamı pakete sayılan oturumda tahsilat yoktur; yuvarlama/indirim anlamsızdır.
		req.OdemeTipi = "paket"
		req.Yuvarla = false
		req.IndirimKurus = 0
	}
	if req.OdemeTipi == "paket" && req.PaketModu != "ucretsiz" {
		writeError(w, http.StatusBadRequest, "Pakete saymak için 'Paketten Düş' seçeneğini kullanın.")
		return
	}
	if req.OdemeTipi != "nakit" && req.OdemeTipi != "kredi_karti" && req.OdemeTipi != "paket" {
		writeError(w, http.StatusBadRequest, "Ödeme tipi 'Nakit' veya 'Kredi Kartı' olmalıdır.")
		return
	}
	if req.IndirimKurus < 0 {
		writeError(w, http.StatusBadRequest, "İndirim tutarı negatif olamaz.")
		return
	}

	ctx := r.Context()
	tx, err := a.DB.Begin(ctx)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "İşlem başlatılamadı, lütfen tekrar deneyin.")
		return
	}
	defer tx.Rollback(ctx)

	var girisZamani time.Time
	var durum string
	var customerID int64
	var onOdemeYapildiMi bool
	if err := tx.QueryRow(ctx,
		`SELECT giris_zamani, durum, customer_id, on_odeme_yapildi_mi FROM sessions WHERE id = $1 FOR UPDATE`, id,
	).Scan(&girisZamani, &durum, &customerID, &onOdemeYapildiMi); err != nil {
		writeError(w, http.StatusNotFound, "oturum bulunamadı")
		return
	}
	if durum != "acik" {
		writeError(w, http.StatusConflict, "oturum zaten kapalı veya iptal edilmiş")
		return
	}
	// Erken ödemesi alınmış bir oturum burada yeniden ücretlendirilirse alınan
	// tutarın üzerine yazılır; bu oturumlar CheckOutSession ile kapatılmalıdır.
	if onOdemeYapildiMi {
		writeError(w, http.StatusConflict, "Bu oturumun ödemesi erkenden alındı. Müşteri çıktığında 'Çıkış Yaptı' ile kapatın.")
		return
	}

	cikisZamani := time.Now()
	toplamDakika := int64(cikisZamani.Sub(girisZamani).Minutes())
	if toplamDakika < 0 {
		toplamDakika = 0
	}

	if toplamDakika == 0 {
		if _, err := tx.Exec(ctx, `DELETE FROM sessions WHERE id = $1`, id); err != nil {
			writeServerError(w, http.StatusInternalServerError, "oturum silinemedi", err)
			return
		}
		if err := tx.Commit(ctx); err != nil {
			writeError(w, http.StatusInternalServerError, "İşlem tamamlanamadı, lütfen tekrar deneyin.")
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{
			"id":                   id,
			"toplam_dakika":        int64(0),
			"orijinal_tutar_kurus": int64(0),
			"tahsil_tutar_kurus":   int64(0),
			"indirim_kurus":        int64(0),
			"odeme_tipi":           req.OdemeTipi,
			"silindi":              true,
		})
		return
	}

	// Paket seçildiyse müşterinin aktif aboneliği ve o günkü kalan hakkı
	// hesaplanır. "ucretsiz" oturumun tamamını pakete sayar; "asim" ise
	// yalnızca günlük hak kadarını pakete sayıp aşan süreyi ücretlendirir.
	// Kararı kasiyer verir (bkz. closeSessionRequest.PaketModu).
	var paketID *int64
	var paketDusulen int64
	ucretlendirilecekDakika := toplamDakika
	if req.PaketModu != "" {
		durum, err := aktifPaketDurumu(ctx, tx, customerID)
		if err != nil {
			writeServerError(w, http.StatusInternalServerError, "paket durumu alınamadı", err)
			return
		}
		if !durum.Var {
			writeError(w, http.StatusConflict, "Müşterinin geçerli bir paketi yok.")
			return
		}
		paketID = &durum.CustomerPackageID
		if req.PaketModu == "ucretsiz" {
			paketDusulen = toplamDakika
			ucretlendirilecekDakika = 0
		} else {
			paketDusulen = durum.KalanGunlukDakika
			if paketDusulen > toplamDakika {
				paketDusulen = toplamDakika
			}
			ucretlendirilecekDakika = toplamDakika - paketDusulen
		}
	}

	var orijinalTutar int64
	var pricingTierVersionID, pricingTierID *int64
	if ucretlendirilecekDakika > 0 {
		versionID, tierID, tutarKurus, err := tierUcretiniHesapla(ctx, tx, ucretlendirilecekDakika)
		if err != nil {
			writeServerError(w, http.StatusInternalServerError, "Aktif bir fiyat politikası tanımlı değil, lütfen yöneticinize bildirin.", err)
			return
		}
		pricingTierVersionID, pricingTierID = &versionID, &tierID
		orijinalTutar = tutarKurus
	}

	tahsilTutar := orijinalTutar
	if req.Yuvarla {
		tahsilTutar = RoundDownToTen(orijinalTutar)
	}

	indirimKurus := req.IndirimKurus
	if indirimKurus > tahsilTutar {
		indirimKurus = tahsilTutar
	}
	tahsilTutar -= indirimKurus

	if _, err := tx.Exec(ctx, `
		UPDATE sessions SET
			cikis_zamani = $1,
			durum = 'kapali',
			pricing_tier_version_id = $2,
			pricing_tier_id = $3,
			toplam_dakika = $4,
			orijinal_tutar_kurus = $5,
			tahsil_tutar_kurus = $6,
			odeme_tipi = $7,
			indirim_kurus = $8,
			paketten_dusulen_dakika = $9,
			customer_package_id = $10
		WHERE id = $11`,
		cikisZamani, pricingTierVersionID, pricingTierID, toplamDakika, orijinalTutar, tahsilTutar, req.OdemeTipi, indirimKurus, paketDusulen, paketID, id,
	); err != nil {
		writeServerError(w, http.StatusInternalServerError, "oturum kapatılamadı", err)
		return
	}

	if err := tx.Commit(ctx); err != nil {
		writeError(w, http.StatusInternalServerError, "İşlem tamamlanamadı, lütfen tekrar deneyin.")
		return
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"id":                      id,
		"toplam_dakika":           toplamDakika,
		"orijinal_tutar_kurus":    orijinalTutar,
		"tahsil_tutar_kurus":      tahsilTutar,
		"indirim_kurus":           indirimKurus,
		"odeme_tipi":              req.OdemeTipi,
		"paketten_dusulen_dakika": paketDusulen,
	})
}

// PayEarlySession, süreli açılan (sure_secimi_dakika belirtilmiş) bir
// oturumun ödemesini müşteri hâlâ içeride iken önceden almayı sağlar.
// Tutar, gerçek geçen süre değil seçilen (rezerve edilen) süre üzerinden
// hesaplanır — müşteri o süre için ödeme yapmıştır. Oturum "acik" kalmaya
// devam eder ve İçeride Olanlar listesinde görünmeyi sürdürür; sadece
// on_odeme_yapildi_mi=true olarak işaretlenir. Müşteri gerçekten çıktığında
// CheckOutSession çağrılır ve burada hesaplanan tutar yeniden hesaplanmaz.
func (a *API) PayEarlySession(w http.ResponseWriter, r *http.Request) {
	idStr := chi.URLParam(r, "id")
	id, err := strconv.ParseInt(idStr, 10, 64)
	if err != nil {
		writeError(w, http.StatusBadRequest, "Geçersiz oturum numarası.")
		return
	}

	var req closeSessionRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "Gönderilen bilgiler okunamadı, lütfen sayfayı yenileyip tekrar deneyin.")
		return
	}
	// Erken ödeme nakit/kart tahsilatıdır. Paketli müşterilerde hak kullanımı
	// çıkışta (CloseSession, paket modu) belirlendiği için burada paket seçilemez.
	if req.OdemeTipi != "nakit" && req.OdemeTipi != "kredi_karti" {
		writeError(w, http.StatusBadRequest, "Ödeme tipi 'Nakit' veya 'Kredi Kartı' olmalıdır.")
		return
	}
	if req.IndirimKurus < 0 {
		writeError(w, http.StatusBadRequest, "İndirim tutarı negatif olamaz.")
		return
	}

	ctx := r.Context()
	tx, err := a.DB.Begin(ctx)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "İşlem başlatılamadı, lütfen tekrar deneyin.")
		return
	}
	defer tx.Rollback(ctx)

	var durum string
	var customerID int64
	var sureSecimiDakika *int64
	var onOdemeYapildiMi bool
	if err := tx.QueryRow(ctx,
		`SELECT durum, customer_id, sure_secimi_dakika, on_odeme_yapildi_mi FROM sessions WHERE id = $1 FOR UPDATE`, id,
	).Scan(&durum, &customerID, &sureSecimiDakika, &onOdemeYapildiMi); err != nil {
		writeError(w, http.StatusNotFound, "oturum bulunamadı")
		return
	}
	if durum != "acik" {
		writeError(w, http.StatusConflict, "oturum zaten kapalı veya iptal edilmiş")
		return
	}
	if sureSecimiDakika == nil {
		writeError(w, http.StatusBadRequest, "erken ödeme yalnızca süreli açılan oturumlarda yapılabilir")
		return
	}
	if onOdemeYapildiMi {
		writeError(w, http.StatusConflict, "bu oturumun ödemesi zaten alınmış")
		return
	}

	toplamDakika := *sureSecimiDakika

	var paketDusulen int64
	var orijinalTutar int64
	var pricingTierVersionID, pricingTierID *int64
	versionID, tierID, tutarKurus, err := tierUcretiniHesapla(ctx, tx, toplamDakika)
	if err != nil {
		writeServerError(w, http.StatusInternalServerError, "Aktif bir fiyat politikası tanımlı değil, lütfen yöneticinize bildirin.", err)
		return
	}
	pricingTierVersionID, pricingTierID = &versionID, &tierID
	orijinalTutar = tutarKurus

	tahsilTutar := orijinalTutar
	if req.Yuvarla {
		tahsilTutar = RoundDownToTen(orijinalTutar)
	}

	indirimKurus := req.IndirimKurus
	if indirimKurus > tahsilTutar {
		indirimKurus = tahsilTutar
	}
	tahsilTutar -= indirimKurus

	if _, err := tx.Exec(ctx, `
		UPDATE sessions SET
			pricing_tier_version_id = $1,
			pricing_tier_id = $2,
			toplam_dakika = $3,
			orijinal_tutar_kurus = $4,
			tahsil_tutar_kurus = $5,
			odeme_tipi = $6,
			indirim_kurus = $7,
			paketten_dusulen_dakika = $8,
			on_odeme_yapildi_mi = true,
			on_odeme_zamani = now()
		WHERE id = $9`,
		pricingTierVersionID, pricingTierID, toplamDakika, orijinalTutar, tahsilTutar, req.OdemeTipi, indirimKurus, paketDusulen, id,
	); err != nil {
		writeServerError(w, http.StatusInternalServerError, "erken ödeme kaydedilemedi", err)
		return
	}

	if err := tx.Commit(ctx); err != nil {
		writeError(w, http.StatusInternalServerError, "İşlem tamamlanamadı, lütfen tekrar deneyin.")
		return
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"id":                      id,
		"toplam_dakika":           toplamDakika,
		"orijinal_tutar_kurus":    orijinalTutar,
		"tahsil_tutar_kurus":      tahsilTutar,
		"indirim_kurus":           indirimKurus,
		"odeme_tipi":              req.OdemeTipi,
		"paketten_dusulen_dakika": paketDusulen,
		"on_odeme_yapildi_mi":     true,
	})
}

// CheckOutSession, ödemesi erkenden alınmış (on_odeme_yapildi_mi=true) bir
// oturumu, müşteri gerçekten çıktığında kapatır. Tutar PayEarlySession'da
// zaten hesaplanıp donduğundan burada yeniden hesaplanmaz; sadece
// cikis_zamani ve durum güncellenir.
func (a *API) CheckOutSession(w http.ResponseWriter, r *http.Request) {
	idStr := chi.URLParam(r, "id")
	id, err := strconv.ParseInt(idStr, 10, 64)
	if err != nil {
		writeError(w, http.StatusBadRequest, "Geçersiz oturum numarası.")
		return
	}

	ctx := r.Context()
	tx, err := a.DB.Begin(ctx)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "İşlem başlatılamadı, lütfen tekrar deneyin.")
		return
	}
	defer tx.Rollback(ctx)

	var durum string
	var onOdemeYapildiMi bool
	if err := tx.QueryRow(ctx,
		`SELECT durum, on_odeme_yapildi_mi FROM sessions WHERE id = $1 FOR UPDATE`, id,
	).Scan(&durum, &onOdemeYapildiMi); err != nil {
		writeError(w, http.StatusNotFound, "oturum bulunamadı")
		return
	}
	if durum != "acik" {
		writeError(w, http.StatusConflict, "oturum zaten kapalı veya iptal edilmiş")
		return
	}
	if !onOdemeYapildiMi {
		writeError(w, http.StatusConflict, "bu oturumun ödemesi henüz alınmamış")
		return
	}

	if _, err := tx.Exec(ctx,
		`UPDATE sessions SET cikis_zamani = now(), durum = 'kapali' WHERE id = $1`, id,
	); err != nil {
		writeServerError(w, http.StatusInternalServerError, "oturum kapatılamadı", err)
		return
	}

	if err := tx.Commit(ctx); err != nil {
		writeError(w, http.StatusInternalServerError, "İşlem tamamlanamadı, lütfen tekrar deneyin.")
		return
	}

	writeJSON(w, http.StatusOK, map[string]any{"id": id, "cikis_yapildi": true})
}

type extendSessionRequest struct {
	EkDakika int64 `json:"ek_dakika"`
}

// ExtendSessionDuration, süreli açılan (sure_secimi_dakika belirtilmiş) ve
// süresi dolan bir oturumun rezerve edilen süresini uzatır — kasa ekranındaki
// "Süresi Doldu" uyarısında müşteri içeride kalmaya devam etmek istediğinde
// kullanılır. Ödemesi zaten erkenden alınmış (on_odeme_yapildi_mi=true) bir
// oturum uzatılamaz: bu durumda ek süre için ayrıca ücret tahsil edilmesi
// gerekir, bu akış kapsam dışıdır — kasiyer müşteri çıktığında normal
// şekilde (gerçek geçen süre üzerinden) kapatmalıdır.
func (a *API) ExtendSessionDuration(w http.ResponseWriter, r *http.Request) {
	idStr := chi.URLParam(r, "id")
	id, err := strconv.ParseInt(idStr, 10, 64)
	if err != nil {
		writeError(w, http.StatusBadRequest, "Geçersiz oturum numarası.")
		return
	}

	var req extendSessionRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "Gönderilen bilgiler okunamadı, lütfen sayfayı yenileyip tekrar deneyin.")
		return
	}
	if req.EkDakika <= 0 {
		writeError(w, http.StatusBadRequest, "eklenecek süre 0'dan büyük olmalıdır")
		return
	}

	ctx := r.Context()
	tx, err := a.DB.Begin(ctx)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "İşlem başlatılamadı, lütfen tekrar deneyin.")
		return
	}
	defer tx.Rollback(ctx)

	var durum string
	var sureSecimiDakika *int64
	var onOdemeYapildiMi bool
	if err := tx.QueryRow(ctx,
		`SELECT durum, sure_secimi_dakika, on_odeme_yapildi_mi FROM sessions WHERE id = $1 FOR UPDATE`, id,
	).Scan(&durum, &sureSecimiDakika, &onOdemeYapildiMi); err != nil {
		writeError(w, http.StatusNotFound, "oturum bulunamadı")
		return
	}
	if durum != "acik" {
		writeError(w, http.StatusConflict, "oturum zaten kapalı veya iptal edilmiş")
		return
	}
	if sureSecimiDakika == nil {
		writeError(w, http.StatusBadRequest, "süre uzatma yalnızca süreli açılan oturumlarda yapılabilir")
		return
	}
	if onOdemeYapildiMi {
		writeError(w, http.StatusConflict, "ödemesi zaten alınmış bir oturumun süresi uzatılamaz; müşteri çıktığında normal şekilde kapatın")
		return
	}

	yeniSure := *sureSecimiDakika + req.EkDakika
	if _, err := tx.Exec(ctx,
		`UPDATE sessions SET sure_secimi_dakika = $1 WHERE id = $2`, yeniSure, id,
	); err != nil {
		writeServerError(w, http.StatusInternalServerError, "süre uzatılamadı", err)
		return
	}

	if err := tx.Commit(ctx); err != nil {
		writeError(w, http.StatusInternalServerError, "İşlem tamamlanamadı, lütfen tekrar deneyin.")
		return
	}

	writeJSON(w, http.StatusOK, map[string]any{"id": id, "sure_secimi_dakika": yeniSure})
}

type manualCloseRequest struct {
	CikisZamani time.Time `json:"cikis_zamani"`
	OdemeTipi   string    `json:"odeme_tipi"`
	Yuvarla     bool      `json:"yuvarla"`
}

// ManualCloseSession gün sonu işleminde açık kalmış (unutulmuş çıkış) bir
// oturumu yönetici tarafından elle kapatmak için kullanılır. Denetim izi
// (audit_log) için işlemi kim yaptı bilgisi JWT claim'lerinden alınır.
func (a *API) ManualCloseSession(w http.ResponseWriter, r *http.Request) {
	claims, ok := auth.FromContext(r.Context())
	if !ok {
		writeError(w, http.StatusUnauthorized, "Yetkilendirme bilgisi bulunamadı, lütfen tekrar giriş yapın.")
		return
	}

	idStr := chi.URLParam(r, "id")
	id, err := strconv.ParseInt(idStr, 10, 64)
	if err != nil {
		writeError(w, http.StatusBadRequest, "Geçersiz oturum numarası.")
		return
	}

	var req manualCloseRequest
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

	var girisZamani time.Time
	var durum string
	var customerID int64
	var onOdemeYapildiMi bool
	if err := tx.QueryRow(ctx,
		`SELECT giris_zamani, durum, customer_id, on_odeme_yapildi_mi FROM sessions WHERE id = $1 FOR UPDATE`, id,
	).Scan(&girisZamani, &durum, &customerID, &onOdemeYapildiMi); err != nil {
		writeError(w, http.StatusNotFound, "oturum bulunamadı")
		return
	}
	if durum != "acik" {
		writeError(w, http.StatusConflict, "oturum zaten kapalı veya iptal edilmiş")
		return
	}
	if req.CikisZamani.IsZero() {
		writeError(w, http.StatusBadRequest, "Çıkış zamanı gerekli.")
		return
	}
	if req.CikisZamani.Before(girisZamani) {
		writeError(w, http.StatusBadRequest, "çıkış zamanı giriş zamanından önce olamaz")
		return
	}
	// Gelecek tarihli çıkış tutarı şişirir ve oturumu gün sonu raporunun
	// aralığı dışında bırakır; 1 dk saat kayması toleransı tanınır.
	if req.CikisZamani.After(time.Now().Add(time.Minute)) {
		writeError(w, http.StatusBadRequest, "Çıkış zamanı ileri bir tarih olamaz.")
		return
	}

	// Ödemesi erkenden alınmış bir oturum gün sonunda "unutulmuş" gibi
	// görünse de tutar zaten donmuştur; yeniden hesaplamadan sadece kapatılır.
	if onOdemeYapildiMi {
		if _, err := tx.Exec(ctx,
			`UPDATE sessions SET cikis_zamani = $1, durum = 'kapali', manuel_kapatildi = true, kapatan_user_id = $2 WHERE id = $3`,
			req.CikisZamani, claims.UserID, id,
		); err != nil {
			writeServerError(w, http.StatusInternalServerError, "oturum kapatılamadı", err)
			return
		}
		if _, err := tx.Exec(ctx,
			`INSERT INTO audit_log (user_id, action, target_table, target_id, detail)
			 VALUES ($1, 'manuel_gun_sonu_kapatma', 'sessions', $2, $3)`,
			claims.UserID, id, map[string]any{"cikis_zamani": req.CikisZamani, "on_odeme_yapildi_mi": true},
		); err != nil {
			writeServerError(w, http.StatusInternalServerError, "audit log yazılamadı", err)
			return
		}
		if err := tx.Commit(ctx); err != nil {
			writeError(w, http.StatusInternalServerError, "İşlem tamamlanamadı, lütfen tekrar deneyin.")
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"id": id, "manuel_kapatildi": true, "on_odeme_yapildi_mi": true})
		return
	}

	toplamDakika := int64(req.CikisZamani.Sub(girisZamani).Minutes())
	if toplamDakika < 0 {
		toplamDakika = 0
	}

	versionID, tierID, orijinalTutar, err := tierUcretiniHesapla(ctx, tx, toplamDakika)
	if err != nil {
		writeServerError(w, http.StatusInternalServerError, "Aktif bir fiyat politikası tanımlı değil, lütfen yöneticinize bildirin.", err)
		return
	}
	tahsilTutar := orijinalTutar
	if req.Yuvarla {
		tahsilTutar = RoundDownToTen(orijinalTutar)
	}

	if _, err := tx.Exec(ctx, `
		UPDATE sessions SET
			cikis_zamani = $1,
			durum = 'kapali',
			pricing_tier_version_id = $2,
			pricing_tier_id = $3,
			toplam_dakika = $4,
			orijinal_tutar_kurus = $5,
			tahsil_tutar_kurus = $6,
			odeme_tipi = $7,
			manuel_kapatildi = true,
			kapatan_user_id = $8
		WHERE id = $9`,
		req.CikisZamani, versionID, tierID, toplamDakika, orijinalTutar, tahsilTutar, req.OdemeTipi, claims.UserID, id,
	); err != nil {
		writeServerError(w, http.StatusInternalServerError, "oturum kapatılamadı", err)
		return
	}

	if _, err := tx.Exec(ctx, `
		INSERT INTO audit_log (user_id, action, target_table, target_id, detail)
		VALUES ($1, 'manuel_gun_sonu_kapatma', 'sessions', $2, $3)`,
		claims.UserID, id, map[string]any{"cikis_zamani": req.CikisZamani, "odeme_tipi": req.OdemeTipi},
	); err != nil {
		writeServerError(w, http.StatusInternalServerError, "audit log yazılamadı", err)
		return
	}

	if err := tx.Commit(ctx); err != nil {
		writeError(w, http.StatusInternalServerError, "İşlem tamamlanamadı, lütfen tekrar deneyin.")
		return
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"id":                   id,
		"toplam_dakika":        toplamDakika,
		"orijinal_tutar_kurus": orijinalTutar,
		"tahsil_tutar_kurus":   tahsilTutar,
		"manuel_kapatildi":     true,
	})
}
