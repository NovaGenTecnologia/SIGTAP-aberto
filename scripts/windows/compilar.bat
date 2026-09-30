@echo off
rem Compila o SIGTAP Aberto (release) e monta a pasta portatil em saida\SIGTAP-Aberto\.
rem Resultado: compilar.log nesta pasta.
setlocal
set "LOG=%~dp0compilar.log"
cd /d "%~dp0..\.."
set "RAIZ=%CD%"
echo === compilar.bat %date% %time% > "%LOG%"
cargo --version >> "%LOG%" 2>&1
echo --- cargo build --release -p sa-app -p sa-cli --locked >> "%LOG%"
cargo build --release -p sa-app -p sa-cli --locked >> "%LOG%" 2>&1
set "RC=%errorlevel%"
if not "%RC%"=="0" goto fim
if not exist "%RAIZ%\saida\SIGTAP-Aberto" mkdir "%RAIZ%\saida\SIGTAP-Aberto"
copy /y "%RAIZ%\target\release\sigtap-aberto.exe" "%RAIZ%\saida\SIGTAP-Aberto\" >> "%LOG%" 2>&1
copy /y "%RAIZ%\target\release\sigtap-aberto-cli.exe" "%RAIZ%\saida\SIGTAP-Aberto\" >> "%LOG%" 2>&1
echo --- SHA-256 >> "%LOG%"
certutil -hashfile "%RAIZ%\saida\SIGTAP-Aberto\sigtap-aberto.exe" SHA256 >> "%LOG%" 2>&1
dir "%RAIZ%\saida\SIGTAP-Aberto" >> "%LOG%" 2>&1
:fim
echo CODIGO_SAIDA=%RC% >> "%LOG%"
echo === FIM >> "%LOG%"
if "%RC%"=="0" (echo Compilado: saida\SIGTAP-Aberto\sigtap-aberto.exe) else (echo Compilacao FALHOU: veja %LOG%)
pause
exit /b %RC%
