@echo off
rem Abre o painel de controle do servidor local InfraView (sem janela de console).
start "" "%SystemRoot%\System32\wscript.exe" "%~dp0InfraView.vbs"
