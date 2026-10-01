@echo off
rem Roda todos os testes do SIGTAP Aberto. Resultado: testar.log nesta pasta.
setlocal
chcp 65001 >nul
set "LOG=%~dp0testar.log"
cd /d "%~dp0..\.."
echo === testar.bat %date% %time% > "%LOG%"
cargo --version >> "%LOG%" 2>&1
rustc --version >> "%LOG%" 2>&1
echo --- cargo test --workspace --locked >> "%LOG%"
cargo test --workspace --locked >> "%LOG%" 2>&1
set "RC=%errorlevel%"
echo CODIGO_SAIDA=%RC% >> "%LOG%"
echo === FIM >> "%LOG%"
if "%RC%"=="0" (echo Testes OK.) else (echo Testes FALHARAM: veja %LOG%)
pause
exit /b %RC%
