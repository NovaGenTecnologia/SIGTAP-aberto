# Fase 4 — Produção e rejeições

Abertura: 05/10/2026. Plano geral: [SIGTAP Aberto: plano de desenvolvimento por fases](https://claude.ai/code/artifact/2ee9540a-db25-4169-919a-a51acbd95324).

Objetivo: o programa passa a mostrar o que de fato foi produzido e aprovado no SUS. Em cada
procedimento, o faturista vê quantos e quais estabelecimentos o produziram (SIA e SIH); em
"Minha unidade", vê o que a unidade produziu e o que o SIH rejeitou, com o motivo oficial.
A produção real também serve de prova indireta para a regra de aptidão da Fase 3, que segue
"não confirmada".

> **Base deste escopo.** O plano por fases e o documento-mestre (Claude Docs) **não puderam ser
> lidos** na abertura (acesso negado, mesmo pelo conector de documentos). O escopo abaixo vem só da
> evidência local: `catalogo/fontes.toml` (fontes com `fase = 4`), `fase-2.md` 1.6, `fase-3.md` 1.2
> e 1.3, `docs/fontes/ftp-datasus.md` e o diário. Se o plano tiver outro escopo, ele manda: ajuste
> esta página.
>
> **Contradição a corrigir.** `INSTRUCOES_SIGTAP_ABERTO_v3.md` (seção 8) põe a conferência
> pré-envio na Fase 4. O repositório inteiro (fases 2 e 3, catálogo, `sa-validate`) trata a Fase 4
> como produção e rejeições e a conferência pré-envio como Fase 5. Segue-se o repositório, que é
> a numeração que as Fases 0 a 3 cumpriram.

> **Atualização (05/10/2026, mais tarde).** Os servidores do DATASUS voltaram a responder e o cliente passou a baixar a
> produção para a versão local. Onde este documento diz "fora do ar" ou "sem rede", leia como o estado da abertura e da
> verificação: o Bloco B deixa de depender do servidor, e a restrição de download deixa de existir.

## 1. Levantamento de escopo

### 1.1 O que o estudo de abertura mostrou

| Fonte | Achado | Consequência |
|---|---|---|
| FTP `dissemin/publicos/SIASUS/200801_/Dados` | Arquivos `PA<UF><AAMM>[a-z].dbc`, 54.478 arquivos, 431 GB; MS 2607: PA 40,3 MB | Um mês de PA de uma UF média pesa dezenas de MB: o usuário escolhe quantos meses; o programa mostra o tamanho antes |
| FTP `…/SIHSUS/200801_/Dados` | `RD`, `SP`, `ER` por UF e mês; MS 2607: RD 1,3 MB, SP 4,1 MB, ER 20 KB | Pequenos; cabem na primeira carga |
| `TAB_SIH.zip` (6 MB) | Traz a tabela de motivos de rejeição (MOTERRO, 641 motivos, segundo o catálogo) | Descrição oficial do motivo; leitura parcial como no `TAB_CNES.zip` |
| Campos pessoais | PA: CNS do profissional, idade, sexo, município do paciente. RD: nascimento, CEP, número da AIH, CPF. ER: número da AIH | Agregar na carga e **descartar a linha**; o arquivo bruto não fica guardado (mesma regra do ST e do PF) |
| API DEMAS (`apidadosabertos.saude.gov.br`) | Endpoints `sia-procedimentos-ambulatoriais` e `sih-procedimentos-hospitalares` respondem (competências até 2026-05 e 2026-03). **Medido em 05/10/2026: devolvem cerca de uma linha por estabelecimento e mês** (unidade do cliente: 11 linhas em 2023, 2 em 2026; Campo Grande em 01/2026: 1 linha) | **Descartada** como fonte: não é a produção por procedimento. A licença segue "a verificar". Nada é baixado dela nesta fase |
| Servidores FTP do DATASUS | Fora do ar na abertura (05/10/2026, timeout na conexão de dados, em duas redes); **voltaram no mesmo dia** | A 1ª versão foi construída e testada só com servidor falso; depois o cliente baixou a produção real de MS e o Bloco B passou a ser possível (seção 2.4) |
| Dicionário da AIH (`leiautes`) | Descreve as tabelas internas do SIHD (`AH_*`), **não** os campos do `RD` de disseminação | Os nomes dos campos não estavam em nenhum documento local; foram confirmados depois com arquivos reais (seção 2.4) |

### 1.2 Como a falta de arquivo real foi tratada

Regra do projeto: nenhum leiaute sem fonte oficial. Na abertura não havia `PA`, `RD`, `SP` nem `ER` no disco e o
servidor estava fora do ar. Por isso:

- Os nomes dos campos ficam num **manifesto** (`manifestos/producao.toml`), com a marca `confirmado` por tipo.
- A carga **recusa o arquivo** se um campo esperado não existir, e a mensagem lista os campos que o
  arquivo tem. Nunca grava número errado em silêncio. **Foi assim que o primeiro palpite errado do `ER` apareceu**
  (seção 2.4): a mensagem trouxe os campos reais e bastou corrigir o manifesto.
- Os testes usam arquivos sintéticos; o que dependia de arquivo real virou o **Bloco B**.

### 1.3 Entregas e validação

**Bloco A** — construído e provado agora, com arquivos sintéticos e servidor FTP falso.

| Id | Entrega | Como será validada | Situação |
|----|---------|--------------------|----------|
| P01 | Manifesto de produção (`manifestos/producao.toml`) e leitor (`sa-sources::producao`) | Testes: manifesto válido; tipos PA, RD, ER; campos pessoais nunca lidos; manifestos incoerentes recusados; tabela MOTERRO lida do DBF. Nomes de campo conferidos depois em arquivo real (2.4) | **Feito** |
| P02 | Banco de produção por UF (`dados\producao\<UF>.db`) e carga com agregação (`sa-packs::producao`) | 10 testes com DBF sintético: somas conferidas à mão; nenhuma coluna de paciente e o CNS não aparece nos bytes do banco; campo ausente recusado com os campos do arquivo; valor inválido recusa o arquivo sem gravar; recarga substitui e partes `a`, `b` somam; competência dos registros guardada e divergência do nome vira aviso; esquema mais novo recusado | **Feito** |
| P03 | Download com cortesia (`sa-download::producao`) | 5 testes: nomes e partes; FTP falso lista e baixa só a UF e a competência pedidas; competência ausente recebe orientação; arquivo corrompido não entra na pasta; importação manual copia só o válido. Retomada: `baixar_lista` é o mesmo código do CNES, coberto por `queda_no_meio_retoma_do_ponto_certo` | **Feito** (só com servidor falso) |
| P04 | Orquestração (`sa-unidade::producao`) | 10 testes: depois da carga não resta arquivo oficial (nem `.parcial`), com ou sem carga bem-sucedida; `SA_MANTER_ARQUIVOS_PRODUCAO` mantém; importação não toca a pasta do usuário; apagar uma UF não mexe na outra; plano e download carregam só os meses pedidos com 7 conexões de controle (não lista de novo); 500 MB exige confirmação | **Feito** |
| P05 | Consultas (`sa-query::producao`) e confronto com a aptidão | 8 testes de consulta com totais conferidos à mão e soma independente em SQL; confronto: teste de classificação e prova ponta a ponta sobre o SIGTAP e o CNES reais de MS (8 aptos e 7 não aptos produzindo, conferidos) | **Feito** (produção inventada) |
| P06 | Linha de comando (7 comandos `producao-*`) | Executados contra o banco sintético: importar, situação, unidade, procedimento. `producao-plano` e `producao-baixar` **não** foram executados (rede) | **Feito** |
| P07 | Janela: Módulos e dados, ficha, Minha unidade | Verificação na janela real, passo a passo: 10 passos passaram, 0 falharam, 2 não verificáveis (rede e diálogo nativo); 0 erros de JavaScript; valores iguais aos da linha de comando. A 1ª rodada falhou 2 passos (competência por nome do arquivo): corrigido e repetido | **Feito** (Windows, sem rede) |
| P08 | Exportação CSV e XLSX | Teste com a planilha no formato exato do que a tela monta: CSV com `;` e vírgula decimal; XLSX com número como número e código (CNES, motivo `023`) como texto. **Não** aberto no Excel/LibreOffice; o diálogo "Salvar como" não foi provado | **Feito** (parcial) |
| P09 | Registro | Este documento, `docs/fontes/producao.md`, catálogo, README, diário | **Feito** |
| P10 | Fechamento | Seção 2 | **Feito** |

**Bloco B** — depende de arquivo ou servidor reais. Situação em 05/10/2026, com os servidores de volta:

| Id | Entrega | Situação |
|----|---------|----------|
| B1 | Confirmar nomes de campo de `PA`, `RD` e `ER` em arquivo real | **Feito** (MS, 08/2025 a 07/2026). `SP` não é usado |
| B2 | Totais conferidos com uma fonte oficial | **Parcial**: SIA bate com a API DEMAS em 40 de 40 comparações (quantidade e valor); SIH só em ordem de grandeza. **TabNet não conferido** |
| B3 | MOTERRO oficial (`TAB_SIH.zip`) | **Feito**: 641 motivos; 37 dos 38 motivos do ER de MS em 07/2026 têm descrição |
| B4 | Cruzamento produção × aptidão com dados reais | **Feito, e achou um defeito na regra de aptidão** (seção 2.4) |
| B5 | Estudo de `SP` (serviços profissionais da AIH) | Pendente |
| B6 | UF grande (SP, MG): tempo, memória e tamanho | Pendente |
| B7 | Prova no Windows (janela, importação, diálogos) | Parcial: janela e importação provadas; diálogos nativos não |

### 1.4 Decisões desta fase

| Decisão | Escolha | Motivo |
|---|---|---|
| Numeração | Fase 4 = produção e rejeições; conferência pré-envio = Fase 5 | Ver o aviso no topo |
| Fonte da produção | Arquivos `PA`, `RD`, `ER` do FTP; **não** a API DEMAS | A API devolve uma linha por estabelecimento e mês (medido) |
| O que se grava | Só totais por estabelecimento × competência × procedimento (e × motivo, na rejeição) | Privacidade por construção; o arquivo bruto não serve ao usuário |
| Arquivo bruto | Apagado depois da carga; `SA_MANTER_ARQUIVOS_PRODUCAO=1` só em desenvolvimento, com cópia em `dados_dev\` | Mesma regra do ST e do PF (decisão do cliente, 05/10/2026) |
| Recorte | Por UF; o usuário escolhe quantos meses; padrão: os 3 mais recentes | Tamanho (PA de MS: ~40 MB por mês) e cortesia com o servidor |
| Aviso de tamanho | Mostrar o total antes de baixar; pedir confirmação acima de 500 MB | Regra do projeto |
| Cruzamento com o SIGTAP e o CNES | Em Rust, com conexões separadas (como na Fase 3), sem `ATTACH` | A vigência do SIGTAP já é resolvida em Rust |
| Banco | `dados\producao\<UF>.db`, versão de esquema 2 (o banco da versão 1 é migrado ao abrir, sem perder nada); versão mais nova recusa sem alterar | Mesma regra das fases anteriores |
| Campos não confirmados | Manifesto com `confirmado`; a carga recusa o arquivo se faltar campo; a tela avisa se algum tipo carregado não foi conferido | Ver 1.2 |

### 1.5 Fora desta fase

Conferência de arquivos de faturamento BPA, APAC, AIH, RAAS e CIHA (Fase 5); TUSS e TISS (Fase 6);
serviços terceirizados do CNES; produção da atenção primária (e-SUS); uso da API DEMAS como fonte (serviu só de conferência do SIA).

## 2. O que foi feito, provado e achado

### 2.1 Construído

- `sa-sources`: `producao` (manifesto, tabela de motivos MOTERRO) e `dbc::de_dbf_sintetico` (gera `.dbc` só com literais, para testes; o programa nunca grava `.dbc`).
- `sa-packs`: `producao` (banco, carga com agregação, `sintetico::dbf` para testes).
- `sa-download`: `producao` (nomes, listagem, `baixar_itens` pelo plano, importação, leitura parcial do `TAB_SIH.zip`: ~100 KB em vez de 6 MB).
- `sa-query`: `producao` (produtores, produção e rejeições da unidade) e `ConsultaCnes::confronto_producao`.
- `sa-unidade`: `producao` (plano, baixar, carregar, importar, situação, apagar, JSON da ficha e da unidade).
- Linha de comando: `producao-plano`, `producao-baixar`, `producao-importar`, `producao-situacao`, `producao-apagar`, `producao`, `producao-unidade`.
- Janela: `producao.js` (bloco na ficha, aba Produção em Minha unidade, seção e linha em Módulos e dados).

### 2.2 Testado e onde

- **Windows, com dados reais** (05/10/2026): `cargo test --workspace --release --all-features` com os ZIPs reais (225 competências), o banco do SIGTAP, o CNES de MS (`SA_CNES_DBC`, `SA_CNES_BANCO_MS`): 32 grupos de testes, **0 falhas** (a carga completa dos ZIPs levou 674 s). `fmt` e `clippy -D warnings`: ok. A 1ª tentativa foi encerrada pelo sistema por pouca memória; a 2ª, com `-j 2` e 2 threads de teste, terminou. Depois dos ajustes da seção 2.4, as crates da produção (`sa-sources`, `sa-packs`, `sa-download`, `sa-query`, `sa-unidade`) foram rodadas de novo, não a suíte inteira.
- Variáveis só de teste: `SA_CNES_BANCO_MS` (`dados\cnes\MS.db` já carregado), `SA_PRODUCAO_REAL` (pasta com `ERMS2607.dbc` e `TAB_SIH.zip` reais), `SA_PRODUCAO_BANCO` (`producao\MS.db` real, para o confronto com a aptidão), `SA_PRODUCAO_SINTETICA_PASTA` e `SA_USUARIO_DB` (geram arquivos sintéticos para ver as telas). Ver `crates/unidade/tests/producao_real.rs`.
- Janela real: 12 passos do módulo (10 passaram; 2 não verificáveis por rede e diálogo nativo), antes da seção 2.4.

### 2.3 Achados da construção

- **A API DEMAS não serve como fonte** (ver `docs/fontes/producao.md`): cerca de uma linha por estabelecimento e mês.
- **Defeito meu, achado na tela e corrigido:** Módulos e dados mostrava a competência do **nome** do arquivo e as outras telas a dos **registros**. Agora todas usam a dos registros, e arquivo cujo nome diverge dos registros gera aviso na carga.
- **Revisão independente do fechamento** apontou e eu corrigi: o download listava o servidor de novo para cada competência (a pasta do SIA tem ~54 mil entradas); agora lista uma vez por tipo e baixa pelo plano. Sobras `.parcial` de download interrompido também têm dado de paciente e agora são apagadas.
- A coluna Município da lista de produtores mostrava o código IBGE; passou a mostrar o nome.

### 2.4 Com os servidores de volta: produção real de MS (05/10/2026)

O cliente baixou a produção de MS (12 meses, 08/2025 a 07/2026) pela versão de desenvolvimento.

**Carga.** 12 `PA` (13,5 milhões de registros → 187.959 totais, 836 estabelecimentos) e 12 `RD` (208.399 AIH → 44.272 totais, 86 estabelecimentos) carregaram com os nomes de campo do manifesto; banco de 37 MB. Os 12 `ER` foram **recusados**: o primeiro palpite estava errado.

| Tipo | Palpite | Real (visto no arquivo) |
|---|---|---|
| `ER` competência | `ANO_CMPT`, `MES_CMPT` | `ANO`, `MES` |
| `ER` motivo | `COD_ERRO` | `CO_ERRO` |
| `ER` pessoais | `N_AIH`, `NASC`, `CEP`, `CNS_PAC` | `AIH`, `DT_INTER`, `DT_SAIDA`, `MUN_RES`, `UF_RES` (campos do arquivo: `SEQUENCIA`, `REMESSA`, `CNES`, `AIH`, `ANO`, `MES`, `DT_INTER`, `DT_SAIDA`, `MUN_MOV`, `UF_ZI`, `MUN_RES`, `UF_RES`, `CO_ERRO`) |

Os campos pessoais que o manifesto listava para `PA` (`PA_CNSMED`, `PA_IDADE`, `PA_MUNPCN`, `PA_RACACOR`, `PA_SEXO`) e para `RD` (`CEP`, `MUNIC_RES`, `NASC`, `N_AIH`, `SEXO`) existem de fato nos arquivos (a carga registra os que achou); `CNS_PAC` não existe no `RD` desta versão. Corrigido o manifesto; o `ER` real de MS 07/2026 carregou (847 rejeições, 142 totais, 55 estabelecimentos, 38 motivos) e todos os três tipos ficaram `confirmado = true`.

**Mensagem de erro.** Doze recusas iguais viravam doze frases de três linhas. Agora o mesmo defeito em vários meses vira uma frase só ("12 arquivos (ERMS2508.dbc a ERMS2607.dbc): …").

**MOTERRO.** `TAB_SIH.zip` (6 MB, 05/10/2026) traz `DBF/MOTERRO.dbf` com `CD_MOT_ERR` (6 caracteres) e `DS_MOT_ERR`: 641 motivos, mesmo código do `CO_ERRO`. Lido por trecho (índice + a entrada). O programa carrega as descrições ao baixar o `ER` e também na importação por pasta (`TAB_SIH.zip` ou `MOTERRO.dbf` soltos).

**Totais × API DEMAS** (SIA, 14 estabelecimentos do maior ao menor × 3 competências): **40 de 40 iguais** em quantidade e valor aprovados. Confirma `PA_CODUNI`, `PA_MVM`, `PA_PROC_ID`, `PA_QTDAPR` e `PA_VALAPR` com dado real. No SIH a linha da API é uma fatia (município do paciente e financiamento); nos 3 casos que diferiram, o total carregado é maior que o da API, como esperado. **Não** foi conferido com o TabNet.

**Ordem de grandeza (MS):** SIA ~4,2 milhões de procedimentos aprovados e ~R$ 31 milhões por mês; SIH ~17 mil AIH e ~R$ 28 milhões por mês. 07/2026 tem menos estabelecimentos no SIA (476 contra 600 a 675 nos outros meses): é a competência mais recente, com envio ainda incompleto.

**Confronto produção × regra de aptidão (B4).** Produção real de 07/2026 contra o CNES de 08/2026 e o SIGTAP de 07/2026:

| | Pares (procedimento, estabelecimento) considerados aptos |
|---|---|
| SIA, todos os procedimentos com exigência | 7.519 de 10.162 (74,0%) |
| SIH, todos os procedimentos com exigência | 331 de 1.151 (28,8%) |

O SIH é o sinal de defeito. Separando as habilitações **38.xx** (programa "Agora Tem Especialistas"):

| Procedimentos que exigem só habilitação | Pares | Aptos pela regra |
|---|---|---|
| SIH, só 38.xx (218 procedimentos) | 791 | **3 (0,4%)** |
| SIH, outras habilitações (89 procedimentos) | 178 | 178 (100%) |
| SIA, só 38.xx (18 procedimentos) | 48 | 22 (45,8%) |
| SIA, outras habilitações (24 procedimentos) | 27 | 27 (100%) |

Sem contar as 38.xx, a regra acerta praticamente tudo: SIH 178/178 (só habilitação), 74/75 (só serviço) e 107/107 (habilitação e serviço); SIA 27/27 e 612/612. O que sobra de erro é o SIA "só serviço" (83,0%, 7.867 de 9.475), compatível com o serviço **terceirizado** que o arquivo público do CNES não traz (achado da Fase 3, 2.3), sem prova.

**Conclusão (a decidir pelo cliente).** As habilitações 38.xx que o SIGTAP lista **não são condição para a aprovação**: 788 de 791 pares (procedimento, hospital) com só 38.xx foram aprovados sem elas. A regra da Fase 3 as trata como exigência e, por isso, diz "não apta" a quem fatura normalmente. Proposta (não implementada): tratar 38.xx como informativas (financiamento do programa), deixar o veredito pelo resto da exigência e manter o aviso que já existe. Isso muda os números fixos de `crates/query/tests/cnes_real.rs` (3.728 procedimentos com exigência, 3.563 com aptos). Base: **uma UF e um mês**.

**SIGTAP 09/2026 republicado.** O banco do cliente mostra `TabelaUnificada_202609_v2610050950.zip` (carregado em 05/10/2026 17:09), no lugar da `v2609171117` de 17/09. É a primeira republicação real vista: 14 procedimentos alterados em relação a 08/2026 (eram 3). O teste `o_que_mudou_bate_com_intervalos_em_todas_as_viradas` tinha esse número fixo; agora o usa só na versão que ele descreve e confere as 224 viradas contra os intervalos nas demais.

### 2.5 Não provado

- **Totais conferidos com o TabNet**, e o SIH com uma fonte exata (só ordem de grandeza e superconjunto da API DEMAS).
- Download real pelo programa (as chamadas de rede dos testes foram só contra servidor falso; o cliente baixou pela versão de desenvolvimento, mas isso ainda não foi lido com cuidado aqui além do resultado da carga). `producao-plano` e `producao-baixar` não foram executados por esta sessão.
- "Salvar como" e "Procurar pasta" do Windows; planilha aberta no Excel ou LibreOffice.
- UF grande (o arquivo é descomprimido inteiro em memória; limite de 2 GiB).
- A tela com a produção real: a verificação na janela foi feita com produção **inventada** sobre o cadastro real.
- Se a proposta sobre 38.xx vale para outras UFs e meses.
- Serviço terceirizado como causa dos 17% do SIA "só serviço".

## 3. Riscos que seguem

1. **Regra de aptidão** com as habilitações 38.xx como exigência: dá "não apta" a quem fatura normalmente (2.4). Decisão do cliente pendente.
2. A regra de aptidão e a correspondência de leitos seguem "não confirmadas" no sentido da prova forte (arquivo rejeitado + retorno oficial); a produção aprovada é só prova indireta.
3. Totais ainda não conferidos com o TabNet; só o SIA foi comparado (API DEMAS).
4. Parecer jurídico sobre os dados (diário, Fase 0) ainda não obtido; esta fase só usa dado público agregado.
5. Plano por fases e documento-mestre não lidos.
6. Memória em UF grande (arquivo descomprimido inteiro).

## 4. Cruzamentos para o faturista (05/10/2026)

Com a produção real de MS carregada, estudou-se o que ela rende ao faturista cruzada com o SIGTAP e o CNES. Cada proposta foi
**validada com dados reais antes de ser construída**; o resultado está na matriz abaixo, inclusive o que não se sustentou.

### 4.1 Matriz de validação

Dados: produção de MS 08/2025 a 07/2026 (instalação de teste), CNES 08/2026, SIGTAP até 09/2026; `PA`/`RD` de 07/2026 baixados de novo
para ver os campos novos. Os testes reais (`crates/unidade/tests/faturamento_real.rs`, `producao_real.rs`) fixam os números.

| Proposta | Veredito | Número medido | O que foi feito |
|---|---|---|---|
| Rejeições: taxa e motivos por mês | **Vale, reenquadrada** | `ER` de 07/2026: 847 linhas para 694 AIH distintas (+22%): uma AIH tem vários erros | Taxa chamada de **"rejeições por 100 AIH aprovadas"**, nunca "% de AIH rejeitadas" |
| Mês completo para análise de volume | **Vale** | SIA de 07/2026: 476 estabelecimentos contra 622 (76,5%); os outros 11 meses entre 92,4% e 101,3%; SIH 79 contra 81 | Regra: ≥ 90% da mediana dos até 3 meses anteriores (`LIMIAR_MES_COMPLETO`) |
| Curva ABC e tendência | **Vale** | Hospital maior de MS: 761 procedimentos no SIH (A 57, B 136, C 568) | A até 80% do valor, B até 95%; tendência = 3 últimos meses completos × 3 anteriores (precisa de 6) |
| Apta × produz × "produz sem ser apta" | **Vale, com sub-rótulos** | Maior hospital de MS: 254 procedimentos "sem aptidão", **todos** só por habilitação 38.xx (R$ 36 mi); 2.107 "aptos que não produz" | Motivos `so_38`, `so_servico`, `habilitacao`, `habilitacao_e_servico`: a decisão sobre as 38.xx não muda o resultado |
| Impacto financeiro das mudanças da tabela | **Vale** | 08→09/2026: 11 mudanças de valor, 2 com produção em MS (R$ 23.343/ano na UF) | Estimativa: quantidade dos meses completos × diferença de valor × 12/meses; SIH só com SH+SP |
| "Regra mais restrita" nas mudanças | **Não vale como proposto** | 72 procedimentos com exigência alterada e produção; **0** passaram a exigir algo que antes não exigiam | Rotulado "exigência alterada" (pode relaxar ou restringir) |
| Valor médio × tabela no **SIH** | **Não vale** | `VAL_TOT` é o total da AIH (OPM, UTI, outros procedimentos): 0415xx, valor de tabela 0, aparece com ~R$ 9 mil por AIH | Só "valor médio da AIH", sem comparação com a tabela |
| Valor × tabela no **SIA** (glosa/incremento) | **Vale, reenquadrada** | 07/2026, 10.797 pares: valor = quantidade × tabela + incremento em 97,6%; o incremento explica só 49 casos; **apresentado > aprovado em 285 pares (R$ 1,37 mi)** | Mostra diferença neutra; a glosa vem do apresentado × aprovado (campos novos) |
| Financiamento por procedimento e unidade | **Vale** | `PA_TPFIN` igual ao financiamento da tabela em 99,3% (10.722 de 10.797) | Valor por financiamento com o nome do SIGTAP |
| Leitos × internações e ocupação | **Vale com `DIAS_PERM`** | Julho de MS: 80.435 dias de permanência para 17.323 AIH | AIH por leito SUS e ocupação **aproximada** (dias ÷ leitos SUS × dias do mês) |
| Habilitação → produção | **Vale** | — | Por habilitação vigente: procedimentos que a citam, produzidos e valor; marca "sem produção"; 38.xx à parte |
| Peso de cada exigência entre os produtores | **Vale** | — | Na ficha: de N produtores, quantos têm cada habilitação/serviço |
| Compatíveis praticados | **Não vale** | Exigiria co-ocorrência por AIH (dado de paciente), que o programa não guarda | Não construído |
| Equipamento exigido | **Não vale** | O SIGTAP não tem tabela de equipamentos exigidos (`rl_procedimento_equipamento` não existe) | Não construído |
| CBO exigido × profissionais | **Não vale (por ora)** | `cnes_pf` de MS tem 211 linhas de **1** estabelecimento | Não construído; só faria sentido para unidades com profissionais carregados |
| Comparar unidades | **Substituída** | Não existe tela de comparação | Em lugar dela, **comparação com os pares do mesmo tipo** (`TP_UNID`) na UF: percentil de valor e mediana da taxa (só pares com ≥ 50 AIH) |

### 4.2 O que foi construído

- **Esquema 2 do banco de produção.** Campos opcionais no manifesto (`financiamento`, `quantidade_apresentada`, `valor_apresentado`,
  `valor_incremento`, `dias`, `dias_uti`), vistos no `PAMS2607` e no `RDMS2607` reais. O banco de versão 1 é **migrado ao abrir, sem
  perder nada**; as linhas antigas ficam com as colunas novas vazias e a tela diz "baixe de novo para ver". Nenhum campo novo é pessoal.
- **`sa-query::faturamento`**: cobertura de meses, séries, ABC, tendência, rejeições, apresentado × aprovado, financiamento, pares;
  valores e mudanças do SIGTAP. **`sa-unidade::faturamento`**: unidade, procedimentos × produção, ficha do procedimento, impacto das
  mudanças, painel. 5 comandos da janela (`faturamento_*`) e 5 da linha de comando (`faturamento-*`).
- **Telas**: Minha unidade (Produção, Procedimentos "Com a produção", Habilitações, Leitos), ficha (série mensal, histórico, peso das
  exigências), O que mudou (impacto estimado), Início (painel do faturista), Módulos e dados ("Completa até", aviso de meses sem os campos novos).

### 4.3 Limites que a tela repete

A produção sai com atraso e o último mês pode vir incompleto; o CNES público não traz serviço terceirizado; a ocupação é aproximada;
o impacto é estimativa e não considera mudança de volume nem incrementos; "pode e não produz" lista só procedimentos com exigência
atendida e usa o que a UF toda produziu (não é previsão). Habilitações 38.xx seguem tratadas à parte: **a decisão de tratá-las como
informativas na regra de aptidão continua com o cliente**.

### 4.4 Prova na janela

As telas novas foram verificadas na janela real do programa sobre dados sintéticos de 8 meses (último mês do SIA incompleto), com o
resultado registrado no diário do projeto. Os números de produção usados nessa verificação são inventados: não servem para conferir
nada com o DATASUS.
