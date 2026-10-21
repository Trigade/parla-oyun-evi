package auth

import (
	"testing"
	"time"
)

func TestVerifyTOTPCodeAtEslesenAdimiDoner(t *testing.T) {
	secret := "JBSWY3DPEHPK3PXP"
	now := time.Unix(1700000000, 0)
	adim := now.Unix() / totpPeriodSeconds

	for _, delta := range []int64{-1, 0, 1} {
		kod, err := totpCodeAt(secret, uint64(adim+delta))
		if err != nil {
			t.Fatal(err)
		}
		got, ok := verifyTOTPCodeAt(secret, kod, now)
		if !ok || got != adim+delta {
			t.Fatalf("delta %d: adım=%d ok=%v, beklenen %d", delta, got, ok, adim+delta)
		}
	}

	if _, ok := verifyTOTPCodeAt(secret, "000000x", now); ok {
		t.Fatal("geçersiz uzunluktaki kod kabul edildi")
	}
}
