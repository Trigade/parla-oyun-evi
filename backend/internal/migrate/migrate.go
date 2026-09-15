// Package migrate, gömülü SQL migration dosyalarını dosya adı sırasıyla ve
// her birini tek bir transaction içinde uygular. Uygulanan dosyalar,
// kurulum script'lerinin (start.ps1 / kurulum.ps1) de kullandığı
// schema_migrations tablosuna yazılır — iki yol birbiriyle uyumludur, daha
// önce script'le kurulmuş bir veritabanında yalnızca eksik dosyalar uygulanır.
package migrate

import (
	"context"
	"fmt"
	"io/fs"
	"sort"

	"github.com/jackc/pgx/v5/pgxpool"
)

// advisoryLockID, aynı anda birden fazla backend kopyası başlarsa
// migration'ların iki kez uygulanmasını engelleyen Postgres kilidinin anahtarıdır.
const advisoryLockID int64 = 7243100114

// Run eksik migration'ları uygular ve uygulananların dosya adlarını döner.
func Run(ctx context.Context, pool *pgxpool.Pool, fsys fs.FS) ([]string, error) {
	conn, err := pool.Acquire(ctx)
	if err != nil {
		return nil, fmt.Errorf("veritabanı bağlantısı alınamadı: %w", err)
	}
	defer conn.Release()

	if _, err := conn.Exec(ctx, `SELECT pg_advisory_lock($1)`, advisoryLockID); err != nil {
		return nil, fmt.Errorf("migration kilidi alınamadı: %w", err)
	}
	defer conn.Exec(context.Background(), `SELECT pg_advisory_unlock($1)`, advisoryLockID)

	if _, err := conn.Exec(ctx, `CREATE TABLE IF NOT EXISTS schema_migrations (
		filename   TEXT PRIMARY KEY,
		applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
	)`); err != nil {
		return nil, fmt.Errorf("schema_migrations tablosu oluşturulamadı: %w", err)
	}

	names, err := fs.Glob(fsys, "*.sql")
	if err != nil {
		return nil, fmt.Errorf("migration dosyaları listelenemedi: %w", err)
	}
	sort.Strings(names)

	var applied []string
	for _, name := range names {
		var exists bool
		if err := conn.QueryRow(ctx,
			`SELECT EXISTS (SELECT 1 FROM schema_migrations WHERE filename = $1)`, name,
		).Scan(&exists); err != nil {
			return applied, fmt.Errorf("%s durumu okunamadı: %w", name, err)
		}
		if exists {
			continue
		}

		body, err := fs.ReadFile(fsys, name)
		if err != nil {
			return applied, fmt.Errorf("%s okunamadı: %w", name, err)
		}

		tx, err := conn.Begin(ctx)
		if err != nil {
			return applied, fmt.Errorf("%s için transaction başlatılamadı: %w", name, err)
		}
		// Argümansız Exec simple protocol kullanır; dosyadaki birden fazla
		// SQL ifadesi tek seferde çalıştırılabilir.
		if _, err := tx.Exec(ctx, string(body)); err != nil {
			_ = tx.Rollback(ctx)
			return applied, fmt.Errorf("%s uygulanamadı: %w", name, err)
		}
		if _, err := tx.Exec(ctx, `INSERT INTO schema_migrations (filename) VALUES ($1)`, name); err != nil {
			_ = tx.Rollback(ctx)
			return applied, fmt.Errorf("%s kaydedilemedi: %w", name, err)
		}
		if err := tx.Commit(ctx); err != nil {
			return applied, fmt.Errorf("%s commit edilemedi: %w", name, err)
		}
		applied = append(applied, name)
	}
	return applied, nil
}
