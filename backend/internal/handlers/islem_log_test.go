package handlers

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestIslemSonucu(t *testing.T) {
	for kod, beklenen := range map[int]string{200: "yapildi", 204: "yapildi", 302: "yapildi", 400: "reddedildi", 403: "reddedildi", 429: "reddedildi", 500: "hata", 503: "hata"} {
		if got := islemSonucu(kod); got != beklenen {
			t.Errorf("%d: %s, beklenen %s", kod, got, beklenen)
		}
	}
}

func TestMaskeliYol(t *testing.T) {
	for girdi, beklenen := range map[string]string{
		"/api/customers/by-tc/12345678901":    "/api/customers/by-tc/123******01",
		"/api/customers/by-phone/05321234567": "/api/customers/by-phone/053******67",
		"/api/customers/by-tc/123":            "/api/customers/by-tc/***",
		"/api/sessions/5/close":               "/api/sessions/5/close",
	} {
		if got := maskeliYol(girdi); got != beklenen {
			t.Errorf("%s: %s, beklenen %s", girdi, got, beklenen)
		}
	}
}

func TestIslemKaydedilsin(t *testing.T) {
	cases := []struct {
		yontem, yol string
		durum       int
		beklenen    bool
	}{
		{"POST", "/api/sessions/start", 200, true},
		{"DELETE", "/api/users/3", 403, true},
		{"GET", "/api/sessions/open", 200, false},
		{"GET", "/api/customers/by-tc/x", 404, true},
		{"GET", "/api/reports/export", 200, true},
		{"GET", "/api/customers/4/export", 200, true},
		{"GET", "/api/health", 503, false},
	}
	for _, c := range cases {
		if got := islemKaydedilsin(c.yontem, c.yol, c.durum); got != c.beklenen {
			t.Errorf("%s %s %d: %v", c.yontem, c.yol, c.durum, got)
		}
	}
}

func TestHataMetni(t *testing.T) {
	if got := hataMetni([]byte("{\"hata\":\"yetki yok\"}\n")); got != "yetki yok" {
		t.Errorf("got %q", got)
	}
	if got := hataMetni([]byte("<html>")); got != "" {
		t.Errorf("got %q", got)
	}
}

func TestIslemDetay(t *testing.T) {
	r := httptest.NewRequest(http.MethodPost, "/", nil)
	islemDetay(r, map[string]any{"a": 1}) // tutucu yokken panik olmamalı
	b := &islemBilgi{}
	r = r.WithContext(context.WithValue(r.Context(), islemBilgiKey{}, b))
	islemDetay(r, map[string]any{"a": 1})
	islemDetay(r, map[string]any{"b": 2})
	if len(b.detay) != 2 {
		t.Errorf("detay: %v", b.detay)
	}
}

func TestGirisKullaniciAdi(t *testing.T) {
	for girdi, beklenen := range map[string]string{
		"kasiyer1":                   "kasiyer1",
		"a.b_c-d":                    "a.b_c-d",
		`=HYPERLINK("http://x","t")`: "(gecersiz)",
		"@SUM(A1)":                   "(gecersiz)",
		"":                           "(gecersiz)",
		"a b":                        "(gecersiz)",
		strings.Repeat("a", 65):      "(gecersiz)",
		strings.Repeat("a", 64):      strings.Repeat("a", 64),
	} {
		if got := girisKullaniciAdi(girdi); got != beklenen {
			t.Errorf("%q: %q, beklenen %q", girdi, got, beklenen)
		}
	}
}
