@echo off
rem Monta ou atualiza o historico git deste repositorio a partir do pacote enviado pelo
rem ambiente de desenvolvimento (_sincronizacao\repo.bundle). Nao altera arquivos de codigo:
rem so posiciona o git no ultimo commit e restaura a pasta .github, que o canal de copia
rem nao consegue gravar. Resultado: sincronizar_git.log nesta pasta.
setlocal
chcp 65001 >nul
set "LOG=%~dp0sincronizar_git.log"
cd /d "%~dp0..\.."
echo === sincronizar_git.bat %date% %time% > "%LOG%"
if not exist "_sincronizacao\repo.bundle" (echo Sem pacote _sincronizacao\repo.bundle; nada a fazer. >> "%LOG%" & exit /b 0)
if not exist ".git" git init -b main >> "%LOG%" 2>&1
git bundle verify "_sincronizacao\repo.bundle" >> "%LOG%" 2>&1
if errorlevel 1 (echo Pacote invalido: peca um novo ao ambiente de desenvolvimento. >> "%LOG%" & exit /b 1)
git fetch --force "_sincronizacao\repo.bundle" main:refs/remotes/nuvem/main >> "%LOG%" 2>&1
git reset --mixed nuvem/main >> "%LOG%" 2>&1
rem O canal de copia nao grava .github e recodifica imagens PNG (mesmos pixels, bytes diferentes):
rem restaura esses arquivos exatamente como estao no commit.
git checkout -- .github "*.png" "*.ico" >> "%LOG%" 2>&1
git log --oneline -3 >> "%LOG%" 2>&1
echo --- git status (vazio = igual ao commit) >> "%LOG%"
git status --short >> "%LOG%" 2>&1
echo === FIM >> "%LOG%"
exit /b 0
