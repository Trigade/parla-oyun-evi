package handlers

import (
	"fmt"
	"net/http"
	"strconv"
	"time"

	"github.com/go-chi/chi/v5"

	"parla-oyun-evi/backend/internal/assets"
	"parla-oyun-evi/backend/internal/pdf"
)

// ExportSessionsPDF seçilen tarih aralığında kapanmış oturumları
// (giriş/çıkış zamanı, müşteri, tutar, ödeme tipi) bir .pdf dosyası
// olarak döner. Otomatik yedeklemenin yerine değil, ek bir manuel dışa
// aktarma imkânı olarak sunulur. Sadece yönetici erişebilir (bkz. router).
func (a *API) ExportSessionsPDF(w http.ResponseWriter, r *http.Request) {
	fromStr := r.URL.Query().Get("from")
	toStr := r.URL.Query().Get("to")
	if fromStr == "" || toStr == "" {
		writeError(w, http.StatusBadRequest, "Başlangıç ve bitiş tarihi zorunludur.")
		return
	}

	from, err := time.ParseInLocation("2006-01-02", fromStr, BusinessLocation)
	if err != nil {
		writeError(w, http.StatusBadRequest, "Geçersiz başlangıç tarihi.")
		return
	}
	to, err := time.ParseInLocation("2006-01-02", toStr, BusinessLocation)
	if err != nil {
		writeError(w, http.StatusBadRequest, "Geçersiz bitiş tarihi.")
		return
	}
	toExclusive := to.Add(24 * time.Hour)

	rows, err := a.DB.Query(r.Context(), `
		SELECT
			c.tc_kimlik_no, c.ad, c.soyad,
			s.giris_zamani, s.cikis_zamani,
			s.indirim_kurus, s.tahsil_tutar_kurus, s.odeme_tipi, s.manuel_kapatildi
		FROM sessions s
		JOIN customers c ON c.id = s.customer_id
		WHERE (s.durum = 'kapali' OR s.on_odeme_yapildi_mi)
		  AND COALESCE(s.on_odeme_zamani, s.cikis_zamani) >= $1
		  AND COALESCE(s.on_odeme_zamani, s.cikis_zamani) < $2
		ORDER BY COALESCE(s.on_odeme_zamani, s.cikis_zamani) ASC`,
		from, toExclusive,
	)
	if err != nil {
		writeServerError(w, http.StatusInternalServerError, "veri alınamadı", err)
		return
	}
	defer rows.Close()

	tableRows := [][]string{}
	var toplamKurus int64
	for rows.Next() {
		var tcKimlikNo, ad, soyad string
		var girisZamani time.Time
		var cikisZamani *time.Time
		var indirimTutar, tahsilTutar *int64
		var odemeTipi *string
		var manuelKapatildi bool

		if err := rows.Scan(&tcKimlikNo, &ad, &soyad, &girisZamani, &cikisZamani,
			&indirimTutar, &tahsilTutar, &odemeTipi, &manuelKapatildi); err != nil {
			writeServerError(w, http.StatusInternalServerError, "satır okunamadı", err)
			return
		}

		tahsil := int64(0)
		if tahsilTutar != nil {
			tahsil = *tahsilTutar
		}
		toplamKurus += tahsil

		tableRows = append(tableRows, []string{
			ad + " " + soyad,
			tcKimlikNo,
			girisZamani.Format("02.01.2006 15:04"),
			formatNullableTime(cikisZamani),
			formatKurusStr2(indirimTutar),
			formatKurusStr2(tahsilTutar),
			odemeTipiEtiketStr(odemeTipi),
			manuelKapatildiEtiket(manuelKapatildi),
		})
	}

	rapor := pdf.Report{
		LogoJPEG:    assets.LogoJPEG,
		BaslikUst:   "Parla Oyun Evi",
		BaslikAlt:   "Oturum Raporu",
		TarihEtiket: fmt.Sprintf("%s — %s", from.Format("02.01.2006"), to.Format("02.01.2006")),
		SummaryLines: []string{
			fmt.Sprintf("Toplam Oturum: %d", len(tableRows)),
			fmt.Sprintf("Toplam Ciro: %s", formatKurusStr(toplamKurus)),
		},
		Headers:    []string{"Müşteri", "TC Kimlik No", "Giriş", "Çıkış", "İndirim", "Tutar", "Ödeme Tipi", "Kapatma Şekli"},
		Rows:       tableRows,
		FooterText: "Sadece Yönetici Görebilir",
	}

	docBytes, err := pdf.Build(rapor)
	if err != nil {
		writeServerError(w, http.StatusInternalServerError, "rapor oluşturulamadı", err)
		return
	}

	filename := fmt.Sprintf("oturumlar_%s_%s.pdf", fromStr, toStr)
	w.Header().Set("Content-Type", "application/pdf")
	w.Header().Set("Content-Disposition", fmt.Sprintf(`attachment; filename="%s"`, filename))
	w.Write(docBytes)
}

// ExportCustomerPDF tek bir müşterinin tüm geçmiş (ve varsa açık) oturum
// kayıtlarını bir .pdf dosyası olarak döner. Sadece yönetici erişebilir.
func (a *API) ExportCustomerPDF(w http.ResponseWriter, r *http.Request) {
	idStr := chi.URLParam(r, "id")
	id, err := strconv.ParseInt(idStr, 10, 64)
	if err != nil {
		writeError(w, http.StatusBadRequest, "Geçersiz müşteri numarası.")
		return
	}

	var tcKimlikNo, ad, soyad, telefon string
	if err := a.DB.QueryRow(r.Context(),
		`SELECT tc_kimlik_no, ad, soyad, telefon FROM customers WHERE id = $1`, id,
	).Scan(&tcKimlikNo, &ad, &soyad, &telefon); err != nil {
		writeError(w, http.StatusNotFound, "müşteri bulunamadı")
		return
	}

	paketRows, err := a.DB.Query(r.Context(), `
		SELECT ad, COALESCE(haftalik_gun, 0), COALESCE(gunluk_dakika, 0),
			COALESCE(toplam_dakika, 0), COALESCE(kalan_dakika, 0), tutar_kurus, gecerlilik_bitis
		FROM customer_packages
		WHERE customer_id = $1 AND (haftalik_gun IS NOT NULL OR toplam_dakika IS NOT NULL)
			AND gecerlilik_bitis > now()
		ORDER BY gecerlilik_bitis ASC`, id,
	)
	if err != nil {
		writeServerError(w, http.StatusInternalServerError, "paket bilgisi alınamadı", err)
		return
	}
	var paketOzetSatirlari []string
	for paketRows.Next() {
		var paketAd string
		var haftalikGun, gunlukDakika, toplamDakika, kalanDakika, tutarKurus int64
		var paketBitis time.Time
		if err := paketRows.Scan(&paketAd, &haftalikGun, &gunlukDakika, &toplamDakika, &kalanDakika, &tutarKurus, &paketBitis); err != nil {
			paketRows.Close()
			writeServerError(w, http.StatusInternalServerError, "satır okunamadı", err)
			return
		}
		if haftalikGun == 0 { // saat bakiyeli paket
			paketOzetSatirlari = append(paketOzetSatirlari,
				fmt.Sprintf("Paket: %s — kalan %d/%d dk (%s değerinde), bitiş %s",
					paketAd, kalanDakika, toplamDakika, formatKurusStr(kalanDegerKurus(tutarKurus, toplamDakika, kalanDakika)),
					paketBitis.Format("02.01.2006")))
			continue
		}
		paketOzetSatirlari = append(paketOzetSatirlari,
			fmt.Sprintf("Paket: %s — haftada %d gün, günde %d dk, %s, bitiş %s",
				paketAd, haftalikGun, gunlukDakika, formatKurusStr(tutarKurus), paketBitis.Format("02.01.2006")))
	}
	paketRows.Close()

	rows, err := a.DB.Query(r.Context(), `
		SELECT giris_zamani, cikis_zamani, durum,
			indirim_kurus, tahsil_tutar_kurus, odeme_tipi, manuel_kapatildi
		FROM sessions
		WHERE customer_id = $1
		ORDER BY giris_zamani DESC`,
		id,
	)
	if err != nil {
		writeServerError(w, http.StatusInternalServerError, "veri alınamadı", err)
		return
	}
	defer rows.Close()

	tableRows := [][]string{}
	var toplamKurus int64
	for rows.Next() {
		var girisZamani time.Time
		var cikisZamani *time.Time
		var durum string
		var indirimTutar, tahsilTutar *int64
		var odemeTipi *string
		var manuelKapatildi bool

		if err := rows.Scan(&girisZamani, &cikisZamani, &durum,
			&indirimTutar, &tahsilTutar, &odemeTipi, &manuelKapatildi); err != nil {
			writeServerError(w, http.StatusInternalServerError, "satır okunamadı", err)
			return
		}

		if tahsilTutar != nil {
			toplamKurus += *tahsilTutar
		}

		tableRows = append(tableRows, []string{
			girisZamani.Format("02.01.2006 15:04"),
			formatNullableTime(cikisZamani),
			durumEtiket(durum),
			formatKurusStr2(indirimTutar),
			formatKurusStr2(tahsilTutar),
			odemeTipiEtiketStr(odemeTipi),
			manuelKapatildiEtiket(manuelKapatildi),
		})
	}

	summaryLines := []string{
		fmt.Sprintf("Müşteri: %s %s (TC: %s, Tel: %s)", ad, soyad, tcKimlikNo, telefon),
		fmt.Sprintf("Toplam Oturum: %d", len(tableRows)),
		fmt.Sprintf("Toplam Harcama: %s", formatKurusStr(toplamKurus)),
	}
	summaryLines = append(summaryLines, paketOzetSatirlari...)
	if len(paketOzetSatirlari) == 0 {
		summaryLines = append(summaryLines, "Aktif paket: yok")
	}

	rapor := pdf.Report{
		LogoJPEG:     assets.LogoJPEG,
		BaslikUst:    "Parla Oyun Evi",
		BaslikAlt:    "Müşteri Geçmişi",
		TarihEtiket:  time.Now().In(BusinessLocation).Format("02.01.2006"),
		SummaryLines: summaryLines,
		Headers:      []string{"Giriş", "Çıkış", "Durum", "İndirim", "Tutar", "Ödeme Tipi", "Kapatma Şekli"},
		Rows:         tableRows,
		FooterText:   "Sadece Yönetici Görebilir",
	}

	docBytes, err := pdf.Build(rapor)
	if err != nil {
		writeServerError(w, http.StatusInternalServerError, "rapor oluşturulamadı", err)
		return
	}

	filename := fmt.Sprintf("musteri_gecmisi_%d.pdf", id)
	w.Header().Set("Content-Type", "application/pdf")
	w.Header().Set("Content-Disposition", fmt.Sprintf(`attachment; filename="%s"`, filename))
	w.Write(docBytes)
}

func formatNullableTime(t *time.Time) string {
	if t == nil {
		return "—"
	}
	return t.Format("02.01.2006 15:04")
}

func formatKurusStr2(kurus *int64) string {
	if kurus == nil || *kurus == 0 {
		return "—"
	}
	return formatKurusStr(*kurus)
}

func formatDakikaStr(dakika int64) string {
	if dakika == 0 {
		return "—"
	}
	return fmt.Sprintf("%d dk", dakika)
}

func odemeTipiEtiketStr(tip *string) string {
	if tip == nil {
		return "—"
	}
	switch *tip {
	case "kredi_karti":
		return "Kredi Kartı"
	case "paket":
		return "Paket"
	}
	return "Nakit"
}

func manuelKapatildiEtiket(v bool) string {
	if v {
		return "Elle Kapatıldı"
	}
	return "Normal"
}

func durumEtiket(durum string) string {
	switch durum {
	case "acik":
		return "Açık"
	case "iptal":
		return "İptal"
	default:
		return "Kapalı"
	}
}
