# Parla Oyun Evi - tum sistemi tek komutla baslatir
# Kullanim: .\start.ps1

$ErrorActionPreference = "Stop"
$root = $PSScriptRoot

Write-Host "== Docker Desktop kontrol ediliyor ==" -ForegroundColor Cyan
docker info *> $null
if ($LASTEXITCODE -ne 0) {
    Write-Host "Docker motoru calismiyor, Docker Desktop baslatiliyor..." -ForegroundColor Yellow
    Start-Process "shell:AppsFolder\Docker.DockerForWindows.Settings"
    $dockerReady = $false
    for ($i = 0; $i -lt 90; $i++) {
        docker info *> $null
        if ($LASTEXITCODE -eq 0) { $dockerReady = $true; break }
        Start-Sleep -Seconds 2
    }
    if (-not $dockerReady) {
        Write-Host "Docker motoru 3 dakika icinde hazir olmadi. Docker Desktop'i elle kontrol edin." -ForegroundColor Red
        exit 1
    }
}

Write-Host "== Postgres baslatiliyor (docker compose up -d) ==" -ForegroundColor Cyan
docker compose -f "$root\docker-compose.yml" up -d

Write-Host "== Veritabaninin hazir olmasi bekleniyor ==" -ForegroundColor Cyan
$ready = $false
for ($i = 0; $i -lt 30; $i++) {
    docker exec parla-oyun-evi-db pg_isready -U parla -d parla_oyun_evi *> $null
    if ($LASTEXITCODE -eq 0) { $ready = $true; break }
    Start-Sleep -Seconds 1
}
if (-not $ready) {
    Write-Host "Veritabani 30 saniye icinde hazir olmadi." -ForegroundColor Red
    exit 1
}

Write-Host "== Migration durumu kontrol ediliyor ==" -ForegroundColor Cyan
try {
    docker exec -i parla-oyun-evi-db psql -U parla -d parla_oyun_evi -c "CREATE TABLE IF NOT EXISTS schema_migrations (filename TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())" *> $null
} catch {}

Get-ChildItem "$root\backend\migrations\*.sql" | Sort-Object Name | ForEach-Object {
    $name = $_.Name
    docker exec parla-oyun-evi-db psql -U parla -d parla_oyun_evi -tAc "SELECT 1 FROM schema_migrations WHERE filename = '$name'" > "$env:TEMP\parla_check.txt" 2>$null
    $applied = (Get-Content "$env:TEMP\parla_check.txt" -Raw -ErrorAction SilentlyContinue) -join ""
    $applied = $applied.Trim()
    if ($applied -eq "1") {
        Write-Host "  -> $name (zaten uygulanmis, atlaniyor)" -ForegroundColor Yellow
    } else {
        Write-Host "  -> $name uygulaniyor" -ForegroundColor Cyan
        Get-Content $_.FullName -Raw | docker exec -i parla-oyun-evi-db psql -U parla -d parla_oyun_evi
        try {
            docker exec parla-oyun-evi-db psql -U parla -d parla_oyun_evi -c "INSERT INTO schema_migrations (filename) VALUES ('$name')" *> $null
        } catch {}
    }
}

if (Get-NetTCPConnection -LocalPort 8080 -State Listen -ErrorAction SilentlyContinue) {
    Write-Host "== Backend zaten calisiyor (port 8080), atlaniyor ==" -ForegroundColor Yellow
} else {
    Write-Host "== Backend baslatiliyor (yeni pencere, port 8080) ==" -ForegroundColor Cyan
    Start-Process powershell -ArgumentList "-NoExit", "-Command", "cd '$root\backend'; go run ./cmd/api"
}

if (Get-NetTCPConnection -LocalPort 5173 -State Listen -ErrorAction SilentlyContinue) {
    Write-Host "== Frontend zaten calisiyor (port 5173), atlaniyor ==" -ForegroundColor Yellow
} else {
    Write-Host "== Frontend baslatiliyor (yeni pencere) ==" -ForegroundColor Cyan
    Start-Process powershell -ArgumentList "-NoExit", "-Command", "cd '$root\frontend'; if (-not (Test-Path node_modules)) { npm install }; npm run dev"
}

Write-Host "== Tamam. Sistem hazir: http://localhost:5173 ==" -ForegroundColor Green
Start-Sleep -Seconds 3
Start-Process "http://localhost:5173"
