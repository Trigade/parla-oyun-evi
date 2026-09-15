// Bootstrap admin kullanıcısı oluşturur. Sadece ilk kurulumda, elle
// çalıştırılır (bkz. DEPLOY.md):
//
//	go run ./cmd/seed <username> [password]
//
// Şifre argüman olarak verilmezse standart girdiden okunur; üretimde şifrenin
// shell geçmişine düşmemesi için bu yol tercih edilmelidir.
package main

import (
	"bufio"
	"context"
	"fmt"
	"log"
	"os"
	"strings"

	"parla-oyun-evi/backend/internal/auth"
	"parla-oyun-evi/backend/internal/db"
)

func main() {
	if len(os.Args) != 2 && len(os.Args) != 3 {
		log.Fatalf("kullanım: seed <username> [password]  (şifre verilmezse standart girdiden okunur)")
	}
	username := os.Args[1]

	var password string
	if len(os.Args) == 3 {
		password = os.Args[2]
	} else {
		fmt.Fprint(os.Stderr, "Şifre: ")
		line, err := bufio.NewReader(os.Stdin).ReadString('\n')
		if err != nil && line == "" {
			log.Fatalf("şifre okunamadı: %v", err)
		}
		// Windows PowerShell 5.1, native programa pipe edilen metnin başına
		// UTF-8 BOM ekler; temizlenmezse şifrenin bir parçası olarak hash'lenir.
		password = strings.TrimPrefix(strings.TrimRight(line, "\r\n"), "\xef\xbb\xbf")
	}
	if len(password) < 6 {
		log.Fatalf("şifre en az 6 karakter olmalı")
	}

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

	hash, err := auth.HashPassword(password)
	if err != nil {
		log.Fatalf("şifre hash'lenemedi: %v", err)
	}

	var id int64
	err = pool.QueryRow(ctx,
		`INSERT INTO users (username, password_hash, role, is_admin) VALUES ($1, $2, 'yonetici', true)
		 ON CONFLICT (username) DO UPDATE SET password_hash = EXCLUDED.password_hash, is_admin = true
		 RETURNING id`,
		username, hash,
	).Scan(&id)
	if err != nil {
		log.Fatalf("kullanıcı oluşturulamadı: %v", err)
	}

	log.Printf("yönetici kullanıcısı hazır: id=%d username=%s", id, username)
}
