# Fase 0 — Preparação

Abertura: 30/09/2026. Plano geral: [SIGTAP Aberto: plano de desenvolvimento por fases](https://claude.ai/code/artifact/2ee9540a-db25-4169-919a-a51acbd95324).

Objetivo: repositório vazio mas completo, que compila no Linux e no Windows, abre uma janela
portátil e barra, por construção, dado oficial ou de paciente dentro do repositório.

## 1. Levantamento de escopo (abertura)

### 1.1 Entregas e como cada uma será validada

| Id | Entrega | Validação no fechamento |
|----|---------|-------------------------|
| E01 | Repositório git `sigtap-aberto` (ramo `main`) | `git log` com os commits da fase; árvore listada |
| E02 | `LICENSE` com o texto oficial da AGPL-3.0 | SHA-256 igual ao de https://www.gnu.org/licenses/agpl-3.0.txt baixado na data |
| E03 | `README.md` em português | Contém: o que é, aviso de ferramenta não oficial, dados não redistribuídos, licença, como compilar e testar |
| E04 | `CONTRIBUTING.md` com proposta de CLA | Texto presente; marcado como "pendente de revisão jurídica" |
| E05 | `.gitignore` + teste de guarda | Teste passa no repositório real e **falha** com arquivos proibidos sintéticos (ZIP, DB, DBC, remessa BPA/APAC/AIH, arquivo > 1 MB) |
| E06 | Workspace Rust com crates vazios: `core`, `sources`, `packs`, `download`, `query`, `validate`, `cli`, `app` | `cargo build --workspace` e `cargo test --workspace` passam no Linux e no Windows |
| E07 | `app` Tauri 2 portátil: janela vazia, dados do WebView2 ao lado do `.exe` | No Windows, a partir de pasta vazia: listagem da pasta, de `%APPDATA%` e `%LOCALAPPDATA%` antes e depois; nada novo fora da pasta |
| E08 | `rust-toolchain.toml` fixando Rust 1.98.1 | Mesma versão no Linux e no Windows (log) |
| E09 | `deny.toml` + `cargo deny check licenses` | Passa; lista de licenças aceitas registrada |
| E10 | `catalogo/fontes.toml` | Uma entrada por fonte citada no documento-mestre, com origem, padrão de nome, escopos, periodicidade, origem do leiaute, campos pessoais, situação da licença |
| E11 | Scripts Windows: `diagnostico.bat` (corrigido), `testar.bat`, `compilar.bat`, todos com log ao lado | Rodados no Windows do cliente; logs lidos e anexados ao fechamento |
| E12 | CI do GitHub Actions (Windows, Linux, macOS) | Arquivo presente e válido (YAML); ativação só quando houver repositório remoto |
| E13 | Estudo: arquivos acessórios do ZIP do SIGTAP em 3 épocas | `docs/fontes/sigtap-acessorios.md` |
| E14 | Estudo: estrutura do FTP (tup e dissemin) | Listagens salvas em `dados_dev/listagens/`; resumo em `docs/fontes/ftp-datasus.md` |
| E15 | Estudo: licença dos dados | `docs/fontes/licenca-dos-dados.md` com a fonte lida e a data |
| E16 | Registro | `DIARIO_DO_PROJETO.md`, documento-mestre e plano atualizados; este arquivo com o fechamento |

### 1.2 Fontes a estudar nesta fase

- ZIPs do SIGTAP 200801, 201501 e 202609 (já na pasta do cliente): `LEIA_ME.TXT`, `layout.txt`,
  `DATASUS - Tabela de Procedimentos - Lay-out.xls`, `config.inf`, `versao`.
- FTP `ftp2.datasus.gov.br/pub/sistemas/tup/downloads` e
  `ftp.datasus.gov.br/dissemin/publicos/{CNES,SIASUS,SIHSUS}`: só listagens.
- Portal de Dados Abertos do Ministério da Saúde: licença declarada.

### 1.3 Dependências e ambiente

| Item | Situação na abertura |
|------|----------------------|
| Windows do cliente | Rust 1.98.1 MSVC, Git 2.53, Node 24 confirmados; Build Tools C++ e WebView2 a confirmar (diagnóstico com erro) |
| Shell do dispositivo (Linux isolado) | Instável: erro de E/S no disco durante a instalação do Rust; pasta do projeto deixou de montar. **Não usado nesta fase.** |
| Ambiente de nuvem (desenvolvimento) | Rust 1.98.1, WebKitGTK 4.1 (para compilar o `app` no Linux), 7 GB de RAM |
| Sincronização | Ponte de arquivos (stage/commit) entre a nuvem e `D:\Projetos\Tabela SIGTAP\sigtap-aberto\` |
| Tauri | 2.12.0 (última estável da série 2; a 3.0 está em alfa e não será usada) |

### 1.4 Decisões desta fase

| Decisão | Escolha | Motivo |
|---------|---------|--------|
| Nome dos pacotes | `sa-core`, `sa-sources`, … em `crates/<nome>` | Prefixo curto evita colisão com crates públicos |
| Interface | HTML, CSS e JavaScript sem empacotador, servidos pelo Tauri | Sem Node no produto; menos dependências para auditar |
| Edição do Rust | 2024 | Atual na versão fixada |
| Pasta de dados do WebView2 | `dados_webview\` ao lado do `.exe` | Regra de portabilidade |
| Onde fica o repositório | `D:\Projetos\Tabela SIGTAP\sigtap-aberto\`, git local, sem remoto | Decisão do cliente pendente só para o GitHub (Fase 7) |
| Autor dos commits | NovaGen Tecnologia, com coautoria do Claude no rodapé | Projeto do cliente |

### 1.5 Riscos

- O Windows pode não ter WebView2 Runtime ou os Build Tools: o diagnóstico corrigido confirma antes da compilação.
- A compilação do Tauri no Windows depende de o cliente rodar o `.bat` (o shell do dispositivo não é Windows).
- Sem repositório remoto, o CI não roda nesta fase: só a validade do arquivo é conferida.

### 1.6 Fora desta fase

Qualquer leitura de dado para ingestão; interface além de uma janela vazia com o aviso.

## 2. Fechamento

(preenchido ao final da fase)
