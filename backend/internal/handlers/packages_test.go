package handlers

import "testing"

func TestBakiyedenDus(t *testing.T) {
	// 10 saatlik paket, 1 saat kullanıldı -> 540 dk kaldı
	d, u, asiyor := bakiyedenDus(60, 600)
	if d != 60 || u != 0 || asiyor {
		t.Fatalf("beklenmeyen: %d %d %v", d, u, asiyor)
	}
	// bakiyeyi aşan oturum: 100 dk oturum, 40 dk bakiye
	d, u, asiyor = bakiyedenDus(100, 40)
	if d != 40 || u != 60 || !asiyor {
		t.Fatalf("aşım: %d %d %v", d, u, asiyor)
	}
	// tam bakiye aşım sayılmaz
	if _, _, asiyor = bakiyedenDus(40, 40); asiyor {
		t.Fatal("eşitlik aşım sayılmamalı")
	}
}

func TestKalanDegerKurus(t *testing.T) {
	if got := kalanDegerKurus(150000, 600, 540); got != 135000 {
		t.Fatalf("135000 beklendi, %d", got)
	}
	if got := kalanDegerKurus(1000, 3, 1); got != 333 { // aşağı yuvarlama
		t.Fatalf("333 beklendi, %d", got)
	}
	if got := kalanDegerKurus(1000, 0, 0); got != 0 {
		t.Fatalf("0 beklendi, %d", got)
	}
}

func TestPaketTanimiDogrula(t *testing.T) {
	// abonelik -> bakiye: haftalık/günlük NULL, dakika dolu
	r := createPackageDefinitionRequest{Tur: "bakiye", Ad: "10 Saat", Dakika: 600, HaftalikGun: 3, GunlukDakika: 240}
	h, g, d, hata := r.dogrula()
	if hata != "" || h != nil || g != nil || d == nil || *d != 600 || r.Grup != "Standart" {
		t.Fatalf("bakiye: %v %v %v %q", h, g, d, hata)
	}
	// bakiye -> abonelik (boş tür = abonelik): dakika NULL
	r = createPackageDefinitionRequest{Ad: "3 Gün", Dakika: 600, HaftalikGun: 3, GunlukDakika: 240}
	h, g, d, hata = r.dogrula()
	if hata != "" || d != nil || h == nil || *h != 3 || g == nil || *g != 240 {
		t.Fatalf("abonelik: %v %v %v %q", h, g, d, hata)
	}
	gecersiz := []createPackageDefinitionRequest{
		{Tur: "x", Ad: "a"},
		{Ad: ""},
		{Tur: "bakiye", Ad: "a", Dakika: 0},
		{Tur: "bakiye", Ad: "a", Dakika: 100001},
		{Ad: "a", HaftalikGun: 8, GunlukDakika: 60},
		{Ad: "a", HaftalikGun: 3, GunlukDakika: 1441},
		{Ad: "a", HaftalikGun: 3, GunlukDakika: 60, AylikUcretKurus: -1},
	}
	for i, r := range gecersiz {
		if _, _, _, hata := r.dogrula(); hata == "" {
			t.Fatalf("%d numaralı geçersiz istek kabul edildi", i)
		}
	}
}
