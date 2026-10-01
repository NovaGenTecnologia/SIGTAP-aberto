# SIGTAP Aberto

Programa de código aberto, portátil e gratuito para consultar a Tabela de Procedimentos do SUS
(SIGTAP) com histórico por competência e cruzá-la com os dados do DATASUS (CNES, SIA, SIH) e da
ANS (TUSS/TISS). É a "colinha" do faturista hospitalar: responde na hora se um procedimento aceita
um CID, um CBO, uma idade, em qual instrumento é registrado, quanto valia na competência da
realização e se a unidade tem a habilitação, o serviço e o leito exigidos. A conferência dos
arquivos de faturamento antes do envio é uma das funcionalidades, construída sobre a mesma base.

> **Ferramenta não oficial**, sem vínculo com o Ministério da Saúde, o DATASUS ou a ANS.
> Confira sempre no SIGTAP oficial e no validador oficial antes de faturar. Nenhum resultado
> "sem erros" garante a aprovação da produção.

Situação: **Fase 0 (preparação)**. Ainda não há dados nem consulta. O roteiro está em
`docs/fases/`.

## Princípios

- **Dados não são redistribuídos.** O repositório não contém nenhum dado oficial. O programa
  baixa as tabelas das fontes oficiais, na máquina do usuário, e mostra a fonte e a data em cada
  tela.
- **Dados de paciente não saem da máquina.** Arquivos de faturamento do hospital (BPA, APAC, AIH,
  TISS) são lidos só localmente: sem telemetria, sem envio, sem nada de paciente em log.
- **Portátil.** Um executável sem instalador e sem administrador. Tudo o que o programa grava fica
  na pasta dele (bancos, arquivos baixados, dados do WebView2).
- **Nada sem prova.** Leiautes vêm das fontes oficiais e entram como dados. Cada carga tem teste
  de reconstrução contra o arquivo oficial.

## Requisitos para compilar

| Sistema | Precisa de |
|---------|-----------|
| Windows 10/11 | [Rust](https://rustup.rs) (toolchain `x86_64-pc-windows-msvc`), Build Tools do Visual Studio com "Desenvolvimento para desktop com C++", Microsoft Edge WebView2 Runtime (já vem no Windows 11), Git |
| Linux | Rust, `build-essential`, `pkg-config`, `libwebkit2gtk-4.1-dev`, `libxdo-dev`, `libssl-dev`, `librsvg2-dev` |

A versão do Rust é fixada em `rust-toolchain.toml`; o `rustup` instala a certa sozinho.

## Compilar e testar

Windows (dois cliques ou no terminal, a partir de `scripts\windows\`):

```bat
sincronizar_git.bat :: monta o histórico git a partir de _sincronizacao\repo.bundle (chamado pelos outros)
diagnostico.bat   :: confere Rust, Git, Build Tools e WebView2; grava diagnostico.log
testar.bat        :: roda todos os testes; grava testar.log
compilar.bat      :: gera saida\SIGTAP-Aberto\sigtap-aberto.exe; grava compilar.log
```

Linux ou terminal:

```sh
cargo test --workspace
cargo build --release -p sa-app
cargo deny check licenses
```

## Organização

| Pasta | Conteúdo |
|-------|----------|
| `crates/core` | Competência, vigência, manifestos |
| `crates/sources` | Leitores de fontes (ZIP/TXT, DBC, DBF, JSON, CSV, XLSX) |
| `crates/packs` | Módulos de dados por escopo (SQLite + `ATTACH`) |
| `crates/download` | Download com cortesia, retomada e modo manual |
| `crates/query` | Consultas com saída JSON |
| `crates/validate` | Conferência pré-envio |
| `crates/cli` | Linha de comando |
| `crates/app` | Aplicativo desktop (Tauri 2) |
| `crates/guarda` | Teste que impede dado oficial ou de paciente no repositório |
| `catalogo/` | Catálogo das fontes oficiais |
| `docs/` | Fases, estudos das fontes, decisões |

## Licença

Código sob [GNU Affero General Public License v3.0](LICENSE) (AGPL-3.0-only): quem modificar e
distribuir o programa, ou oferecê-lo como serviço pela rede, tem de publicar o código-fonte.
Os dados baixados pelo programa pertencem às suas fontes (Ministério da Saúde, DATASUS, ANS,
IBGE) e seguem as licenças delas; veja `docs/fontes/licenca-dos-dados.md`.

Contribuições: veja [CONTRIBUTING.md](CONTRIBUTING.md).
