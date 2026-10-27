package handlers

import (
	"testing"
	"time"
)

func TestAbonelikKalanHaklar(t *testing.T) {
	an := func(gun, saat int) time.Time { // Ekim 2026: 20 Salı, 21 Çarşamba, 22 Perşembe, 24 Cumartesi
		return time.Date(2026, 10, gun, saat, 0, 0, 0, BusinessLocation)
	}
	uzak := an(21, 12).AddDate(0, 0, 20)
	cases := []struct {
		ad                       string
		simdi, bitis             time.Time
		kullanilanGun, bugunDk   int64
		sayildi                  bool
		bugun, haftaGun, haftaDk int64
	}{
		{"çarşamba, sayılmamış, 1 gün kullanılmış", an(21, 12), uzak, 1, 0, false, 240, 4, 960},
		{"çarşamba, bugün sayılmış 60 dk, 2 gün", an(21, 12), uzak, 2, 60, true, 180, 3, 180 + 3*240},
		{"cumartesi, hiç kullanılmamış", an(24, 12), uzak, 0, 0, false, 240, 2, 480},
		{"paket perşembe bitiyor, salı", an(20, 12), an(22, 18), 0, 0, false, 240, 3, 720},
		{"gün hakkı doldu", an(21, 12), uzak, 5, 0, false, 0, 0, 0},
	}
	for _, c := range cases {
		h := abonelikKalanHaklar(c.simdi, c.bitis, 5, 240, c.kullanilanGun, c.bugunDk, c.sayildi)
		if h.BugunKalanDakika != c.bugun || h.BuHaftaKalanGun != c.haftaGun || h.BuHaftaKalanDakika != c.haftaDk {
			t.Errorf("%s: bugün=%d gün=%d dk=%d, beklenen %d/%d/%d", c.ad,
				h.BugunKalanDakika, h.BuHaftaKalanGun, h.BuHaftaKalanDakika, c.bugun, c.haftaGun, c.haftaDk)
		}
	}
	// Toplam kalan: bu hafta + sonraki haftalar (bitiş günü dahil), 5 gün/240 dk.
	pzt := an(26, 10)
	bitis := time.Date(2026, 11, 26, 10, 0, 0, 0, BusinessLocation) // 26 Eki Pzt -> 26 Kas Per
	toplamCases := []struct {
		ad              string
		simdi, bitis    time.Time
		kullanilanGun   int64
		bugunDk         int64
		sayildi         bool
		haftaDk, toplam int64
	}{
		{"pazartesi, hiç kullanılmamış", pzt, bitis, 0, 0, false, 5 * 240, 24 * 240},
		{"cumartesi, bu hafta 2 gün kalmış", time.Date(2026, 10, 31, 10, 0, 0, 0, BusinessLocation), bitis, 0, 0, false, 2 * 240, 21 * 240},
		{"bugün sayılmış, 60 dk kullanılmış", pzt, bitis, 1, 60, true, 180 + 4*240, 180 + 4*240 + 19*240},
		{"gün hakkı dolmuş", an(28, 12), bitis, 5, 0, false, 0, 19 * 240},
		{"bitişe 2 gün kalmış", an(20, 12), an(22, 18), 0, 0, false, 3 * 240, 3 * 240},
	}
	for _, c := range toplamCases {
		h := abonelikKalanHaklar(c.simdi, c.bitis, 5, 240, c.kullanilanGun, c.bugunDk, c.sayildi)
		if h.BuHaftaKalanDakika != c.haftaDk || h.ToplamKalanDakika != c.toplam {
			t.Errorf("%s: hafta=%d toplam=%d, beklenen %d/%d", c.ad, h.BuHaftaKalanDakika, h.ToplamKalanDakika, c.haftaDk, c.toplam)
		}
	}
	if g := abonelikKalanHaklar(an(20, 12), an(22, 18), 5, 240, 0, 0, false).BitiseKalanGun; g != 2 {
		t.Errorf("bitişe kalan gün = %d, beklenen 2", g)
	}
}
