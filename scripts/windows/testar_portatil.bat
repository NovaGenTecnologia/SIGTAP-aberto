@echo off
rem Prova de portabilidade: copia o .exe para uma pasta vazia, abre o programa por 15 s,
rem fecha e verifica se algo foi gravado fora da pasta. Resultado: testar_portatil.log.
rem Rode compilar.bat antes.
setlocal
chcp 65001 >nul
set "LOG=%~dp0testar_portatil.log"
cd /d "%~dp0..\.."
set "RAIZ=%CD%"
set "EXE=%RAIZ%\saida\SIGTAP-Aberto\sigtap-aberto.exe"
set "TESTE=%RAIZ%\saida\teste_portatil"
echo === testar_portatil.bat %date% %time% > "%LOG%"
if not exist "%EXE%" (echo Rode compilar.bat antes. >> "%LOG%" & echo Rode compilar.bat antes. & pause & exit /b 1)
if exist "%TESTE%" rmdir /s /q "%TESTE%"
mkdir "%TESTE%"
copy /y "%EXE%" "%TESTE%\" >> "%LOG%" 2>&1
echo --- pasta antes >> "%LOG%"
dir /s /b "%TESTE%" >> "%LOG%" 2>&1
echo --- pastas do perfil antes >> "%LOG%"
if exist "%LOCALAPPDATA%\br.sigtap-aberto.app" (echo EXISTE %LOCALAPPDATA%\br.sigtap-aberto.app >> "%LOG%") else (echo nao existe LOCALAPPDATA\br.sigtap-aberto.app >> "%LOG%")
if exist "%APPDATA%\br.sigtap-aberto.app" (echo EXISTE %APPDATA%\br.sigtap-aberto.app >> "%LOG%") else (echo nao existe APPDATA\br.sigtap-aberto.app >> "%LOG%")
powershell -NoProfile -Command "(Get-Date).ToString('o')" > "%TESTE%\..\inicio.txt"
echo Abrindo o SIGTAP Aberto por 15 segundos...
start "" "%TESTE%\sigtap-aberto.exe"
timeout /t 15 /nobreak >nul
tasklist /fi "imagename eq sigtap-aberto.exe" >> "%LOG%" 2>&1
taskkill /im sigtap-aberto.exe /f >> "%LOG%" 2>&1
timeout /t 3 /nobreak >nul
echo --- pasta depois >> "%LOG%"
dir /s /b "%TESTE%" >> "%LOG%" 2>&1
echo --- E12: o que o programa criou ao lado do .exe >> "%LOG%"
if exist "%TESTE%\dados_webview" (echo OK: dados_webview criada ao lado do .exe >> "%LOG%") else (echo FALHA: dados_webview nao foi criada ao lado do .exe >> "%LOG%")
if exist "%TESTE%\dados" (echo OK: dados criada ao lado do .exe >> "%LOG%") else (echo AVISO: dados nao existe ainda; normal se a carga inicial nao foi iniciada >> "%LOG%")
if exist "%TESTE%\dados\sigtap.db" (echo OK: sigtap.db em dados >> "%LOG%") else (echo primeira execucao: sem sigtap.db, a tela de carga inicial deve ter aparecido >> "%LOG%")
echo --- pastas do perfil depois >> "%LOG%"
if exist "%LOCALAPPDATA%\br.sigtap-aberto.app" (echo EXISTE %LOCALAPPDATA%\br.sigtap-aberto.app >> "%LOG%") else (echo nao existe LOCALAPPDATA\br.sigtap-aberto.app >> "%LOG%")
if exist "%APPDATA%\br.sigtap-aberto.app" (echo EXISTE %APPDATA%\br.sigtap-aberto.app >> "%LOG%") else (echo nao existe APPDATA\br.sigtap-aberto.app >> "%LOG%")
echo --- arquivos novos no perfil com "sigtap" no caminho (vazio = nada fora da pasta) >> "%LOG%"
powershell -NoProfile -Command "$i=[datetime](Get-Content '%TESTE%\..\inicio.txt'); Get-ChildItem $env:LOCALAPPDATA,$env:APPDATA,$env:TEMP -Recurse -File -ErrorAction SilentlyContinue | Where-Object { $_.LastWriteTime -gt $i -and $_.FullName -match 'sigtap' } | ForEach-Object { $_.FullName }" >> "%LOG%" 2>&1
echo === FIM >> "%LOG%"
echo Pronto. Resultado em: %LOG%
pause
exit /b 0
