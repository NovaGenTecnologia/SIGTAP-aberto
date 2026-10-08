# Fase 4.5 — Produção completa: teto, composição, regras e desempenho

Abertura (planejamento): 06/10/2026. Plano geral: [SIGTAP Aberto: plano de desenvolvimento por fases](https://claude.ai/code/artifact/2ee9540a-db25-4169-919a-a51acbd95324).

> **Estado (07/10/2026): Q00 a Q18 construídas e testadas; Q19 (prova na janela) pendente; ver a seção 6.** Planejamento original:
> **planejada, nada construído.** Esta fase reúne tudo o que os estudos de 05 e 06/10/2026 mostraram que **já pode ser implantado com os dados que o
> programa baixa hoje**, sem fonte nova e sem esperar decisão de privacidade. O que depende de arquivo do hospital, de decisão do cliente ou de fonte nova
> está nas Fases 5 a 8 (seção 5). Fontes e medidas: [inventário](../fontes/inventario-de-dados.md); cruzamentos e números:
> [cruzamentos para o faturista](../cruzamentos-para-o-faturista.md).
>
> O plano geral (documento-mestre) não pôde ser lido na abertura da Fase 4; se ele atribuir outra numeração, ele manda. A "4.5" fica entre a Fase 4 (produção e
> rejeições, feita) e a Fase 5 (conferência pré-envio) porque **reaproveita os mesmos arquivos e as mesmas telas da Fase 4**: muda o esquema do banco de produção
> (de 2 para 3) e acrescenta consultas e telas.

Objetivo: o faturista passa a ver **por que** a produção não foi paga (teto financeiro, e não erro), **de que é feita** a AIH, **que regras contratuais, incentivos
e complementos** a unidade tem, e usa tudo isso em **UF grande** (SP) sem esperar 20 segundos.

## 1. Levantamento de escopo

### 1.1 O que os estudos mostraram (resumo; medidas no inventário e nos cruzamentos)

| Achado | Medida | Consequência |
|---|---|---|
| A diferença apresentado × aprovado do SIA é **teto financeiro** | MS 07/2026: R$ 1.372.926,63 = `PA_FLQT` `O` (R$ 995.410,34) + `M` (R$ 377.516,29); nenhuma crítica de erro | A tela da Fase 4 chama de "glosa" o que é teto: **corrigir o rótulo e abrir o motivo** |
| Um estabelecimento domina a diferença da UF | SP 12/2025: R$ 192,6 mi dos R$ 198 mi; cerca de 2 milhões de unidades apresentadas de exames | Alerta de **quantidade atípica** |
| A UF grande é lenta | SP, 4,1 milhões de linhas: painel 19,9 s, procedimentos 16,5 s, impacto 16,9 s; agrupamento da UF inteira = 14 s; memória só 30 MB | **Tabela de totais da UF** gravada na carga |
| O `SP` do SIH decompõe a AIH ao centavo | `SP_VALATO` = `VAL_TOT` = R$ 29.053.487,20 (MS 07/2026); SH R$ 22,42 mi + SP R$ 6,02 mi + complementos R$ 0,62 mi; OPM e material = 37% | Composição do valor da AIH; reabilita a comparação com a tabela |
| Regra contratual explica "produz e não gera crédito" | 31,8% dos registros do `PA` de MS têm `PA_REGCT`; o mesmo código está no `RC` do CNES; **os códigos 6xxx a 8xxx não existem no SIGTAP** | Perfil financeiro da unidade (`RC`, `IN`, `GM`, `EF`) |
| Instrumento de registro e serviço executado estão no `PA` | `PA_DOCORIG` 5 valores; `PA_SRV_C` em 17% dos registros | Valor por instrumento; serviço executado × CNES (resolve em parte o "terceirizado") |
| As críticas do SIH têm vigência | `erroebloqueio.xlsx`: 60 bloqueios e 579 rejeições, com início e fim | Motivo de rejeição com vigência |
| Padrão `so_38` se repete em SP | 10 maiores unidades: todos `so_38`, 3 exceções de `habilitacao` | A decisão sobre as 38.xx continua com o cliente; não bloqueia esta fase |

### 1.2 Entregas e validação

Cada entrega só fecha com **prova em dado real**: MS (12 meses, esquema 2) e SP (12 meses, 4,1 milhões de linhas), conferência contra SQL independente, número em teste fixo.

**Bloco A — fundação (nesta ordem; tudo depende dele)**

| Id | Entrega | Como será validada |
|----|---------|--------------------|
| Q00 | **Chave "guardar os arquivos baixados"** (`manter_arquivos_brutos`, padrão **desligada**): ligada, os `.dbc` brutos da produção (e a tabela de motivos) ficam em `dados/producao/arquivos/<UF>`; **refazer a produção dos arquivos guardados sem rede** (`producao-reconstruir`); o download pula o que já está guardado com o mesmo tamanho; apagar os guardados; tela com aviso de privacidade. **ST, CADGER e PF do CNES (CPF) nunca são guardados, com ou sem a chave** | Testes: padrão desligada e persistente; ligada guarda, desligada apaga; reconstruir refaz o banco apagado (inclusive os motivos de rejeição) sem rede e sem apagar os brutos; plano pula o já guardado; situação informa chave e bytes guardados. **Feita em 06/10/2026** |
| Q01 | **Totais da UF por procedimento e competência**, gravados na carga e na migração (`prod_amb_uf`, `prod_hosp_uf`: quantidade, valor, apresentado, estabelecimentos). Consultas da UF inteira (painel, procedimentos, impacto, pares) passam a ler dela | Totais iguais a `GROUP BY` direto sobre `prod_amb`/`prod_hosp` em MS e SP (teste real). **Meta: painel, procedimentos e impacto abaixo de 2 s em SP** (hoje 16 a 20 s); memória abaixo de 100 MB. Tempos medidos e registrados |

**Q01 feita (06/10/2026).** Desenho final: tabelas derivadas `uf_proc_mes`, `uf_cobertura` e `uf_produtor_mes` (máscara de 1 bit por mês, 62 meses), refeitas sozinhas quando uma carga ou remoção as invalida e no fim da carga. Em SP (debug, 4,1 milhões de linhas no SIA): procedimentos 13 s → 0,4 s; impacto 0,5 s; painel 2,6 s (o resto é a consulta por unidade); pico 33 MB. Custo único de refazer os totais na primeira abertura do banco antigo: ~40 s medidos em SQL puro (220 s no build debug); a medir em release na Q18.
| Q02 | **Esquema 3 da produção**: `PA_INDICA`, `PA_CODOCO`, `PA_FLQT`, `PA_DOCORIG`, `PA_REGCT`, `PA_SRV_C`, `PA_CMP`, `PA_VL_CL`, `PA_VL_CF`, `PA_VL_CRD` no `PA`; `REGCT`, `VAL_SH_FED`, `VAL_SP_FED`, `VAL_SH_GES`, `VAL_SP_GES`, `VAL_UTI` no `RD`. Manifesto com a marca de não pessoal; migração 2 → 3 sem perder nada; aviso "baixe de novo" para os meses antigos | Testes como os do esquema 2 (soma, NULL quando o arquivo não tem o campo, migração sem perda); campos conferidos no cabeçalho real; **tamanho do banco de SP medido antes e depois** (hoje 816 MB). Se a chave nova crescer demais, os campos vão para tabela lateral (decisão pela medida) |
| Q03 | **`SP` do SIH**: tabela `prod_hosp_ato` (estabelecimento, competência, procedimento do ato, tipo de valor, serviço/classificação, quantidade, valor) e carga do arquivo `SP` | **A soma bate com o `VAL_TOT` do `RD` ao centavo** em MS e SP; `IN_TP_VAL` lido pelo `TP_VAL.CNV` (e não pelo texto do Informe, que está invertido); número de AIH e CPF nunca lidos |
| Q04 | **CNES: `RC`, `IN`, `GM`, `EF`** com decodificadores (`REGRAS.DBF`, `incentivos.dbf`, `GESTAO.dbf`, `ESTABFIL.CNV`) | Testes de privacidade como os do `ST` (`CPF_CNPJ` apagado se pessoa física); contagens de MS e SP conferidas; código sem descrição mostrado como tal, sem inventar |
| Q05 | **Tabelas auxiliares**: `CODOCO.CNV`, `INDICA.cnv`, `DOCORIG.CNV`, `REGRA_C.cnv` (de `TAB_SIA.zip`), `REGCT.cnv` e `erroebloqueio.xlsx` com vigência (de `TAB_SIH.zip`), lidos por faixa de bytes como o MOTERRO | Descrições e vigências conferidas contra os arquivos reais; 14 códigos do MOTERRO sem vigência tratados como "sem vigência na fonte" |

**Bloco B — consultas e telas** (cada uma na janela real, em MS e em SP)

| Id | Entrega | Cruzamento (ver documento) | Como será validada |
|----|---------|---------|--------------------|
| Q06 | **Por que o SIA não pagou**: teto financeiro, teto físico, sem orçamento, sem valor unitário, por procedimento e mês; **renomear "glosa" para "apresentado × aprovado"** nas telas da Fase 4 e explicar que teto não é erro | itens 1 e 23 | Soma dos motivos = diferença apresentado − aprovado, ao centavo, em MS; texto revisado |
| Q07 | **Quantidade atípica**: alerta quando a quantidade apresentada de um procedimento por estabelecimento foge da série da própria unidade e dos pares do mesmo tipo | item 24 | O caso de SP 12/2025 aparece; MS (07/2026) sem falso alarme; limiar registrado e explicado na tela |
| Q08 | **Valor por instrumento** (BPA-C, BPA-I, APAC principal e secundária, RAAS) e procedimento produzido em instrumento que o SIGTAP não lista | item 2 | Valores por instrumento = total do `PA`; lista de divergências contada em MS e SP |
| Q09 | **Regra contratual e perfil financeiro**: regra da unidade pelo nome oficial e valor sob ela; incentivos, gestão e metas, filantropia; complemento local, federal, crédito, incremento; na ficha, "N% da produção sai de unidades sem geração de crédito" | itens 3, 4 e 15 | `RC` × `PA_REGCT` coerentes (mesmos códigos); valores = soma dos campos |
| Q10 | **Composição do valor da AIH**: SH, SP, complementos federal e do gestor, por capítulo do ato; peso de OPM e material; valor médio da AIH por procedimento principal, **já sem comparar com a tabela** | itens 5 e 6 | Composição = `VAL_TOT` ao centavo; capítulos conferidos |
| Q11 | **Serviço executado × CNES**: classes "executa serviço que o CNES não lista" e "tem no CNES e não executa" | item 9 | Contagem em MS e SP; texto não afirma "terceirizado" (só "cadastro não lista"); limite documentado |
| Q12 | **Reapresentação**: parcela da produção do processamento com competência de realização anterior | item 11 | MS 07/2026: 5,0% dos registros; SP medido |
| Q13 | **Permanência média real × SIGTAP**: por procedimento e por unidade, ao lado de `qt_dias_permanencia` e `qt_tempo_permanencia` | item 30 | Média = dias ÷ AIH do banco; conferido em SQL independente |
| Q14 | **Pares por natureza**: tipo de unidade, natureza jurídica, esfera, filantropia e ensino | item 33 | Pares calculados em MS e SP; mínimo de 50 AIH mantido |
| Q15 | **Motivo de rejeição com vigência** e bloqueio separado de rejeição | item 8 | 567 de 581 códigos com vigência; os demais marcados |
| Q16 | **Início e Produção**: alertas novos (R$ não pagos por teto, regra sem crédito, quantidade atípica, mês incompleto por estabelecimento) | itens 16 e 25 | Cada alerta com dado real que o dispare e dado real que o evite |
| Q17 | **Série longa**: baixar até 60 meses; comparação "mesmo mês do ano anterior" e sazonalidade | item 32 | Com 13 ou mais meses de MS carregados; custo de rede avisado antes (limite de 500 MB mantido) |

**Bloco C — fechamento**

| Id | Entrega | Como será validada |
|----|---------|--------------------|
| Q18 | Testes reais em MS e SP (`faturamento_real` estendido) e medição de desempenho | Suíte completa passando; tempos da seção 1.2 registrados |
| Q19 | Prova na janela dos módulos tocados (Início, Minha unidade, ficha, Módulos e dados), em MS e SP | Relatório revisado; o que não foi provado fica dito |
| Q20 | Documentação: esta página, `docs/fontes/producao.md`, catálogo de fontes (`catalogo/fontes.toml`: `RC`, `IN`, `GM`, `EF`, `SP`, auxiliares, com `fase = 4.5`), README, diário | Documento desatualizado é bug |

### 1.3 Ordem e dependências

`Q01` e `Q02` primeiro (as telas dependem deles). `Q03`, `Q04` e `Q05` em seguida, em paralelo. `Q06` a `Q17` depois, agrupadas por tela: Produção (Q06, Q07, Q08, Q12, Q15),
Procedimentos e ficha (Q09, Q11, Q13), Habilitações e perfil (Q09, Q14), AIH (Q10, Q13), Início (Q16), Módulos e dados (Q17). `Q18` a `Q20` fecham.

### 1.4 Decisões desta fase

| Decisão | Valor | Por quê |
|---|---|---|
| Numeração | **Fase 4.5**, entre a 4 e a 5 | Mesmos arquivos e telas da Fase 4; pedido do cliente |
| "Glosa" | Deixa de aparecer como rótulo; passa a "apresentado × aprovado" e "não pago por teto" | Medido: em MS toda a diferença é teto financeiro |
| Chave dos totais | Novos campos entram como **somas** e, se necessário, em tabela lateral | Evita explosão de linhas; decidido pela medida do tamanho de SP |
| Privacidade | Nenhum campo pessoal; **CBO, CID e perfil clínico por unidade ficam fora** (seção 5) | Dependem do piso de contagem |
| 38.xx | Segue como está (tratadas à parte) | Decisão do cliente pendente; não bloqueia |
| Licença | Só dados já usados; nada novo exige licença nova | A TUSS (CC BY-ND 3.0) e a Tabela SUS Paulista (sem declaração) ficam fora |

### 1.5 Fora desta fase

Ver a seção 5: conferência de arquivos (Fase 5), TUSS e TISS (6), preços e equipes (7), módulos estaduais (8).

## 2. Riscos

| Risco | Efeito | Mitigação |
|---|---|---|
| Esquema 3 aumentar muito o banco de SP (816 MB) | Disco e tempo de carga | Medir com SP antes de decidir a chave; tabela lateral; índices só onde a consulta usa |
| Baixar de novo todos os meses (esquema 3) | MS: 12 meses de `PA` de 40 MB cada (cerca de 0,5 GB); **SP: 12 meses = 6,8 GB de `PA` e 0,24 GB de `RD`** (cerca de 560 MB por mês de `PA`) | Aviso de tamanho antes (limite de 500 MB); migração mantém o que pode; "baixe de novo" só dos campos novos |
| Totais da UF desatualizados depois de nova carga | Tela mostrar número velho | Recalcular na mesma transação da carga; teste de consistência |
| Significado dos códigos `PA_FLQT` `R` e `S` (aprovados, mas "teto") | Texto errado na tela | Usar o texto do `CODOCO.CNV` literalmente; marcar "como a fonte descreve" |
| `PA_FLER` sem significado publicado | Campo inútil | Não usar; documentar |
| Padrão de MS não valer fora de MS e SP | Regras exageradas | Provar em SP; outras UFs só com download autorizado |

## 3. O que será provado e onde

Linux: testes unitários e sintéticos (esquema 3, migração, totais, privacidade). **Windows com dado real**: carga de MS e SP, tempos, telas. Nada será declarado
pronto sem execução e sem dizer o que não foi testado.

## 4. Critério de pronto

Os de `INSTRUCOES_SIGTAP_ABERTO_v3.md`, seção 12, mais: desempenho de SP dentro da meta; soma dos motivos de não pagamento = diferença apresentado − aprovado; composição da
AIH = `VAL_TOT`; nenhum dado pessoal gravado (teste que procura o valor no banco, como na Fase 4).

## 5. Mapa de todos os cruzamentos por fase

A numeração dos itens é a de [`cruzamentos-para-o-faturista.md`](../cruzamentos-para-o-faturista.md), seção 10. "Condição" = o que precisa ser decidido ou obtido antes.

| Fase | Cruzamentos | Condição |
|---|---|---|
| **4** (feita) | Produção, rejeições, apta × produz, pares, painel, impacto, mês incompleto (item 25 confirmado em SP) | — |
| **4.5** (esta) | 1, 2, 3, 4, 5, 6, 8, 9, 11, 15, 16, 23, 24, 25, 30, 32, 33, e o desempenho (item 29) | Nenhuma: dados já baixados |
| **5** conferência pré-envio | 17, 18, 19, 20, 26, 27; BPA, APAC, AIH, RAAS, CIHA; **10** (CBO que realmente produz), **12** (perfil do atendimento), **7** (valor das AIH rejeitadas, `RJ` × `ER`), **31** (CSAP e causa externa por hospital) | Leiaute real da AIH; arquivo rejeitado com retorno oficial; **piso de contagem de privacidade** para CBO e CID (itens 10, 12, 31); casar `ER` e `RJ` por resumo em memória (item 7); decisão sobre as 38.xx |
| **6** TUSS e TISS | 21 (de-para conservador do DATASUS + planilha ampla da ANS), 28 (atribuição e CC BY-ND 3.0) | **Parecer jurídico** sobre a licença da ANS |
| **7** preços e equipes | 14 (equipes de atenção primária: `EP`); BPS (preço de compra × valor da tabela) | CATMAT com compra registrada e tabela que ligue CATMAT a procedimento (não existe: só se o usuário informar); formato dos registros do BPS |
| **8** módulos estaduais (proposta) | 22 (**Tabela SUS Paulista**: valor do MS, complementação, valor paulista; estimativa por unidade) | Licença sem declaração; regra de elegibilidade (excluídos os de natureza jurídica pública); adaptador para planilhas cumulativas sem URL estável; modelo de vigência por resolução |
| Sem fase (descartados) | 13 (APAC por laudo), `AN`, `SAD`, `EE`, `ABO`/`ACF`/`ATD`/`AMP` para valor, `base_aih1.duck` | Não rendem valor novo ou são séries encerradas |

## 6. Registro

Esta página, o inventário e o documento de cruzamentos foram atualizados em 06/10/2026 (planejamento). Execução abaixo.

## 6. Registro de execução (07/10/2026)

Q00 a Q18 feitas e testadas; **Q19 (prova na janela) e as telas novas não foram provadas na janela**. Nada commitado.

**Medidas em dado real (MS 07/2026, arquivos de `dados_dev\producao_real`, release):**

| Item | Medida |
|---|---|
| Q02 | Cada dimensão do `PA` soma R$ 29.259.032,24 (o total do `PA`); `REGCT` do `RD` soma R$ 29.053.487,20 |
| Q03 | `SP_VALATO` = `VAL_TOT` do `RD` = R$ 29.053.487,20. Por `IN_TP_VAL`: 1 (SH) R$ 22.419.923,93; 2 (SP) R$ 6.015.615,36; 3 R$ 434.275,97; 4 R$ 183.671,94. Grupo 07 (OPM) R$ 2.452.721,89. A tabela se chama `prod_ato` (não `prod_hosp_ato`); a UTI (`VAL_UTI`, R$ 7,1 mi) está **dentro** do SH |
| Q04 | `RC` 356 linhas/288 estabelecimentos, `IN` 228/143, `GM` 53/52, `EF` 16/16; descrições decodificadas; os brutos são apagados após a carga (têm `CPF_CNPJ`) |
| Q05 | 659 descrições (`CODOCO` 11, `INDICA` 3, `DOCORIG` 6) e 639 vigências (`0024` bloqueio: 60 itens, 4 dígitos; `0027` rejeição: 579 itens, 6 dígitos, os mesmos do `CO_ERRO`). `REGCT.cnv` **descartado** (texto cortado em 50 caracteres): a regra contratual vem do `REGRAS.DBF` do CNES |
| Q06 | Diferença apresentado − aprovado R$ 1.372.926,63 = `PA_FLQT` M (R$ 377.516,29) + O (R$ 995.410,34). **O apresentado por `FLQT` é por unidade e mês, não por procedimento** |
| Q07 | Limiares: mais de 10× a mediana dos 3+ meses anteriores da unidade e 10× a mediana dos outros estabelecimentos, com 100 unidades a mais. MS 07/2026: 25 alertas em 18 unidades (aguarda avaliação do cliente); SP 12/2025 **não verificado** |
| Q08 | Soma por instrumento = total do `PA`; 139 pares procedimento × instrumento fora do SIGTAP (R$ 6.044,98), em geral APAC secundário. `DOCORIG` → registro: C→01, I→02, P→06, S→07, A→08, B→09 |
| Q09 | Marcas do CNES e valor por regra batem: `PA_REGCT` 7101 e `REGCT` 7102 do maior hospital de MS são as regras `RC` dele. `PA_VL_CF` todo zero em MS; `PA_VL_CRD` com significado a confirmar |
| Q10 | Tipos de valor da UF, OPM e FAEC (`SP_CO_FAEC` preenchido) ao lado da UF. **Capítulo do ato não foi feito** (exigiria CID, fora por privacidade) |
| Q11 | `PA_SRV_C` = 3 dígitos do serviço + 3 da classificação (igual a `SERV_ESP` + `CLASS_SR` do `SR`); em branco em parte da produção |
| Q12 | MS 07/2026: 5,6% do valor do `PA` (R$ 1,64 mi) é de meses anteriores (`PA_CMP` < `PA_MVM`) |
| Q13 | O previsto do SIGTAP **não é uma média**: em MS, 82 dos 207 procedimentos com 10+ AIH já têm a média da UF fora de 1,5× o previsto. Por isso o destaque exige também 25% de afastamento da UF (no maior hospital de MS: 33 procedimentos fora do previsto, 16 também fora da UF). `qt_tempo_permanencia` não foi usado |
| Q14 | Recortes: natureza jurídica, filantropia (arquivo `EF`) e ensino (`ATIVIDAD` diferente de `04`; **significado do campo não confirmado**: o Informe Técnico veio desalinhado no PDF e o `ATIVIDAD` não tem decodificador). Esfera: não usada (o campo `ESFERA_A` traz M/E/D, sem decodificador; a natureza jurídica já separa público de privado) |
| Q15 | Vigência e "encerrado" por `0027`. **Bloqueio × rejeição**: os 60 códigos de bloqueio (`0024`, 4 dígitos) não aparecem no `ER` (6 dígitos); o rótulo "bloqueio de AIH" vem do **texto** da descrição ("AIH BLOQUEADA…"). A tabela traz acentos como `&#193;`, agora decodificados |
| Q16 | Alertas: serviço fora do cadastro, reapresentação alta (10% e 2× a UF), permanência fora do previsto, motivo de rejeição encerrado, regra sem geração de crédito. O "R$ não pago por teto" já saía da Q06; o "mês incompleto por estabelecimento" ficou de fora |
| Q17 | Gráfico de série longa (até 60 meses; o plano de download passou a oferecer 24, 36 e 60) e variação contra o mesmo mês do ano anterior, só se esse mês está carregado e completo. **Sazonalidade não foi feita** |

**Desempenho (release).** MS: painel 0,19 s, unidade 0,15 s, procedimentos 0,13 s, impacto 0,09 s, carga dos 4 arquivos 10 s. SP (4,1 milhões de linhas, banco antigo sem os campos novos, maior hospital de SP): painel 2,4 s, unidade 2,1 s, procedimentos 0,28 s, impacto 0,32 s, pico de 30 MB (antes da fase: painel 19,9 s). **A meta de 2 s não foi atingida para o painel da maior unidade de SP (2,1 a 2,4 s)**; o resto é a série de financiamento da unidade (0,6 s). A primeira abertura de um banco antigo refaz os totais da UF: 44 a 62 s em SP (uma vez). Tamanho de SP: 840 MB (sem os campos novos; com eles, a medir).

**Totais derivados novos** (refeitos na carga): `uf_dim_mes`, `uf_ato_mes`, `uf_estab_mes`, `uf_dias_proc`, além de `uf_proc_mes`, `uf_cobertura` e `uf_produtor_mes`; `prod_uf_dim` (total da UF por procedimento e campo: `PA_DOCORIG` e `PA_REGCT`) substitui `prod_inst`. A versão dos totais fica em `sa_info`.

**Não provado.** Telas novas na janela (Q19); SP com os arquivos do esquema 3 (só MS tem); outras UFs; Excel e diálogos nativos; `faturamento_real` de MS com 12 meses roda, mas só estende o que já afirmava (os números novos estão em testes sintéticos e nesta tabela); `PA_VL_CRD`; significado de `ATIVIDAD`.

**Decisões do cliente pendentes** (inalteradas): piso de privacidade para CBO e CID; casar `ER` e `RJ`; 38.xx; parecer sobre TUSS e TISS; e **se `HB`, `SR`, `LT` e `EQ` do CNES (que trazem `CPF_CNPJ`) também devem ser apagados depois da carga**. Hoje só `ST`, `CADGER`, `RC`, `IN`, `GM` e `EF` são apagados; o teste existente exige que `HB`/`SR`/`LT`/`EQ` fiquem, por decisão de 05/10.

