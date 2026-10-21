package handlers

import (
	"fmt"
	"net/http"
	"strconv"
	"time"

	"github.com/go-chi/chi/v5"

	"parla-oyun-evi/backend/internal/assets"
	"parla-oyun-evi/backend/internal/auth"
	"parla-oyun-evi/backend/internal/pdf"
)

type businessDayView struct {
	ID            int64   `json:"id"`
	AcilisZamani  string  `json:"acilis_zamani"`
	KapanisZamani *string `json:"kapanis_zamani,omitempty"`
	Durum         string  `json:"durum"`
}

// GetCurrentBusinessDay şu an açık olan iş gününü döner; açık gün yoksa
// acik:false ile boş yanıt döner.
func (a *API) GetCurrentBusinessDay(w http.ResponseWriter, r *http.Request) {
	var v businessDayView
	var acilis time.Time
	err := a.DB.QueryRow(r.Context(), `
		SELECT id, acilis_zamani, durum FROM business_days
		WHERE durum = 'acik' ORDER BY acilis_zamani DESC LIMIT 1`,
	).Scan(&v.ID, &acilis, &v.Durum)
	if err != nil {
		writeJSON(w, http.StatusOK, map[string]any{"acik": false})
		return
	}
	v.AcilisZamani = acilis.Format("2006-01-02 15:04:05")
	writeJSON(w, http.StatusOK, map[string]any{"acik": true, "gun": v})
}

// StartBusinessDay ("Gün Başı") yeni bir iş günü açar. Zaten açık bir gün
// varsa hata döner (aynı anda tek bir açık gün olabilir).
func (a *API) StartBusinessDay(w http.ResponseWriter, r *http.Request) {
	claims, ok := auth.FromContext(r.Context())
	if !ok {
		writeError(w, http.StatusUnauthorized, "Yetkilendirme bilgisi bulunamadı, lütfen tekrar giriş yapın.")
		return
	}

	var existingID int64
	err := a.DB.QueryRow(r.Context(),
		`SELECT id FROM business_days WHERE durum = 'acik' LIMIT 1`,
	).Scan(&existingID)
	if err == nil {
		writeError(w, http.StatusConflict, "zaten açık bir gün var")
		return
	}

	var id int64
	var acilis time.Time
	err = a.DB.QueryRow(r.Context(), `
		INSERT INTO business_days (acilis_user_id) VALUES ($1)
		RETURNING id, acilis_zamani`,
		claims.UserID,
	).Scan(&id, &acilis)
	if err != nil {
		if pgUniqueViolation(err) {
			// idx_business_days_single_open: iki eşzamanlı "Gün Başı" isteği
			// yarıştı, ikincisi DB tarafından reddedildi.
			writeError(w, http.StatusConflict, "zaten açık bir gün var")
			return
		}
		writeServerError(w, http.StatusInternalServerError, "gün başlatılamadı", err)
		return
	}

	writeJSON(w, http.StatusCreated, map[string]any{
		"id": id, "acilis_zamani": acilis.Format("2006-01-02 15:04:05"), "durum": "acik",
	})
}

// EndBusinessDay ("Gün Sonu") açık iş gününü kapatır. Ödemesi alınmamış açık
// oturum varsa işlem reddedilir — önce bunların nakit/kart/elle kapatılmış
// olması gerekir. Ödemesi erkenden alınmış ama "Çıkış Yaptı" ile henüz
// kapatılmamış oturumlar gün sonunu engellemez: gün kapanırken otomatik
// olarak çıkış yapmış sayılır. Başarılı olursa, gün boyunca ödemesi alınan
// tüm oturumları içeren bir PDF raporu döner.
func (a *API) EndBusinessDay(w http.ResponseWriter, r *http.Request) {
	claims, ok := auth.FromContext(r.Context())
	if !ok {
		writeError(w, http.StatusUnauthorized, "Yetkilendirme bilgisi bulunamadı, lütfen tekrar giriş yapın.")
		return
	}

	idStr := chi.URLParam(r, "id")
	id, err := strconv.ParseInt(idStr, 10, 64)
	if err != nil {
		writeError(w, http.StatusBadRequest, "Geçersiz gün numarası.")
		return
	}

	ctx := r.Context()
	tx, err := a.DB.Begin(ctx)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "İşlem başlatılamadı, lütfen tekrar deneyin.")
		return
	}
	defer tx.Rollback(ctx)

	var acilisZamani time.Time
	var durum string
	if err := tx.QueryRow(ctx,
		`SELECT acilis_zamani, durum FROM business_days WHERE id = $1 FOR UPDATE`, id,
	).Scan(&acilisZamani, &durum); err != nil {
		writeError(w, http.StatusNotFound, "gün bulunamadı")
		return
	}
	if durum != "acik" {
		writeError(w, http.StatusConflict, "bu gün zaten kapatılmış")
		return
	}

	var odenmemisAcikOturumSayisi int64
	if err := tx.QueryRow(ctx,
		`SELECT COUNT(*) FROM sessions WHERE durum = 'acik' AND NOT on_odeme_yapildi_mi`,
	).Scan(&odenmemisAcikOturumSayisi); err != nil {
		writeError(w, http.StatusInternalServerError, "açık oturum kontrolü yapılamadı")
		return
	}
	if odenmemisAcikOturumSayisi > 0 {
		writeError(w, http.StatusConflict,
			fmt.Sprintf("gün sonu yapılamıyor: ödemesi alınmamış %d açık oturum var, önce hepsini kapatın", odenmemisAcikOturumSayisi))
		return
	}

	kapanisZamani := time.Now()
	if _, err := tx.Exec(ctx, `
		UPDATE business_days SET kapanis_zamani = $1, kapanis_user_id = $2, durum = 'kapali'
		WHERE id = $3`,
		kapanisZamani, claims.UserID, id,
	); err != nil {
		writeServerError(w, http.StatusInternalServerError, "gün kapatılamadı", err)
		return
	}

	// Ödemesi erkenden alınmış, hâlâ içeride görünen oturumlar gün sonunda
	// kapatılır; tutarları erken ödemede zaten donmuştur, yeniden hesaplanmaz.
	if _, err := tx.Exec(ctx, `
		UPDATE sessions SET cikis_zamani = $1, durum = 'kapali'
		WHERE durum = 'acik' AND on_odeme_yapildi_mi`,
		kapanisZamani,
	); err != nil {
		writeServerError(w, http.StatusInternalServerError, "erken ödemeli oturumlar kapatılamadı", err)
		return
	}

	// Rapor, oturumları ödemenin alındığı ana göre filtreler: erken ödemede
	// bu an on_odeme_zamani'dir, diğerlerinde çıkış anı.
	rows, err := tx.Query(ctx, `
		SELECT c.ad, c.soyad, s.giris_zamani, s.cikis_zamani, s.toplam_dakika,
			s.tahsil_tutar_kurus, s.indirim_kurus, s.odeme_tipi, s.manuel_kapatildi, s.on_odeme_yapildi_mi
		FROM sessions s
		JOIN customers c ON c.id = s.customer_id
		WHERE s.durum = 'kapali'
			AND COALESCE(s.on_odeme_zamani, s.cikis_zamani) >= $1
			AND COALESCE(s.on_odeme_zamani, s.cikis_zamani) <= $2
		ORDER BY COALESCE(s.on_odeme_zamani, s.cikis_zamani) ASC`,
		acilisZamani, kapanisZamani,
	)
	if err != nil {
		writeServerError(w, http.StatusInternalServerError, "işlemler alınamadı", err)
		return
	}

	tableRows := [][]string{}
	var toplamKurus, nakitKurus, kartKurus, toplamIndirimKurus, erkenOdemeKurus int64
	var nakitSayisi, kartSayisi, paketSayisi, erkenOdemeSayisi, oturumSayisi int64
	var paketSatisKurus, paketSatisSayisi int64
	for rows.Next() {
		var ad, soyad string
		var giris, cikis time.Time
		var dakika, tutar, indirim int64
		var odemeTipi string
		var manuelKapatildi, erkenOdeme bool
		if err := rows.Scan(&ad, &soyad, &giris, &cikis, &dakika, &tutar, &indirim, &odemeTipi, &manuelKapatildi, &erkenOdeme); err != nil {
			rows.Close()
			writeServerError(w, http.StatusInternalServerError, "satır okunamadı", err)
			return
		}
		kapatmaSekli := "Normal"
		switch {
		case manuelKapatildi:
			kapatmaSekli = "Elle Kapatıldı"
		case erkenOdeme:
			kapatmaSekli = "Erken Ödeme"
		}
		odemeEtiket := "Nakit"
		switch odemeTipi {
		case "kredi_karti":
			odemeEtiket = "Kredi Kartı"
		case "paket":
			odemeEtiket = "Paket"
		}
		indirimStr := "—"
		if indirim > 0 {
			indirimStr = formatKurusStr(indirim)
		}
		tableRows = append(tableRows, []string{
			ad + " " + soyad,
			giris.Format("15:04"),
			cikis.Format("15:04"),
			fmt.Sprintf("%d dk", dakika),
			indirimStr,
			formatKurusStr(tutar),
			odemeEtiket,
			kapatmaSekli,
		})
		toplamKurus += tutar
		toplamIndirimKurus += indirim
		oturumSayisi++
		switch odemeTipi {
		case "nakit":
			nakitKurus += tutar
			nakitSayisi++
		case "kredi_karti":
			kartKurus += tutar
			kartSayisi++
		case "paket":
			paketSayisi++
		}
		if erkenOdeme {
			erkenOdemeKurus += tutar
			erkenOdemeSayisi++
		}
	}
	rows.Close()

	// Gün içinde satılan paketler de tahsilattır: raporda ayrı satır olarak
	// listelenir ve toplam ciroya/ödeme tipi dağılımına dahil edilir.
	paketRows, err := tx.Query(ctx, `
		SELECT c.ad, c.soyad, cp.ad, cp.tutar_kurus, cp.odeme_tipi, cp.satin_alma_zamani
		FROM customer_packages cp
		JOIN customers c ON c.id = cp.customer_id
		WHERE cp.odeme_tipi IS NOT NULL
			AND cp.satin_alma_zamani >= $1 AND cp.satin_alma_zamani <= $2
		ORDER BY cp.satin_alma_zamani ASC`,
		acilisZamani, kapanisZamani,
	)
	if err != nil {
		writeServerError(w, http.StatusInternalServerError, "paket satışları alınamadı", err)
		return
	}
	for paketRows.Next() {
		var ad, soyad, paketAd, odemeTipi string
		var tutar int64
		var satinAlma time.Time
		if err := paketRows.Scan(&ad, &soyad, &paketAd, &tutar, &odemeTipi, &satinAlma); err != nil {
			paketRows.Close()
			writeServerError(w, http.StatusInternalServerError, "satır okunamadı", err)
			return
		}
		odemeEtiket := "Nakit"
		if odemeTipi == "kredi_karti" {
			odemeEtiket = "Kredi Kartı"
		}
		tableRows = append(tableRows, []string{
			ad + " " + soyad,
			satinAlma.Format("15:04"),
			"—",
			"—",
			"—",
			formatKurusStr(tutar),
			odemeEtiket,
			"Paket Satışı: " + paketAd,
		})
		toplamKurus += tutar
		paketSatisKurus += tutar
		paketSatisSayisi++
		if odemeTipi == "nakit" {
			nakitKurus += tutar
			nakitSayisi++
		} else {
			kartKurus += tutar
			kartSayisi++
		}
	}
	paketRows.Close()

	ozet := []string{
		fmt.Sprintf("Gün Başı: %s", acilisZamani.Format("02.01.2006 15:04")),
		fmt.Sprintf("Gün Sonu: %s", kapanisZamani.Format("02.01.2006 15:04")),
		fmt.Sprintf("Toplam Oturum: %d", oturumSayisi),
		fmt.Sprintf("Toplam Ciro: %s", formatKurusStr(toplamKurus)),
		fmt.Sprintf("Toplam İndirim: %s", formatKurusStr(toplamIndirimKurus)),
		fmt.Sprintf("Nakit: %d oturum, %s", nakitSayisi, formatKurusStr(nakitKurus)),
		fmt.Sprintf("Kredi Kartı: %d oturum, %s", kartSayisi, formatKurusStr(kartKurus)),
	}
	if paketSayisi > 0 {
		ozet = append(ozet, fmt.Sprintf("Pakete Sayılan: %d oturum (ücret alınmadı)", paketSayisi))
	}
	if paketSatisSayisi > 0 {
		ozet = append(ozet, fmt.Sprintf("Paket Satışı: %d adet, %s (toplam ciroya dahil)", paketSatisSayisi, formatKurusStr(paketSatisKurus)))
	}
	if erkenOdemeSayisi > 0 {
		ozet = append(ozet, fmt.Sprintf("Erken Ödeme: %d oturum, %s (toplam ciroya dahil)", erkenOdemeSayisi, formatKurusStr(erkenOdemeKurus)))
	}

	rapor := pdf.Report{
		LogoJPEG:     assets.LogoJPEG,
		BaslikUst:    "Parla Oyun Evi",
		BaslikAlt:    "Gün Sonu Raporu",
		TarihEtiket:  kapanisZamani.Format("02.01.2006"),
		SummaryLines: ozet,
		Headers:      []string{"Müşteri", "Giriş", "Çıkış", "Süre", "İndirim", "Tutar", "Ödeme Tipi", "Kapatma Şekli"},
		Rows:         tableRows,
		FooterText:   "Sadece Yönetici Görebilir",
	}

	docBytes, err := pdf.Build(rapor)
	if err != nil {
		writeServerError(w, http.StatusInternalServerError, "rapor oluşturulamadı", err)
		return
	}

	// PDF hazır olmadan gün kalıcı kapanmaz: üretim hatasında tx geri alınır.
	if err := tx.Commit(ctx); err != nil {
		writeError(w, http.StatusInternalServerError, "İşlem tamamlanamadı, lütfen tekrar deneyin.")
		return
	}

	filename := fmt.Sprintf("gun_sonu_%s.pdf", kapanisZamani.Format("2006-01-02"))
	w.Header().Set("Content-Type", "application/pdf")
	w.Header().Set("Content-Disposition", fmt.Sprintf(`attachment; filename="%s"`, filename))
	w.Write(docBytes)
}

func formatKurusStr(kurus int64) string {
	lira := float64(kurus) / 100
	return fmt.Sprintf("%.2f TL", lira)
}
