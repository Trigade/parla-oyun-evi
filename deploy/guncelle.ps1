# Parla Oyun Evi - otomatik guncelleme
#
# Yeni bir uygulama imaji yayinlanmissa indirir ve uygular. Islem sirasi:
#   1. Docker calisiyor mu
#   2. Acik oturum var mi (gece guncellemesi kasada musteri varken ertelenir)
#   3. Yeni imaj var mi (yoksa hicbir sey yapilmaz)
#   4. Veritabani yedegi
#   5. Yeni imajla baslat, saglik kontrolu
#   6. Saglik kontrolu gecmezse eski imaja geri don
#
# Kullanim:
#   .\deploy\guncelle.ps1            (gece gorevi: acik oturum varsa erteler)
#   .\deploy\guncelle.ps1 -Zorla     (elle: acik oturum olsa da gunceller)

param([switch]$Zorla)

$ErrorActionPreference = "Stop"
$kok = Split-Path -Parent $PSScriptRoot
Set-Location $kok

$logDosyasi = Join-Path $kok "deploy\guncelleme.log"
function Yaz($mesaj) {
    $satir = "{0}  {1}" -f (Get-Date -Format "yyyy-MM-dd HH:mm:ss"), $mesaj
    Write-Host $satir
    Add-Content -Path $logDosyasi -Value $satir -Encoding utf8
}

$compose = @("compose", "-f", "docker-compose.auto.yml")

# --- .env icinden gerekli degerler ---------------------------------------
if (-not (Test-Path ".env")) { Yaz ".env bulunamadi, guncelleme iptal."; exit 1 }
$envSatirlari = Get-Content ".env" | Where-Object { $_ -match "^\s*[^#].*=" }
function EnvDeger($ad) {
    $satir = $envSatirlari | Where-Object { $_ -match "^\s*$ad\s*=" } | Select-Object -First 1
    if (-not $satir) { return $null }
    return ($satir -split "=", 2)[1].Trim()
}
$imaj = EnvDeger "APP_IMAGE"
if (-not $imaj) { Yaz ".env icinde APP_IMAGE tanimli degil, guncelleme iptal."; exit 1 }
$httpPort = EnvDeger "HTTP_PORT"
if (-not $httpPort) { $httpPort = "80" }

# --- 1. Docker hazir mi ---------------------------------------------------
docker info *> $null
if ($LASTEXITCODE -ne 0) { Yaz "Docker calismiyor, guncelleme atlandi."; exit 0 }

# --- 2. Acik oturum kontrolu ---------------------------------------------
if (-not $Zorla) {
    $acik = docker @compose exec -T db psql -U (EnvDeger "POSTGRES_USER") -d (EnvDeger "POSTGRES_DB") -tAc "SELECT count(*) FROM sessions WHERE durum = 'acik'" 2>$null
    if ($LASTEXITCODE -eq 0 -and "$acik".Trim() -ne "" -and [int]"$acik".Trim() -gt 0) {
        Yaz "Kasada $("$acik".Trim()) acik oturum var, guncelleme ertelendi."
        exit 0
    }
}

# --- 3. Yeni imaj var mi --------------------------------------------------
$oncekiId = docker image inspect --format "{{.Id}}" $imaj 2>$null
docker @compose pull app
if ($LASTEXITCODE -ne 0) { Yaz "Imaj indirilemedi (internet/oturum sorunu olabilir)."; exit 1 }
$yeniId = docker image inspect --format "{{.Id}}" $imaj 2>$null

if ($oncekiId -and $yeniId -and $oncekiId -eq $yeniId) {
    Yaz "Yeni surum yok, sistem guncel."
    exit 0
}
Yaz "Yeni surum bulundu, guncelleme basliyor."

# --- 4. Yedek -------------------------------------------------------------
docker @compose exec -T backup /bin/sh /usr/local/bin/parla-backup.sh now
if ($LASTEXITCODE -ne 0) { Yaz "UYARI: guncelleme oncesi yedek alinamadi." }

# --- 5. Uygula ------------------------------------------------------------
docker @compose up -d --wait
$baslatmaSonucu = $LASTEXITCODE

# --- 6. Saglik kontrolu ---------------------------------------------------
$saglikli = $false
if ($baslatmaSonucu -eq 0) {
    for ($i = 0; $i -lt 10; $i++) {
        $kod = curl.exe -s -o NUL -m 5 -w "%{http_code}" "http://localhost:$httpPort/api/health"
        if ($kod -eq "200") { $saglikli = $true; break }
        Start-Sleep -Seconds 3
    }
}

if ($saglikli) {
    Yaz "Guncelleme tamamlandi, sistem calisiyor."
    exit 0
}

# --- Geri alma ------------------------------------------------------------
Yaz "HATA: yeni surum saglik kontrolunu gecemedi."
if ($oncekiId) {
    Yaz "Eski surume geri donuluyor."
    docker tag $oncekiId $imaj
    docker @compose up -d --wait
    $kod = curl.exe -s -o NUL -m 5 -w "%{http_code}" "http://localhost:$httpPort/api/health"
    if ($kod -eq "200") { Yaz "Eski surume donuldu, sistem calisiyor." }
    else { Yaz "DIKKAT: sistem ayaga kalkmadi, elle kontrol gerekiyor." }
} else {
    Yaz "DIKKAT: geri donulecek eski imaj yok, elle kontrol gerekiyor."
}
exit 1
