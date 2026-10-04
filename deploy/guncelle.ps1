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

# PowerShell 5.1'de native komutlarin stderr ciktisi "Stop" ile terminating
# hataya donusur (ornegin ilk calistirmada beklenen "No such image" mesaji
# script'i durdururdu). Bu yuzden akis exit kodlariyla yonetilir.
$ErrorActionPreference = "Continue"

$kok = Split-Path -Parent $PSScriptRoot
Set-Location $kok

$logDosyasi = Join-Path $kok "deploy\guncelleme.log"
function Yaz($mesaj) {
    $satir = "{0}  {1}" -f (Get-Date -Format "yyyy-MM-dd HH:mm:ss"), $mesaj
    Write-Host $satir
    Add-Content -Path $logDosyasi -Value $satir -Encoding utf8
}

# Docker'i calistirir; cikti (hata akisi dahil) yakalanir, karar exit koduna gore verilir.
function Docker-Calistir([string[]]$arguman) {
    $cikti = & docker @arguman 2>&1 | Out-String
    return [pscustomobject]@{ Kod = $LASTEXITCODE; Cikti = $cikti.Trim() }
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
$dbKullanici = EnvDeger "POSTGRES_USER"; if (-not $dbKullanici) { $dbKullanici = "parla" }
$dbAdi = EnvDeger "POSTGRES_DB"; if (-not $dbAdi) { $dbAdi = "parla_oyun_evi" }

# --- 1. Docker hazir mi ---------------------------------------------------
if ((Docker-Calistir @("info")).Kod -ne 0) { Yaz "Docker calismiyor, guncelleme atlandi."; exit 0 }

# --- 2. Acik oturum kontrolu ---------------------------------------------
if (-not $Zorla) {
    $sorgu = Docker-Calistir ($compose + @("exec", "-T", "db", "psql", "-U", $dbKullanici, "-d", $dbAdi,
            "-tAc", "SELECT count(*) FROM sessions WHERE durum = 'acik'"))
    $acikSayisi = 0
    if ($sorgu.Kod -eq 0 -and [int]::TryParse($sorgu.Cikti, [ref]$acikSayisi) -and $acikSayisi -gt 0) {
        Yaz "Kasada $acikSayisi acik oturum var, guncelleme ertelendi."
        exit 0
    }
}

# --- 3. Yeni imaj var mi --------------------------------------------------
# Ilk calistirmada imaj henuz indirilmemis olabilir; bu bir hata degildir.
$onceki = Docker-Calistir @("image", "inspect", "--format", "{{.Id}}", $imaj)
$oncekiId = if ($onceki.Kod -eq 0) { $onceki.Cikti } else { $null }

Yaz "Yeni surum kontrol ediliyor: $imaj"
$indirme = Docker-Calistir ($compose + @("pull", "app"))
if ($indirme.Kod -ne 0) {
    Yaz "Imaj indirilemedi. Internet baglantisini kontrol edin."
    Yaz $indirme.Cikti
    exit 1
}

$yeni = Docker-Calistir @("image", "inspect", "--format", "{{.Id}}", $imaj)
$yeniId = if ($yeni.Kod -eq 0) { $yeni.Cikti } else { $null }
if (-not $yeniId) { Yaz "Imaj indirildi ama bulunamadi, guncelleme iptal."; exit 1 }

if ($oncekiId -and $oncekiId -eq $yeniId) {
    Yaz "Yeni surum yok, sistem guncel."
    exit 0
}
Yaz "Yeni surum bulundu, guncelleme basliyor."

# --- 4. Yedek -------------------------------------------------------------
$yedek = Docker-Calistir ($compose + @("exec", "-T", "backup", "/bin/sh", "/usr/local/bin/parla-backup.sh", "now"))
if ($yedek.Kod -eq 0) { Yaz "Guncelleme oncesi yedek alindi." } else { Yaz "UYARI: yedek alinamadi, guncellemeye devam ediliyor." }

# --- 5. Uygula ------------------------------------------------------------
$baslat = Docker-Calistir ($compose + @("up", "-d", "--wait"))
if ($baslat.Kod -ne 0) { Yaz "Konteynerler baslatilamadi:"; Yaz $baslat.Cikti }

# --- 6. Saglik kontrolu ---------------------------------------------------
$saglikli = $false
if ($baslat.Kod -eq 0) {
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
    Docker-Calistir @("tag", $oncekiId, $imaj) | Out-Null
    Docker-Calistir ($compose + @("up", "-d", "--wait")) | Out-Null
    $kod = curl.exe -s -o NUL -m 5 -w "%{http_code}" "http://localhost:$httpPort/api/health"
    if ($kod -eq "200") { Yaz "Eski surume donuldu, sistem calisiyor." }
    else { Yaz "DIKKAT: sistem ayaga kalkmadi, elle kontrol gerekiyor." }
} else {
    Yaz "DIKKAT: geri donulecek eski imaj yok, elle kontrol gerekiyor."
}
exit 1
