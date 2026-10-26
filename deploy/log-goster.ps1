# Parla Oyun Evi - islem kayitlarini okuma (YALNIZCA GELISTIRICI)
#
# Uygulamadaki islem kayitlarini (hangi islem yapildi / yapilamadi ve nedeni)
# veritabanindan okur; ekrana kisa ozet yazar ve CSV dosyasi uretir.
# Kayitlar uygulamada ve API'de gorunmez, sadece bu script ile okunur.
#
# Kullanim (proje klasorunde):
#   .\deploy\log-goster.ps1                              (son 7 gun)
#   .\deploy\log-goster.ps1 -Gun 30
#   .\deploy\log-goster.ps1 -Baslangic 2026-10-01 -Bitis 2026-10-26
#   .\deploy\log-goster.ps1 -Sadece reddedildi           (veya: hata)
#   .\deploy\log-goster.ps1 -Kullanici kasiyer1
#   .\deploy\log-goster.ps1 -Musteri 42                  (tek musterinin tum gecmisi)
#
# CSV: deploy\loglar\islem_log_<tarih>.csv (UTF-8, Excel'de Turkce karakterler bozulmaz)

param(
    [int]$Gun = 7,
    [string]$Baslangic,
    [string]$Bitis,
    [ValidateSet("reddedildi", "hata", "yapildi")][string]$Sadece,
    [string]$Kullanici,
    [int]$Musteri = 0
)

$ErrorActionPreference = "Continue"

$kok = Split-Path -Parent $PSScriptRoot
Set-Location $kok

# psql Turkce karakterleri UTF-8 verir; PowerShell de UTF-8 okusun.
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

$compose = @("compose", "-f", "docker-compose.auto.yml")

# --- .env icinden gerekli degerler ---------------------------------------
$envSatirlari = @()
if (Test-Path ".env") { $envSatirlari = Get-Content ".env" | Where-Object { $_ -match "^\s*[^#].*=" } }
function EnvDeger($ad) {
    $satir = $envSatirlari | Where-Object { $_ -match "^\s*$ad\s*=" } | Select-Object -First 1
    if (-not $satir) { return $null }
    return ($satir -split "=", 2)[1].Trim()
}
$dbKullanici = EnvDeger "POSTGRES_USER"; if (-not $dbKullanici) { $dbKullanici = "parla" }
$dbAdi = EnvDeger "POSTGRES_DB"; if (-not $dbAdi) { $dbAdi = "parla_oyun_evi" }

# --- Girdi dogrulama (SQL'e yalnizca guvenli degerler girer) -------------
$tarihDeseni = '^\d{4}-\d{2}-\d{2}$'
if ($Baslangic -and $Baslangic -notmatch $tarihDeseni) { Write-Host "Baslangic yyyy-MM-dd bicimde olmali."; exit 1 }
if ($Bitis -and $Bitis -notmatch $tarihDeseni) { Write-Host "Bitis yyyy-MM-dd bicimde olmali."; exit 1 }
if ($Kullanici -and $Kullanici -notmatch '^[A-Za-z0-9_.-]+$') { Write-Host "Kullanici yalnizca harf, rakam, _ . - icerebilir."; exit 1 }
if ($Gun -lt 1) { Write-Host "Gun en az 1 olmali."; exit 1 }

# --- Filtre ---------------------------------------------------------------
# Tarihler Istanbul saatine gore; Bitis gunu dahildir.
$istanbul = "(l.zaman AT TIME ZONE 'Europe/Istanbul')"
if ($Baslangic) {
    $kosullar = @("$istanbul >= '$Baslangic'::date")
    if ($Bitis) { $kosullar += "$istanbul < ('$Bitis'::date + 1)" }
} elseif ($Bitis) {
    $kosullar = @("$istanbul < ('$Bitis'::date + 1)", "l.zaman >= now() - interval '$Gun days'")
} else {
    $kosullar = @("l.zaman >= now() - interval '$Gun days'")
}
if ($Sadece) { $kosullar += "l.sonuc = '$Sadece'" }
if ($Kullanici) { $kosullar += "COALESCE(u.username, l.kullanici_adi) = '$Kullanici'" }
if ($Musteri -gt 0) { $kosullar += "(l.detay->>'customer_id' = '$Musteri' OR l.gercek_yol ~ '^/api/customers/$Musteri(/|$)')" }
$nerede = $kosullar -join " AND "
$kaynak = "FROM islem_log l LEFT JOIN users u ON u.id = l.user_id WHERE $nerede"

function Psql([string[]]$ek, [string]$sql) {
    $arguman = $compose + @("exec", "-T", "db", "psql", "-U", $dbKullanici, "-d", $dbAdi) + $ek + @("-c", $sql)
    $cikti = & docker @arguman 2>&1 | Out-String
    return [pscustomobject]@{ Kod = $LASTEXITCODE; Cikti = $cikti }
}

# --- Ekran ozeti ----------------------------------------------------------
$ozet = Psql @() "SELECT l.sonuc, count(*) AS adet $kaynak GROUP BY l.sonuc ORDER BY l.sonuc"
if ($ozet.Kod -ne 0) { Write-Host "Veritabanina erisilemedi:"; Write-Host $ozet.Cikti; exit 1 }
Write-Host "--- Sonuc ozeti ---"
Write-Host $ozet.Cikti

# detay'dan kisa ozet: bakiyede kalan dakika, abonelikte bugunku kullanim
$kisa = "COALESCE(l.mesaj, CASE WHEN l.detay->>'kalan_dakika_once' IS NOT NULL THEN 'kalan ' || (l.detay->>'kalan_dakika_once') || '->' || COALESCE(l.detay->>'kalan_dakika_sonra', '?') || ' dk' " +
    "WHEN l.detay->>'bugun_kullanilan_dakika_once' IS NOT NULL THEN 'bugun ' || (l.detay->>'bugun_kullanilan_dakika_once') || '->' || (l.detay->>'bugun_kullanilan_dakika_sonra') || ' dk' " +
    "WHEN l.detay->>'customer_id' IS NOT NULL THEN 'musteri ' || (l.detay->>'customer_id') END, '') AS ozet"
$son = Psql @() ("SELECT to_char(l.zaman AT TIME ZONE 'Europe/Istanbul', 'MM-DD HH24:MI:SS') AS zaman, COALESCE(u.username, l.kullanici_adi, '-') AS kullanici, " +
    "l.yontem || ' ' || l.gercek_yol AS islem, l.sonuc, l.durum_kodu AS kod, $kisa $kaynak ORDER BY l.zaman DESC LIMIT 20")
Write-Host "--- Son 20 kayit ---"
Write-Host $son.Cikti

# --- CSV ------------------------------------------------------------------
# CSV/formul enjeksiyonu: =, +, -, @, sekme veya CR ile baslayan metin hucrelerinin basina ' konur.
function Guvenli([string]$kolon) {
    return "(CASE WHEN $kolon ~ '^[=+\-@\t\r]' THEN '''' || $kolon ELSE $kolon END)"
}
$csvSorgu = "COPY (SELECT to_char(l.zaman AT TIME ZONE 'Europe/Istanbul', 'YYYY-MM-DD HH24:MI:SS') AS zaman, $(Guvenli "COALESCE(u.username, l.kullanici_adi)") AS kullanici, " +
    "$(Guvenli "l.yontem || ' ' || l.yol") AS islem, $(Guvenli "l.gercek_yol") AS gercek_yol, $(Guvenli "l.sonuc") AS sonuc, l.durum_kodu, $(Guvenli "l.mesaj") AS mesaj, $(Guvenli "l.ip") AS ip, l.sure_ms, $(Guvenli "l.detay::text") AS detay " +
    "$kaynak ORDER BY l.zaman) TO STDOUT WITH CSV HEADER"
$csv = Psql @() $csvSorgu
if ($csv.Kod -ne 0) { Write-Host "CSV olusturulamadi:"; Write-Host $csv.Cikti; exit 1 }

$klasor = Join-Path $kok "deploy\loglar"
if (-not (Test-Path $klasor)) { New-Item -ItemType Directory -Path $klasor | Out-Null }
$dosya = Join-Path $klasor ("islem_log_{0}.csv" -f (Get-Date -Format "yyyy-MM-dd_HHmmss"))
# BOM'lu UTF-8: Excel Turkce karakterleri dogru acar.
[System.IO.File]::WriteAllText($dosya, $csv.Cikti, (New-Object System.Text.UTF8Encoding $true))
Write-Host "CSV yazildi: $dosya"
