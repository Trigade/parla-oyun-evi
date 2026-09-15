# Parla Oyun Evi - veritabani yedegi alir
# Kullanim: .\backup.ps1
# Gunluk olarak Gorev Zamanlayici uzerinden de calistirilir (bkz. kurulum.ps1)

$root = $PSScriptRoot
$backupDir = "$root\backups"
if (-not (Test-Path $backupDir)) {
    New-Item -ItemType Directory -Path $backupDir | Out-Null
}

$timestamp = Get-Date -Format "yyyy-MM-dd_HHmmss"
$outFile = "$backupDir\parla_oyun_evi_$timestamp.sql"

$running = docker ps --filter "name=parla-oyun-evi-db" --format "{{.Names}}"
if (-not $running) {
    Write-Host "Veritabani konteyneri calismiyor, yedek alinamadi." -ForegroundColor Red
    exit 1
}

# Dump konteynerin icinde dosyaya yazilip docker cp ile disari alinir.
# PowerShell 5.1'de "> dosya" yonlendirmesi ciktiyi UTF-16'ya cevirir ve
# olusan .sql dosyasi psql ile geri yuklenemez hale gelir.
$tmp = "/tmp/parla_backup_$timestamp.sql"
docker exec parla-oyun-evi-db pg_dump -U parla -d parla_oyun_evi -f $tmp
if ($LASTEXITCODE -eq 0) {
    docker cp "parla-oyun-evi-db:$tmp" $outFile | Out-Null
}
docker exec parla-oyun-evi-db rm -f $tmp | Out-Null

if ((Test-Path $outFile) -and (Get-Item $outFile).Length -gt 0) {
    Write-Host "Yedek alindi: $outFile" -ForegroundColor Green
} else {
    Write-Host "Yedek alma basarisiz oldu (dosya bos)." -ForegroundColor Red
    Remove-Item $outFile -ErrorAction SilentlyContinue
    exit 1
}

# 30 gunden eski yedekleri sil
Get-ChildItem $backupDir -Filter "parla_oyun_evi_*.sql" |
    Where-Object { $_.LastWriteTime -lt (Get-Date).AddDays(-30) } |
    Remove-Item -Force
