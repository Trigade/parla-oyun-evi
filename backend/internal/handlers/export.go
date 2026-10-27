package handlers

import (
	"fmt"
	"net/http"
	"strconv"
	"strings"
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
		SELECT c.ad, c.soyad, `+oturumRaporKolonlari+`
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
	var toplam raporToplamlari
	for rows.Next() {
		var ad, soyad string
		var o oturumKaydi
		if err := o.scan(rows, &ad, &soyad); err != nil {
			writeServerError(w, http.StatusInternalServerError, "satır okunamadı", err)
			return
		}
		tableRows = append(tableRows, append([]string{
			o.Giris.Format("02.01.2006"), ad + " " + soyad, saatStr(o.Giris, o.Giris), saatStr(o.Cikis, o.Giris),
		}, o.hucreler()...))
		toplam.ekle(o)
	}

	rapor := pdf.Report{
		LogoJPEG:     assets.LogoJPEG,
		BaslikUst:    "Parla Oyun Evi",
		BaslikAlt:    "Oturum Raporu",
		TarihEtiket:  fmt.Sprintf("%s — %s", from.Format("02.01.2006"), to.Format("02.01.2006")),
		SummaryLines: toplam.ozet(),
		Headers:      []string{"Tarih", "Müşteri", "Giriş", "Çıkış", "Süre", "Normal Ücret", "İndirim", "Tahsil Edilen", "Ödeme", "Açıklama"},
		Rows:         tableRows,
		SagaHizali:   append([]bool{false}, sagaHizaliSutunlar(3)...),
		ToplamSatiri: append([]string{""}, toplam.toplamSatiri(3)...),
		FooterText:   "Sadece Yönetici Görebilir",
	}
	rapor.ToplamSatiri[0], rapor.ToplamSatiri[1] = "Toplam", ""

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
		SELECT id, ad, COALESCE(haftalik_gun, 0), COALESCE(gunluk_dakika, 0),
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
	type aktifPaket struct {
		id, haftalikGun, gunlukDakika, toplamDakika, kalanDakika, tutarKurus int64
		ad                                                                   string
		bitis                                                                time.Time
	}
	var paketler []aktifPaket
	for paketRows.Next() {
		var p aktifPaket
		if err := paketRows.Scan(&p.id, &p.ad, &p.haftalikGun, &p.gunlukDakika, &p.toplamDakika, &p.kalanDakika, &p.tutarKurus, &p.bitis); err != nil {
			paketRows.Close()
			writeServerError(w, http.StatusInternalServerError, "satır okunamadı", err)
			return
		}
		paketler = append(paketler, p)
	}
	paketRows.Close()

	var paketOzetSatirlari []string
	for _, p := range paketler {
		bitis := p.bitis.Format("02.01.2006")
		if p.haftalikGun == 0 { // saat bakiyeli paket
			paketOzetSatirlari = append(paketOzetSatirlari,
				fmt.Sprintf("Bakiye paketi: %s — kalan %s / %s (%s değerinde) · bitiş %s",
					p.ad, formatSure(p.kalanDakika), formatSure(p.toplamDakika),
					formatKurusStr(kalanDegerKurus(p.tutarKurus, p.toplamDakika, p.kalanDakika)), bitis))
			continue
		}
		gun, dk, oturum, err := abonelikKullanimi(r.Context(), a.DB, p.id)
		if err != nil {
			writeServerError(w, http.StatusInternalServerError, "paket kullanımı alınamadı", err)
			return
		}
		h := abonelikKalanHaklar(time.Now(), p.bitis, p.haftalikGun, p.gunlukDakika, gun, dk, oturum > 0)
		paketOzetSatirlari = append(paketOzetSatirlari,
			fmt.Sprintf("Abonelik: %s — haftada %d gün, günde %s · bu hafta kalan %s · paketten kalan toplam %s · bitiş %s",
				p.ad, p.haftalikGun, formatSure(p.gunlukDakika), formatSure(h.BuHaftaKalanDakika), formatSure(h.ToplamKalanDakika), bitis))
	}

	rows, err := a.DB.Query(r.Context(), `
		SELECT `+oturumRaporKolonlari+`
		FROM sessions s
		WHERE s.customer_id = $1
		ORDER BY s.giris_zamani DESC`,
		id,
	)
	if err != nil {
		writeServerError(w, http.StatusInternalServerError, "veri alınamadı", err)
		return
	}
	defer rows.Close()

	tableRows := [][]string{}
	var toplam raporToplamlari
	for rows.Next() {
		var o oturumKaydi
		if err := o.scan(rows); err != nil {
			writeServerError(w, http.StatusInternalServerError, "satır okunamadı", err)
			return
		}
		tableRows = append(tableRows, append([]string{
			o.Giris.Format("02.01.2006"), saatStr(o.Giris, o.Giris), saatStr(o.Cikis, o.Giris),
		}, o.hucreler()...))
		toplam.ekle(o)
	}

	summaryLines := []string{
		fmt.Sprintf("Müşteri: %s %s", ad, soyad),
		fmt.Sprintf("Telefon: %s", telefon),
		fmt.Sprintf("TC Kimlik No: %s", maskeTC(tcKimlikNo)),
		fmt.Sprintf("Toplam Oturum: %d", toplam.Oturum),
		fmt.Sprintf("Toplam Harcama: %s", formatKurusStr(toplam.Tahsil)),
		fmt.Sprintf("Toplam İndirim: %s", formatKurusStr(toplam.Indirim)),
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
		Headers:      []string{"Tarih", "Giriş", "Çıkış", "Süre", "Normal Ücret", "İndirim", "Tahsil Edilen", "Ödeme", "Açıklama"},
		Rows:         tableRows,
		SagaHizali:   sagaHizaliSutunlar(3),
		ToplamSatiri: toplam.toplamSatiri(3),
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

// maskeTC kimlik numarasının ilk 3 ve son 2 hanesini gösterir (kişisel veri).
func maskeTC(tc string) string {
	r := []rune(tc)
	if len(r) < 6 {
		return tc
	}
	return string(r[:3]) + strings.Repeat("*", len(r)-5) + string(r[len(r)-2:])
}

func formatKurusStr2(kurus *int64) string {
	if kurus == nil || *kurus == 0 {
		return "—"
	}
	return formatKurusStr(*kurus)
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
