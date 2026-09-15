$ErrorActionPreference = "Stop"
$root = $PSScriptRoot

Write-Host "== Veritabani baglantisi kontrol ediliyor ==" -ForegroundColor Cyan
docker exec parla-oyun-evi-db pg_isready -U parla -d parla_oyun_evi *> $null
if ($LASTEXITCODE -ne 0) {
    Write-Host "Postgres calismiyor gibi gorunuyor. Once .\start.ps1 calistirin." -ForegroundColor Red
    exit 1
}

Write-Host "== Mevcut musteri / oturum / audit / gun sonu verileri siliniyor ==" -ForegroundColor Cyan
docker exec parla-oyun-evi-db psql -U parla -d parla_oyun_evi -c `
    "TRUNCATE TABLE audit_log, sessions, business_days, customers RESTART IDENTITY CASCADE;"

Write-Host "== Yeni dummy veri ekleniyor (go run ./cmd/seed_dummy) ==" -ForegroundColor Cyan
Push-Location "$root\backend"
try {
    go run ./cmd/seed_dummy
} finally {
    Pop-Location
}

Write-Host "== Tamam. Eski veriler silindi, yeni dummy veri eklendi. ==" -ForegroundColor Green
