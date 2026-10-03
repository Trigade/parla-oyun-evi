package handlers

import (
	"net/http"
	"sort"
	"time"
)

type dailyBreakdown struct {
	Tarih        string `json:"tarih"`
	CiroKurus    int64  `json:"ciro_kurus"`
	OturumSayisi int64  `json:"oturum_sayisi"`
}

type reportResponse struct {
	ToplamCiroKurus  int64            `json:"toplam_ciro_kurus"`
	OturumSayisi     int64            `json:"oturum_sayisi"`
	NakitKurus       int64            `json:"nakit_kurus"`
	NakitSayisi      int64            `json:"nakit_sayisi"`
	KrediKartiKurus  int64            `json:"kredi_karti_kurus"`
	KrediKartiSayisi int64            `json:"kredi_karti_sayisi"`
	PaketSatisKurus  int64            `json:"paket_satis_kurus"`
	PaketSatisSayisi int64            `json:"paket_satis_sayisi"`
	GunlukKirilim    []dailyBreakdown `json:"gunluk_kirilim"`
}

// GetReport verilen tarih aralığında toplam ciroyu, oturum sayısını ve ödeme
// tipi dağılımını döner. Ciro iki kalemden oluşur: kapanmış oturumlar (çıkış
// zamanına göre) ve satılan paketler (satın alma zamanına göre). Oturum
// sayısı yalnızca oturumları sayar; paket satışları ayrıca raporlanır.
// Sadece yönetici erişebilir (bkz. router).
func (a *API) GetReport(w http.ResponseWriter, r *http.Request) {
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
	// to tarihini (Türkiye saatiyle) gün sonuna kadar kapsayacak şekilde genişlet
	toExclusive := to.Add(24 * time.Hour)

	ctx := r.Context()
	var resp reportResponse

	err = a.DB.QueryRow(ctx, `
		SELECT
			COALESCE(SUM(tahsil_tutar_kurus), 0),
			COUNT(*),
			COALESCE(SUM(tahsil_tutar_kurus) FILTER (WHERE odeme_tipi = 'nakit'), 0),
			COUNT(*) FILTER (WHERE odeme_tipi = 'nakit'),
			COALESCE(SUM(tahsil_tutar_kurus) FILTER (WHERE odeme_tipi = 'kredi_karti'), 0),
			COUNT(*) FILTER (WHERE odeme_tipi = 'kredi_karti')
		FROM sessions
		WHERE durum = 'kapali' AND cikis_zamani >= $1 AND cikis_zamani < $2`,
		from, toExclusive,
	).Scan(
		&resp.ToplamCiroKurus, &resp.OturumSayisi,
		&resp.NakitKurus, &resp.NakitSayisi,
		&resp.KrediKartiKurus, &resp.KrediKartiSayisi,
	)
	if err != nil {
		writeServerError(w, http.StatusInternalServerError, "rapor hesaplanamadı", err)
		return
	}

	// Paket satışları: tahsilat tipiyle birlikte ciroya eklenir.
	var paketNakit, paketKart int64
	var paketNakitSayisi, paketKartSayisi int64
	err = a.DB.QueryRow(ctx, `
		SELECT
			COALESCE(SUM(tutar_kurus), 0),
			COUNT(*),
			COALESCE(SUM(tutar_kurus) FILTER (WHERE odeme_tipi = 'nakit'), 0),
			COUNT(*) FILTER (WHERE odeme_tipi = 'nakit'),
			COALESCE(SUM(tutar_kurus) FILTER (WHERE odeme_tipi = 'kredi_karti'), 0),
			COUNT(*) FILTER (WHERE odeme_tipi = 'kredi_karti')
		FROM customer_packages
		WHERE odeme_tipi IS NOT NULL AND satin_alma_zamani >= $1 AND satin_alma_zamani < $2`,
		from, toExclusive,
	).Scan(
		&resp.PaketSatisKurus, &resp.PaketSatisSayisi,
		&paketNakit, &paketNakitSayisi,
		&paketKart, &paketKartSayisi,
	)
	if err != nil {
		writeServerError(w, http.StatusInternalServerError, "paket satışları hesaplanamadı", err)
		return
	}
	resp.ToplamCiroKurus += resp.PaketSatisKurus
	resp.NakitKurus += paketNakit
	resp.NakitSayisi += paketNakitSayisi
	resp.KrediKartiKurus += paketKart
	resp.KrediKartiSayisi += paketKartSayisi

	gunler := map[string]*dailyBreakdown{}
	rows, err := a.DB.Query(ctx, `
		SELECT date(cikis_zamani AT TIME ZONE 'Europe/Istanbul') AS gun,
			COALESCE(SUM(tahsil_tutar_kurus), 0), COUNT(*)
		FROM sessions
		WHERE durum = 'kapali' AND cikis_zamani >= $1 AND cikis_zamani < $2
		GROUP BY gun
		ORDER BY gun ASC`,
		from, toExclusive,
	)
	if err != nil {
		writeServerError(w, http.StatusInternalServerError, "günlük kırılım alınamadı", err)
		return
	}
	for rows.Next() {
		var d dailyBreakdown
		var gun time.Time
		if err := rows.Scan(&gun, &d.CiroKurus, &d.OturumSayisi); err != nil {
			rows.Close()
			writeServerError(w, http.StatusInternalServerError, "satır okunamadı", err)
			return
		}
		d.Tarih = gun.Format("2006-01-02")
		kopya := d
		gunler[d.Tarih] = &kopya
	}
	rows.Close()

	paketRows, err := a.DB.Query(ctx, `
		SELECT date(satin_alma_zamani AT TIME ZONE 'Europe/Istanbul') AS gun,
			COALESCE(SUM(tutar_kurus), 0)
		FROM customer_packages
		WHERE odeme_tipi IS NOT NULL AND satin_alma_zamani >= $1 AND satin_alma_zamani < $2
		GROUP BY gun
		ORDER BY gun ASC`,
		from, toExclusive,
	)
	if err != nil {
		writeServerError(w, http.StatusInternalServerError, "paket satışlarının günlük kırılımı alınamadı", err)
		return
	}
	for paketRows.Next() {
		var gun time.Time
		var tutar int64
		if err := paketRows.Scan(&gun, &tutar); err != nil {
			paketRows.Close()
			writeServerError(w, http.StatusInternalServerError, "satır okunamadı", err)
			return
		}
		tarih := gun.Format("2006-01-02")
		if mevcut, ok := gunler[tarih]; ok {
			mevcut.CiroKurus += tutar
		} else {
			gunler[tarih] = &dailyBreakdown{Tarih: tarih, CiroKurus: tutar}
		}
	}
	paketRows.Close()

	resp.GunlukKirilim = make([]dailyBreakdown, 0, len(gunler))
	for _, d := range gunler {
		resp.GunlukKirilim = append(resp.GunlukKirilim, *d)
	}
	sort.Slice(resp.GunlukKirilim, func(i, j int) bool {
		return resp.GunlukKirilim[i].Tarih < resp.GunlukKirilim[j].Tarih
	})

	writeJSON(w, http.StatusOK, resp)
}
