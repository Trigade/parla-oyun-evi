package handlers

import (
	"fmt"
	"strings"
	"time"
)

// formatKurusStr kuruşu Türkçe para biçimine çevirir: 135000 → "1.350,00 TL".
// Float kullanılmaz; negatif tutarlar "-" ile başlar.
func formatKurusStr(kurus int64) string {
	isaret := ""
	u := uint64(kurus)
	if kurus < 0 {
		isaret = "-"
		u = -u
	}
	lira := fmt.Sprintf("%d", u/100)
	var b strings.Builder
	for i, c := range lira {
		if i > 0 && (len(lira)-i)%3 == 0 {
			b.WriteByte('.')
		}
		b.WriteRune(c)
	}
	return fmt.Sprintf("%s%s,%02d TL", isaret, b.String(), u%100)
}

// formatSure dakikayı okunur süreye çevirir: 90 → "1 sa 30 dk", 45 → "45 dk", 120 → "2 sa".
func formatSure(dakika int64) string {
	sa, dk := dakika/60, dakika%60
	switch {
	case sa == 0:
		return fmt.Sprintf("%d dk", dk)
	case dk == 0:
		return fmt.Sprintf("%d sa", sa)
	}
	return fmt.Sprintf("%d sa %d dk", sa, dk)
}

// tutarStr nil tutarı "—", diğerlerini (0 dahil) para biçiminde yazar.
func tutarStr(kurus *int64) string {
	if kurus == nil {
		return "—"
	}
	return formatKurusStr(*kurus)
}

// oturumKaydi, oturum tabanlı raporların (gün sonu, dönem, müşteri) ortak satır verisidir.
type oturumKaydi struct {
	Giris, Cikis   time.Time // Cikis sıfırsa henüz çıkış yok
	Durum          string
	Dakika         *int64
	Orijinal       *int64
	Indirim        *int64
	Tahsil         *int64
	OdemeTipi      *string
	Manuel, Erken  bool
	PaketDusulenDk int64
}

const oturumRaporKolonlari = `s.giris_zamani, s.cikis_zamani, s.durum, s.toplam_dakika,
	s.orijinal_tutar_kurus, s.indirim_kurus, s.tahsil_tutar_kurus, s.odeme_tipi,
	s.manuel_kapatildi, s.on_odeme_yapildi_mi, s.paketten_dusulen_dakika`

// scan, oturumRaporKolonlari sırasındaki satırı okur; onde verilen hedefler
// bu kolonlardan önceki (müşteri adı gibi) alanlar içindir.
func (o *oturumKaydi) scan(row interface{ Scan(...any) error }, onde ...any) error {
	var cikis *time.Time
	hedef := append(onde, &o.Giris, &cikis, &o.Durum, &o.Dakika, &o.Orijinal, &o.Indirim,
		&o.Tahsil, &o.OdemeTipi, &o.Manuel, &o.Erken, &o.PaketDusulenDk)
	if err := row.Scan(hedef...); err != nil {
		return err
	}
	if cikis != nil {
		o.Cikis = *cikis
	}
	return nil
}

// tarihSaat: "02.01.2006 15:04"; zaman yoksa "—".
func tarihSaat(t time.Time) string {
	if t.IsZero() {
		return "—"
	}
	return t.Format("02.01.2006 15:04")
}

// saatStr, tablodaki "Tarih" sütunu zaten günü gösterirken kullanılır:
// aynı günse "15:04", farklı günse "02.01 15:04"; zaman yoksa "—".
func saatStr(t, gun time.Time) string {
	if t.IsZero() {
		return "—"
	}
	if t.Format("2006-01-02") == gun.Format("2006-01-02") {
		return t.Format("15:04")
	}
	return t.Format("02.01 15:04")
}

// aciklama, oturumun "neden böyle" notunu üretir; birden fazlaysa " · " ile birleştirir.
func (o oturumKaydi) aciklama() string {
	var n []string
	if o.PaketDusulenDk > 0 {
		n = append(n, fmt.Sprintf("Paketten düşüldü (%d dk)", o.PaketDusulenDk))
		if o.Tahsil != nil && *o.Tahsil > 0 {
			n = append(n, "Aşım tahsil edildi")
		}
	}
	if o.Erken {
		n = append(n, "Erken ödeme")
	}
	if o.Manuel {
		n = append(n, "Elle kapatıldı")
	}
	switch o.Durum {
	case "acik":
		n = append(n, "Devam ediyor")
	case "iptal":
		n = append(n, "İptal")
	}
	if len(n) == 0 {
		return "—"
	}
	return strings.Join(n, " · ")
}

// hucreler: Süre | Normal Ücret | İndirim | Tahsil Edilen | Ödeme | Açıklama.
func (o oturumKaydi) hucreler() []string {
	sure := "—"
	if o.Dakika != nil {
		sure = formatSure(*o.Dakika)
	}
	return []string{sure, tutarStr(o.Orijinal), formatKurusStr2(o.Indirim), tutarStr(o.Tahsil),
		odemeTipiEtiketStr(o.OdemeTipi), o.aciklama()}
}

// Tablo sütun düzeni: [başa eklenenler...] + Süre, Normal, İndirim, Tahsil (sağa hizalı), Ödeme, Açıklama.
func sagaHizaliSutunlar(bas int) []bool {
	s := make([]bool, bas+6)
	for i := bas; i < bas+4; i++ {
		s[i] = true
	}
	return s
}

// raporToplamlari, oturum tabanlı raporların toplam ve özet sayaçlarıdır.
type raporToplamlari struct {
	Normal, Indirim, Tahsil int64
	Oturum                  int64
	NakitSayisi, NakitKurus int64
	KartSayisi, KartKurus   int64
	PaketSayisi             int64
	ErkenSayisi, ErkenKurus int64
}

func deger(p *int64) int64 {
	if p == nil {
		return 0
	}
	return *p
}

func (t *raporToplamlari) ekle(o oturumKaydi) {
	tahsil := deger(o.Tahsil)
	t.Normal += deger(o.Orijinal)
	t.Indirim += deger(o.Indirim)
	t.Tahsil += tahsil
	t.Oturum++
	if o.OdemeTipi != nil {
		switch *o.OdemeTipi {
		case "nakit":
			t.NakitSayisi++
			t.NakitKurus += tahsil
		case "kredi_karti":
			t.KartSayisi++
			t.KartKurus += tahsil
		case "paket":
			t.PaketSayisi++
		}
	}
	if o.Erken {
		t.ErkenSayisi++
		t.ErkenKurus += tahsil
	}
}

// ozet, ortak özet satırlarını ("Etiket: Değer") döner.
func (t raporToplamlari) ozet() []string {
	s := []string{
		fmt.Sprintf("Toplam Oturum: %d", t.Oturum),
		fmt.Sprintf("Toplam Ciro: %s", formatKurusStr(t.Tahsil)),
		fmt.Sprintf("Nakit: %d adet · %s", t.NakitSayisi, formatKurusStr(t.NakitKurus)),
		fmt.Sprintf("Kredi Kartı: %d adet · %s", t.KartSayisi, formatKurusStr(t.KartKurus)),
		fmt.Sprintf("Toplam İndirim: %s", formatKurusStr(t.Indirim)),
	}
	if t.PaketSayisi > 0 {
		s = append(s, fmt.Sprintf("Pakete Sayılan: %d oturum (ücret alınmadı)", t.PaketSayisi))
	}
	if t.ErkenSayisi > 0 {
		s = append(s, fmt.Sprintf("Erken Ödeme: %d oturum · %s", t.ErkenSayisi, formatKurusStr(t.ErkenKurus)))
	}
	return s
}

// toplamSatiri: bas sütundan sonra Süre, Normal, İndirim, Tahsil, Ödeme, Açıklama düzenine göre "Toplam" satırı.
func (t raporToplamlari) toplamSatiri(bas int) []string {
	satir := make([]string, bas+6)
	satir[0] = "Toplam"
	satir[bas+1] = formatKurusStr(t.Normal)
	satir[bas+2] = formatKurusStr(t.Indirim)
	satir[bas+3] = formatKurusStr(t.Tahsil)
	return satir
}
