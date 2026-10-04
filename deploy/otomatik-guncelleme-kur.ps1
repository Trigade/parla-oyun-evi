# Parla Oyun Evi - otomatik guncellemeyi kurar (is bilgisayarinda bir kez calistirilir)
#
#   - Her gece 03:30'da guncelleme kontrolu yapan bir Gorev Zamanlayici gorevi
#     olusturur (yeni surum yoksa hicbir sey yapmaz).
#   - Masaustune "Parla Oyun Evi - Guncelle" kisayolu koyar (elle guncelleme).
#
# Kullanim:  .\deploy\otomatik-guncelleme-kur.ps1

$ErrorActionPreference = "Stop"
$kok = Split-Path -Parent $PSScriptRoot
$script = Join-Path $kok "deploy\guncelle.ps1"
if (-not (Test-Path $script)) { Write-Host "guncelle.ps1 bulunamadi: $script" -ForegroundColor Red; exit 1 }

Write-Host "== Gece guncelleme gorevi kuruluyor (03:30) ==" -ForegroundColor Cyan
$action = New-ScheduledTaskAction -Execute "powershell.exe" `
    -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$script`"" -WorkingDirectory $kok
$trigger = New-ScheduledTaskTrigger -Daily -At 3:30am
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -DontStopOnIdleEnd `
    -ExecutionTimeLimit (New-TimeSpan -Minutes 30)
Register-ScheduledTask -TaskName "ParlaOyunEvi-OtomatikGuncelleme" -Action $action -Trigger $trigger `
    -Settings $settings -Description "Parla Oyun Evi: yeni surum varsa gece otomatik guncelleme" -Force | Out-Null
Write-Host "  [OK] Her gece 03:30'da kontrol edilecek." -ForegroundColor Green

Write-Host "== Masaustu kisayolu olusturuluyor ==" -ForegroundColor Cyan
$WshShell = New-Object -ComObject WScript.Shell
$desktop = [Environment]::GetFolderPath("Desktop")
$kisayol = $WshShell.CreateShortcut("$desktop\Parla Oyun Evi - Guncelle.lnk")
$kisayol.TargetPath = Join-Path $kok "deploy\Guncelle.bat"
$kisayol.WorkingDirectory = $kok
$kisayol.IconLocation = "shell32.dll,46"
$kisayol.Save()
Write-Host "  [OK] Masaustune 'Parla Oyun Evi - Guncelle' eklendi." -ForegroundColor Green

Write-Host ""
Write-Host "Kurulum tamam. Guncelleme kayitlari: deploy\guncelleme.log" -ForegroundColor Green
