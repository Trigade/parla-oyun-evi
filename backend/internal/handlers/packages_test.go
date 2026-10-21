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
