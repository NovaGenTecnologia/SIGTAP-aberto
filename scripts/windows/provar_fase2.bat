@echo off
rem Provas da Fase 2 no Windows (10 a 25 minutos). Resultado: provar_fase2.log.
rem Precisa do banco completo da Fase 1 em saida\prova_fase1\sigtap.db (rode provar_fase1.bat antes,
rem se ele nao existir). Grava em saida\prova_fase2\.
setlocal
chcp 65001 >nul
set "LOG=%~dp0provar_fase2.log"
cd /d "%~dp0..\.."
set "RAIZ=%CD%"
call "%~dp0sincronizar_git.bat"
set "PROVA=%RAIZ%\saida\prova_fase2"
if exist "%PROVA%" rmdir /s /q "%PROVA%"
mkdir "%PROVA%"
echo === provar_fase2.bat %date% %time% > "%LOG%"
git log --oneline -1 >> "%LOG%" 2>&1
cargo --version >> "%LOG%" 2>&1
echo --- 1. testes do workspace %time% >> "%LOG%"
cargo test --workspace --locked >> "%LOG%" 2>&1
echo CODIGO_TESTES=%errorlevel% >> "%LOG%"
echo --- 2. compilacao do programa e da linha de comando %time% >> "%LOG%"
cargo build --release --locked -p sa-cli -p sa-app >> "%LOG%" 2>&1
echo CODIGO_COMPILAR=%errorlevel% >> "%LOG%"
set "CLI=%RAIZ%\target\release\sigtap-aberto-cli.exe"
set "APP=%RAIZ%\target\release\sigtap-aberto.exe"
echo --- 3. consultas contra o banco completo (copia) %time% >> "%LOG%"
if not exist "%RAIZ%\saida\prova_fase1\sigtap.db" (
  echo FALTA saida\prova_fase1\sigtap.db: rode provar_fase1.bat antes >> "%LOG%"
  goto territorio
)
copy /y "%RAIZ%\saida\prova_fase1\sigtap.db" "%PROVA%\consulta.db" >nul
set "SA_SIGTAP_BANCO_CONSULTA=%PROVA%\consulta.db"
cargo test --release --locked -p sa-query --test consulta_real -- --nocapture --test-threads=2 >> "%LOG%" 2>&1
echo CODIGO_CONSULTAS=%errorlevel% >> "%LOG%"
set "SA_SIGTAP_BANCO_PRONTO=%PROVA%\consulta.db"
cargo test --release --locked -p sa-packs --test sigtap_real dominios -- --nocapture >> "%LOG%" 2>&1
echo CODIGO_DOMINIOS=%errorlevel% >> "%LOG%"
echo --- 4. tempo de resposta da linha de comando (inclui abrir o banco) %time% >> "%LOG%"
powershell -NoProfile -Command "foreach($a in @('buscar desfibrilador','ficha 04.06.01.057-9','historico 0406010579','arvore 040601')){ $p=$a.Split(' '); $t=Measure-Command { & '%CLI%' $p[0] $p[1] --banco '%PROVA%\consulta.db' | Out-Null }; '{0}: {1:N0} ms' -f $a,$t.TotalMilliseconds }" >> "%LOG%" 2>&1
:territorio
echo --- 5. territorio: download real (IBGE e Ministerio da Saude) %time% >> "%LOG%"
"%CLI%" territorio --banco "%PROVA%\sigtap.db" >> "%LOG%" 2>&1
echo CODIGO_TERRITORIO=%errorlevel% >> "%LOG%"
echo --- 6. pasta portatil para teste manual %time% >> "%LOG%"
mkdir "%PROVA%\portatil"
copy /y "%APP%" "%PROVA%\portatil\" >nul
dir "%PROVA%\portatil" >> "%LOG%" 2>&1
echo === FIM %time% >> "%LOG%"
echo.
echo Pronto. Resultado em: %LOG%
echo.
echo Agora o teste manual: vai abrir a pasta %PROVA%\portatil com o programa sozinho.
echo 1. Abra o sigtap-aberto.exe. Deve aparecer a tela de primeira execucao.
echo 2. Clique em Baixar agora (sem marcar o historico). Espere terminar.
echo 3. Busque "desfibrilador", abra 04.06.01.057-9, veja as abas e o Historico.
echo 4. Feche o programa e confira que so ha dados, dados_webview e o .exe na pasta.
explorer "%PROVA%\portatil"
pause
exit /b 0
