package pdf

import (
	"bytes"
	"testing"

	"parla-oyun-evi/backend/internal/assets"
)

func TestSutunGenislikleriSayfayiAsmaz(t *testing.T) {
	for _, total := range []float64{190, 277} {
		w := sutunGenislikleri([]float64{30, 70, 12, 55, 8, 70, 70, 22, 60}, total)
		var sum float64
		for _, x := range w {
			sum += x
		}
		if sum > total+1e-9 || sum < total-1e-9 {
			t.Fatalf("toplam %v, beklenen %v", sum, total)
		}
	}
}

func TestBuildDokuzSutunluRapor(t *testing.T) {
	r := Report{
		LogoJPEG:     assets.LogoJPEG,
		BaslikUst:    "Parla Oyun Evi",
		BaslikAlt:    "Test Raporu",
		TarihEtiket:  "02.01.2006",
		SummaryLines: []string{"Toplam Oturum: 2", "Toplam Ciro: 1.350,00 TL", "Not metni iki nokta içermez"},
		Headers:      []string{"Müşteri", "Giriş", "Çıkış", "Süre", "Normal Ücret", "İndirim", "Tahsil Edilen", "Ödeme", "Açıklama"},
		Rows: [][]string{
			{"Çağla Şahin Öztürk", "02.01.2006 10:00", "02.01.2006 11:30", "1 sa 30 dk", "1.350,00 TL", "—", "1.350,00 TL", "Nakit", "Erken ödeme · Elle kapatıldı"},
			{"Ğ Ü", "02.01.2006 10:00", "—", "—", "0,00 TL", "—", "0,00 TL", "Paket", "Paketten düşüldü (60 dk) çok uzun bir açıklama metni kısaltılmalı kısaltılmalı kısaltılmalı"},
		},
		SagaHizali:   []bool{false, false, false, true, true, true, true},
		ToplamSatiri: []string{"Toplam", "", "", "", "1.350,00 TL", "—", "1.350,00 TL", "", ""},
		FooterText:   "Sadece Yönetici Görebilir",
	}
	for i := 0; i < 80; i++ { // çok sayfalı
		r.Rows = append(r.Rows, r.Rows[0])
	}
	b, err := Build(r)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.HasPrefix(b, []byte("%PDF")) {
		t.Fatal("PDF başlığı yok")
	}
}
