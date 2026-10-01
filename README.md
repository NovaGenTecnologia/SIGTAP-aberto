# SIGTAP Aberto

[![Licença: AGPL-3.0](https://img.shields.io/badge/licen%C3%A7a-AGPL--3.0-blue)](LICENSE)

**A colinha do faturista do SUS: consulte a Tabela de Procedimentos (SIGTAP) com o histórico de cada competência, num programa gratuito, de código aberto, que roda no seu computador.**

Você digita um código, um nome, um CID ou um CBO. O programa responde na hora: o que o procedimento aceita, onde é registrado, quanto valia na competência da realização e o que mudou desde o mês anterior. Tudo o que o SIGTAP publica, sem perder nada, e com os 16 anos de histórico navegável.

> **Ferramenta não oficial.** Sem vínculo com o Ministério da Saúde, o DATASUS ou a ANS.
> Confira no SIGTAP oficial antes de faturar. Nenhum resultado do programa garante a aprovação da produção.

## O que ele faz hoje

- **Consulta por competência.** Escolha qualquer mês carregado (a base de teste vai de 01/2010 a 09/2026, 225 competências) e veja a ficha completa do procedimento.
- **Busca em tempo real.** Código com ou sem máscara, nome sem acento, CID, CBO, habilitação, serviço/classificação.
- **Duas árvores.** Procedimentos (grupo → subgrupo → forma) e CIDs (letra → categoria → subcategoria), cada uma com a contagem de procedimentos ligados.
- **Histórico.** Linha do tempo de cada campo e de cada relação, comparação entre duas competências e a tela "O que mudou" no mês.
- **Avisa quando há novidade.** Confere o servidor oficial de tempos em tempos e diz se saiu uma competência nova ou republicada. Não baixa nada sem você mandar.
- **Baixa as tabelas oficiais sozinho,** com cortesia com os servidores (uma conexão, um arquivo por vez, retomada), e tem passo a passo para quem precisa baixar à mão.
- **Cuida do próprio banco.** Confere a integridade ao abrir; se algo estiver danificado, guarda o arquivo ruim numa pasta à parte e refaz a partir dos ZIPs.
- **Atualiza a si mesmo.** Compara a versão com a do GitHub, avisa e troca o executável depois de conferir o SHA-256.

## O que ele não faz

- Não é prontuário, agendamento nem substituto do sistema de gestão do hospital.
- Não transmite nada ao DATASUS nem à ANS. Ele confere e orienta; quem envia é você.
- **Conferência dos arquivos de faturamento (BPA, APAC, AIH) ainda não está pronta.** É o próximo grande módulo. Cada regra só deixa de ser "não confirmada" depois de provada com arquivo rejeitado real e o retorno oficial.
- Cruzamento com CNES, SIA e SIH e correlação TUSS × SIGTAP estão no roteiro, não no programa.

## Princípios

- **Dados oficiais não são redistribuídos.** O repositório não contém nenhuma tabela oficial. O programa baixa tudo das fontes oficiais, na sua máquina, e mostra a fonte e a data em cada tela.
- **Dado de paciente não sai da sua máquina.** Arquivos de faturamento são lidos só localmente: sem telemetria, sem envio, nada de paciente em log.
- **Portátil.** Um executável, sem instalador e sem administrador. Tudo o que ele grava fica na pasta dele.
- **Nada sem prova.** Layouts vêm das fontes oficiais e entram como dados. Cada carga tem teste de reconstrução contra o arquivo oficial, byte a byte.
- **Mensagens em português que dizem o que fazer.** Nunca "erro genérico".

## Como usar

Ainda não há versão publicada para baixar. Por enquanto, compile (próxima seção). Quando houver, será um ZIP com um único `.exe`:

1. Extraia numa pasta sua (por exemplo, `D:\SIGTAP`).
2. Abra o `sigtap-aberto.exe`. Na primeira vez ele baixa a Tabela Unificada vigente e o território (IBGE e regiões de saúde).
3. Se a rede do hospital bloquear o download, a tela **Módulos e dados** tem o passo a passo para baixar os arquivos à mão e importar.

Para outras competências, use **Módulos e dados**: histórico completo, últimos 6, 12 ou 24 meses, ou só as que você escolher.

## Compilar e testar

| Sistema | Precisa de |
|---------|-----------|
| Windows 10/11 | [Rust](https://rustup.rs) (`x86_64-pc-windows-msvc`), Build Tools do Visual Studio com "Desenvolvimento para desktop com C++", WebView2 Runtime (já vem no Windows 11), Git |
| Linux | Rust, `build-essential`, `pkg-config`, `libwebkit2gtk-4.1-dev`, `libxdo-dev`, `libssl-dev`, `librsvg2-dev` |

O `rustup` instala sozinho a versão fixada em `rust-toolchain.toml`.

No Windows, o caminho é um só: dois cliques em `scripts\windows\compilar.bat`. Ele confere o ambiente (Rust, ferramentas C++, WebView2, espaço em disco), mostra de qual versão do código está compilando, roda os testes, compila e empacota:

```bat
compilar.bat               :: confere, testa, compila e empacota
compilar.bat -Atualizar    :: antes, traz a versão mais nova do GitHub (só se a pasta não tiver alterações)
compilar.bat -SemTestes    :: mais rápido; não serve como prova
```

O resultado fica em `saida\`:

- `SIGTAP-Aberto\sigtap-aberto.exe`: o programa pronto para usar, com a linha de comando ao lado;
- `SIGTAP-Aberto-v<versão>-windows-x64.zip` e o `.sha256`: o mesmo pacote que o lançamento do GitHub publica.

Se algo faltar, o script para e diz o que instalar ou o que fazer. Outros scripts da pasta: `diagnostico.bat` (só lê o ambiente), `testar.bat` (só os testes), `provar_fase2.bat` (prova completa da fase, com dados reais).

Cada script grava um `.log` ao lado. No Linux ou no terminal:

```sh
cargo test --workspace
cargo build --release -p sa-app
cargo deny check licenses
```

Os testes que usam dados reais precisam dos arquivos oficiais na sua máquina: `SA_ZIPS_HISTORICO=<pasta dos ZIPs>` (reconstrução e carga) e `SA_SIGTAP_BANCO_CONSULTA=<banco já carregado>` (consultas). Sem essas variáveis, esses testes terminam sem rodar e aparecem como "ok". Por isso, só vale como prova a execução com os dados reais.

## Linha de comando

O mesmo núcleo do aplicativo, para scripts e conferências. Tudo sai em JSON.

```sh
sigtap-aberto-cli competencias
sigtap-aberto-cli buscar "consulta medica"
sigtap-aberto-cli ficha 0301010072 --competencia 202609
sigtap-aberto-cli arvore-cid T
sigtap-aberto-cli mudou --competencia 202609
sigtap-aberto-cli conferir <pasta de zips>   # reconstrói cada competência e compara com o ZIP oficial
```

`sigtap-aberto-cli ajuda` lista todos os comandos.

## Organização

| Pasta | Conteúdo |
|-------|----------|
| `crates/core` | Competência, vigência, manifestos |
| `crates/sources` | Leitores de fontes (ZIP/TXT, DBC, DBF, JSON, CSV, XLSX) |
| `crates/packs` | Módulos de dados por escopo (SQLite + `ATTACH`) e saúde do banco |
| `crates/download` | Download com cortesia, retomada, modo manual e atualizador |
| `crates/query` | Consultas com saída JSON |
| `crates/validate` | Conferência pré-envio (ainda só a fronteira do módulo) |
| `crates/cli` | Linha de comando |
| `crates/app` | Aplicativo desktop (Tauri 2) |
| `crates/guarda` | Teste que impede dado oficial ou de paciente no repositório |
| `catalogo/` | Catálogo das fontes oficiais |
| `docs/` | Fases, estudos das fontes, decisões |

O estado de cada fase, com o que foi provado e o que não foi, está em [`docs/fases/`](docs/fases/).

## Perguntas frequentes

**Posso usar no computador do hospital?**
Pode. Não precisa de instalação nem de administrador, e nada de paciente sai da máquina. Se a rede bloquear o download, use o passo a passo manual.

**De onde vêm os dados?**
Das fontes oficiais: Tabela Unificada no FTP do DATASUS, municípios na API de Localidades do IBGE e regiões de saúde na API do DEMAS. Cada tela mostra a fonte e a data de publicação do arquivo.

**O programa mostrou algo diferente do site do SIGTAP. Qual vale?**
O site oficial. Abra uma [issue](../../issues) com o código do procedimento e a competência; é exatamente esse tipo de achado que melhora o programa. Não cole dado de paciente.

**Por que AGPL?**
Porque o que é público tem que permanecer público. Quem modificar e distribuir o programa, ou oferecê-lo como serviço pela rede, publica o código-fonte.

**Como ajudo o projeto a continuar?**
Reportando problemas, sugerindo melhorias ou contribuindo com código (veja [CONTRIBUTING.md](CONTRIBUTING.md)). Se quiser apoiar financeiramente, o botão **Sobre**, no rodapé do programa, tem a chave Pix e o QR Code. É voluntário e não dá acesso a nada a mais.

## Licença

Código sob [GNU Affero General Public License v3.0](LICENSE) (AGPL-3.0-only). Os dados baixados pelo programa pertencem às suas fontes (Ministério da Saúde, DATASUS, ANS, IBGE) e seguem as licenças delas; veja [`docs/fontes/licenca-dos-dados.md`](docs/fontes/licenca-dos-dados.md).
