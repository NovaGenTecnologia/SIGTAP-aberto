@echo off
rem Provas da Fase 3 no Windows (10 a 20 minutos). Resultado: provar_fase3.log.
rem Baixa do FTP do DATASUS o CNES de MS (cerca de 5 MB) para saida\prova_fase3\dados.
rem Para outra UF: provar_fase3.bat SP
setlocal
chcp 65001 >nul
set "UF=%~1"
if "%UF%"=="" set "UF=MS"
set "LOG=%~dp0provar_fase3.log"
cd /d "%~dp0..\.."
set "RAIZ=%CD%"
set "PROVA=%RAIZ%\saida\prova_fase3"
if not exist "%PROVA%" mkdir "%PROVA%"
if not exist "%PROVA%\dados" mkdir "%PROVA%\dados"
echo === provar_fase3.bat %date% %time% UF=%UF% > "%LOG%"
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
set "BANCO=%PROVA%\dados\sigtap.db"
echo --- 3. banco do SIGTAP para a prova %time% >> "%LOG%"
if exist "%BANCO%" goto tem_banco
if exist "%RAIZ%\saida\SIGTAP-Aberto\dados\sigtap.db" (
  copy /y "%RAIZ%\saida\SIGTAP-Aberto\dados\sigtap.db" "%BANCO%" >nul
  copy /y "%RAIZ%\saida\SIGTAP-Aberto\dados\territorio.db" "%PROVA%\dados\" >nul
  echo copiado de saida\SIGTAP-Aberto\dados >> "%LOG%"
  goto tem_banco
)
echo FALTA um banco do SIGTAP: abra o programa uma vez em saida\SIGTAP-Aberto (compilar.bat) e rode de novo >> "%LOG%"
goto fim
:tem_banco
echo --- 4. CNES de %UF%: competencias no servidor e download real %time% >> "%LOG%"
"%CLI%" cnes-competencias %UF% --banco "%BANCO%" > "%PROVA%\competencias.json" 2>> "%LOG%"
echo CODIGO_COMPETENCIAS=%errorlevel% >> "%LOG%"
powershell -NoProfile -Command "$t=Measure-Command { & '%CLI%' cnes-baixar %UF% --banco '%BANCO%' 2>$null | Out-File -Append -Encoding utf8 '%LOG%' }; 'download e carga: {0:N1} s' -f $t.TotalSeconds" >> "%LOG%" 2>&1
"%CLI%" cnes-situacao --banco "%BANCO%" > "%PROVA%\situacao.json" 2>> "%LOG%"
echo CODIGO_SITUACAO=%errorlevel% >> "%LOG%"
echo --- 5. privacidade: nenhum arquivo de profissionais guardado sem unidade escolhida %time% >> "%LOG%"
dir /b "%PROVA%\dados\cnes\arquivos\%UF%" >> "%LOG%" 2>&1
if exist "%PROVA%\dados\cnes\arquivos\%UF%\PF%UF%*.dbc" (echo FALHA: arquivo PF guardado >> "%LOG%") else (echo OK: sem arquivo PF >> "%LOG%")
echo --- 6. tempo de resposta (inclui abrir os bancos) %time% >> "%LOG%"
powershell -NoProfile -Command "foreach($a in @('cnes-buscar %UF% hospital','ficha 0406010935','buscar desfibrilador')){ $p=$a.Split(' '); $t=Measure-Command { & '%CLI%' @p --banco '%BANCO%' | Out-Null }; '{0}: {1:N0} ms' -f $a,$t.TotalMilliseconds }" >> "%LOG%" 2>&1
echo --- 7. favoritos, anotacao e exportacao %time% >> "%LOG%"
"%CLI%" favorito 0406010935 sim --banco "%BANCO%" >> "%LOG%" 2>&1
"%CLI%" anotar 0406010935 prova da fase 3 --banco "%BANCO%" >> "%LOG%" 2>&1
"%CLI%" marcados --banco "%BANCO%" >> "%LOG%" 2>&1
echo {"titulo":"Prova","abas":[{"nome":"A","colunas":["Codigo","Nome"],"linhas":[["0406010935","Teste"]]}]} | "%CLI%" exportar --saida "%PROVA%\prova.xlsx" --banco "%BANCO%" >> "%LOG%" 2>&1
echo CODIGO_EXPORTAR=%errorlevel% >> "%LOG%"
echo --- 8. pasta portatil para o teste manual %time% >> "%LOG%"
copy /y "%APP%" "%PROVA%\" >nul
dir "%PROVA%" >> "%LOG%" 2>&1
:fim
echo === FIM %time% >> "%LOG%"
echo.
echo Pronto. Resultado em: %LOG%
echo.
echo Agora o teste manual: vai abrir a pasta %PROVA% com o programa e os dados da prova.
echo  1. Abra o sigtap-aberto.exe. Deve abrir direto na consulta (sem a tela de carga inicial).
echo  2. Clique em Minha unidade. Procure o seu estabelecimento pelo nome ou pelo CNES e clique em "E esta".
echo     Ao lado da competencia, no alto, deve aparecer "CNES %UF% mm/aaaa".
echo  3. Confira habilitacoes, servicos, leitos e equipamentos com o site cnes.datasus.gov.br.
echo  4. Aba Profissionais: clique em "Baixar os profissionais". Ao terminar, confira os CBO.
echo     Depois confira que NAO ha arquivo PF%UF%*.dbc em dados\cnes\arquivos\%UF%.
echo  5. Abra um procedimento que a sua unidade faz e um que nao faz. Leia o quadro "Apta / Nao apta".
echo     Clique nos numeros de "Quem faz na rede" e confira a lista.
echo  6. Clique em Favoritar e em Anotar. Abra a aba Favoritos, a esquerda.
echo  7. Clique em Exportar ficha: deve abrir "Salvar como". Salve em .xlsx e abra no Excel; repita em .csv.
echo  8. Modulos e dados, CNES por UF: confira a linha da UF; teste "atualizar".
echo  9. Diminua a janela ate o minimo: nao pode aparecer barra de rolagem horizontal.
echo 10. Feche o programa. Na pasta so pode haver o .exe, dados, dados_webview e os arquivos da prova.
echo     NAO escreva dados de paciente nas anotacoes.
explorer "%PROVA%"
pause
exit /b 0
