# Fase 1 — Núcleo SIGTAP

Abertura: 30/09/2026. Plano geral: [SIGTAP Aberto: plano de desenvolvimento por fases](https://claude.ai/code/artifact/2ee9540a-db25-4169-919a-a51acbd95324).

Objetivo: banco SIGTAP com as 225 competências (200801 a 202609) em intervalos de vigência, do
qual qualquer competência sai **idêntica, byte a byte**, aos `.txt` do ZIP oficial.

## 1. Levantamento de escopo (abertura)

### 1.1 O que os 225 ZIPs mostram (estudo feito na abertura, sobre os arquivos reais)

| Fato | Medida | Consequência |
|---|---|---|
| Tabelas distintas | 41 (30 em 2008; 41 desde 2014) | Esquema criado a partir do `_layout.txt` de cada ZIP |
| Arquivos de tabela | 8.442 | Todos conferidos na reconstrução |
| Registros | **Largura fixa + CRLF em 8.442 de 8.442 arquivos** | Ler por tamanho de registro, **nunca** separar por linha |
| LF dentro do texto | 17 arquivos de `tb_regra_condicionada` | Separar por linha quebraria registros (motivo do item acima) |
| Leiautes | Contíguos em 100% (soma dos tamanhos = largura) | Validação obrigatória na leitura |
| Nome de coluna com vírgula | `REPLACE(DS_REGRA_CONDICIONADA,CHR(10),NULL)` em 201412–201503 | Ler o leiaute da direita para a esquerda; nome de coluna normalizado por manifesto |
| Mudanças de leiaute | `tb_procedimento` 4 versões (201109, 201209, 202506); `tb_tipo_leito` 4; `tb_tuss`, `tb_componente_rede`, `tb_regra_condicionada` 3; demais 1–2 | Coluna ausente numa competência = ausente, não vazia |
| Preenchimento | Texto: espaços à direita (há valores com espaço à esquerda, que é dado). NUMBER: zeros à esquerda, sempre | Guardar texto sem espaços à direita e número como inteiro; regerar pelo leiaute |
| `DT_COMPETENCIA` | Igual à competência do ZIP em 100% das linhas da amostra | Derivada da competência, não guardada por linha (conferido na reconstrução) |
| Linhas idênticas repetidas | Existem (`rl_procedimento_renases`, 35 na amostra) | Guardar multiplicidade |
| Volume | 64,3 milhões de ocorrências → 489.570 linhas distintas → **506.758 intervalos** | Banco pequeno; carga completa viável no Windows |
| Tabelas com lacuna | 7 tabelas surgem em 201404 e somem de 201405 até 201503 (`tb_*`) ou 201507 (`rl_*`) | `201404` foi **republicado em 26/02/2020** (`_v2002261635`) já com as tabelas novas |
| Republicações | Carimbo `_vAAMMDDhhmm` muito posterior à competência em 201404 (2020), 201808 (2021), 202507–202602 (09/2025 e 02/2026) | O FTP só guarda a última versão; o programa tem de aceitar competência antiga que muda |
| Contagens do documento-mestre | 19.010 compatibilidades, 100.754 CID, 32.181 `tb_cid` = **número de intervalos** (com histórico); 12.407 = vigentes em 202609 | Resolve a "divergência" 12.407 × 19.010 levantada na Fase 0 |

### 1.2 Entregas e como cada uma será validada

| Id | Entrega | Validação no fechamento |
|----|---------|-------------------------|
| E01 | `sa-core`: tipo `Competencia` (AAAAMM ↔ sequência 1..N), intervalos de vigência | Testes unitários: conversões, bordas (200801, virada de ano), inválidos recusados |
| E02 | `sa-sources`: leitor do ZIP do SIGTAP (lista, leiaute, registros de largura fixa) | Testes com ZIP sintético; lê os 8.442 arquivos reais sem erro |
| E03 | Leitor de leiaute: da direita para a esquerda, contiguidade, tipos conhecidos | Teste com a linha `REPLACE(…)` real; leiaute não contíguo recusado com mensagem |
| E04 | Limites de segurança: tamanho descomprimido, razão de compressão, número de entradas, nomes | Zip-bomba sintética e nome de arquivo com `../` recusados |
| E05 | `safe_ident` + manifesto de normalização de nomes de coluna | Nome malicioso sintético recusado; `REPLACE(…)` mapeado para `DS_REGRA_CONDICIONADA` pelo manifesto |
| E06 | `sa-packs`: banco SQLite do módulo SIGTAP (esquema a partir dos leiautes, intervalos, multiplicidade, proveniência) | Inspeção do esquema; teste de proveniência (nome, versão, SHA-256 por competência) |
| E07 | Carga completa das 225 competências | Tempo e tamanho medidos no Linux e no Windows |
| E08 | **Reconstrução exata**: exportar cada tabela de cada competência e comparar com o `.txt` do ZIP | 8.442 de 8.442 arquivos idênticos byte a byte (SHA-256), no Linux e no Windows |
| E09 | Carga incremental (só a competência nova) | Banco de 1..224 + 225 igual ao banco completo (dump lógico idêntico) |
| E10 | Republicação e retroativo | ZIP sintético derivado de um real, com mudanças, recarregado no meio da cadeia: a competência muda, as outras 224 continuam exatas; recarregar o original volta ao banco anterior |
| E11 | Manifesto de chaves naturais por tabela (para "o que mudou", Fase 2) | Unicidade de cada chave conferida nas 225 competências; as que não fecharem ficam registradas |
| E12 | `sa-download`: listagem e download do SIGTAP com cortesia, retomada, verificação; modo manual (pasta) | Testes com servidor FTP local simulado; baixar 1 competência real pelo shell do dispositivo |
| E13 | CLI: `carregar`, `reconstruir <AAAAMM>`, `conferir`, `competencias` | Execução registrada no Linux e no Windows |
| E14 | `docs/fontes/sigtap.md`: linha do tempo do esquema das 225 competências | Documento gerado a partir dos dados |
| E15 | Explicar as contagens do documento-mestre com o banco novo | Consulta registrada; documento-mestre corrigido |
| E16 | Registro | Fechamento aqui; diário; plano e documento-mestre |

### 1.3 Fontes e dados usados

- 225 ZIPs de `historico_zips\` (341 MiB), copiados para o ambiente de desenvolvimento só para
  os testes; nada entra no repositório.
- Notas técnicas mensais: consultadas só se alguma decisão de chave natural precisar.
- Downloads novos: nenhum obrigatório. Para E12, uma competência real pelo FTP (~2 MB).

### 1.4 Decisões desta fase

| Decisão | Escolha | Motivo |
|---|---|---|
| Unidade de versionamento | Conteúdo da linha (todas as colunas menos `DT_COMPETENCIA`) + multiplicidade | Reconstrução exata garantida sem depender de chave natural, que fica para a comparação (E11) |
| Representação | Texto sem espaços à direita; NUMBER como inteiro; o resto do leiaute é dado | Mudança de largura (ex.: VL_SH 10→12) não vira "mudança" falsa |
| Banco | Um SQLite do módulo SIGTAP (`sigtap.db`) com uma tabela por tabela de origem, colunas = união das colunas de todas as competências, mais `vig_ini`, `vig_fim`, `qtd` | Consulta direta por competência: `vig_ini <= s AND (vig_fim IS NULL OR vig_fim >= s)` |
| Leiautes | Guardados por competência numa tabela de metadados | Reconstrução usa o leiaute daquela competência |
| Biblioteca SQLite | `rusqlite` com SQLite embutido (`bundled`) | Portátil, sem DLL externa; licença MIT |
| Biblioteca ZIP | `zip` (MIT) com limites próprios | Madura; limites implementados por nós |
| FTP | Implementação mínima própria sobre TCP, ou `suppaftp` se a licença passar no `cargo-deny` | Decidir no E12 com a auditoria |

### 1.5 Riscos

- Tempo da carga completa no Windows (lido em ~4 min no Linux só com Python de estudo).
- Alguma tabela pode ter regra de preenchimento diferente da amostra (29 competências
  conferidas): a reconstrução completa (E08) é o que prova.
- Download real depende do shell do dispositivo (instável) ou do Windows.

### 1.6 Fora desta fase

Interface gráfica; território; consulta para o usuário (Fase 2).

## 2. Fechamento

Fechamento: 30/09/2026, 19h. Evidências: `crates/packs/tests/sigtap_real.rs` e
`crates/sources/tests/zips_reais.rs` no Linux (ambiente de nuvem) e no Windows do cliente
(`scripts/windows/provar_fase1.log`, execução das 16h44 às 17h33). **Fase 1 fechada: 16 de 16
itens cumpridos**, com as ressalvas da seção 2.3.

### 2.1 Validação item a item

| Id | Resultado | Evidência |
|----|-----------|-----------|
| E01 | Cumprido | 4 testes de `Competencia` (ida e volta, virada de ano, 225 meses de 200801 a 202609, inválidos com mensagem) |
| E02 | Cumprido | Linux e Windows: 225 ZIPs, **8.442 arquivos, 64.310.859 registros** lidos sem erro |
| E03 | Cumprido | Teste com a linha `REPLACE(DS_REGRA_CONDICIONADA,CHR(10),NULL)`; 7 leiautes defeituosos sintéticos recusados |
| E04 | Cumprido | Zip-bomba (razão e tamanho), 4 caminhos perigosos e arquivo que não é ZIP recusados, com mensagem |
| E05 | Cumprido | `safe_ident` recusa 8 nomes maliciosos; manifesto `sigtap.toml` normaliza o nome real |
| E06 | Cumprido | Esquema (`sa_competencia`, `sa_tabela`, `sa_leiaute`, `sa_ordem`, tabela de conteúdo + `__vig` por tabela); proveniência com arquivo, versão e SHA-256 (teste) |
| E07 | Cumprido | Carga completa: Linux 450 s, Windows 699 s (ambas rodando em paralelo com outros dois testes); banco de **99,7 MB** nos dois |
| E08 | Cumprido | **8.442 arquivos de tabela (5,2 GB) e 8.442 leiautes idênticos byte a byte**, no Linux e no Windows (SHA-256 de cada arquivo) |
| E09 | Cumprido | Toda carga em ordem é incremental (competência nova anexada); o banco resultante tem o mesmo resumo lógico que o montado fora de ordem (E10) |
| E10 | Cumprido | Retroativo (201705 e 200801 carregadas por último), remover e recarregar e republicação derivada de ZIP real: resumo lógico `c87c809f…` idêntico ao da carga em ordem, **igual no Linux e no Windows**; 7 testes sintéticos (4 ordens de carga, republicação, remoção) |
| E11 | Cumprido | `manifestos/sigtap_chaves.toml`; **8.307 pares (tabela, competência)** sem chave repetida; `rl_procedimento_renases` sem chave (linhas inteiras repetidas em 93 competências) |
| E12 | Cumprido | 5 testes contra servidor FTP falso (uma conexão para a lista, queda no meio com retomada por REST no byte certo, arquivo inválido descartado, cancelamento com parcial guardado, importação por pasta). Windows: listagem real do FTP (225 competências) e download real de `TabelaUnificada_202609_v2609171117.zip` (2.155.846 bytes), verificado, com o mesmo SHA-256 do arquivo já existente |
| E13 | Cumprido | CLI no Windows: `listar-ftp`, `baixar --ultima`, `carregar` (2,9 s), `conferir` (41 arquivos idênticos), `competencias`. No Linux também `reconstruir` e o erro orientado de competência não carregada |
| E14 | Cumprido | `docs/fontes/sigtap.md` gerado dos 225 leiautes |
| E15 | Cumprido | 19.010, 100.754, 32.181/32.183 e 11.522 do documento-mestre = intervalos com histórico; vigentes em 202609: 12.407, 82.103, 14.246 e 5.766. Documento-mestre corrigido |
| E16 | Cumprido | Este fechamento; diário; plano e documento-mestre |

Total de testes do workspace: 52 (unitários e sintéticos), mais 5 provas com dados reais.

### 2.2 Achados da fase

- 1.342 dos 8.442 arquivos não estão em ordem de bytes: a ordem física é guardada (`sa_ordem`)
  para a reconstrução ser idêntica.
- Registros com CRLF e LF dentro do texto em `tb_regra_condicionada`: separar por linha erra
  9 registros; a leitura por largura acerta todos.
- `rl_procedimento_tuss` vazia em **todas** as competências desde 201404.
- Chaves: `tb_sia_sih` repete código entre ambulatorial (A) e hospitalar (H); `tb_cid` repete
  `CO_CID` em algumas competências (chave com `TP_AGRAVO`).
- Republicações reais: 201404 (em 2020), 201808 (em 2021), 202507–202602 (em 2025–2026).

### 2.3 Ressalvas

- **Tempo de carga medido com concorrência** (três testes em paralelo); não há medida isolada.
  O primeiro uso só carrega a competência vigente (2,9 s no Windows); o histórico completo é
  opcional.
- **No Windows, o passo 1 do `provar_fase1.bat` rodou também as provas com dados reais em modo
  de depuração** (34 min), porque a variável de ambiente foi definida cedo demais. Os resultados
  são válidos; o script foi corrigido para ligar as provas só a partir do passo 2.
- **Acentos na saída da CLI** aparecem trocados no prompt clássico do Windows (página de código
  850). Os scripts passam a usar `chcp 65001`; a interface gráfica (Fase 2) não é afetada.
- `remover` e `reconstruir` pela CLI não foram executados no Windows (a lógica foi provada no
  Windows pelos testes de retroativo e reconstrução).
