@echo off
rem Abre o painel de controle do servidor local InfraView.
start "" powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "%~dp0InfraView.ps1"
