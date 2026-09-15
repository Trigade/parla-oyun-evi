package models

import "time"

type Customer struct {
	ID          int64      `json:"id"`
	TCKimlikNo  string     `json:"tc_kimlik_no"`
	Ad          string     `json:"ad"`
	Soyad       string     `json:"soyad"`
	Telefon     string     `json:"telefon"`
	VeliTelefon *string    `json:"veli_telefon,omitempty"`
	CreatedAt   time.Time  `json:"created_at"`
	DeletedAt   *time.Time `json:"deleted_at,omitempty"`
}

type PricingRule struct {
	ID             int64     `json:"id"`
	KurusPerDakika int64     `json:"kurus_per_dakika"`
	EffectiveFrom  time.Time `json:"effective_from"`
}

type Session struct {
	ID                 int64      `json:"id"`
	CustomerID         int64      `json:"customer_id"`
	GirisZamani        time.Time  `json:"giris_zamani"`
	CikisZamani        *time.Time `json:"cikis_zamani,omitempty"`
	Durum              string     `json:"durum"`
	ToplamDakika       *int       `json:"toplam_dakika,omitempty"`
	OrijinalTutarKurus *int64     `json:"orijinal_tutar_kurus,omitempty"`
	TahsilTutarKurus   *int64     `json:"tahsil_tutar_kurus,omitempty"`
	OdemeTipi          *string    `json:"odeme_tipi,omitempty"`
	ManuelKapatildi    bool       `json:"manuel_kapatildi"`
}
