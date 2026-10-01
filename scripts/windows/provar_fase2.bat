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
echo --- 1b. download e carga em paralelo (FTP local servindo os ZIPs reais de historico_zips) %time% >> "%LOG%"
set "SA_ZIPS_HISTORICO=%RAIZ%\..\historico_zips"
if not exist "%SA_ZIPS_HISTORICO%" goto sem_zips
cargo test --release --locked -p sa-app -- --nocapture >> "%LOG%" 2>&1
echo CODIGO_PIPELINE=%errorlevel% >> "%LOG%"
goto compilar
:sem_zips
echo FALTA a pasta historico_zips ao lado de sigtap-aberto >> "%LOG%"
:compilar
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
echo 2. Escolha "Ultimos 6 meses", marque "Apagar os ZIPs" e clique em Baixar agora.
echo    A barra deve encher uma vez so, com "Fazendo download X de 6; carregadas no banco Y de 6".
echo    Quando aparecer "Usar enquanto termina", clique: a barra vai para o rodape, a direita.
echo 3. Digite "desfib" na busca: as sugestoes aparecem sem Enter. Abra 04.06.01.057-9.
echo    Clique no codigo (copia sem pontos), Ctrl+clique (com pontos), clique no nome (copia o nome).
echo 4. Historico: clique numa barra da linha do tempo; o mes deve piscar.
echo 5. O que mudou e Modulos e dados: confira o botao Voltar e o "Ver mais".
echo 6. Modulos e dados: Procurar pasta... abre a janela do Windows; "Como baixar os arquivos a mao".
echo 7. Diminua a janela ate o minimo: nao pode aparecer barra de rolagem horizontal.
echo 8. Feche o programa e confira que so ha dados, dados_webview e o .exe na pasta.
echo 9. Rodape: clique em SIGTAP; o site oficial deve abrir no navegador. Abra Sobre e Sugerir ou relatar (Esc fecha).
echo    Em Sugerir ou relatar, escreva algo e clique em Copiar texto; confira que nao ha dado de paciente no texto.
echo 10. Aba CIDs na esquerda: abra uma letra, uma categoria (ex.: T74) e clique em T74.2: devem aparecer 5 procedimentos, e
echo    clicar de novo na linha do CID NAO pode repetir a lista. Teste o icone de expandir e recolher tudo nas duas abas.
echo 11. Modulos e dados, Baixar do DATASUS: opcoes ja baixadas ficam em cinza. Em Atualizacoes, clique em Verificar agora
echo    (com internet no FTP do DATASUS) e em Procurar nova versao (sem repositorio publico deve dizer que nao ha versao nova).
echo 12. Modulos e dados, Saude dos dados: Verificar o banco e Verificacao completa devem dizer "integro".
echo    NAO clique em Recriar o banco na pasta de dados de verdade sem ter os ZIPs guardados.
explorer "%PROVA%\portatil"
pause
exit /b 0
