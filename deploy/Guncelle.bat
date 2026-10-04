@echo off
title Parla Oyun Evi - Guncelle
echo Guncelleme kontrol ediliyor. Sistem kisa sure (yaklasik 1 dakika) kapanabilir.
echo.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0guncelle.ps1" -Zorla
echo.
pause
