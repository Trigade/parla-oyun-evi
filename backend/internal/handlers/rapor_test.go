package handlers

import "testing"

func TestFormatKurusStr(t *testing.T) {
	for kurus, beklenen := range map[int64]string{
		135000:    "1.350,00 TL",
		0:         "0,00 TL",
		123:       "1,23 TL",
		5:         "0,05 TL",
		123456789: "1.234.567,89 TL",
		-135000:   "-1.350,00 TL",
		-5:        "-0,05 TL",
		100000:    "1.000,00 TL",
		99999:     "999,99 TL",
	} {
		if got := formatKurusStr(kurus); got != beklenen {
			t.Errorf("formatKurusStr(%d) = %q, beklenen %q", kurus, got, beklenen)
		}
	}
}

func TestFormatSure(t *testing.T) {
	for dk, beklenen := range map[int64]string{0: "0 dk", 45: "45 dk", 60: "1 sa", 90: "1 sa 30 dk", 125: "2 sa 5 dk"} {
		if got := formatSure(dk); got != beklenen {
			t.Errorf("formatSure(%d) = %q, beklenen %q", dk, got, beklenen)
		}
	}
}

func TestMaskeTC(t *testing.T) {
	if got := maskeTC("12345678901"); got != "123******01" {
		t.Errorf("maskeTC = %q", got)
	}
}
