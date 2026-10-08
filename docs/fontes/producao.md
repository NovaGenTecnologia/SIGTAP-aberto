# Produção do SUS (SIA e SIH): arquivos de disseminação e API DEMAS

Estudo de 05/10/2026. Na abertura **não havia arquivo `PA`, `RD`, `SP` ou `ER` no disco e o FTP do DATASUS estava fora do ar**;
ele voltou no mesmo dia e a produção real de MS (08/2025 a 07/2026) foi baixada. Este documento separa o que foi **medido em
arquivo real** do que ainda está **por confirmar**.

## Onde está

| O quê | Endereço | Tamanho (listagem de 30/09/2026) |
|---|---|---|
| SIA, produção ambulatorial | `ftp://ftp.datasus.gov.br/dissemin/publicos/SIASUS/200801_/Dados/PA<UF><AAMM>[a-z].dbc` | MS 07/2026: 40,3 MB; SIA inteiro: 431 GB |
| SIH, AIH aprovadas | `…/SIHSUS/200801_/Dados/RD<UF><AAMM>.dbc` | MS 07/2026: 1,3 MB |
| SIH, AIH rejeitadas | `…/SIHSUS/200801_/Dados/ER<UF><AAMM>.dbc` | MS 07/2026: 20 KB |
| SIH, serviços profissionais | `…/SIHSUS/200801_/Dados/SP<UF><AAMM>.dbc` | MS 07/2026: 4,1 MB (não usado nesta fase) |
| Tabelas auxiliares | `…/SIHSUS/200801_/Auxiliar/TAB_SIH.zip` (6 MB), `…/SIASUS/200801_/Auxiliar/TAB_SIA.zip` (73,4 MB) | |

O `PA` de uma UF e competência pode vir em partes (`a`, `b`…). O formato `.dbc` é o mesmo do CNES
(DBF com registros em PKWARE DCL): o leitor da Fase 3 serve.

## O que o programa faz

- Soma por **estabelecimento × competência × procedimento** (SIA e SIH) e por **estabelecimento × competência × motivo** (rejeições).
- **Não grava nenhuma linha de paciente.** O arquivo traz CNS do profissional, idade, sexo, município e raça (PA);
  nascimento, CEP, número da AIH e CNS do paciente (RD, ER). O manifesto (`crates/sources/manifestos/producao.toml`)
  lista esses campos como `pessoais`: a carga não os lê, e há teste que procura o valor no arquivo do banco.
- O arquivo oficial é **apagado depois da carga, também quando a carga falha**. `SA_MANTER_ARQUIVOS_PRODUCAO=1` mantém
  (só desenvolvimento; a cópia local fica em `dados_dev\`, fora do repositório).
- Download: uma sessão por pasta, um arquivo por vez, retomada, arquivo só entra se descomprime; o programa lista o tamanho
  antes e pede confirmação acima de 500 MB. Padrão: os 3 meses mais recentes que o servidor tem para a UF.

## Campos (confirmados em arquivos reais de MS, 08/2025 a 07/2026)

| Tipo | Lidos pela carga | Pessoais (nunca lidos nem gravados) |
|---|---|---|
| `PA` | `PA_CODUNI` (CNES), `PA_MVM` (AAAAMM), `PA_PROC_ID`, `PA_QTDAPR` (quantidade aprovada), `PA_VALAPR` (valor aprovado) | `PA_CNSMED`, `PA_IDADE`, `PA_MUNPCN`, `PA_RACACOR`, `PA_SEXO` |
| `RD` | `CNES`, `ANO_CMPT`, `MES_CMPT`, `PROC_REA`, `VAL_TOT`; uma AIH por registro | `N_AIH`, `NASC`, `SEXO`, `CEP`, `MUNIC_RES` |
| `ER` | `CNES`, `ANO`, `MES`, `CO_ERRO`; uma rejeição por registro | `AIH`, `DT_INTER`, `DT_SAIDA`, `MUN_RES`, `UF_RES` |

O cabeçalho do `ER` real é: `SEQUENCIA`, `REMESSA`, `CNES`, `AIH`, `ANO`, `MES`, `DT_INTER`, `DT_SAIDA`, `MUN_MOV`, `UF_ZI`,
`MUN_RES`, `UF_RES`, `CO_ERRO`. O primeiro palpite do manifesto (`ANO_CMPT`, `MES_CMPT`, `COD_ERRO`) estava errado e a carga recusou os
12 arquivos listando os campos reais.

Medido em MS: 12 `PA` somam 13,5 milhões de registros (187.959 totais, 836 estabelecimentos); 12 `RD`, 208.399 AIH (44.272 totais,
86 estabelecimentos); `ERMS2607` (19.777 bytes): 847 rejeições, 142 totais, 55 estabelecimentos, 38 motivos. Ordem de grandeza por
mês: SIA ~4,2 milhões de procedimentos e ~R$ 31 milhões; SIH ~17 mil AIH e ~R$ 28 milhões. A competência mais recente tem menos
estabelecimentos (envio incompleto).

### Campos opcionais (esquema 2)

Vistos no cabeçalho do `PAMS2607` (1.217.200 registros) e do `RDMS2607` (17.323) reais. Todos agregáveis, nenhum pessoal; a carga os soma
quando o arquivo os tem e grava NULL quando não.

| Tipo | Campo | Uso |
|---|---|---|
| `PA` | `PA_TPFIN` | financiamento (parte da chave dos totais); igual ao financiamento da tabela SIGTAP em 99,3% dos pares de 07/2026 |
| `PA` | `PA_QTDPRO`, `PA_VALPRO` | quantidade e valor **apresentados**, antes da crítica: base do apresentado × aprovado (285 pares com apresentado maior, R$ 1,37 mi, em 07/2026) |
| `PA` | `PA_VL_INC` | incremento dentro do valor aprovado: explica só 49 diferenças entre valor aprovado e quantidade × tabela |
| `RD` | `FINANC` | financiamento da AIH |
| `RD` | `DIAS_PERM`, `UTI_MES_TO` | dias de permanência e de UTI: ocupação aproximada (80.435 e 9.998 dias para 17.323 AIH em 07/2026) |

`VAL_TOT` do `RD` é o total da AIH (OPM, UTI e outros procedimentos): **não** é comparável ao valor do procedimento na tabela.
O `ER` traz uma linha por erro: 847 linhas para 694 AIH distintas em 07/2026, por isso a taxa é "rejeições por 100 AIH".

### Campos do esquema 3 (Fase 4.5)

Vistos nos arquivos reais de MS 07/2026. Guardados **por valor do campo** (`prod_dim`), não pessoais.

| Tipo | Campos | Uso |
|---|---|---|
| `PA` | `PA_INDICA`, `PA_CODOCO`, `PA_FLQT` | por que o SIA não pagou: `FLQT` O/M = teto financeiro, N/L = teto físico, P = sem orçamento, Q = sem valor unitário |
| `PA` | `PA_DOCORIG`, `PA_REGCT`, `PA_SRV_C`, `PA_CMP` | instrumento de registro; regra contratual (mesmos códigos do `RC` do CNES); serviço+classificação executados; mês do atendimento |
| `PA` | `PA_VL_CL`, `PA_VL_CF`, `PA_VL_CRD` | complemento local, federal e crédito (somas) |
| `RD` | `REGCT`, `VAL_SH_FED`, `VAL_SP_FED`, `VAL_SH_GES`, `VAL_SP_GES`, `VAL_UTI` | regra contratual e composição do valor da AIH |
| `SP` | `SP_CNES`, `SP_AA`+`SP_MM`, `SP_ATOPROF`, `SP_QTD_ATO`, `SP_VALATO`, `IN_TP_VAL`, `SP_CO_FAEC`, `SERV_CLA` | atos da AIH: `SP_VALATO` soma o `VAL_TOT` do `RD`. Não lidos: `SP_NAIH`, datas, `SP_CPFCGC`, `SP_M_PAC`, `SP_PF_CBO` |

Tabelas auxiliares (por faixa de bytes, de `TAB_SIA.zip` e `TAB_SIH.zip`): `CODOCO` (código = `PA_CODOCO` + `PA_FLQT`; vale a folha), `INDICA`,
`DOCORIG` e `erroebloqueio.xlsx` (vigência de cada crítica; `0024` bloqueio, `0027` rejeição). Quando "guardar os arquivos baixados" está ligado,
ficam em `arquivos/<UF>` como `aux_<entrada>`. Medidas e limites: [fase 4.5](../fases/fase-4-5.md), seção 6.

## MOTERRO (tabela de motivos de rejeição)

`TAB_SIH.zip` (6.006.169 bytes em 05/10/2026) traz `DBF/MOTERRO.dbf` (81 KB): `CD_MOT_ERR` (6 caracteres, com espaços à direita) e
`DS_MOT_ERR` (120), **641 motivos**. O código é o mesmo do `CO_ERRO` do `ER`: dos 38 motivos de MS em 07/2026, 37 têm descrição
(`060225` não tem). Textos em ISO-8859-1. O `Motivo_de_Erro.DEF` do ZIP descreve só a ferramenta TabWin. O ZIP traz também
`Docs/erroebloqueio.xlsx` (não estudado; candidato para a conferência pré-envio, Fase 5).

O programa lê só o índice e a entrada (cerca de 100 KB em vez dos 6 MB) e carrega as descrições ao baixar o `ER`.

## Ainda por confirmar

- Totais contra o **TabNet** (nada foi comparado com ele).
- `SP` (serviços profissionais da AIH): não estudado, não usado.
- O comportamento em UF grande (SP, MG).

## API DEMAS (descartada como fonte; serviu de conferência do SIA)

`https://apidadosabertos.saude.gov.br/assistencia-a-saude/sia-procedimentos-ambulatoriais` e `…/sih-procedimentos-hospitalares`
respondem (competências até 2026-05 e 2026-03 em 05/10/2026), com procedimento, quantidade e valor por CNES. **Medido: devolvem
cerca de uma linha por estabelecimento e mês**:

| Consulta | Resultado |
|---|---|
| Unidade do hospital do cliente, ano 2017, 2020, 2023, 2025, 2026 | 11, 11, 11, 10 e 2 linhas (uma por mês) |
| Campo Grande (IBGE 500270), 01/2026, páginas 0, 1 e 2 | 1 linha por página, estabelecimentos diferentes |

Isso não é a produção por procedimento (um hospital produz centenas de procedimentos por mês). Pode ser uma amostra
ou um resumo; a documentação do endpoint não explica. A licença segue "a verificar". Nada é baixado dela pelo programa.

**Uso como conferência** (só nos testes desta fase, com cortesia): a linha que a API devolve para um estabelecimento, mês e
procedimento coincide com o total carregado do `PA`. Em 14 estabelecimentos (do maior ao menor) × 3 competências, **40 de 40** linhas
iguais em quantidade e valor. No SIH a linha da API é uma fatia (traz município do paciente e financiamento); nos 3 casos que
diferiram, o total carregado é maior.

## Pontos de atenção para a conferência pré-envio (Fase 5)

A produção aprovada é a melhor prova indireta da regra de aptidão: quem produziu e foi aprovado passou nas críticas do
SIA/SIH. A ficha mostra, para o procedimento, quantos produtores a regra considera aptos. Isso **não substitui** a prova forte
(arquivo rejeitado + retorno oficial).

**Resultado com a produção real de MS (07/2026)**, detalhado em `docs/fases/fase-4.md` (2.4): a regra da Fase 3 acerta
praticamente tudo (SIH 178/178, 74/75 e 107/107; SIA 27/27 e 612/612) **exceto** nos procedimentos cuja exigência é só de habilitações
**38.xx** (programa "Agora Tem Especialistas"): no SIH, 3 de 791 pares (0,4%). Essas habilitações não são condição para a aprovação.
O resto da diferença é o SIA "só serviço" (83%), compatível com serviço terceirizado. Base: uma UF e um mês.

A tabela de motivos de rejeição (MOTERRO) traz textos como "QUANTIDADE DE DIÁRIAS SUPERIOR A CAPACIDADE INSTALADA" e "AIH BLOQUEADA
PARA AUDITORIA NO PRONTUÁRIO": base para as regras da conferência pré-envio.
