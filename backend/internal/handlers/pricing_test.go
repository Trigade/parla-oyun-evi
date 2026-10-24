package handlers

import "testing"

func TestTierUcretiSaf(t *testing.T) {
	bloklar := []int64{30, 60, 90, 120, 180, 300, 600}
	ucret := []int64{250, 370, 550, 650, 900, 1450, 2500}
	var tiers []tierRow
	min := int64(0)
	for i, mx := range bloklar {
		tiers = append(tiers, tierRow{id: int64(i + 1), minDakika: min, maxDakika: mx, tutar: ucret[i]})
		min = mx + 1
	}
	cases := []struct {
		tolerans int
		dakika   int64
		want     int64
	}{
		{10, 60, 370}, {10, 61, 370}, {10, 70, 370}, {10, 71, 550},
		{10, 1, 250}, {10, 0, 0}, {10, 605, 2500}, {10, 611, 2500 + 250},
		{0, 61, 550}, {0, 60, 370}, {0, 601, 2500 + 250}, {0, 0, 0},
	}
	for _, c := range cases {
		_, got, err := tierUcretiSaf(tiers, c.tolerans, c.dakika)
		if err != nil || got != c.want {
			t.Errorf("tolerans=%d dakika=%d: got %d (err=%v), want %d", c.tolerans, c.dakika, got, err, c.want)
		}
	}
}
