# Cruzamentos para o faturista: o que se tira de juntar as fontes

Levantamento de 06/10/2026. Parte do [inventário de dados brutos](fontes/inventario-de-dados.md) e mostra, **por módulo do
programa**, cada informação útil que sai do cruzamento, quais fontes ela junta e **em que fase ela está disponível**.

## Como ler

| Marca | Significa |
|---|---|
| **Disponível (Fase N)** | Já está no programa, na fase indicada. Os números citados vêm de dado real de MS e estão fixados em testes. |
| **Fase 4.5** | Planejada em [`fases/fase-4-5.md`](fases/fase-4-5.md): dados já baixados, sem decisão pendente. |
| **Viável, não feito** | Os dados já estão carregados; falta construir e **validar com dado real** antes de prometer. |
| **Planejada (Fase N)** | Depende de fonte que ainda não entrou. A fase vem do catálogo de fontes. |
| **Hipótese** | Ideia ainda sem prova de que o dado sustenta. Na Fase 4 isso evitou construir quatro propostas que não se sustentaram (seção 9). |

Siglas das fontes: **SIG** SIGTAP · **TER** território (IBGE e DEMAS) · **CNES** · **SIA** (`PA`) · **SIH** (`RD`, `ER`, MOTERRO) ·
**ARQ** arquivo do hospital (BPA, APAC, AIH, RAAS, CIHA) · **ANS** (TUSS, TISS) · **BPS** Banco de Preços em Saúde.

> A fase de cada item futuro segue o catálogo `catalogo/fontes.toml`. O plano geral por fases (documento-mestre) não pôde ser lido na
> abertura da Fase 4; se ele atribuir outra fase, ele manda.

---

## 1. Resumo por fase

| Fase | O que o faturista ganha | Fontes juntadas |
|---|---|---|
| 1 | Qualquer procedimento, em qualquer competência desde 2008, idêntico ao SIGTAP oficial | SIG |
| 2 | Ficha completa com histórico, busca, árvore de procedimentos e de CIDs, "O que mudou", favoritos, anotações, exportação, região de saúde | SIG, TER |
| 3 | "Minha unidade": a unidade tem o que o SIGTAP exige (habilitação, serviço, leito, CBO) e quem mais faz o procedimento | SIG, CNES, TER |
| 4 | O que a unidade e a UF **de fato produziram e foram pagas**; rejeições com o motivo oficial; apresentado × aprovado; ocupação aproximada; impacto financeiro das mudanças da tabela | SIG, CNES, SIA, SIH |
| 5 | **Conferência pré-envio** dos arquivos BPA, APAC, AIH, RAAS e CIHA antes de transmitir | SIG, CNES, SIA, SIH, ARQ |
| 6 | Equivalência SUS × convênio e validação do XML TISS | SIG, ANS, ARQ |
| 7 | Preço de compra de insumos contra o valor da tabela | SIG, BPS |

---

## 2. Início (painel do faturista)

| Informação | Como se obtém | Fase |
|---|---|---|
| Alertas da unidade: mês incompleto, meses sem os campos novos, taxa de rejeição acima da dos pares | SIA/SIH (cobertura de meses) × competência baixada | **Disponível (4)** |
| "Pode e não produz, mas a UF produz": procedimentos que a unidade pode cobrar (exigência atendida no CNES) e que outros estabelecimentos da UF produzem, com o valor da UF nos últimos 12 meses completos | SIG (exigências) × CNES (habilitação, serviço) × SIA/SIH (produção da UF) | **Disponível (4)** |
| Mudanças da competência que atingem o que a unidade produz, com o impacto em R$ por ano | SIG (2 competências) × SIA/SIH da unidade | **Disponível (4)** |
| Prazo: "o arquivo desta competência ainda não foi conferido" | ARQ × competência vigente | Planejada (5) |
| Pendências da conferência pré-envio por gravidade | ARQ × SIG × CNES | Planejada (5) |

## 3. Consulta (busca, árvore de procedimentos, árvore de CIDs, favoritos)

| Informação | Como se obtém | Fase |
|---|---|---|
| Busca por código com ou sem máscara, nome sem acento, CID, CBO, habilitação | SIG | **Disponível (2)** |
| Procedimentos de um CID, árvore letra → categoria → subcategoria com a contagem | SIG (`rl_procedimento_cid` × `tb_cid`) | **Disponível (2)** |
| Resultado da busca com um selo "produzido na UF" e o volume dos últimos 12 meses | SIG × SIA/SIH | Viável, não feito |
| Busca por termo TUSS e atalho para o procedimento SIGTAP correspondente | ANS × SIG | Planejada (6) |

## 4. Ficha do procedimento

### 4.1 Resumo e abas de relações

| Informação | Como se obtém | Fase |
|---|---|---|
| Tudo o que o SIGTAP publica: valores SA, SH, SP, idade, sexo, quantidade máxima, permanência, pontos, financiamento, instrumentos de registro | SIG | **Disponível (2)** |
| Exigências agrupadas "para cobrar": CID, CBO, habilitação (com grupos), serviço/classificação, leito, modalidade | SIG | **Disponível (2)** |
| Compatibilidades e exceções, incrementos, origem, SIA/SIH de origem, regra condicionada, redes, RENASES | SIG | **Disponível (2)** |
| Quantos estabelecimentos da UF têm o que o procedimento exige, e quais | SIG × CNES | **Disponível (3)** |
| **Peso de cada exigência entre os produtores**: de N estabelecimentos que produziram, quantos têm cada habilitação e cada serviço. Mostra qual exigência de fato separa quem produz de quem não produz | SIG × CNES × SIA/SIH | **Disponível (4)** |
| Quem produz: quantidade de estabelecimentos, quantidade e valor por mês | SIA/SIH × CNES (nome) | **Disponível (4)** |
| Série mensal do procedimento na UF, só com meses completos | SIA/SIH (regra de mês completo) | **Disponível (4)** |
| Valor por financiamento (nome vem do SIGTAP) | SIA (`PA_TPFIN`) × SIG | **Disponível (4)** |
| Termos TUSS equivalentes, com **grau de equivalência** e data da fonte | ANS × SIG | Planejada (6) |
| Se alguém na UF faturou o procedimento com a CID que o arquivo traz | SIA/SIH × ARQ | Hipótese (5): o programa guarda só totais, não CID por linha |

### 4.2 Histórico

| Informação | Como se obtém | Fase |
|---|---|---|
| O que mudou no procedimento a cada competência (valor, exigência, relação), desde 2008 | SIG (intervalos de vigência) | **Disponível (2)** |
| Série mensal de produção ao lado do histórico: a mudança de valor e o que aconteceu com o volume | SIG × SIA/SIH | **Disponível (4)** |
| Nota técnica oficial do mês em que a mudança entrou (os PDFs estão no FTP; o programa ainda não os mostra) | SIG (notas técnicas) | Viável, não feito |

## 5. O que mudou (entre competências)

| Informação | Como se obtém | Fase |
|---|---|---|
| Procedimentos incluídos, excluídos, com valor ou exigência alterada entre duas competências | SIG | **Disponível (2)** |
| **Impacto estimado em R$/ano**: quantidade dos meses completos × diferença de valor × 12/meses (SIH usa SH + SP). Medido de 08 para 09/2026: 11 mudanças de valor, 2 com produção em MS, R$ 23.343/ano na UF | SIG × SIA/SIH | **Disponível (4)** |
| Rótulo "exigência alterada" nos procedimentos com produção (pode relaxar ou restringir; em MS nenhum passou a exigir o que antes não exigia) | SIG × SIA/SIH | **Disponível (4)** |
| Das exclusões da tabela, quais a unidade ainda produz | SIG × SIA/SIH da unidade | **Disponível (4)** |
| Efeito da mudança sobre os arquivos já preparados da competência | SIG × ARQ | Planejada (5) |

## 6. Minha unidade

### 6.1 Procedimentos

| Informação | Como se obtém | Fase |
|---|---|---|
| Procedimentos que a unidade pode cobrar pelo cadastro, marcados "habilitada" ou "a confirmar" (só serviço próprio no CNES) | SIG × CNES | **Disponível (3)** |
| **Apta × produz**: `produz_apta`, `produz_com_ressalva`, `apta_nao_produz`, `produz_sem_aptidao` (com motivo só 38.xx, habilitação, habilitação e serviço), `produz_sem_exigencia`, `produz_fora_da_tabela` | SIG × CNES × SIA/SIH | **Disponível (4)** |
| Curva ABC por valor (A até 80%, B até 95%) e tendência (3 últimos meses completos × 3 anteriores; ±3% = estável) | SIA/SIH | **Disponível (4)** |

### 6.2 Habilitações

| Informação | Como se obtém | Fase |
|---|---|---|
| Habilitações vigentes, portaria e vigência | CNES | **Disponível (3)** |
| Por habilitação: procedimentos que a citam, quantos a unidade produziu e o valor; marca "sem produção"; 38.xx à parte | SIG × CNES × SIA/SIH | **Disponível (4)** |
| Habilitação que venceu ou perdeu entre duas competências do CNES e a produção afetada | CNES (2 competências) × SIA/SIH | Viável, não feito (depende de mais de uma competência do CNES baixada) |

### 6.3 Serviços

| Informação | Como se obtém | Fase |
|---|---|---|
| Serviços e classificações da unidade, com o nome do SIGTAP | CNES × SIG | **Disponível (3)** |
| Aviso de que o CNES público não traz serviço terceirizado | CNES | **Disponível (3)** |

### 6.4 Leitos

| Informação | Como se obtém | Fase |
|---|---|---|
| Leitos existentes e SUS por tipo, com o procedimento que exige cada tipo | CNES × SIG | **Disponível (3)** |
| **Ocupação aproximada** = dias de permanência ÷ (leitos SUS × dias do mês); AIH por leito SUS. Medido: maior hospital de MS, cerca de 91% | CNES (`QT_SUS`) × SIH (`DIAS_PERM`) | **Disponível (4)** |
| Dias de UTI no mês | SIH (`UTI_MES_TO`) | **Disponível (4)** |
| Ocupação **real**, contra o censo hospitalar | Fonte que não temos | Hipótese (sem fonte) |

### 6.5 Equipamentos e Profissionais

| Informação | Como se obtém | Fase |
|---|---|---|
| Equipamentos da unidade com o nome oficial | CNES (`EQ` × `equipam2508.cnv`) | **Disponível (3)** |
| Profissionais por CBO, conselho, vínculo e horas (só a unidade escolhida, sem CPF nem CNS) | CNES (`PF`) | **Disponível (3)** |
| CBO exigido pelo procedimento × profissionais da unidade | SIG × CNES | Hipótese: só `cnes_pf` de **uma** unidade; nada a cruzar em escala |
| CBO do arquivo de faturamento × profissionais cadastrados (casando por resumo criptográfico do CNS, nunca o número) | ARQ × CNES | Planejada (5); decisão de privacidade pendente |

### 6.6 Produção

| Informação | Como se obtém | Fase |
|---|---|---|
| Valor e quantidade por mês no SIA e no SIH, só com meses completos; coluna "Completa até" | SIA/SIH | **Disponível (4)** |
| **Rejeições por 100 AIH aprovadas**, por mês, com o motivo oficial em português (641 motivos do MOTERRO) | SIH (`ER` × `RD` × MOTERRO) | **Disponível (4)** |
| **Apresentado × aprovado** (glosa do SIA): quantidade e valor apresentados menos aprovados, por procedimento. Medido em MS: R$ 64,5 mil nos 11 meses completos do maior hospital, concentrado em ressonância magnética | SIA (`PA_QTDPRO`, `PA_VALPRO`, `PA_QTDAPR`, `PA_VALAPR`) | **Disponível (4)** |
| Valor por financiamento | SIA/SIH (`PA_TPFIN`, `FINANC`) × SIG | **Disponível (4)** |
| **Comparação com pares do mesmo tipo de unidade** (`TP_UNID`) na UF: percentil do valor e mediana da taxa de rejeição (só pares com 50 AIH ou mais) | CNES (`TP_UNID`) × SIA/SIH | **Disponível (4)** |
| Valor aprovado × quantidade × tabela (diferença neutra; o incremento explica poucos casos) | SIA × SIG | **Disponível (4)** |
| **Taxa de rejeição prevista** do arquivo antes do envio, comparada com o histórico da unidade | ARQ × SIH (`ER`) | Planejada (5) |
| Procedimentos por mil habitantes, por região de saúde: produção da região dividida pela população DEMAS 2022 | SIA/SIH × CNES (município) × TER | Viável, não feito (exige as produções de todas as UFs da região; hoje só as UFs baixadas) |
| Sazonalidade e comparação com o mesmo mês dos anos anteriores | SIA/SIH (mais de 12 meses) | Viável, não feito (precisa baixar mais competências; custo de rede, não de código) |

## 7. Módulos e dados

| Informação | Como se obtém | Fase |
|---|---|---|
| Quais competências do SIGTAP, CNES e produção estão carregadas e até quando cada uma está completa | Todas | **Disponível (2, 3, 4)** |
| Aviso de "baixe de novo" para meses carregados antes do esquema 2 | SIA/SIH | **Disponível (4)** |
| Atualização do CNES, do SIGTAP e da produção, com cortesia e retomada | Todas | **Disponível (2, 3, 4)** |
| Cadastro dos leiautes de arquivo (BPA, APAC, AIH…) e de cada regra com seu estado "não confirmada / confirmada" | ARQ | Planejada (5) |

---

## 8. Módulos futuros

### 8.1 Conferência pré-envio (Fase 5)

Entrada: o arquivo que o faturista gerou. Saída: relatório por arquivo, linha e regra, com gravidade, mensagem em português, como
corrigir e código oficial (MOTERRO) quando existir. **Cada regra nasce "não confirmada"** e só muda com prova: arquivo rejeitado real
mais o retorno oficial.

| Conferência | Cruza | Observação |
|---|---|---|
| Controle do cabeçalho do BPA e da APAC | ARQ | Fórmula já reproduzida em arquivo real (BPA 1917, APAC 1714) |
| Procedimento existe e está vigente **na competência do arquivo** | ARQ × SIG | Usa o histórico por competência |
| Instrumento de registro compatível com o tipo de arquivo (BPA-C, BPA-I, AIH, APAC) | ARQ × SIG (`tb_registro`) | |
| Quantidade acima do máximo; idade e sexo fora da faixa; valor | ARQ × SIG | BPA-I tem idade e sexo; BPA-C não |
| CBO do profissional compatível com o procedimento | ARQ × SIG (`rl_procedimento_ocupacao`) | |
| CID permitida e CID principal | ARQ × SIG (`rl_procedimento_cid`) | |
| Habilitação e serviço/classificação exigidos × o que o CNES da unidade tem | ARQ × SIG × CNES | **Mesma regra da aptidão da Fase 3**, ainda "não confirmada"; ver a decisão sobre as 38.xx |
| Compatibilidade entre procedimento principal e secundário | ARQ × SIG (`rl_procedimento_compativel`, exceções) | Principal na APAC e na AIH |
| Tipo de leito e diárias × capacidade instalada | ARQ (AIH) × CNES (`LT`) × SIG (`rl_procedimento_leito`) | Reproduz a crítica "quantidade de diárias superior à capacidade instalada" do MOTERRO. **Depende do leiaute real da AIH**, que não é o publicado |
| Permanência da AIH × média e tempo de permanência do procedimento | ARQ (AIH) × SIG | Idem |
| "Ninguém na UF produziu isto nos últimos 12 meses" como aviso de risco, **não** como erro | ARQ × SIA/SIH | Prova **indireta**: quem foi aprovado passou nas críticas. Não substitui a prova forte |
| Se o arquivo reproduz um motivo que o `ER` já devolveu a esta unidade | ARQ × SIH (`ER`, MOTERRO) | Fecha o ciclo: rejeição de ontem vira regra de hoje |
| Casar CNS do profissional do arquivo com o cadastro | ARQ × CNES (`PF`) | Só por resumo criptográfico; decidir ao entrar na Fase 5 |

Arquivos ainda sem leiaute: AIH real (1.925 bytes). **CIHA** (390 posições, 2014) e **RAAS** (psicossocial de 2025, atenção domiciliar de 2013) têm leiaute, sem amostra para provar.

### 8.2 TUSS e TISS (Fase 6)

| Informação | Cruza | Observação |
|---|---|---|
| Para um procedimento SIGTAP, o(s) TUSS equivalente(s), com grau de equivalência e data da fonte | ANS × SIG | O de-para é de **2017**: só 22,4% dos procedimentos vigentes em 202609 aparecem nele. **Apoio, nunca verdade**. `rl_procedimento_tuss` do SIGTAP está vazia |
| Valor SUS do procedimento ao lado do TUSS que o convênio paga | SIG × ANS | O preço do convênio vem do contrato do hospital, não de fonte pública. Fica como campo do usuário |
| Procedimentos que a unidade faz no SUS e que têm equivalente TUSS | SIA/SIH × ANS | Hipótese: a cobertura do de-para limita |
| Validação do XML TISS contra o XSD e do hash do epílogo | ARQ (XML) × ANS | Hash MD5 do conteúdo das tags, ISO-8859-1 |
| Licença da TUSS | — | Site da ANS sob **CC BY-ND 3.0** (levantamento no inventário, 12.3): atribuição obrigatória e sem obra derivada, ponto para o parecer jurídico |

### 8.3 Preços de compra (Fase 7)

| Informação | Cruza | Observação |
|---|---|---|
| Preço praticado de um material ou medicamento ao lado do valor SH/SA do procedimento | BPS × SIG | **Hipótese.** A API exige código CATMAT, e **não há tabela que ligue CATMAT a procedimento do SIGTAP**. Só vale se a ligação for informada pelo usuário |

### 8.4 Fontes estudadas em 06/10/2026 e o que sobrou por estudar

As fontes abaixo foram abertas (arquivo real de MS) e rendem os cruzamentos da seção 10. O detalhe campo a campo está no
[inventário](fontes/inventario-de-dados.md), seção 11.

| Fonte | Estado | Onde entra |
|---|---|---|
| SIH `SP` | Estudado: soma ao centavo igual ao `VAL_TOT` do `RD` | Seção 10, itens 5 e 6 |
| SIH `RJ` | Estudado: as mesmas 694 AIH do `ER` | Seção 10, item 7 |
| `erroebloqueio.xlsx` | Estudado: vigência de cada crítica | Seção 10, item 8; Fase 5 |
| SIA `PA` e SIH `RD` (campos novos) | Estudados | Seção 10, itens 1 a 4, 9 a 12 |
| SIA `BI`, `PS`, `AD`, `AM`, `AQ`, `AR` | Estudados: são detalhe por paciente de linhas que o `PA` já soma | Nenhum cruzamento novo de valor; ver seção 10, item 13 |
| CNES `RC`, `IN`, `GM`, `EF`, `EP`, `DC` | Estudados | Seção 10, itens 3, 4 e 14 |
| Mapeamento TUSS × SIGTAP do DATASUS | Estudado: 977 linhas, graus 1 e 2 | Seção 8.2 (Fase 6) |
| **Ainda por estudar** | `base_aih1.duck` (estudado: inventário, 12.8), BPS (nenhum CATMAT de teste devolveu dado), amostras públicas de CIHA e RAAS (não existem), `PA_FLER` | — |

---

## 9. O que foi validado e **não** se sustentou

Estas ideias pareciam úteis, foram testadas com dado real de MS na Fase 4 e **não foram construídas**:

| Ideia | Por que não vale | Pode voltar? |
|---|---|---|
| Valor médio da AIH × valor da tabela, no SIH | `VAL_TOT` é o total da AIH (OPM, UTI, outros procedimentos): procedimentos com tabela zero aparecem com cerca de R$ 9 mil por AIH | **Sim, com `SP`**: ele decompõe o `VAL_TOT` ao centavo (seção 10, itens 5 e 6) |
| Procedimentos **compatíveis na prática** | Exigiria saber o que aparece junto na mesma AIH ou APAC: dado de paciente, que o programa não guarda | **Não**, por desenho de privacidade. Na Fase 5 a compatibilidade vem do SIGTAP |
| **Equipamento exigido** × equipamento da unidade | O SIGTAP não tem tabela de equipamento exigido | Não, sem fonte nova |
| **CBO exigido** × profissionais, em escala | Só uma unidade tem profissionais carregados | Quando o usuário carregar as unidades que interessam |
| "Regra mais restrita" nas mudanças | De 72 procedimentos com exigência alterada e produção, nenhum passou a exigir algo novo | Já rotulado "exigência alterada" |
| "Comparar unidades" como tela livre | Não existe tela; foi trocada pela comparação com os pares do mesmo tipo | Já feita |

## 10. Novos cruzamentos, habilitados pelas fontes estudadas em 06/10/2026

Todos validados em arquivo real de MS (07/2026) apenas **quanto à existência e à consistência do dado**; nenhum foi construído. A marca
"Fase 4.5" quer dizer: usa a mesma produção da Fase 4, com mais campos no esquema do banco (**esquema 3**), o que obriga baixar de novo
os meses já carregados, como na passagem do esquema 1 para o 2.

### 10.1 Minha unidade, aba Produção

| # | Informação | Cruza | Evidência medida | Fase |
|---|---|---|---|---|
| 1 | **Por que o SIA não pagou**: do que foi apresentado a mais que o aprovado, quanto foi cortado por **teto financeiro**, por teto físico, por falta de orçamento ou de valor unitário. A coluna decide o que fazer: teto não é erro de faturamento, é negociação com o gestor | SIA (`PA_INDICA`, `PA_CODOCO`, `PA_FLQT`, `PA_VALPRO`, `PA_VALAPR`) | R$ 1.372.926,63 de diferença em MS 07/2026 = R$ 995.410,34 não aprovado (**todo `O`, ultrapassou teto financeiro**) + R$ 377.516,29 aprovado parcial (**todo `M`, idem**). **100% teto financeiro; nenhuma crítica de erro.** Tabela de significados em `CODOCO.CNV` (inventário, 12.4) | Fase 4.5 |
| 2 | **Produção por instrumento de registro**: BPA-C, BPA-I, APAC principal, APAC secundária, RAAS | SIA (`PA_DOCORIG`) × SIG (`rl_procedimento_registro`) | BPA-I R$ 11,67 mi; APAC principal R$ 10,57 mi; BPA-C R$ 5,75 mi; APAC secundária R$ 1,26 mi; RAAS-PSI R$ 0 (a RAAS psicossocial aparece com valor zero no `PA`). Permite apontar procedimento produzido num instrumento que o SIGTAP não lista para ele | Fase 4.5 |
| 3 | **Unidade com regra contratual: produz, mas não gera crédito.** Mostra a regra pelo nome oficial e o valor aprovado sob ela | CNES (`RC`, `DBF/REGRAS.DBF`) × SIA (`PA_REGCT`) × SIH (`REGCT`) | 31,8% dos registros do `PA` de MS têm regra (`7101`: R$ 2,29 mi em 207 mil registros). O mesmo código do `RC` aparece no `PA` | Fase 4.5 |
| 4 | **Perfil financeiro da unidade**: incentivos (`IN`), contrato de gestão e metas (`GM`), hospital filantrópico (`EF`), e o que entrou como incremento, complemento local, federal e crédito na produção | CNES (`IN`, `GM`, `EF`) × SIA (`PA_VL_INC`, `PA_VL_CL`, `PA_VL_CF`, `PA_VL_CRD`) × SIH (`VAL_SH_FED`, `VAL_SP_FED`, `VAL_SH_GES`, `VAL_SP_GES`) | MS: 143 estabelecimentos com incentivo, 52 com gestão e metas, 16 filantrópicos; R$ 781 mil de complemento local e R$ 290 mil de incremento no `PA` de 07/2026 | Fase 4.5 |
| 5 | **De que é feito o valor da AIH**: SH, SP, complementos federal e do gestor, e a divisão por capítulo do ato (OPM, cirurgias, diagnóstico, clínicos) | SIH (`SP` × `RD`) | `SP_VALATO` soma R$ 29.053.487,20 = `VAL_TOT`. SH R$ 22,42 mi · SP R$ 6,02 mi · complementos federais R$ 0,62 mi. Por capítulo: cirurgias 04 R$ 10,10 mi, OPM 08 R$ 8,27 mi, clínicos 03 R$ 5,07 mi, órteses e próteses 07 R$ 2,45 mi | Fase 4.5 |
| 6 | **OPM e material pesam quanto no faturamento da unidade**, e por procedimento principal | SIH (`SP`, capítulos 07 e 08) × SIG | Capítulos 07 e 08 somam R$ 10,7 mi de R$ 29,1 mi (37%) em MS 07/2026 | Fase 4.5 |
| 7 | **Rejeição em reais, não só em quantidade**: valor e procedimento das AIH rejeitadas por motivo | SIH (`RJ` × `ER`) | As 694 AIH do `RJ` são as mesmas do `ER`, nos mesmos 55 CNES. Casar `ER` e `RJ` exige o número da AIH, que é dado pessoal: só em memória e por resumo, sem gravar. **Decisão de privacidade pendente** | Fase 5 (condicionado) |
| 8 | **Motivo de rejeição com vigência**: a crítica estava em vigor na competência? Bloqueios (tabela `0024`) separados das rejeições (`0027`) | SIH (`ER`, MOTERRO, `erroebloqueio.xlsx`) | 60 bloqueios de 4 dígitos e 579 rejeições de 6; 567 dos 581 do MOTERRO casam com a vigência; 14 não | Fase 4.5 (vigência) e Fase 5 (conferência) |
| 9 | **Serviço/classificação realmente executado**, contra o que o CNES lista: diz se a produção sem serviço no CNES é terceirizado ou cadastro incompleto | SIA (`PA_SRV_C`) e SIH (`SERV_CLA` do `SP`) × CNES (`SR`) × SIG (`rl_procedimento_servico`) | `PA_SRV_C` preenchido em 17% dos registros (os que exigem serviço); `SERV_CLA` em 13% dos atos do `SP`. **Resolve em parte o limite "o CNES público não traz serviço terceirizado"** | Fase 4.5 |
| 10 | **CBO que realmente produz** o procedimento, contra os CBO que o SIGTAP aceita (`rl_procedimento_ocupacao`) | SIA (`PA_CBOCOD`) e SIH (`SP_PF_CBO`) × SIG | `PA_CBOCOD` em 110 CBO; 236 registros sem CBO. Prova indireta da regra de CBO. Exige o piso de contagem de privacidade (inventário, seção 10) | Fase 5 (condicionado ao piso de privacidade) |
| 11 | **Produção de meses anteriores reapresentada**: o que entrou neste processamento com competência de realização atrasada | SIA (`PA_CMP` × `PA_MVM`) | 5,0% dos registros do arquivo de 07/2026 são de 04 a 06/2026 | Fase 4.5 |
| 12 | **Perfil do atendimento**: eletivo × urgência (`PA_CATEND`, `CAR_INT`), complexidade, óbito (`MORTE`) | SIA/SIH | `PA_CATEND` `01` 895 mil · `02` 287 mil; exige o piso de privacidade | Fase 5 (condicionado ao piso de privacidade) |

### 10.2 Outros módulos

| # | Módulo | Informação | Cruza | Fase |
|---|---|---|---|---|
| 13 | Minha unidade (APAC) | **Valor aprovado da APAC por tipo de laudo** (quimioterapia, radioterapia, medicamentos, laudos diversos, RAAS) | SIA (`AQ`, `AR`, `AM`, `AD`, `PS`) | **Não se justifica**: o `PA` já traz o valor por procedimento e instrumento (`BI` e `PS` têm exatamente os registros do `PA` `I` e `B`). Só valeria para o clínico (esquema, estádio), que é dado de paciente |
| 14 | Minha unidade (perfil) | **Equipes de atenção primária** (tipo, ativação, desativação e motivo) | CNES (`EP`, `EQUIPE.dbf`, `MOTDESAT.cnv`) | Fora do foco hospitalar; **proposta** de Fase 7 ou posterior |
| 15 | Ficha do procedimento | "Em MS, **N% da produção deste procedimento sai de unidades sem geração de crédito**" | SIA (`PA_REGCT`) | Fase 4.5 |
| 16 | Início | Alerta: "R$ X apresentados e não aprovados no último mês completo" e "sua unidade tem a regra contratual 7101" | itens 1 e 3 | Fase 4.5 |
| 17 | Conferência pré-envio | Crítica vigente na competência do arquivo, com a descrição oficial | `erroebloqueio.xlsx` × ARQ | Fase 5 |
| 18 | Conferência pré-envio (BPA-C) | O BPA-C gera **um registro por par procedimento × CBO**: a conferência pode apontar par duplicado dentro da folha | ARQ × `PA_DOCORIG` = `C` | Fase 5 |
| 19 | Conferência pré-envio (idade) | Regra de idade do SIGTAP: o `PA_FLIDADE` do `PA` real mostra **zero** casos "fora da faixa" em 1,2 milhão de registros, confirmando que a crítica barra antes de aprovar | SIA (`PA_FLIDADE`) × SIG | Fase 5 (prova indireta) |
| 20 | Conferência pré-envio (RAAS-PSI) | Leiaute lido (cabeçalho `#RAS#`, linhas 15 e 16, controle = códigos + quantidades da linha 16) | ARQ | Fase 5, depende de amostra para provar o controle |
| 21 | TUSS (Fase 6) | De-para **conservador** do DATASUS (graus 1 e 2, 977 linhas, 888 vigentes) como camada **validada**, e a planilha da ANS (6.919 linhas) como camada **ampla** | ANS × DATASUS × SIG | Fase 6 |

### 10.2.1 O que a segunda passagem acrescentou (06/10/2026: SP, SES-SP, CIHA, ocorrências)

| # | Módulo | Informação | Cruza | Evidência | Fase |
|---|---|---|---|---|---|
| 22 | Minha unidade e ficha (UF de SP) | **Quanto a Tabela SUS Paulista adiciona** ao procedimento e à unidade: valor do MS, complementação estadual, valor paulista; estimativa de complementação da unidade = quantidade produzida × complementação | SES-SP (3 XLSX) × SIG × SIA/SIH de SP × CNES (natureza jurídica) | A coluna "Tab SUS MS" é **idêntica ao SIGTAP 202606** (680/680, 1.692/1.694, 109/109). Cobre 49% do valor aprovado do SIA de SP. O `PA` traz o valor do MS, não o Paulista: **a complementação estadual não está na produção federal** e só se estima | **Fase 8 (proposta)**: fonte estadual nova; depende de licença (sem declaração) e da regra de elegibilidade (excluídos prestadores de natureza jurídica pública) |
| 23 | Minha unidade, aba Produção | **Teto financeiro**: valor de cada competência que o gestor não pagou por teto, por procedimento (`PA_FLQT` O, M, T, R, S) | SIA (`PA_CODOCO`, `PA_FLQT`) | Ver item 1. `R` e `S` (teto financeiro, mas aprovados) somam 56.842 registros em MS 07/2026 | Fase 4.5 |
| 24 | Minha unidade, aba Produção | **Apresentação fora de qualquer realidade**: alerta quando a quantidade apresentada por procedimento é muito maior que a série da própria unidade ou que a mediana dos pares | SIA (`PA_QTDPRO`) × pares do mesmo `TP_UNID` | Em SP, **um só estabelecimento** apresentou cerca de 2 milhões de unidades de hemocultura, adenograma e mielograma em 12/2025: R$ 192,6 mi de R$ 198 mi de diferença da UF. Sem o alerta, a glosa da UF fica dominada por esse caso | Fase 4.5 |
| 25 | Início, Produção | **Mês incompleto por estabelecimento, não só por UF**: 84% dos estabelecimentos de SP em 07/2026 | SIA/SIH (cobertura) | SIA 07/2026: 7.241 estabelecimentos contra 8.586 de mediana | **Disponível (4)**, confirmado em SP |
| 26 | Conferência pré-envio (CIHA) | Conferir o arquivo da CIHA (hospitais que atendem fora do SUS) contra o SIGTAP: procedimento (`PROC_REA`), CID, tipo de alta, modalidade, fonte de remuneração (`TP_FREMU`) | ARQ (CIHA, 390 posições) × SIG × CNES | **Leiaute de 2014 achado** (inventário, 12.1); falta amostra | Fase 5 (depois de BPA e APAC) |
| 27 | Conferência pré-envio (RAAS) | RAAS psicossocial: controle e campos; RAAS-AD só com o leiaute de 2013 | ARQ × SIG × CNES (`PA_SRV_C`) | Inventário 12.2 | Fase 5, depois de BPA e APAC |
| 28 | TUSS (Fase 6) | **Aviso de licença na tela**: o conteúdo da ANS está sob CC BY-ND 3.0; mostrar sempre a atribuição e não redistribuir derivado | ANS | Inventário 12.3 | Fase 6, depende do parecer jurídico |
| 29 | Minha unidade (SP) | **Tempo de resposta**: o painel leva 20 s em SP porque agrega a UF inteira a cada abertura | SIA (`prod_amb`) | Inventário 12.6: 14 s por agregação; a solução é uma tabela de totais da UF por procedimento e competência, gravada na carga | Fase 4.5, obrigatório antes de liberar UF grande |

### 10.2.3 O que a base consolidada de AIH (`stg_aih`) acrescenta

| # | Módulo | Informação | Cruza | Evidência | Fase |
|---|---|---|---|---|---|
| 30 | Ficha do procedimento | **Permanência real × média de permanência do SIGTAP**: mediana e percentis nacionais de `QT_DIAS_PERM` por procedimento, ao lado de `qt_dias_permanencia` e `qt_tempo_permanencia` da tabela | Base de AIH × SIG | `stg_aih` tem `QT_DIAS_PERM` e `CO_PROCEDIMENTO_REALIZ` de 221 milhões de AIH. O `RD` por UF também (`DIAS_PERM`) | Fase 4.5 com o `RD`; a base nacional só como referência de desenvolvimento |
| 31 | Minha unidade (hospital) | **Indicadores de qualidade do hospital**: proporção de internações por **condição sensível à atenção primária (CSAP)**, por causa externa e por faixa etária, contra os pares | `RD` (`DIAG_PRINC`) × tabela CSAP e causa externa extraída da `dim_cid_subcategoria` | A dimensão tem o indicador e o grupo CSAP (14.274 subcategorias) | Fase 5, condicionado ao piso de privacidade (CID por unidade) |
| 32 | Minha unidade | **Série longa**: 18 anos de AIH e valor por mês, para sazonalidade e comparação com o mesmo mês dos anos anteriores | `RD` por UF e mês (uma competência por vez) | O Brasil passou de 11,1 milhões de AIH (R$ 8,3 bi) em 2008 a 14,6 milhões (R$ 25,8 bi) em 2025; 2020 caiu a 10,7 milhões (pandemia) e 2021 chegou a R$ 22,4 bi | Fase 4.5, custo de rede |
| 33 | Minha unidade | **Natureza do hospital** (filantrópico, ensino, gestão estadual ou municipal) para escolher os pares de comparação | `ST` do CNES (`NAT_JUR`, `ESFERA_A`) e `EF` × `RC`/`IN`/`GM` | Na base: 21,8% das AIH são de hospital filantrópico e 42,5% de gestão estadual | **Disponível (3)** em parte; completa com a Fase 4.5 |

**A base de 12 GB em si não vai para o programa** (inventário, 12.8): os dados que importam já estão no `RD` por UF e mês.

### 10.2.2 Arquivos que não rendem mais nada

`EE` (ensino): série encerrada em 12/2019. `AN` (nefrologia): encerrada em 2014. `SAD` (atenção domiciliar): encerrada em 2018. APAC `ABO`, `ACF`, `ATD` e `AMP`:
têm só o clínico por paciente, igual a `AQ` e `AR`; o valor já está no `PA`. Estes arquivos **não devem ser baixados** para o faturamento.

### 10.3 O que isso exige do programa

- **Esquema 3 da produção:** novos campos somados (`PA_INDICA`, `PA_DOCORIG`, `PA_REGCT`, `PA_SRV_C`, `PA_CMP`, `PA_VL_CL`, `PA_VL_CRD`, `PA_VL_CF`, `RD.REGCT`,
  `VAL_SH_FED` e afins), tabela `prod_hosp_ato` para o `SP`, migração automática como a do esquema 2 e aviso de "baixe de novo".
- **CNES:** ler `RC`, `IN`, `GM` e `EF` (arquivos pequenos: 1,5 a 12 KB em MS) com a mesma privacidade do `ST` (`CPF_CNPJ` apagado quando pessoa física), e os decodificadores de `TAB_CNES.zip`.
- **SIH:** ler o `SP` (4,1 MB em MS) e, só com a decisão de privacidade, o `RJ` (51 KB).
- **Tabelas auxiliares:** `erroebloqueio.xlsx` e `REGCT.cnv` de `TAB_SIH.zip`; `REGRA_C.cnv` e `INDICA.cnv` de `TAB_SIA.zip`.
- **Decisões do cliente:** piso de contagem para CBO e CID por unidade; casar `ER` e `RJ` por resumo do número da AIH em memória; se o esquema 3 entra na Fase 4.5 (decidido: [`fase-4-5.md`](fases/fase-4-5.md)).

## 10.4 Plano por fase (resumo)

O mapa completo, com condições, está em [`fases/fase-4-5.md`](fases/fase-4-5.md), seção 5.

| Fase | Itens da seção 10 |
|---|---|
| **4.5** | 1, 2, 3, 4, 5, 6, 8, 9, 11, 15, 16, 23, 24, 25, 29, 30, 32, 33 |
| **5** | 7, 10, 12, 17 a 20, 26, 27, 31 (alguns condicionados ao piso de privacidade) |
| **6** | 21, 28 |
| **7** | 14 e o BPS |
| **8** (proposta) | 22 (Tabela SUS Paulista) |
| Sem fase | 13 e os arquivos de série encerrada (10.2.2) |

## 11. Decisões e limites que afetam vários módulos

- **Habilitações 38.xx** (programa "Agora Tem Especialistas"): em MS, todos os 254 procedimentos "produz sem aptidão" do maior hospital
  têm só a 38.xx como falta, e o SIH aprova mesmo assim (3 de 791 pares). Tratá-las como **informativas na regra de aptidão** é decisão
  do cliente e mudaria números fixados em testes. Nenhuma tela depende dela hoje; a Fase 5 depende.
- **Regra de aptidão ainda "não confirmada"**: a produção real é a melhor prova indireta (SIH 178/178, 74/75 e 107/107; SIA 27/27 e 612/612),
  mas falta um arquivo rejeitado por habilitação ou serviço com o retorno oficial.
- **Mês completo**: análise de volume só usa meses com pelo menos 90% da mediana dos três anteriores; os 12 últimos meses completos formam a janela.
- **Privacidade**: a produção é guardada **agregada**. Nada que dependa de paciente, de CID ou de CBO por linha sai dela.
- **Ainda sem prova**: totais contra o TabNet; UF grande (SP, MG); ocupação contra o censo hospitalar; padrão só-38.xx em outras UFs e meses.
- **Licença dos dados**: levantamento sem parecer jurídico ([`licenca-dos-dados.md`](fontes/licenca-dos-dados.md)); parecer pendente.
