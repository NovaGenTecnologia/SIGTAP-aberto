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

Fechamento: 30/09/2026, 16h. Logs do Windows lidos em `scripts/windows/*.log` (execução pelo
cliente, 15h43–15h52). **Fase 0 fechada: 16 de 16 itens cumpridos**, com as ressalvas da seção 2.3.

### 2.1 Validação item a item

| Id | Resultado | Evidência |
|----|-----------|-----------|
| E01 | Cumprido | `git log`: 3 commits no `main`; histórico montado no Windows pelo pacote (`sincronizar_git.log`: bundle verificado, `0a2be7c`) |
| E02 | Cumprido | `LICENSE` com SHA-256 `0d96a4ff…abcb0`, igual ao arquivo baixado de gnu.org em 30/09/2026 |
| E03 | Cumprido | `README.md`: o que é, aviso não oficial, dados não redistribuídos, licença, requisitos, compilar e testar |
| E04 | Cumprido | `CONTRIBUTING.md` com proposta de CLA marcada "pendente de revisão jurídica" |
| E05 | Cumprido | 5 testes unitários da guarda + teste do repositório passam no Linux e no Windows; o teste **falhou** de propósito com uma remessa BPA sintética não rastreada e voltou a passar após removê-la |
| E06 | Cumprido | Linux: `cargo build`, `clippy -D warnings`, `fmt --check`, `cargo test` (7 passaram, 0 falharam). Windows (`testar.log`): 7 passaram, 0 falharam |
| E07 | Cumprido | Windows (`testar_portatil.log`): `.exe` copiado para pasta vazia, processo ativo por 15 s (34 MB), `dados_webview\EBWebView\` criado **ao lado do executável**; `%LOCALAPPDATA%\br.sigtap-aberto.app` e `%APPDATA%\br.sigtap-aberto.app` não existem antes nem depois; nenhum arquivo novo com "sigtap" em `%LOCALAPPDATA%`, `%APPDATA%` ou `%TEMP%`. Linux: janela renderizada com o aviso (captura de tela) |
| E08 | Cumprido | `rust-toolchain.toml` 1.98.1; o Windows instalou sozinho o toolchain fixado (`diagnostico.log`) |
| E09 | Cumprido | `cargo deny check licenses`: "licenses ok". Encontradas: MIT, Apache-2.0 (e com LLVM-exception), BSD-3-Clause, ISC, Zlib, Unicode-3.0, MPL-2.0 (cssparser, via Tauri), CC0-1.0, MIT-0, 0BSD/Unlicense/LGPL só como alternativas em licenças duplas com MIT |
| E10 | Cumprido | `catalogo/fontes.toml`: 24 fontes, todas com os 10 campos obrigatórios (conferido por script) |
| E11 | Cumprido | 5 scripts rodados no Windows, cada um com log; `compilar.log` com `CODIGO_SAIDA=0` |
| E12 | Cumprido com ressalva | `ci.yml` válido (YAML conferido); não executado, porque não há repositório remoto |
| E13 | Cumprido | `docs/fontes/sigtap-acessorios.md` |
| E14 | Cumprido | `docs/fontes/ftp-datasus.md` (listagens de 22 diretórios pelo shell do dispositivo) |
| E15 | Cumprido | `docs/fontes/licenca-dos-dados.md` (dados.gov.br e dadosabertos.saude.gov.br pelo navegador embutido) |
| E16 | Cumprido | Este fechamento; `DIARIO_DO_PROJETO.md`; plano por fases e documento-mestre atualizados |

### 2.2 Ambiente confirmado no Windows (`diagnostico.log`)

Windows 10.0.26200; Rust/Cargo 1.98.1 MSVC; Git 2.53.0; **Ferramentas de Build do Visual
Studio 2026 (18.4)**; **WebView2 Runtime 154.0.4258.37**. Compilação release: 2 min 38 s;
`sigtap-aberto.exe` 8,8 MB, SHA-256 `960f0412…d044`; `sigtap-aberto-cli.exe` 130 KB.

### 2.3 Ressalvas e achados do fechamento

- **Não verificado no Windows:** a aparência da janela (o processo abriu e o WebView2
  inicializou, mas ninguém olhou a tela). No Linux a janela foi vista renderizada.
- **CI não executado** (sem remoto). Fica para quando houver repositório no GitHub.
- **Canal de cópia para o Windows:** não grava `.git` nem `.github`, e **recodifica PNG**
  (mesmos pixels, bytes diferentes). Solução: histórico por pacote git e
  `sincronizar_git.bat` restaurando `.github`, `*.png` e `*.ico` a partir do commit.
- **Fim de linha dos `.bat`:** o `.gitattributes` entrou depois do primeiro commit; dois
  scripts apareciam como modificados no Windows. Corrigido com `git add --renormalize`.
- **Shell do dispositivo:** instável (erro de E/S no disco da sessão, pasta desmontada). Serve
  para o FTP (rede funciona), não para trabalhar na pasta.
- **Linux:** o WebKitGTK grava cache de shaders da GPU em `~/.cache/mesa_shader_cache`, fora da
  pasta. Não afeta o Windows (alvo); registrado para quando houver versão Linux.

### 2.4 O que muda no plano por causa desta fase

- Tamanhos que estavam "a medir": `TAB_CNES.zip` 127,5 MB, `TAB_SIA.zip` 73,4 MB,
  `EQMS2608.dbc` 142 KB, `SPMS2607.dbc` 4,1 MB. SIA e SIH vão até 2607; CNES até 2608.
- Novas fontes para estudo: 225 notas técnicas mensais do SIGTAP (Fases 1 a 3) e
  `Mapeamento_TUSS_SIGTAP.zip` do próprio DATASUS (Fase 6).
- Republicação e retroativo da Fase 1 serão provados com arquivos sintéticos (não há
  competência republicada no FTP hoje).
- Licença: o documento-mestre diz CC BY-ND 3.0; o dados.gov.br mostra Creative Commons
  Attribution para o CNES. Corrigido no documento-mestre com a fonte.
