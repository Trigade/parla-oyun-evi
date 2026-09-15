// Demo/test amaçlı dummy veri üretir: müşteriler, geçmiş kapalı oturumlar
// (farklı tarih/tutar/ödeme tipi) ve birkaç açık oturum. Sadece elle,
// geliştirme ortamında çalıştırılır: go run ./cmd/seed_dummy
package main

import (
	"context"
	"fmt"
	"log"
	"math/rand"
	"os"
	"time"

	"parla-oyun-evi/backend/internal/db"
)

// gecerliTCKimlikNo, backend'in isValidTCKimlikNo ile aynı kurala (ilk 10
// hanenin toplamının birler basamağı 11. haneye eşit olmalı) uyan, dolayısıyla
// gerçek bir TC kimlik no gibi doğrulamadan geçen 11 haneli bir numara üretir.
// Aksi halde bu dummy müşterilerle "İsim ile Ara" üzerinden hızlı giriş
// yapmaya çalışıldığında sunucu tarafı doğrulama 400 ile reddeder.
func gecerliTCKimlikNo(i int) string {
	ilk10 := fmt.Sprintf("1%09d", 100000000+i)
	toplam := 0
	for _, c := range ilk10 {
		toplam += int(c - '0')
	}
	return fmt.Sprintf("%s%d", ilk10, toplam%10)
}

var adlar = []string{
	"Ahmet", "Mehmet", "Ayşe", "Fatma", "Ali", "Zeynep", "Mustafa", "Elif",
	"Hüseyin", "Emine", "Hasan", "Hatice", "İbrahim", "Meryem", "Yusuf",
	"Özge", "Kemal", "Sultan", "Osman", "Havva", "Murat", "Şeyma", "Burak",
	"Gülsüm", "Cem", "Derya", "Kerem", "Nur", "Serkan", "Aylin",
}

var soyadlar = []string{
	"Yılmaz", "Kaya", "Demir", "Şahin", "Çelik", "Yıldız", "Aydın", "Öztürk",
	"Arslan", "Doğan", "Kılıç", "Aslan", "Çetin", "Kara", "Koç", "Güneş",
	"Şimşek", "Polat", "Erdoğan", "Türk", "Yalçın", "Bulut", "Aktaş",
	"Korkmaz", "Özdemir", "Şen", "Avcı", "Ünal", "Keskin", "Tan",
}

func main() {
	databaseURL := os.Getenv("DATABASE_URL")
	if databaseURL == "" {
		databaseURL = "postgres://parla:parla_dev_password@localhost:5432/parla_oyun_evi?sslmode=disable"
	}

	ctx := context.Background()
	pool, err := db.Connect(ctx, databaseURL)
	if err != nil {
		log.Fatalf("veritabanına bağlanılamadı: %v", err)
	}
	defer pool.Close()

	var kurusPerDakika int64
	var pricingRuleID int64
	if err := pool.QueryRow(ctx, `
		SELECT id, kurus_per_dakika FROM pricing_rules
		WHERE effective_from <= now() ORDER BY effective_from DESC LIMIT 1`,
	).Scan(&pricingRuleID, &kurusPerDakika); err != nil {
		log.Fatalf("aktif fiyat kuralı bulunamadı, önce en az bir fiyat kuralı ekleyin: %v", err)
	}

	var adminID int64
	if err := pool.QueryRow(ctx, `SELECT id FROM users WHERE is_admin = true ORDER BY id LIMIT 1`).Scan(&adminID); err != nil {
		log.Fatalf("yönetici kullanıcı bulunamadı: %v", err)
	}

	rng := rand.New(rand.NewSource(time.Now().UnixNano()))

	const musteriSayisi = 30
	customerIDs := make([]int64, 0, musteriSayisi)

	for i := 0; i < musteriSayisi; i++ {
		ad := adlar[rng.Intn(len(adlar))]
		soyad := soyadlar[rng.Intn(len(soyadlar))]
		tcKimlikNo := gecerliTCKimlikNo(i)
		telefon := fmt.Sprintf("05%09d", 300000000+i)

		var veliTelefon *string
		if rng.Float64() < 0.4 {
			v := fmt.Sprintf("05%09d", 400000000+i)
			veliTelefon = &v
		}

		createdAt := time.Now().Add(-time.Duration(rng.Intn(60)) * 24 * time.Hour)
		var id int64
		err := pool.QueryRow(ctx, `
			INSERT INTO customers (tc_kimlik_no, ad, soyad, telefon, veli_telefon, created_at)
			VALUES ($1, $2, $3, $4, $5, $6)
			RETURNING id`,
			tcKimlikNo, ad, soyad, telefon, veliTelefon, createdAt,
		).Scan(&id)
		if err != nil {
			log.Fatalf("müşteri eklenemedi: %v", err)
		}
		customerIDs = append(customerIDs, id)
	}
	log.Printf("%d müşteri oluşturuldu", len(customerIDs))

	kapaliOturumSayisi := 0
	for _, custID := range customerIDs {
		oturumSayisi := 1 + rng.Intn(4) // 1-4 geçmiş oturum
		for j := 0; j < oturumSayisi; j++ {
			girisZamani := time.Now().
				Add(-time.Duration(rng.Intn(45)) * 24 * time.Hour).
				Add(-time.Duration(rng.Intn(14)) * time.Hour).
				Add(-time.Duration(rng.Intn(60)) * time.Minute)

			dakika := int64(5 + rng.Intn(176)) // 5-180 dakika
			cikisZamani := girisZamani.Add(time.Duration(dakika) * time.Minute)
			orijinalTutar := dakika * kurusPerDakika

			tahsilTutar := orijinalTutar
			if rng.Float64() < 0.3 {
				// bazı oturumlarda yuvarlama uygulanmış gibi davran
				lira := orijinalTutar / 100
				tahsilTutar = (lira / 10) * 10 * 100
			}

			odemeTipi := "nakit"
			if rng.Float64() < 0.4 {
				odemeTipi = "kredi_karti"
			}

			manuelKapatildi := rng.Float64() < 0.12
			var kapatanUserID *int64
			if manuelKapatildi {
				kapatanUserID = &adminID
			}

			_, err := pool.Exec(ctx, `
				INSERT INTO sessions (
					customer_id, giris_zamani, cikis_zamani, durum,
					pricing_rule_id, toplam_dakika, orijinal_tutar_kurus, tahsil_tutar_kurus,
					odeme_tipi, manuel_kapatildi, kapatan_user_id
				) VALUES ($1, $2, $3, 'kapali', $4, $5, $6, $7, $8, $9, $10)`,
				custID, girisZamani, cikisZamani, pricingRuleID, dakika,
				orijinalTutar, tahsilTutar, odemeTipi, manuelKapatildi, kapatanUserID,
			)
			if err != nil {
				log.Fatalf("oturum eklenemedi: %v", err)
			}
			kapaliOturumSayisi++
		}
	}
	log.Printf("%d kapalı (geçmiş) oturum oluşturuldu", kapaliOturumSayisi)

	// Birkaç müşteriyi şu an "içeride" olacak şekilde açık oturumla işaretle.
	acikSayisi := 5
	rng.Shuffle(len(customerIDs), func(i, j int) { customerIDs[i], customerIDs[j] = customerIDs[j], customerIDs[i] })
	for i := 0; i < acikSayisi && i < len(customerIDs); i++ {
		girisZamani := time.Now().Add(-time.Duration(5+rng.Intn(90)) * time.Minute)
		_, err := pool.Exec(ctx, `
			INSERT INTO sessions (customer_id, giris_zamani, durum)
			VALUES ($1, $2, 'acik')`,
			customerIDs[i], girisZamani,
		)
		if err != nil {
			log.Fatalf("açık oturum eklenemedi: %v", err)
		}
	}
	log.Printf("%d açık oturum oluşturuldu", acikSayisi)

	log.Println("dummy veri yükleme tamamlandı")
}
