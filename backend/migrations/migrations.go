// Package migrations, SQL migration dosyalarını backend binary'sine gömer;
// böylece üretim imajında ayrı bir dosya kopyalamaya veya psql'e gerek kalmaz
// (bkz. internal/migrate).
package migrations

import "embed"

//go:embed *.sql
var FS embed.FS
