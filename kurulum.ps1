# =====================================================================
#  Parla Oyun Evi - Tek Tikla Kurulum Sihirbazi
#  Kullanim: Bu dosyaya sag tiklayip "PowerShell ile Calistir" secin,
#  veya "Kurulum.bat" dosyasina cift tiklayin.
# =====================================================================

$ErrorActionPreference = "Stop"
$root = $PSScriptRoot

function Baslik($metin) {
    Write-Host ""
    Write-Host "== $metin ==" -ForegroundColor Cyan
}

# --- 0. Yonetici kontrolu -------------------------------------------------
$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) {
    Write-Host "Bu kurulum yonetici yetkisi gerektiriyor. Yeniden baslatiliyor..." -ForegroundColor Yellow
    Start-Process powershell -Verb RunAs -ArgumentList "-NoProfile -ExecutionPolicy Bypass -File `"$PSCommandPath`""
    exit
}

Write-Host "==============================================" -ForegroundColor Green
Write-Host " Parla Oyun Evi - Kurulum Sihirbazi" -ForegroundColor Green
Write-Host "==============================================" -ForegroundColor Green

# --- 1. Gerekli programlarin kontrolu / kurulumu --------------------------
Baslik "Gerekli programlar kontrol ediliyor"

function Kur-Eger-Yok($komut, $wingetId, $adi) {
    $var = Get-Command $komut -ErrorAction SilentlyContinue
    if ($var) {
        Write-Host "  [OK] $adi zaten kurulu." -ForegroundColor Green
    } else {
        Write-Host "  [--] $adi kuruluyor..." -ForegroundColor Yellow
        winget install --id $wingetId -e --accept-package-agreements --accept-source-agreements --silent | Out-Null
        Write-Host "  [OK] $adi kuruldu." -ForegroundColor Green
    }
}

Kur-Eger-Yok "go" "GoLang.Go" "Go"
Kur-Eger-Yok "node" "OpenJS.NodeJS.LTS" "Node.js"
Kur-Eger-Yok "git" "Git.Git" "Git"
Kur-Eger-Yok "docker" "Docker.DockerDesktop" "Docker Desktop"

# PATH guncellemesi (bu oturumda yeni kurulan programlarin taninmasi icin)
$env:Path = [System.Environment]::GetEnvironmentVariable("Path", "Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path", "User")

# --- 2. WSL2 kontrolu ------------------------------------------------------
Baslik "WSL2 kontrol ediliyor"
$wslFeature = (dism.exe /online /get-features /format:table | Select-String "Microsoft-Windows-Subsystem-Linux\s*\|\s*Enabled")
$vmpFeature = (dism.exe /online /get-features /format:table | Select-String "VirtualMachinePlatform\s*\|\s*Enabled")
if (-not $wslFeature -or -not $vmpFeature) {
    Write-Host "  WSL2 bilesenleri etkinlestiriliyor (yeniden baslatma gerekebilir)..." -ForegroundColor Yellow
    dism.exe /online /enable-feature /featurename:Microsoft-Windows-Subsystem-Linux /all /norestart | Out-Null
    dism.exe /online /enable-feature /featurename:VirtualMachinePlatform /all /norestart | Out-Null
    Write-Host ""
    Write-Host "  Bilgisayarin yeniden baslatilmasi gerekiyor. Yeniden baslattiktan" -ForegroundColor Red
    Write-Host "  sonra bu kurulum dosyasini tekrar calistirin." -ForegroundColor Red
    Read-Host "Devam etmek icin Enter'a basin (yeniden baslatma islemini siz yapin)"
    exit
} else {
    Write-Host "  [OK] WSL2 zaten etkin." -ForegroundColor Green
}

# --- 3. Docker motorunun hazir olmasi --------------------------------------
Baslik "Docker Desktop kontrol ediliyor"
docker info *> $null
if ($LASTEXITCODE -ne 0) {
    Write-Host "  Docker Desktop baslatiliyor, bu birkac dakika surebilir..." -ForegroundColor Yellow
    Start-Process "shell:AppsFolder\Docker.DockerForWindows.Settings" -ErrorAction SilentlyContinue
    $ready = $false
    for ($i = 0; $i -lt 90; $i++) {
        docker info *> $null
        if ($LASTEXITCODE -eq 0) { $ready = $true; break }
        Start-Sleep -Seconds 2
    }
    if (-not $ready) {
        Write-Host ""
        Write-Host "  Docker motoru baslatilamadi. Docker Desktop'i elle acip" -ForegroundColor Red
        Write-Host "  hata varsa cozdukten sonra bu kurulumu tekrar calistirin." -ForegroundColor Red
        exit 1
    }
}
Write-Host "  [OK] Docker calisiyor." -ForegroundColor Green

# --- 4. Veritabani ve migration'lar -----------------------------------------
Baslik "Veritabani hazirlaniyor"
docker compose -f "$root\docker-compose.yml" up -d

$dbReady = $false
for ($i = 0; $i -lt 30; $i++) {
    docker exec parla-oyun-evi-db pg_isready -U parla -d parla_oyun_evi *> $null
    if ($LASTEXITCODE -eq 0) { $dbReady = $true; break }
    Start-Sleep -Seconds 1
}
if (-not $dbReady) {
    Write-Host "  Veritabani hazir olmadi." -ForegroundColor Red
    exit 1
}

docker exec -i parla-oyun-evi-db psql -U parla -d parla_oyun_evi -c "CREATE TABLE IF NOT EXISTS schema_migrations (filename TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())" *> $null

Get-ChildItem "$root\backend\migrations\*.sql" | Sort-Object Name | ForEach-Object {
    $name = $_.Name
    $applied = docker exec parla-oyun-evi-db psql -U parla -d parla_oyun_evi -tAc "SELECT 1 FROM schema_migrations WHERE filename = '$name'"
    if ($applied -ne "1") {
        Write-Host "  -> $name uygulaniyor" -ForegroundColor Cyan
        Get-Content $_.FullName -Raw | docker exec -i parla-oyun-evi-db psql -U parla -d parla_oyun_evi *> $null
        docker exec parla-oyun-evi-db psql -U parla -d parla_oyun_evi -c "INSERT INTO schema_migrations (filename) VALUES ('$name')" *> $null
    }
}
Write-Host "  [OK] Veritabani ve migration'lar hazir." -ForegroundColor Green

# --- 5. Yonetici kullanicisi -------------------------------------------------
Baslik "Yonetici kullanicisi kontrol ediliyor"
$userCount = docker exec parla-oyun-evi-db psql -U parla -d parla_oyun_evi -tAc "SELECT count(*) FROM users"
if ($userCount.Trim() -eq "0") {
    Write-Host "  Hicbir kullanici yok, ilk yonetici hesabi olusturulacak."
    $u = Read-Host "  Yonetici kullanici adi"
    $p = Read-Host "  Yonetici sifresi"
    Push-Location "$root\backend"
    go run ./cmd/seed $u $p
    Pop-Location
} else {
    Write-Host "  [OK] Kullanici(lar) zaten mevcut, atlaniyor." -ForegroundColor Green
}

# --- 6. Masaustu kisayollari --------------------------------------------------
Baslik "Masaustu kisayollari olusturuluyor"
$WshShell = New-Object -ComObject WScript.Shell
$desktop = [Environment]::GetFolderPath("Desktop")

$s1 = $WshShell.CreateShortcut("$desktop\Parla Oyun Evi - Baslat.lnk")
$s1.TargetPath = "$root\Sistemi-Baslat.bat"
$s1.WorkingDirectory = $root
$s1.IconLocation = "shell32.dll,137"
$s1.Save()

$s2 = $WshShell.CreateShortcut("$desktop\Parla Oyun Evi - Durdur.lnk")
$s2.TargetPath = "$root\Sistemi-Durdur.bat"
$s2.WorkingDirectory = $root
$s2.IconLocation = "shell32.dll,131"
$s2.Save()
Write-Host "  [OK] Kisayollar masaustune eklendi." -ForegroundColor Green

# --- 7. Otomatik gunluk yedek -------------------------------------------------
Baslik "Otomatik gunluk yedekleme kuruluyor"
$action = New-ScheduledTaskAction -Execute "powershell.exe" -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$root\backup.ps1`""
$trigger = New-ScheduledTaskTrigger -Daily -At 3am
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -DontStopOnIdleEnd -ExecutionTimeLimit (New-TimeSpan -Minutes 15)
Register-ScheduledTask -TaskName "ParlaOyunEvi-GunlukYedek" -Action $action -Trigger $trigger -Settings $settings -Description "Parla Oyun Evi veritabani gunluk otomatik yedek" -Force | Out-Null
Write-Host "  [OK] Her gece 03:00'te otomatik yedek alinacak." -ForegroundColor Green

# --- Bitis -------------------------------------------------------------------
Write-Host ""
Write-Host "==============================================" -ForegroundColor Green
Write-Host " Kurulum tamamlandi!" -ForegroundColor Green
Write-Host " Sistemi baslatmak icin masaustundeki" -ForegroundColor Green
Write-Host " 'Parla Oyun Evi - Baslat' kisayoluna cift tiklayin." -ForegroundColor Green
Write-Host "==============================================" -ForegroundColor Green
Read-Host "Cikmak icin Enter'a basin"
