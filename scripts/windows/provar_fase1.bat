@echo off
rem Provas da Fase 1 no Windows (demora 20 a 40 minutos). Resultado: provar_fase1.log.
rem Usa os ZIPs de ..\historico_zips (fora do repositorio) e grava em saida\prova_fase1\.
setlocal
set "LOG=%~dp0provar_fase1.log"
cd /d "%~dp0..\.."
set "RAIZ=%CD%"
call "%~dp0sincronizar_git.bat"
set "SA_SIGTAP_ZIPS=%RAIZ%\..\historico_zips"
set "PROVA=%RAIZ%\saida\prova_fase1"
if exist "%PROVA%" rmdir /s /q "%PROVA%"
mkdir "%PROVA%"
echo === provar_fase1.bat %date% %time% > "%LOG%"
git log --oneline -1 >> "%LOG%" 2>&1
cargo --version >> "%LOG%" 2>&1
echo --- 1. testes do workspace %time% >> "%LOG%"
cargo test --workspace --locked >> "%LOG%" 2>&1
echo CODIGO_TESTES=%errorlevel% >> "%LOG%"
echo --- 2. leitura dos ZIPs reais %time% >> "%LOG%"
cargo test --release --locked -p sa-sources --test zips_reais -- --nocapture >> "%LOG%" 2>&1
echo CODIGO_LEITURA=%errorlevel% >> "%LOG%"
echo --- 3. carga completa, reconstrucao, retroativo, republicacao %time% >> "%LOG%"
set "SA_SIGTAP_BANCO=%PROVA%\sigtap.db"
cargo test --release --locked -p sa-packs --test sigtap_real -- --nocapture >> "%LOG%" 2>&1
echo CODIGO_REAL=%errorlevel% >> "%LOG%"
echo --- 4. chaves naturais %time% >> "%LOG%"
set "SA_SIGTAP_BANCO_PRONTO=%PROVA%\sigtap.db"
cargo test --release --locked -p sa-packs --test sigtap_real chaves -- --nocapture >> "%LOG%" 2>&1
echo CODIGO_CHAVES=%errorlevel% >> "%LOG%"
echo --- 5. linha de comando: FTP oficial, download, carga e conferencia %time% >> "%LOG%"
cargo build --release --locked -p sa-cli >> "%LOG%" 2>&1
set "CLI=%RAIZ%\target\release\sigtap-aberto-cli.exe"
"%CLI%" listar-ftp > "%PROVA%\listar_ftp.txt" 2>&1
echo CODIGO_LISTAR=%errorlevel% >> "%LOG%"
powershell -NoProfile -Command "Get-Content '%PROVA%\listar_ftp.txt' -Tail 3" >> "%LOG%" 2>&1
"%CLI%" baixar --ultima --zips "%PROVA%\zips" >> "%LOG%" 2>&1
echo CODIGO_BAIXAR=%errorlevel% >> "%LOG%"
"%CLI%" carregar "%PROVA%\zips" --banco "%PROVA%\cli.db" >> "%LOG%" 2>&1
echo CODIGO_CARREGAR=%errorlevel% >> "%LOG%"
"%CLI%" conferir "%PROVA%\zips" --banco "%PROVA%\cli.db" >> "%LOG%" 2>&1
echo CODIGO_CONFERIR=%errorlevel% >> "%LOG%"
"%CLI%" competencias --banco "%PROVA%\sigtap.db" > "%PROVA%\competencias.txt" 2>&1
powershell -NoProfile -Command "Get-Content '%PROVA%\competencias.txt' -Tail 2" >> "%LOG%" 2>&1
dir "%PROVA%" >> "%LOG%" 2>&1
echo === FIM %time% >> "%LOG%"
echo Pronto. Resultado em: %LOG%
pause
exit /b 0
