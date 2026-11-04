package handlers

import "testing"

func TestTcNullable(t *testing.T) {
	if tcNullable("") != nil || tcNullable("   ") != nil {
		t.Fatal("boş TC nil olmalı")
	}
	if p := tcNullable(" 123 "); p == nil || *p != "123" {
		t.Fatal("dolu TC kırpılmış dönmeli")
	}
}
