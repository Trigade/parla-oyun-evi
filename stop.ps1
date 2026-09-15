# Parla Oyun Evi - tum sistemi durdurur
# Kullanim: .\stop.ps1

$root = $PSScriptRoot

function Stop-PortProcess($port, $label) {
    $conns = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue
    if (-not $conns) {
        Write-Host "$label (port $port) zaten calismiyor." -ForegroundColor Yellow
        return
    }
    $conns | Select-Object -ExpandProperty OwningProcess -Unique | ForEach-Object {
        $procId = $_
        $proc = Get-Process -Id $procId -ErrorAction SilentlyContinue
        if ($proc) {
            Write-Host "$label durduruluyor (PID $procId, $($proc.ProcessName)) ..." -ForegroundColor Cyan
            Stop-Process -Id $procId -Force
        }
    }
}

Write-Host "== Backend durduruluyor (port 8080) ==" -ForegroundColor Cyan
Stop-PortProcess -port 8080 -label "Backend"

Write-Host "== Frontend durduruluyor (port 5173) ==" -ForegroundColor Cyan
Stop-PortProcess -port 5173 -label "Frontend"

Write-Host "== Postgres durduruluyor (docker compose down) ==" -ForegroundColor Cyan
docker compose -f "$root\docker-compose.yml" down

Write-Host "== Tamam. Sistem durduruldu. ==" -ForegroundColor Green
