<#
  SIGTAP Aberto: compilação para Windows.

  Gera, numa pasta "saida" ao lado do repositório:
    saida\SIGTAP-Aberto\                          programa pronto para usar (sigtap-aberto.exe e a linha de comando)
    saida\SIGTAP-Aberto-v<versão>-windows-x64.zip  o mesmo pacote que o lançamento do GitHub publica
    saida\SIGTAP-Aberto-v<versão>-windows-x64.zip.sha256

  Uso (dois cliques em compilar.bat, ou no terminal):
    compilar.bat               confere o ambiente, roda os testes, compila e empacota
    compilar.bat -Atualizar    antes, traz do GitHub a versão mais nova (só se a pasta não tiver alterações)
    compilar.bat -SemTestes    pula os testes (mais rápido; não serve como prova)
    compilar.bat -SemPausa     não espera Enter no fim (para uso em outros scripts)

  Nunca apaga nada fora de saida\pacote (pasta temporária deste script). A pasta saida\SIGTAP-Aberto
  pode ter dados\ de quem usou o programa por ali: este script só substitui os executáveis e os textos.
  Registro completo: compilar.log, nesta pasta.
#>
[CmdletBinding()]
param([switch]$Atualizar, [switch]$SemTestes, [switch]$SemPausa)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version 2.0
try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch { }

$Raiz  = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$Log   = Join-Path $PSScriptRoot "compilar.log"
$Saida = Join-Path $Raiz "saida"
$Inicio = Get-Date
$NoWindows = ($env:OS -eq "Windows_NT")
$Etapas = 6
$script:Avisos = New-Object System.Collections.Generic.List[string]

Set-Content -Path $Log -Value "=== compilar.ps1 $($Inicio.ToString('yyyy-MM-dd HH:mm:ss'))" -Encoding UTF8

function Gravar([string]$texto) { Add-Content -Path $Log -Value $texto -Encoding UTF8 }
function Dizer([string]$texto, [string]$cor = "Gray") { Write-Host $texto -ForegroundColor $cor; Gravar $texto }
function Etapa([int]$n, [string]$texto) { Dizer ""; Dizer "[$n/$Etapas] $texto" "Cyan" }
function Ok([string]$texto) { Dizer "      ok: $texto" "Green" }
function Avisar([string]$texto) { Dizer "      atenção: $texto" "Yellow"; $script:Avisos.Add($texto) }
function Pausar { if (-not $SemPausa) { Write-Host ""; Read-Host "Aperte Enter para fechar" | Out-Null } }
function Falhar([string]$oQue, [string]$comoResolver) {
  Dizer ""
  Dizer "NÃO COMPILOU: $oQue" "Red"
  if ($comoResolver) { Dizer "O que fazer: $comoResolver" "Yellow" }
  Dizer "Registro completo: $Log"
  Pausar
  exit 1
}
# Roda um comando externo mostrando e gravando a saída; devolve o código de saída.
# Passa pelo cmd para juntar a saída de erro (o cargo escreve o progresso nela) sem o PowerShell 5 tratá-la como erro.
function Rodar([string]$linha) {
  Gravar "--- $linha"
  $anterior = $ErrorActionPreference; $ErrorActionPreference = "Continue"
  & cmd.exe /d /c "$linha 2>&1" | ForEach-Object { $t = "$_"; Write-Host "      $t"; Gravar $t }
  $codigo = $LASTEXITCODE
  $ErrorActionPreference = $anterior
  Gravar "--- código de saída: $codigo"
  return $codigo
}
# Executa e devolve só a primeira linha da saída (ou $null), sem mostrar.
function Ler([string]$linha) {
  $anterior = $ErrorActionPreference; $ErrorActionPreference = "Continue"
  $r = & cmd.exe /d /c "$linha 2>nul"
  $ErrorActionPreference = $anterior
  if ($LASTEXITCODE -ne 0 -or -not $r) { return $null }
  return (@($r)[0]).ToString().Trim()
}
# Executa e devolve todas as linhas não vazias da saída.
function LerTudo([string]$linha) {
  $anterior = $ErrorActionPreference; $ErrorActionPreference = "Continue"
  $r = @(& cmd.exe /d /c "$linha 2>nul" | Where-Object { "$_".Trim() })
  $ErrorActionPreference = $anterior
  return ,$r
}
function Tem([string]$programa) { return [bool](Get-Command $programa -ErrorAction SilentlyContinue) }
function Tamanho([long]$bytes) { if ($bytes -ge 1MB) { "{0:N1} MB" -f ($bytes / 1MB) } else { "{0:N0} KB" -f ($bytes / 1KB) } }

Dizer "SIGTAP Aberto: compilação para Windows" "White"
Dizer "Repositório: $Raiz"
if (-not $NoWindows) { Falhar "este script é para Windows." "No Linux, use: cargo build --release -p sa-app" }
Set-Location $Raiz

# ---------------------------------------------------------------- 1. ambiente
Etapa 1 "Conferindo o ambiente"
if (-not (Test-Path (Join-Path $Raiz "Cargo.toml"))) { Falhar "não achei o Cargo.toml em $Raiz." "Rode o script de dentro da pasta scripts\windows do repositório." }
if (-not (Tem "cargo") -or -not (Tem "rustup")) {
  Falhar "o Rust não está instalado (ou não está no PATH)." "Instale pelo https://rustup.rs (opção padrão), feche este terminal e abra de novo."
}
Ok (Ler "cargo --version")
$vswhere = Join-Path ${env:ProgramFiles(x86)} "Microsoft Visual Studio\Installer\vswhere.exe"
$vc = $null
if (Test-Path $vswhere) { $vc = Ler "`"$vswhere`" -latest -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property displayName" }
if (-not $vc) {
  Falhar "faltam as ferramentas de C++ da Microsoft (Build Tools do Visual Studio)." "Instale os Build Tools do Visual Studio e marque 'Desenvolvimento para desktop com C++'. Depois rode de novo."
}
Ok "ferramentas C++: $vc"
$wv = $null
foreach ($chave in @("HKLM:\SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}",
                     "HKLM:\SOFTWARE\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}",
                     "HKCU:\Software\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}")) {
  if (-not $wv) { try { $wv = (Get-ItemProperty -Path $chave -Name pv -ErrorAction Stop).pv } catch { } }
}
if ($wv) { Ok "WebView2 $wv" } else { Avisar "WebView2 Runtime não encontrado. A compilação funciona, mas o programa precisa dele para abrir (já vem no Windows 11)." }
$disco = Get-PSDrive -Name ($Raiz.Substring(0, 1)) -ErrorAction SilentlyContinue
if ($disco -and $disco.Free -lt 5GB) { Avisar "só $(Tamanho $disco.Free) livres no disco $($disco.Name):. A primeira compilação usa uns 4 GB em target\." }
$TemGit = (Tem "git") -and (Test-Path (Join-Path $Raiz ".git"))
if (-not $TemGit) { Avisar "sem git nesta pasta: vou compilar o que está aqui, sem registrar de qual versão veio." }

# ---------------------------------------------------------------- 2. versão do código
Etapa 2 "Conferindo a versão do código"
$Commit = "?"
if ($TemGit) {
  $remoto = Ler "git remote get-url origin"
  if ($remoto) {
    $env:GIT_TERMINAL_PROMPT = "0"
    if ((Rodar "git fetch --quiet origin") -ne 0) { Avisar "não consegui consultar o GitHub (sem internet?). Compilando o que está na pasta." }
  } else { Avisar "esta pasta não tem o GitHub configurado como origem (git remote add origin ...)." }
  $alteracoes = LerTudo "git status --porcelain"
  $atras = 0
  if ($remoto) { $n = Ler "git rev-list --count HEAD..origin/main"; if ($n) { $atras = [int]$n } }
  if ($Atualizar) {
    if ($alteracoes.Count -gt 0) {
      Falhar "pedi para atualizar, mas a pasta tem $($alteracoes.Count) arquivo(s) alterado(s) e eu não sobrescrevo trabalho seu." "Veja com 'git status'. Guarde com 'git stash' (ou registre com commit) e rode de novo."
    }
    if ($atras -gt 0) {
      if ((Rodar "git pull --ff-only origin main") -ne 0) { Falhar "não consegui trazer a versão do GitHub." "Veja o registro; se o histórico divergiu, peça ajuda antes de forçar qualquer coisa." }
      Ok "atualizado do GitHub ($atras alteração(ões) nova(s))"
      $alteracoes = @(); $atras = 0
    } else { Ok "já está na versão mais nova do GitHub" }
  } elseif ($atras -gt 0) {
    Avisar "o GitHub tem $atras alteração(ões) que esta pasta ainda não tem. Para incluí-las: compilar.bat -Atualizar"
  }
  $Commit = Ler "git rev-parse --short HEAD"
  Ok "commit $Commit, de $(Ler 'git log -1 --format=%cs')"
  if ($alteracoes.Count -gt 0) { Avisar "$($alteracoes.Count) arquivo(s) com alterações não registradas no git entram nesta compilação." }
}
$Versao = $null
foreach ($linha in Get-Content (Join-Path $Raiz "Cargo.toml")) { if (-not $Versao -and $linha -match '^\s*version\s*=\s*"([^"]+)"') { $Versao = $Matches[1] } }
$VersaoTauri = (Get-Content (Join-Path $Raiz "crates\app\tauri.conf.json") -Raw -Encoding UTF8 | ConvertFrom-Json).version
if (-not $Versao) { Falhar "não achei a versão no Cargo.toml." "Confira a linha version = ""x.y.z"" em [workspace.package]." }
if ($VersaoTauri -ne $Versao) {
  Falhar "a versão do Cargo.toml ($Versao) é diferente da do tauri.conf.json ($VersaoTauri)." "Deixe as duas iguais; o atualizador do programa compara essa versão com a do GitHub."
}
Ok "versão $Versao"

# ---------------------------------------------------------------- 3. testes
Etapa 3 "Rodando os testes"
if ($SemTestes) {
  Avisar "testes pulados (-SemTestes): esta compilação não serve como prova."
} else {
  Dizer "      (a primeira vez demora: o Rust baixa e compila as dependências)"
  if ((Rodar "cargo test --workspace --locked") -ne 0) { Falhar "algum teste falhou." "Procure 'FAILED' ou 'panicked' em $Log e me mande esse trecho." }
  Ok "todos os testes passaram"
  if (-not $env:SA_ZIPS_HISTORICO -and -not $env:SA_SIGTAP_BANCO_CONSULTA) {
    Avisar "os testes com dados reais não rodaram (SA_ZIPS_HISTORICO e SA_SIGTAP_BANCO_CONSULTA vazias). Para a prova completa, use provar_fase2.bat."
  }
}

# ---------------------------------------------------------------- 4. compilação
Etapa 4 "Compilando o programa (release)"
if ((Rodar "cargo build --release --locked -p sa-app -p sa-cli") -ne 0) {
  Falhar "o cargo não conseguiu compilar." "Procure 'error' em $Log e me mande o trecho. Se for falta de memória ou de disco, feche outros programas e rode de novo."
}
$Exe = Join-Path $Raiz "target\release\sigtap-aberto.exe"
$Cli = Join-Path $Raiz "target\release\sigtap-aberto-cli.exe"
foreach ($a in @($Exe, $Cli)) { if (-not (Test-Path $a)) { Falhar "a compilação terminou, mas não achei $a." "Rode de novo; se repetir, me mande o $Log." } }
$cab = New-Object byte[] 2
$fs = [System.IO.File]::OpenRead($Exe); try { [void]$fs.Read($cab, 0, 2) } finally { $fs.Close() }
if ($cab[0] -ne 0x4D -or $cab[1] -ne 0x5A) { Falhar "o arquivo gerado não parece um executável do Windows." "Rode de novo; se repetir, me mande o $Log." }
Ok "sigtap-aberto.exe $(Tamanho (Get-Item $Exe).Length), sigtap-aberto-cli.exe $(Tamanho (Get-Item $Cli).Length)"

# ---------------------------------------------------------------- 5. pasta portátil e pacote
Etapa 5 "Montando a pasta portátil e o pacote"
$Pasta = Join-Path $Saida "SIGTAP-Aberto"
New-Item -ItemType Directory -Path $Pasta -Force | Out-Null
try {
  Copy-Item $Exe (Join-Path $Pasta "sigtap-aberto.exe") -Force
  Copy-Item $Cli (Join-Path $Pasta "sigtap-aberto-cli.exe") -Force
} catch {
  Falhar "não consegui copiar o programa para $Pasta." "Feche o SIGTAP Aberto se ele estiver aberto a partir dessa pasta e rode de novo."
}
Copy-Item (Join-Path $Raiz "LICENSE") (Join-Path $Pasta "LICENSE") -Force
Copy-Item (Join-Path $Raiz "README.md") (Join-Path $Pasta "LEIAME.md") -Force
Ok "pasta portátil: $Pasta"

# O ZIP segue o formato do lançamento no GitHub (.github/workflows/release.yml), que o atualizador do programa espera:
# uma pasta "SIGTAP Aberto" com o .exe, a licença e o LEIAME.
$Nome = "SIGTAP-Aberto-v$Versao-windows-x64"
$Temp = Join-Path $Saida "pacote"
$Dentro = Join-Path $Temp "SIGTAP Aberto"
if (Test-Path $Temp) { Remove-Item $Temp -Recurse -Force }
New-Item -ItemType Directory -Path $Dentro -Force | Out-Null
Copy-Item $Exe (Join-Path $Dentro "sigtap-aberto.exe")
Copy-Item (Join-Path $Raiz "LICENSE") (Join-Path $Dentro "LICENSE")
Copy-Item (Join-Path $Raiz "README.md") (Join-Path $Dentro "LEIAME.md")
$Zip = Join-Path $Saida "$Nome.zip"
if (Test-Path $Zip) { Remove-Item $Zip -Force }
Add-Type -AssemblyName System.IO.Compression.FileSystem
[System.IO.Compression.ZipFile]::CreateFromDirectory($Temp, $Zip, [System.IO.Compression.CompressionLevel]::Optimal, $false)
Remove-Item $Temp -Recurse -Force
$HashZip = (Get-FileHash $Zip -Algorithm SHA256).Hash.ToLower()
[System.IO.File]::WriteAllText("$Zip.sha256", "$HashZip  $Nome.zip`n", (New-Object System.Text.ASCIIEncoding))
Ok "pacote: $Zip ($(Tamanho (Get-Item $Zip).Length))"

# ---------------------------------------------------------------- 6. conferência
Etapa 6 "Conferindo o resultado"
$z = [System.IO.Compression.ZipFile]::OpenRead($Zip)
try { $itens = @($z.Entries | ForEach-Object { $_.FullName.Replace('\', '/') } | Where-Object { -not $_.EndsWith('/') } | Sort-Object) } finally { $z.Dispose() }
$esperado = @("SIGTAP Aberto/LEIAME.md", "SIGTAP Aberto/LICENSE", "SIGTAP Aberto/sigtap-aberto.exe")
if (($itens -join "|") -ne ($esperado -join "|")) { Falhar "o ZIP não ficou com o conteúdo esperado: $($itens -join ', ')." "Me mande o $Log." }
Ok "ZIP com $($itens.Count) arquivos, no formato que o atualizador espera"
if ((Get-FileHash $Zip -Algorithm SHA256).Hash.ToLower() -ne $HashZip) { Falhar "o SHA-256 do ZIP mudou depois de gravado." "Rode de novo." }
$HashExe = (Get-FileHash $Exe -Algorithm SHA256).Hash.ToLower()
Ok "SHA-256 do ZIP: $HashZip"
Ok "SHA-256 do .exe: $HashExe"
if ((Rodar "`"$(Join-Path $Pasta 'sigtap-aberto-cli.exe')`" ajuda >nul") -ne 0) { Falhar "a linha de comando compilada não abriu." "Me mande o $Log; pode ser antivírus bloqueando o executável novo." }
Ok "a linha de comando abre (sigtap-aberto-cli ajuda)"

# ---------------------------------------------------------------- resumo
$min = [math]::Round(((Get-Date) - $Inicio).TotalMinutes, 1)
Dizer ""
Dizer "COMPILADO: SIGTAP Aberto $Versao (commit $Commit) em $min min." "Green"
Dizer "  Para usar:   $Pasta\sigtap-aberto.exe"
Dizer "  Para enviar: $Zip"
if ($script:Avisos.Count -gt 0) {
  Dizer ""
  Dizer "Atenção ($($script:Avisos.Count)):" "Yellow"
  foreach ($a in $script:Avisos) { Dizer "  - $a" "Yellow" }
}
Dizer "Registro completo: $Log"
Pausar
exit 0
