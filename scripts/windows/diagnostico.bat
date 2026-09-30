@echo off
rem Diagnostico do ambiente de compilacao do SIGTAP Aberto. So LE informacoes.
rem Resultado: diagnostico.log nesta pasta.
setlocal
set "LOG=%~dp0diagnostico.log"
echo === Diagnostico SIGTAP Aberto %date% %time% > "%LOG%"
ver >> "%LOG%"
call :versao cargo
call :versao rustc
call :versao rustup
call :versao git
echo --- rustup toolchain list >> "%LOG%"
rustup toolchain list >> "%LOG%" 2>&1
echo --- Build Tools C++ (vswhere) >> "%LOG%"
set "VSWHERE=%ProgramFiles(x86)%\Microsoft Visual Studio\Installer\vswhere.exe"
if not exist "%VSWHERE%" echo vswhere nao encontrado: instale os Build Tools do Visual Studio >> "%LOG%"
if exist "%VSWHERE%" "%VSWHERE%" -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property displayName >> "%LOG%" 2>&1
if exist "%VSWHERE%" "%VSWHERE%" -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationVersion >> "%LOG%" 2>&1
echo --- WebView2 Runtime (pv = versao instalada) >> "%LOG%"
reg query "HKLM\SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}" /v pv >> "%LOG%" 2>&1
reg query "HKLM\SOFTWARE\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}" /v pv >> "%LOG%" 2>&1
reg query "HKCU\Software\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}" /v pv >> "%LOG%" 2>&1
echo === FIM >> "%LOG%"
echo Pronto. Resultado em: %LOG%
pause
exit /b 0

:versao
echo --- %1 >> "%LOG%"
where %1 >> "%LOG%" 2>&1
%1 --version >> "%LOG%" 2>&1
exit /b 0
