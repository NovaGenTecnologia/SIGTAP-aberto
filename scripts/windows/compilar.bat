@echo off
rem Compila o SIGTAP Aberto para Windows: confere o ambiente, roda os testes, compila e empacota.
rem Todo o trabalho fica em compilar.ps1 (nesta pasta). Opcoes: -Atualizar  -SemTestes  -SemPausa
rem Resultado: saida\SIGTAP-Aberto\ e saida\SIGTAP-Aberto-v<versao>-windows-x64.zip; registro em compilar.log.
setlocal
chcp 65001 >nul
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0compilar.ps1" %*
exit /b %errorlevel%
