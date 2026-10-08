# Inventário dos dados brutos: o que cada fonte entrega

Levantamento de 06/10/2026, com as fontes antes "por estudar" abertas no mesmo dia (seção 11). Reúne, num lugar só, **toda informação bruta** que as fontes do SIGTAP Aberto trazem: as que já
estão no programa e as que entram nas próximas fases. O documento irmão
[`cruzamentos-para-o-faturista.md`](../cruzamentos-para-o-faturista.md) mostra o que se faz juntando esses dados.

## Como ler

| Marca | Significa |
|---|---|
| **Medido** | Visto em arquivo real; o número vem de uma contagem registrada em `docs/fontes/` ou `docs/fases/`. |
| **Por estudar** | Existe na fonte (pelo nome, pela listagem ou pelo leiaute), mas nenhum arquivo foi aberto. Conteúdo a confirmar com dado real antes de qualquer promessa. |
| **Pessoal** | Dado que identifica pessoa. O programa **nunca grava**; quando a fonte o traz, ele só soma ou descarta. |
| **No programa** | Já carregado e usado hoje. |
| **Fase N** | Fase em que o dado entra (ou entrou) no programa. Fases 0 a 4 estão feitas; 5 a 7 vêm do catálogo `catalogo/fontes.toml`. |

> O plano geral por fases (documento-mestre) não pôde ser lido na abertura da Fase 4. A fase de cada fonte **futura** segue o
> catálogo de fontes do repositório; o que o catálogo não atribui está marcado como **proposta**.

Regras que valem para todas as fontes: nenhum dado oficial ou de paciente entra no repositório; cada instalação baixa da fonte
oficial e converte na própria máquina; toda tela mostra fonte e data do dado.

---

## 1. SIGTAP: Tabela Unificada de Procedimentos (Fase 1, no programa)

**Origem:** `ftp2.datasus.gov.br/pub/sistemas/tup/downloads`, um ZIP por competência, de 200801 a 202609 (225 ZIPs, 441 MB).
**Forma:** texto de largura fixa, ISO-8859-1, CRLF. As posições vêm do `*_layout.txt` do próprio ZIP.
**Volume (medido):** 64,3 milhões de registros nas 225 competências; 489.569 conteúdos distintos e 506.748 intervalos de vigência
no banco; 395.276 registros em 202609. Cada fato é guardado com `vig_ini`/`vig_fim` sobre a sequência de competências.

### 1.1 O procedimento e seus valores

| Tabela | Dado bruto | Vigentes em 202609 |
|---|---|---|
| `tb_procedimento` | Código, nome, complexidade, sexo, idade mínima e máxima (em meses; 9999 = não se aplica), quantidade máxima, média e tempo de permanência, pontos, valores **SA** (ambulatorial), **SH** (hospitalar) e **SP** (serviço profissional) em centavos, financiamento, rubrica, tipo (A/H) | 5.023 |
| `tb_descricao`, `tb_descricao_detalhe` | Texto descritivo do procedimento | — |
| `tb_grupo`, `tb_sub_grupo`, `tb_forma_organizacao` | Árvore grupo → subgrupo → forma de organização | 9, 71, 422 |
| `tb_financiamento`, `tb_rubrica` | Nome do financiamento (PAB, MAC, FAEC…) e da rubrica | 7, 43 |
| `tb_modalidade` | Ambulatorial, hospitalar, hospital-dia, atenção domiciliar | 4 |
| `tb_detalhe`, `rl_procedimento_detalhe` | Atributos complementares do procedimento | 60 / 10.623 |
| `rl_procedimento_incremento` | Incremento de valor por habilitação | 2.710 |

### 1.2 O que se exige para cobrar

| Tabela | Dado bruto | Vigentes em 202609 |
|---|---|---|
| `rl_procedimento_cid` | CIDs permitidos e se é principal (`ST_PRINCIPAL`) | 82.103 |
| `tb_cid` | Código e nome da CID-10, estádio, campos irradiados | 14.246 |
| `rl_procedimento_ocupacao`, `tb_ocupacao` | CBO que pode executar | 195.072 / 2.719 |
| `rl_procedimento_habilitacao`, `tb_habilitacao`, `tb_grupo_habilitacao` | Habilitação exigida e **grupos** ("0801 e 0803") | 11.304 / 347 / 31 |
| `rl_procedimento_servico`, `tb_servico`, `tb_servico_classificacao` | Serviço/classificação exigido | 4.144 / 75 / 436 |
| `rl_procedimento_leito`, `tb_tipo_leito` | Tipo de leito exigido | 4.120 / 41 |
| `rl_procedimento_registro`, `tb_registro` | Instrumento de registro: 01 BPA-C, 02 BPA-I, 03 AIH principal, 04 AIH especial, 05 AIH secundário, 06 APAC principal, 07 APAC secundário, 08 RAAS AD, 09 RAAS PSI, 10 e-SUS APS | 7.767 / 10 |
| `rl_procedimento_modalidade` | Modalidades em que o procedimento vale | 8.080 |
| `rl_procedimento_regra_cond`, `tb_regra_condicionada` | Regra condicionada, em texto livre | 3.861 / 15 |

### 1.3 Relações entre procedimentos e com outros sistemas

| Tabela | Dado bruto | Vigentes em 202609 |
|---|---|---|
| `rl_procedimento_compativel`, `rl_excecao_compatibilidade` | Compatibilidades e exceções entre principal e secundário | 12.407 / 5 |
| `rl_procedimento_origem` | Procedimento de origem | 4 |
| `rl_procedimento_sia_sih`, `tb_sia_sih` | Procedimento SIGTAP ↔ procedimento do SIA e do SIH | 5.381 / 8.383 |
| `rl_procedimento_comp_rede`, `tb_componente_rede`, `tb_rede_atencao` | Rede de atenção e componente | 4 / 20 / 5 |
| `rl_procedimento_renases`, `tb_renases` | Relação Nacional de Ações e Serviços de Saúde | 5.372 / 201 |
| `rl_procedimento_tuss`, `tb_tuss` | Termos TUSS; **`rl_procedimento_tuss` está vazia em todas as 225 competências** | 0 / 5.766 |

### 1.4 Dados que vêm junto do ZIP, fora das tabelas

| O quê | Dado bruto | Situação |
|---|---|---|
| Notas técnicas mensais | 225 PDFs (`notastecnicas/`), um por competência, 70 a 400 KB: a fonte oficial das mudanças de cada mês | Medido; o programa sabe baixá-las, mas ainda não as mostra |
| Planilha `Lay-out.xls` | Descrição de 133 colunas (congelada desde 2015) | Medido; só descrições, nunca leiaute |
| Domínios do `Lay-out.xls` | Complexidade 0 a 3, sexo M/F/I/N, 9999, compatibilidade 1 a 3, agravo 0 a 2, estádio, tipo A/H | Medido; viram manifesto de domínios |
| `LEIA_ME.TXT`, `versao`, `config.inf` | Versão do formato de exportação | Medido; sem uso |

---

## 2. Território (Fase 2, no programa)

| Fonte | Dado bruto | Volume |
|---|---|---|
| API de Localidades do IBGE (`municipios?view=nivelado`) | Código de 7 dígitos, nome, UF, região, microrregião, mesorregião, regiões imediata e intermediária (16 campos) | 5.571 municípios, 2,4 MB |
| API DEMAS `macrorregiao-e-regiao-de-saude/municipio` | Código de 6 dígitos, região de saúde, macrorregião, **população estimada IBGE 2022** | 5.570 municípios; 439 regiões; 121 macrorregiões |

Achado: um município do IBGE (510183) não tem região de saúde na fonte; a tela mostra "sem região de saúde na fonte".

---

## 3. CNES: cadastro dos estabelecimentos (Fase 3, no programa)

**Origem:** `ftp.datasus.gov.br/dissemin/publicos/CNES/200508_/Dados/<TIPO>/<TIPO><UF><AAMM>.dbc` (de 0508 a 2608) e
`Auxiliar/TAB_CNES.zip` (127,5 MB). **Forma:** DBF comprimido com PKWare DCL, um arquivo por tipo, UF e mês.
Um módulo por UF; o programa lê só os trechos necessários do ZIP auxiliar (cerca de 5 MB em vez de 127 MB).

### 3.1 Tipos que o programa já lê

| Tipo | Dado bruto | MS 08/2026 | Observação |
|---|---|---|---|
| `ST` estabelecimentos | 208 campos em 2026. Os que o programa decodifica: CNES, município (`CODUFMUN`), competência, tipo de unidade (`TP_UNID`), tipo de gestão (`TPGESTAO`), esfera (`ESFERA_A`), natureza (`NATUREZA`) e natureza jurídica (`NAT_JUR`, desde 2016), nível hierárquico (`NIV_HIER`), turno (`TURNO_AT`), vínculo SUS (`VINC_SUS`). Sete campos `AP0xCV07` entram depois de 2020. Os demais ficam gravados, sem decodificação | 7.108 | **Pessoal:** `CPF_CNPJ` e conta bancária quando é pessoa física são apagados. Não traz o nome. O arquivo é apagado depois da carga |
| `HB` habilitações | Habilitação (`SGRUPHAB`), portaria e vigência | 537 | 537 de 537 casam com o SIGTAP |
| `SR` serviços especializados | Serviço (`SERV_ESP`) e classificação (`CLASS_SR`), caráter, CNES terceiro | 15.968 | O público só traz serviço **próprio**: `CARACTER`=1 em quase todas as linhas e `CNESTERC` vazio desde 2012. 15.947 casam com o SIGTAP |
| `LT` leitos | Tipo (`TP_LEITO`), código (`CODLEITO`), quantidade existente (`QT_EXIST`) e quantidade SUS (`QT_SUS`) | 1.036 | 1.000 de 1.036 tipos casam com o manifesto |
| `EQ` equipamentos | Tipo (`TIPEQUIP`), código (`CODEQUIP`) e quantidade existente (`QT_EXIST`); os demais campos ficam gravados | 15.658 | 196 de 196 códigos de MS decodificados |
| `PF` profissionais | Nome, CBO, conselho, vínculo, horas | 99.946 | **Pessoal:** `CPF_PROF` e `CNS_PROF` nunca gravados. Só entra a unidade escolhida; o arquivo é apagado depois |
| `CADGER` (auxiliar) | Nome fantasia e razão social por CNES | — | **Pessoal:** CPF, razão social, telefone, fax e e-mail de pessoa física são apagados. Apagado depois da carga |
| `CNV/*.cnv` e `.def` (auxiliar) | Tabelas de código e descrição (tipo de estabelecimento, equipamento, esfera, natureza jurídica…) | — | `TP_UNID` 16 e esfera "M" não têm descrição |

### 3.2 Tipos que o programa ainda não lê, agora estudados (MS 08/2026, arquivos reais)

Todos têm o mesmo cabeçalho de estabelecimento do `ST` (município, região de saúde, gestão, esfera, tipo de unidade, natureza jurídica,
vínculo SUS) e **trazem `CPF_CNPJ`**: valem as mesmas regras de privacidade do ST (apagar quando `PF_PJ` = 1).

| Tipo | Registros em MS | O que traz | Decodificador | Uso para o faturista |
|---|---|---|---|---|
| `RC` regra contratual | 356 (288 estabelecimentos) | `SGRUPHAB` (13 códigos 71xx), `CMPT_INI`/`CMPT_FIM` (999999 = sem fim), portaria e mês de publicação | `DBF/REGRAS.DBF` de `TAB_CNES.zip` (19 regras: "estabelecimento **sem geração de crédito** na média complexidade ambulatorial", "…na alta complexidade hospitalar", "NASF", "MEC" etc.). O mesmo código aparece no `PA_REGCT` e no `REGCT` do `RD` | Explica por que uma produção aprovada **não gera crédito** no teto |
| `IN` incentivos | 228 (143) | `SGRUPHAB` (48 códigos 81xx e 82xx), vigência, portaria | `DBF/incentivos.dbf` (105 incentivos: UPA, SAMU, CER, CEO, Rede Cegonha, IntegraSUS, leito de AVC, UTI, saúde mental…) | O que a unidade recebe **além** da produção |
| `GM` gestão e metas | 53 (52) | `SGRUPHAB` (4 códigos 70xx), vigência | `DBF/GESTAO.dbf` (9 tipos de contrato de gestão/metas) | Contrato de metas ativo |
| `EF` filantrópico | 16 (16) | `SGRUPHAB` = 6001, desde 12/2006 | `CNV/ESTABFIL.CNV` ("hospital filantrópico") | Marca de hospital filantrópico |
| `EP` equipes | 1.802 (651) | Tipo da equipe (`TIPO_EQP`, 16 tipos em MS), nome e área da equipe, ativação e desativação (`DT_ATIVA`, `DT_DESAT`, `MOTDESAT`, `TP_DESAT`), populações atendidas (quilombola, assentado, indígena, escola, PRONASCI), `IDEQUIPE`, `ID_AREA`, `ID_SEGM` | `DBF/EQUIPE.dbf` (64 tipos: ESF, ESB, NASF, eCR, EMAD, EMAP, ECD, EAP…) | Atenção primária: fora do foco hospitalar, mas completa o perfil da unidade |
| `DC` dados complementares | 29 (29) | Contagens de salas e equipamentos de terapia renal, radioterapia, hemoterapia (mais de 100 campos `S_`, `QT_`, `EQ`) | Sem decodificador no ZIP | Só 29 unidades em MS, todas com `HEMOTERA` = 1 (hemoterapia). **Pessoal:** 11 campos `CNS_*` de responsáveis (nunca ler) |
| `EE` entidades de ensino | 50 em SP (arquivo mais recente `EESP1912`) | Mesmo leiaute do `IN`/`GM`: `SGRUPHAB` = `5001` (um só valor), `TP_UNID` 05 (39) e 07 (11). **`CMPT_FIM` = 201912 em todas as 50 linhas**: a série **acabou em 12/2019** (o FTP lista `EE` até 2019, não até 2107) | `ESTABFIL`-like, sem decodificador no ZIP | Nenhum: série encerrada. Substituída pelas marcas de ensino do `ST` (`ATIVIDAD`) |

**Achado que muda o quadro:** os códigos de `RC`, `IN`, `GM` e `EF` (6001, 7001 a 7117, 8101 a 8237) **não existem em `tb_habilitacao` do SIGTAP**. São
famílias próprias do CNES. Por isso a aptidão por habilitação (Fase 3) nunca os enxerga, e não deve: eles não são exigência de procedimento, são
**atributos da unidade que mudam o que o pagamento faz**.

### 3.3 Documentos do CNES baixados e não analisados

Glossário de Críticas (`.xls`) e Dicionário de Dados do CNES, em `leiautes\`. Candidatos a regras da conferência pré-envio (Fase 5).

---

## 4. SIA: produção ambulatorial (Fase 4, no programa)

**Origem:** `…/SIASUS/200801_/Dados/PA<UF><AAMM>[a-z].dbc` (de 2008-01 a 2026-07; SIA inteiro: 54.478 arquivos, 431 GB).
O `PA` de uma UF e mês pode vir em partes (`a`, `b`…). `PA` de MS 07/2026: 40,3 MB, **1.217.200 registros**.

### 4.1 `PA`: um registro por procedimento apresentado, com paciente

| Campo | Uso | Situação |
|---|---|---|
| `PA_CODUNI` (CNES), `PA_MVM` (AAAAMM), `PA_PROC_ID` (procedimento) | Chave: estabelecimento × competência × procedimento | Lido, somado |
| `PA_QTDAPR`, `PA_VALAPR` | Quantidade e valor **aprovados** | Lido, somado |
| `PA_QTDPRO`, `PA_VALPRO` | Quantidade e valor **apresentados**, antes da crítica | Lido, somado (esquema 2) |
| `PA_VL_INC` | Incremento dentro do valor aprovado | Lido, somado (esquema 2) |
| `PA_TPFIN` | Financiamento; igual ao da tabela em 99,3% dos pares | Lido, parte da chave (esquema 2) |
| `PA_CNSMED`, `PA_IDADE`, `PA_MUNPCN`, `PA_RACACOR`, `PA_SEXO` | Profissional e paciente | **Pessoal**, nunca lidos |
| Demais campos do `PA` (CBO, CID, caráter, regra contratual, serviço, instrumento, situação da produção…) | Estudados na seção 4.1.1 abaixo | Entram só como soma, depois da decisão de privacidade (seção 10) |

**Medido (MS, 12 meses, 08/2025 a 07/2026):** 13,5 milhões de registros, 836 estabelecimentos; por mês cerca de 4,2 milhões de
procedimentos e R$ 31 milhões. A competência mais recente costuma vir incompleta (07/2026: 476 estabelecimentos contra 622).

#### 4.1.1 Campos do `PA` ainda não gravados, agora lidos no cabeçalho real e no Informe Técnico do SIASUS (07/2019)

Nenhum destes é dado de paciente por si só; entram só como **soma por estabelecimento × competência × procedimento × valor do campo**.

| Campo | Significado oficial | Medido em MS 07/2026 (1.217.200 registros) |
|---|---|---|
| `PA_DOCORIG` | Instrumento de registro: `C` BPA-C, `I` BPA-I, `P` APAC principal, `S` APAC secundário, `A` RAAS-AD, `B` RAAS-PSI | `I` 1.061.691 · `P` 46.354 · `S` 42.095 · `C` 34.867 · `B` 32.193. R$ aprovado: `I` 11,67 mi · `P` 10,57 mi · `C` 5,75 mi · `S` 1,26 mi · `B` zero |
| `PA_INDICA` | Situação da produção: `5` aprovado total, `6` aprovado parcial, `0` não aprovado (tabela `INDICA.cnv`) | `5` 1.179.539 · `0` 37.529 · `6` 132 |
| `PA_VALPRO`, `PA_VALAPR` | Valor apresentado e aprovado | 30.631.958,87 e 29.259.032,24: diferença **R$ 1.372.926,63**, que é exatamente a soma de `0` (R$ 995.410,34, 72,5%) e de `6` (R$ 377.516,29) |
| `PA_CODOCO` + `PA_FLQT` | **Código de ocorrência** (agrupa) e **motivo detalhado**, pela tabela `CNV/CODOCO.CNV` do `TAB_SIA.zip` (ver seção 12): CODOCO 1 = totalmente aprovada (FLQT `K` aprovado totalmente, `R` teto financeiro, `S` teto financeiro da competência atual); CODOCO 2 e 3 = parcialmente aprovada (`L` ultrapassou teto físico, `M` ultrapassou teto financeiro, `T` teto financeiro da competência atual); CODOCO 4 e 5 = não aprovada (`P` procedimento sem orçamento, `Q` sem valor unitário, `N` ultrapassou teto físico, `O` ultrapassou teto financeiro) | `PA_FLQT` em MS 07/2026: K 1.129.119 · R 56.332 · O 28.700 · N 2.407 · S 510 · M 132. **Medido: todo o valor apresentado e não aprovado de MS (R$ 995.410,34 de `INDICA` = 0) é `O`; todo o aprovado parcial (R$ 377.516,29) é `M`: a glosa do SIA em MS foi 100% teto financeiro** |
| `PA_FLER` | Indicador de erro de corpo da APAC (significado e valores não publicados no Informe nem no `.DEF`) | Sempre `0` em MS 07/2026 |
| `PA_FLIDADE` | Idade compatível com a faixa do SIGTAP: 0 não exigida, 1 compatível, 2 fora da faixa, 3 inexistente, 4 em branco | `1` 1.198.483 · `3` 14.161 · `0` 4.556 (nenhum `2`: a crítica de idade já barrou antes) |
| `PA_REGCT` | Regra contratual (mesmos códigos de `RC` no CNES e de `REGRA_C.cnv`) | 32% dos registros têm regra: `7101` 207.126 (R$ 2,29 mi) · `7114` 101.946 (R$ 0,52 mi) · `7117` · `7109` · `7106` · `7111` · `7103` |
| `PA_NIVCPL` | Complexidade do procedimento (mesma codificação do `COMPLEX2.CNV`: 1 atenção básica, 2 média, 3 alta) | `2` 953.696 · `1` 176.274 · `3` 78.309 · `0` 8.921 |
| `PA_SUBFIN`, `PA_INCOUT`, `PA_INCURG` | Subtipo de financiamento; incremento "outros" e de urgência (código do incremento) | `PA_SUBFIN` tem 15 valores, 99,3% `0000`; `PA_INCOUT` 9 valores; `PA_INCURG` só `0000` |
| `PA_CBOCOD` | CBO do profissional executante | 110 distintos; 236 vazios; mais comuns 223505, 225125, 223415, 221205 |
| `PA_SRV_C` | Serviço especializado e classificação (de acordo com o CNES) | 84 distintos; **83% vazios** (1.008.799); preenchido onde o procedimento exige serviço |
| `PA_CIDPRI`, `PA_CIDSEC`, `PA_CIDCAS` | CID principal, secundário e causas associadas (só APAC e BPA-I) | 5.143 CIDs distintos; 65% `0000` |
| `PA_CATEND` | Caráter do atendimento | `01` eletivo 895.341 · `02` urgência 286.970 · `99` (BPA-C) 34.867 |
| `PA_MOTSAI`, `PA_OBITO`, `PA_ENCERR`, `PA_PERMAN`, `PA_ALTA`, `PA_TRANSF` | Desfecho da APAC | `00` 1.096.558 · `21` 102.481 · demais menores |
| `PA_CMP` | Competência da realização (diferente da de processamento `PA_MVM`) | `202607` 1.156.528 · `202606` 26.937 · `202605` 19.511 · `202604` 14.224: **5,0% dos registros do arquivo são de meses anteriores** (reapresentação) |
| `PA_VL_CL`, `PA_VL_CRD`, `PA_VL_CF`, `PA_DIF_VAL` | Complemento local, crédito, complemento federal, diferença do valor praticado pelo gestor | R$ 781.348,30 · R$ 43.721,10 · zero · zero |
| `NU_PA_TOT`, `NU_VPA_TOT` | Valor unitário do procedimento na tabela SIGTAP e na tabela do gestor (VPA) | A soma não tem sentido (valor unitário somado) |
| `PA_INE` | Identificação nacional da equipe | Vazio em todos os registros |
| `PA_FNTORC`, `PA_TPUPS`, `PA_TIPPRE`, `PA_MN_IND`, `PA_NAT_JUR` | Fonte orçamentária, tipo de unidade, prestador, mantida/individual, natureza jurídica | `PA_FNTORC` 3 preenchidos; `PA_TPUPS` 25 tipos |

### 4.2 Outros arquivos do SIA (MS 07/2026, arquivos reais e Informe Técnico)

Cada arquivo abaixo é **o detalhe, por APAC ou por atendimento, de registros que o `PA` já soma**. O `PA` já contém o valor de tudo isto;
o que os arquivos específicos acrescentam é o **detalhe clínico por autorização**, que é dado de paciente.

| Arquivo | O que é (Informe Técnico SIASUS 07/2019) | Registros em MS | Campos novos além do cabeçalho comum de APAC | Pessoais (nunca ler) |
|---|---|---|---|---|
| `BI` | BPA-I: uma linha por atendimento | 1.061.691 (**igual** ao `PA_DOCORIG` = `I`) | CNS do profissional, CBO, CID, caráter, quantidades e valores apresentado e aprovado | CNS do paciente, nascimento, sexo, raça, município |
| `AD` | APAC de laudos diversos | 3.163 | só o cabeçalho comum (45 campos): procedimento principal, valor total da APAC, datas de início e fim, tipo de APAC (1 inicial, 2 continuidade, 3 única), motivo de saída, CIDs, estabelecimento solicitante | CNS do paciente, CEP, nascimento |
| `AM` | APAC de medicamentos | 36.716 | `AM_PESO`, `AM_ALTURA`, `AM_TRANSPL`, `AM_QTDTRAN`, `AM_GESTANT` | idem |
| `AQ` | APAC de quimioterapia | 3.595 | CID, linha de tratamento (`AQ_LINFIN`), estádio, grau histológico, esquema (`AQ_ESQU_P1`, `AQ_ESQU_P2`), meses planejados e autorizados, 10 medicamentos (`AQ_MED01..10`), datas de início de tratamento | idem; **datas** também identificam |
| `AR` | APAC de radioterapia | 120 | CID, finalidade, três campos (CID, início, fim, nº de campos) de tratamento | idem |
| `ABO` (o Informe diz `AB`) | APAC de acompanhamento à cirurgia bariátrica (série de 01/2014 em diante) | SP 07/2026: 1.882 | `AB_IMC`, procedimentos e datas de cirurgia, AIH da cirurgia e do acompanhamento (`AB_NUMAIH`, `AB_PROCAIH`…), pontuação (`AB_PONTBAR`), comorbidades (`AP_COMORB`, `AP_CID_C1..5`), medicamento, polivitamínico, atividade física, adesão. **Os nomes dos campos diferem dos demais APAC** (`AP_TPPRE`, `AP_TPATEND`, `CO_CIDPRIM`, `AP_DTOOCOR`, `AP_APACAN`) | idem; **número de AIH** (`AB_NUMAIH`) |
| `ACF` | APAC de confecção de fístula arteriovenosa | SP 07/2026: 507 | `ACF_DUPLEX`, `ACF_USOCAT`, `ACF_PREFAV`, `ACF_FLEBIT`, `ACF_HEMATO`, `ACF_VEIAVI`, `ACF_PULSO`, `ACF_VEIDIA`, `ACF_ARTDIA`, `ACF_FREMIT` (indicadores clínicos) | idem |
| `ATD` | APAC de tratamento dialítico | SP 07/2026: 29.778 | `ATD_CARACT`, `ATD_DTPDR`, `ATD_DTCLI`, acesso vascular, situação inicial e de tratamento, exames (`ATD_HB`, `ATD_FOSFOR`, `ATD_KTVSEM`, `ATD_ALBUMI`, `ATD_PTH`, `ATD_HIV`, `ATD_HCV`, `ATD_HBSAG`) | idem; resultados de exame |
| `AMP` | APAC de acompanhamento multiprofissional | SP 07/2026: 931 | `AMP_*`: mesmo desenho do `ATD` (caráter, datas, acesso, exames) | idem |
| `AN` | APAC de nefrologia | **Série encerrada em 2014** (último arquivo `ANSP1409`; 12 registros no último mês de SP) | `AN_DTPDR`, altura, peso, `AN_DIURES`, `AN_GLICOS`, acesso vascular, `AN_HB`, `AN_HCV`, `AN_HIV` | idem |
| `PS` | RAAS psicossocial | 32.193 (**igual** ao `PA_DOCORIG` = `B`) | local de realização, situação de rua, uso de droga, destino do paciente, cobertura ESF, origem do paciente | CNS do paciente, nascimento, município |
| `SAD` | RAAS de atenção domiciliar | **Série encerrada em 2018** (último `SADSP1712`: 73 registros; `PA_DOCORIG` = `A` não aparece mais no `PA` de 07/2026) | Mesmo desenho do `PS` mais equipe (`PA_EQUIPE`, `PA_TP_EQP`, `CO_INE`) e CID (`PA_CID`) | CNS do paciente, nascimento |

**Consequência para o programa:** nenhum desses arquivos precisa ser baixado para o valor, a quantidade ou o procedimento: tudo já está no `PA`.
Só entram se o programa for **agregar o clínico** (ex.: produção de quimioterapia por CID e estádio na UF, por unidade), e isso tem de passar por
uma decisão de privacidade antes (seção 10).

### 4.2.1 Tabelas auxiliares `TAB_SIA.zip` (73,4 MB, 878 entradas)

`CNV/` (791 decodificadores), `DBF/` (72: `CADGER<UF>` nomes de estabelecimento, `CBO`, `EQUIPE`, `INE_EQUIPE_<UF>`, `PROC_AIH`, `PROC_CB`, `S_CID`,
`TB_SIGTAW`, `TP_FINAN`, etc.), 13 arquivos `.DEF` (um por instrumento de registro) e o Informe Técnico SIASUS 07/2019 (19 páginas). Os `.DEF`
trazem a lista de campos e o decodificador de cada um. Medido: `DOCORIG.CNV`, `INDICA.cnv` e `REGRA_C.cnv` já abertos.

### 4.3 Tabelas auxiliares

`TAB_SIA.zip` (73,4 MB) e três históricos de 4 a 5 MB. **Por estudar**; o programa usa só a decodificação já presente no SIGTAP.

---

## 5. SIH: internações (Fase 4, no programa)

**Origem:** `…/SIHSUS/200801_/Dados/` (22.915 arquivos, 66,5 GB, até 2026-07). `Auxiliar/TAB_SIH.zip` (6 MB).

### 5.1 `RD`: AIH aprovada, uma por registro

114 campos no Informe Técnico SIHSUS (03/2016); o arquivo real de 07/2026 tem os mesmos nomes, mais o `SEQUENCIA`/`REMESSA`. **Vários campos vêm "zerados" por definição** (`VAL_SADT`, `VAL_RN`,
`VAL_ACOMP`, `VAL_ORTP`, `VAL_SANGUE` e outros): o valor não está neles, está em `VAL_SH` e `VAL_SP`.

| Campo | Significado oficial | Situação |
|---|---|---|
| `CNES`, `ANO_CMPT`, `MES_CMPT`, `PROC_REA` | Estabelecimento, competência e procedimento realizado | Lido |
| `VAL_TOT` | Valor total da AIH | Lido, somado |
| `FINANC`, `DIAS_PERM`, `UTI_MES_TO` | Financiamento; dias de permanência; dias de UTI no mês | Lido (esquema 2) |
| `VAL_SH`, `VAL_SP` | Serviços hospitalares e serviços profissionais | **Medido:** R$ 22.419.923,93 e R$ 6.015.615,36 em 07/2026; `VAL_TOT` = SH + SP + complementos federais (R$ 29.053.487,20 = 22,42 + 6,02 + 0,43 + 0,18 mi) |
| `VAL_SH_FED`, `VAL_SP_FED`, `VAL_SH_GES`, `VAL_SP_GES` | Complementos federal e do gestor, **incluídos no total** | Por estudar |
| `VAL_UTI`, `VAL_UCI`, `MARCA_UTI`, `MARCA_UCI`, `UTI_INT_TO` | Valor e tipo de UTI e UCI; diárias em unidade intermediária | Por estudar |
| `PROC_SOLIC`, `PROC_REA` | Procedimento solicitado e realizado | `PROC_REA` lido; **solicitado × realizado** por estudar |
| `ESPEC`, `IDENT` | Especialidade do leito; tipo da AIH (1 normal, 5 longa permanência) | Por estudar |
| `DIAG_PRINC`, `DIAGSEC1..9`, `TPDISEC1..9`, `CID_ASSO`, `CID_MORTE`, `CID_NOTIF` | Diagnósticos | Por estudar (clínico) |
| `COBRANCA` | Motivo de saída ou permanência | Por estudar |
| `CAR_INT`, `COMPLEX`, `MORTE`, `QT_DIARIAS`, `DIAR_ACOM` | Caráter da internação, complexidade, óbito, diárias | Por estudar |
| `REGCT` | Regra contratual (mesmo código de `RC`) | Por estudar |
| `FAEC_TP` | Subtipo FAEC | Por estudar |
| `NAT_JUR`, `GESTAO`, `MUNIC_MOV`, `CNPJ_MANT`, `INFEHOSP`, `GESTRISCO`, `VINCPREV` | Estabelecimento e indicadores | Por estudar |
| `N_AIH`, `NASC`, `SEXO`, `CEP`, `MUNIC_RES`, `COD_IDADE`, `IDADE`, `NUM_FILHOS`, `INSTRU`, `CBOR`, `RACA_COR`, `ETNIA`, `INSC_PN`, `CNAER`, `HOMONIMO` | Paciente | **Pessoal**, nunca lidos |
| `GESTOR_CPF`, `CPF_AUT`, `GESTOR_COD`, `GESTOR_TP`, `GESTOR_DT` | Autorização do gestor | **Pessoal** (CPF); nunca lidos |
| `AUD_JUST`, `SIS_JUST` | **Texto livre de 50 caracteres** (justificativa do auditor e do estabelecimento para AIH sem CNS) | **Nunca ler**: texto livre pode conter dado pessoal |

**Medido:** MS 07/2026 tem 17.323 AIH, 80.435 dias de permanência e 9.998 dias de UTI; em 12 meses, 208.399 AIH de 86 estabelecimentos.

### 5.2 `ER`: AIH rejeitada, **uma linha por erro**

Campos usados: `CNES`, `ANO`, `MES`, `CO_ERRO`. Pessoais, nunca lidos: `AIH`, `DT_INTER`, `DT_SAIDA`, `MUN_RES`, `UF_RES`.
**Medido:** `ERMS2607` traz 847 linhas para 694 AIH distintas, 142 totais, 55 estabelecimentos e 38 motivos.
A taxa exibida é "rejeições por 100 AIH aprovadas", nunca "% de AIH rejeitadas".

### 5.3 `MOTERRO.dbf` e `erroebloqueio.xlsx` (dentro de `TAB_SIH.zip`)

`MOTERRO.dbf`: 641 motivos de rejeição, `CD_MOT_ERR` e `DS_MOT_ERR` (120). Casa com `CO_ERRO`: 37 dos 38 motivos de MS têm texto (`060225` não tem). Há
**dois comprimentos de código**: 581 de 6 caracteres (críticas de rejeição) e 60 de 4 caracteres (bloqueios: duplicidade, agravo, parto sem VDRL…).

`Docs/erroebloqueio.xlsx` (25 KB, estudado): duas tabelas do banco do SIHD, `CO_TAB` `0024` (60 itens de 4 dígitos, bloqueio) e `0027` (579 itens de 6 dígitos,
rejeição), com `CO_ITEM`, `DT_CMPT_INI`, `DT_CMPT_FIM` e `DS_DESCRICAO`. **Acrescenta ao MOTERRO a vigência de cada crítica** (desde 200701,
999999 = em vigor). Cobre os 60 de 4 dígitos e 567 dos 581 de 6 dígitos do MOTERRO; 14 códigos do MOTERRO não estão na planilha. Nos 567 em comum a
descrição é igual em 564. O código `060225` não está em nenhum dos dois.

Outras tabelas de `TAB_SIH.zip` úteis para decodificar `RD`, `SP`, `RJ`: `FINANC.CNV` (01 PAB, 02 assistência farmacêutica, 04 FAEC, 05 incentivo MAC, 06 MAC,
07 vigilância, 08 gestão), `COMPLEX2.CNV`, `IDENT.CNV`, `REGCT.cnv` (regra contratual), `TP_VAL.CNV` (tipo de valor do `SP`), `sitrejeicao.cnv`, `sitbloqueio.cnv`,
`motbloqueio.cnv`, `LEITOS.CNV`, `PROCOBS2b.CNV` (procedimentos obstétricos), `DBF/CADHOSP.DBF` (4.069 hospitais com CNPJ e razão social),
`DBF/HUF_MEC.dbf` (54 hospitais universitários federais), `DBF/LIBGESTOR.dbf`, `DBF/PROC_AIH.dbf`/`PROC_CB.dbf` (procedimentos de cirurgia bariátrica),
e o Informe Técnico `IT_SIHSUS_1603.pdf`. Total: 886 entradas, 6 MB.

### 5.4 Outros arquivos do SIH

| Arquivo | O que é | Medido em MS 07/2026 |
|---|---|---|
| **`SP`** serviços profissionais | Um registro por **ato** da AIH, com o procedimento do ato (`SP_ATOPROF`), quantidade (`SP_QTD_ATO`, `SP_QT_PROC`), pontos (`SP_PTSP`), **valor do ato (`SP_VALATO`)**, tipo de valor (`IN_TP_VAL`), complexidade, financiamento, FAEC (`SP_CO_FAEC`), CBO do profissional (`SP_PF_CBO`), serviço/classificação (`SERV_CLA`), CIDs e o indicador `SP_U_AIH` que vale 1 uma vez por AIH | 233.305 atos para 17.323 AIH (`SP_U_AIH` = 1 em 17.323). **A soma de `SP_VALATO` é R$ 29.053.487,20, igual ao `VAL_TOT` do `RD` ao centavo.** Por `IN_TP_VAL` (conforme `TP_VAL.CNV`): `1` valor SH R$ 22.419.923,93 (= `VAL_SH` do `RD`), `2` valor SP R$ 6.015.615,36 (= `VAL_SP`), `3` complemento federal SH R$ 434.275,97, `4` complemento federal SP R$ 183.671,94. (O Informe Técnico escreve "1 SP / 2 SH", o contrário do `TP_VAL.CNV` e do dado; vale o dado.) Por capítulo do ato: 08 (OPM) R$ 8,27 mi · 04 (cirurgias) R$ 10,10 mi · 03 R$ 5,07 mi · 07 R$ 2,45 mi · 02 R$ 1,64 mi · 05 R$ 1,39 mi · 06 R$ 0,14 mi. `SP_CO_FAEC`: 13 códigos, 96% vazio. `SERV_CLA`: 54 códigos, 87% `000000`. `SP_PF_CBO`: 71 CBOs, 66% `000000` |
| `RJ` AIH rejeitada (reduzida) | Mesmo leiaute do `RD`, mais `ST_SITUAC`, `ST_BLOQ`, `ST_MOT_BLO` (situação, bloqueio e motivo do bloqueio) | 709 registros; **694 AIH distintas, exatamente as 694 do `ER`**, nos mesmos 55 CNES. Nenhuma AIH do `RJ` está no `RD` do mesmo mês (rejeitada não é aprovada). Mostra o procedimento, o valor e o diagnóstico da AIH rejeitada: dado de paciente por linha |
| `base_aih1.duck` (12 GB, DuckDB, 06/2026) | Base consolidada | **Não aberto**: acima do limite de 500 MB, fora do que o programa pode baixar sem aviso |
| Pastas `DBF/` e `XML/` (2014) | Cópias antigas do `RD` (`RDAC0801.dbf`, de 1 a 12 MB por mês/UF) em DBF e XML | Redundantes com `Dados/*.dbc`; não abertas |
| Pasta `CSV/` | Só um `LEIA-ME`: os CSV foram **retirados temporariamente** pelo DATASUS "para atualizações e correções" | Sem dados |
| `199201_200712/`, `2008` a `2014`, `Arquivos_MTBR/`, `MHJ_14_16/` | Séries antigas e arquivos de projetos | Não abertas |
| `Doc/IT_SIHSUS_1603.pdf` | Informe Técnico (6 páginas): layout de `RD` e `SP` | Lido |

---

## 6. Dados abertos do DEMAS

| Fonte | Dado bruto | Situação |
|---|---|---|
| API `sia-procedimentos-ambulatoriais` e `sih-procedimentos-hospitalares` | Cerca de uma linha por estabelecimento e mês; procedimento, quantidade e valor por CNES | **Descartada como fonte** (não é a produção por procedimento). Serviu de conferência: 40 de 40 linhas do SIA iguais ao total carregado. Licença "a verificar" |
| API `economia-da-saude/bps` (Banco de Preços em Saúde) | Exige `codigoCatmat` ou `cnpjInstituicao` (sem eles devolve "ao menos um dos parâmetros deve ser informado"). Cinco consultas com CATMAT e CNPJ de teste devolveram `{"bps": []}`; **o formato dos registros não foi visto** | **Fase 7**; tentativa de estudo sem resultado: falta um código CATMAT com compra registrada (não há tabela CATMAT no projeto) |

---

## 7. Arquivos de faturamento do próprio hospital (Fase 5, só local)

São os arquivos que o faturista **gera** e envia. Contêm dado de paciente: ficam na máquina do usuário, nunca em repositório, log
ou relatório. O programa só os lê para conferir.

| Arquivo | O que traz | Leiaute | Situação |
|---|---|---|---|
| **BPA** (`#BPA#`) | Cabeçalho (130 posições), BPA-C tipo 02 (48), BPA-I tipo 03 (351). Procedimento, CBO, quantidade, competência, folha, linha; no BPA-I também idade, sexo, CID e paciente por CPF ou CNS; situação de rua desde 12/2024 e "sem CPF" desde 07/2026 | `Layout_Exportacao_BPA.pdf` | Leiaute **conferido** com arquivo real: controle `((Σ proc + Σ qtd) mod 1111) + 1111` reproduzido (1917). Divergência aberta: folhas 119 × 32 |
| **APAC** (`#APAC`) | Cabeçalho (138), tipo 14 corpo (533+), tipo 13 ações (90 a 97), tipo 06 laudo, 07/08 oncologia | `Layout_Exportacao_APAC.pdf` (08/07/2026) | Leiaute **conferido**: controle reproduzido (1714) |
| **AIH / SISAIH01** | Registro de 1.925 bytes no arquivo real do hospital | Leiaute publicado (CMPT 09/2015) tem 1.800 bytes e **não bate** | **Leiaute real desconhecido**: depende do nome do sistema e da versão, ou do leiaute do retorno |
| **RAAS** (psicossocial) | Cabeçalho `#RAS#` de 159 posições (linha 01); folha do paciente, linha 15 (408 posições: CNS ou CPF, nome, nome da mãe, endereço, CID principal e até 3 secundários, motivo de saída, origem, situação de rua, uso de droga, total de ações); ações, linha 16 (112 posições: procedimento, CBO e CNS do executante, data, serviço, classificação, quantidade, local C ou T). Controle: soma dos códigos dos procedimentos mais as quantidades da linha 16. Atualizado em abril/2025 | `Layout_Exportacao_RAAS.pdf` (7 páginas, lido) | **Leiaute lido**, sem amostra para reproduzir o controle. O PDF cobre só a RAAS **psicossocial**; o leiaute da atenção domiciliar não está nele |
| **CIHA** | Comunicação de internação hospitalar ambulatorial | **O leiaute não estava em nossa pasta** (achado depois, seção 12). O ZIP `SIA_SIH_CIHA_CIH_CADERNO_LAYOUT_ARQUIVO_TXT.ZIP` contém, apesar do nome, o caderno de **TXT do SCNES** (v2.1, 2016: 24 arquivos `LFCES…`/`NFCES…` do cadastro). O ZIP `SCNES_CADERNO_LAYOUT_DE_ARQUIVOS_OUTROS.ZIP` traz outro: Fornecedores Anvisa, Importadores, SISGERF e Equipes de Captação (2012) | **Leiaute achado** (seção 12): `LayoutCIHA01V1.0.4.2.zip` em `ftp.datasus.gov.br/CIHA/downloads/Documentacao/`. **Amostra continua pendente** |
| **Retorno do SIHD / `ER`** | O que o DATASUS rejeitou, com o motivo | `ER` real já lido (seção 5.2) | Necessário para **provar** regras: sem arquivo rejeitado e retorno oficial, a regra fica "não confirmada" |

Conferência nas amostras reais: 1 achado no BPA, 0 na APAC. Os `.doc` dos cadernos do SCNES descrevem o **TXT da aplicação local do CNES** (24 arquivos: `LFCES004` estabelecimentos, `LFCES018` profissionais, `LFCES021` carga horária, `LFCES032` serviço/classificação, `LFCES037` equipes, `LFCES045` habilitações, `LFCES046` regras contratuais, `NFCES041` **CBO × serviço/classificação**, `NFCES071` profissionais com mais de 168 horas ou mais de 2 vínculos públicos); não são arquivos públicos de disseminação. `Layout_REDUZIDA.pdf` é o layout antigo do `RD` (SIHD) e `t.pdf` é uma página HTML de listagem de BPA, não um PDF. Manuais: `Manual_Operacional_BPA.pdf`, `Manual_Operacional_APAC_v_1_1.pdf`,
`Manual_Operacional_SIA_v2.pdf`, `MANUAL_SIH_janeiro_2015.pdf`, `dicionario_de_dados_AIH.pdf`.

---

## 8. Saúde suplementar: ANS (Fase 6)

| Fonte | Dado bruto | Situação |
|---|---|---|
| **TUSS** (Terminologia Unificada da Saúde Suplementar) | Tabela 22 (procedimentos): 5.967 vigentes; 18 (diárias, taxas e gases): 3.595; 20 (medicamentos): 45.355; 19 (materiais): 1.518.454. Pacote 202609: 408 MB (já truncado uma vez; baixar só as tabelas 18, 20, 22, com leitura parcial) | **Medido**. Licença do site da ANS: **CC BY-ND 3.0** (seção 12); a ND impede obra derivada, ponto para o parecer jurídico |
| **TISS** (padrão de troca) | XSD `tissV4_03_00` (comunicação 04.03.00; monitoramento 01.06.00); organizacional 202609; conteúdo 202511; segurança 202511. Hash do epílogo = MD5 do conteúdo das tags, ISO-8859-1, hexadecimal. CNPJ alfanumérico desde 01/07/2026 | **Medido**: o XSD compila. Os XSD e WSDL não trazem licença própria; vale a do site (CC BY-ND 3.0, seção 12) |
| **Compatibilização TUSS × SIGTAP (ANS, 2017)** | 6.919 linhas; 3.324 TUSS × 2.912 SIGTAP; só 1.127 desses códigos SIGTAP existem em 202609 (22,4% dos 5.023 vigentes); 2.739 TUSS apontam para 1 SIGTAP; 1.075 são 1:1; leque máximo 111 e 152 | **Medido**. Conclusão do projeto: apoio, nunca verdade; mostrar grau de equivalência e data |
| **`Mapeamento_TUSS_SIGTAP.zip`** (DATASUS, 06/03/2017, 35 KB; mais a Nota Informativa `.doc`) | CSV de 977 linhas: código e termo TUSS, **grau de equivalência**, código e nome SUS. 972 TUSS e 909 códigos SUS distintos; 888 desses 909 ainda existem em 202609 (**cobrem 17,7% dos 5.023 procedimentos vigentes**); 66 códigos SUS têm mais de 1 TUSS (máximo 3); 5 TUSS têm mais de 1 SUS. Graus: `1` = equivalência lexical e conceitual (454 linhas); `2` = equivalência com sinonímia (523). A Nota diz que o trabalho foi feito de 01/2015 a 01/2017 com a ANS e o COPISS, validado pela SAS, com base no mapeamento do Hospital Sírio-Libanês, pela ISO/TR 12300:2014; os graus 3 (TUSS menos específico), 4 (mais específico) e 5 (sem mapeamento) **não foram publicados** | **Medido.** Menor e mais conservador que a planilha da ANS (6.919 linhas): só traz o que o DATASUS validou |
| XML TISS do hospital | Guias de convênio, com paciente | Local, nunca fora da máquina |

---

## 9. Resumo: dado × fase

| Fase | O que entra | Estado |
|---|---|---|
| 1 | SIGTAP, 225 competências (seção 1) | Feita |
| 2 | Território IBGE e DEMAS (seção 2); notas técnicas e domínios | Feita |
| 3 | CNES: ST, HB, SR, LT, EQ, PF, nomes e decodificadores (seção 3.1) | Feita |
| 4 | SIA `PA`, SIH `RD` e `ER`, MOTERRO, campos do esquema 2 (seções 4.1, 5.1 a 5.3) | Feita |
| 5 | Arquivos do hospital: BPA, APAC, AIH, RAAS, CIHA e retorno (seção 7); leiautes como dados. **Propostas, já estudadas (seção 11):** campos novos do `PA` e do `RD`, `SP`, `erroebloqueio.xlsx`, `RC` e `IN` do CNES | A fazer |
| 6 | TUSS, TISS (XSD, hash), compatibilização e mapeamento (seção 8) | A fazer |
| 7 | Banco de Preços em Saúde (seção 6) | A fazer |

## 10. Limites que valem para todo o inventário

- A produção sai com atraso; o último mês pode vir incompleto.
- O CNES público não traz serviço terceirizado.
- O arquivo de produção é **agregado**: nenhuma linha de paciente é guardada, então o programa nunca sabe quais procedimentos aparecem juntos na mesma AIH ou APAC.
- O SIGTAP não tem tabela de equipamento exigido, e `cnes_pf` só tem os profissionais das unidades escolhidas.
- Licença dos dados: levantamento sem parecer jurídico em [`licenca-dos-dados.md`](licenca-dos-dados.md).
- **Privacidade das novas somas.** `PA_CBOCOD`, `PA_CIDPRI`, `PA_SRV_C`, `PA_REGCT`, `PA_INDICA` e outros não identificam ninguém sozinhos, mas **cruzados
  em uma célula pequena** (unidade pequena, CID raro, um só profissional) podem apontar uma pessoa. Antes de gravar CBO ou CID por unidade, definir
  um piso de contagem (por exemplo, suprimir células com menos de 5) ou limitar a UF. **Decisão pendente do cliente.**
- Texto livre (`AUD_JUST`, `SIS_JUST`) e datas de tratamento (`AQ_DTINI*`, `AR_INIAR*`) nunca entram.

## 11. O que o estudo de 06/10/2026 fechou e o que abriu

Fontes que estavam "por estudar" e foram abertas (arquivos reais de MS, `dados_dev\estudo_fontes\`, fora do repositório; nenhum valor pessoal foi impresso):

| Fonte | Resultado em uma linha |
|---|---|
| CNES `RC`, `IN`, `GM`, `EF`, `EP`, `DC` | Seção 3.2. Códigos de regra contratual, incentivo e gestão de metas **não existem no SIGTAP**; `RC` é a mesma tabela do `PA_REGCT` e do `REGCT` do `RD` |
| SIA `BI`, `AD`, `AM`, `AQ`, `AR`, `PS` | Seção 4.2. `BI` e `PS` têm exatamente o número de registros do `PA` com `DOCORIG` `I` e `B`: **são o detalhe de linhas que o `PA` já soma** |
| SIA `PA`: campos ainda não gravados | Seção 4.1. `PA_INDICA` decompõe a glosa: 72,5% do apresentado a mais é produção **não aprovada**, 27,5% **aprovada parcial** |
| SIH `RD`: campos ainda não gravados | Seção 5.1. `VAL_TOT` = SH + SP + complementos |
| SIH `SP` | Seção 5.4. **Soma ao centavo igual ao `VAL_TOT`**: decompõe o valor da AIH em SH, SP e complementos e por capítulo do ato |
| SIH `RJ` | Seção 5.4. As 694 AIH são as mesmas do `ER`: o `ER` dá o motivo, o `RJ` dá o procedimento e o valor |
| `erroebloqueio.xlsx` | Seção 5.3. Acrescenta a **vigência** de cada crítica ao MOTERRO |
| `TAB_SIA.zip`, `TAB_SIH.zip` | Seções 4.2.1 e 5.3. Informes Técnicos oficiais e decodificadores |
| RAAS, cadernos CNES | Seção 7. RAAS psicossocial lida; **o leiaute da CIHA continua faltando** (o ZIP tem outro conteúdo) |
| Mapeamento DATASUS | Seção 8. 977 linhas, graus 1 e 2, 17,7% dos procedimentos vigentes |

**Continua sem estudo** (depois da segunda passagem, seção 12): leiaute da RAAS-AD atualizado (só há o de 2013); amostra pública de CIHA, RAAS, BPA e APAC (não existe: só instaladores); `PA_FLER`; a licença formal da Tabela SUS Paulista e dos conjuntos no `dados.gov.br`; os Termos de Uso do novo Sistema de Gestão de Terminologias da ANS; `base_aih1.duck` (ver seção 12.8).

## 12. Segunda passagem de estudo (06/10/2026): CIHA, RAAS, licenças, ocorrências, SES-SP, SP, DuckDB

Arquivos de estudo em `dados_dev\estudo_fontes\` (fora do repositório; nenhum valor pessoal impresso).

### 12.1 Leiaute da CIHA (achado)

Fonte oficial: `http://ciha.datasus.gov.br/CIHA/index.php`, aba Documentação; arquivos em `ftp://ftp.datasus.gov.br/CIHA/downloads/Documentacao/`.

| Documento | O que é |
|---|---|
| `LayoutCIHA01V1.0.4.2.zip` → `LayoutCIHA01.docx` (24 KB, **01/08/2014**) | Leiaute vigente. Texto posicional de largura fixa. **Cabeçalho (`TIPO_REG` = 1)**: 15 posições, 3 campos (`TIPO_REG` 1/1, `CNES` 2/7, `VERSAO` 9/7). **Dados**: 37 campos, **registro de 390 posições**. `TIPO_REG` 2 internação individualizada, 3 remessa sem movimento, 4 ambulatorial individualizado, 5 ambulatorial consolidado |
| `LayoutCIHA01V1.0.4.0` (07/01/2014) | Versão anterior, obrigatória desde 12/2013 |
| `OrientacoesTecnicasCIHAv4.pdf` (21/07/2011) | Cita a Portaria GM/MS 1171, de 19/05/2011, que instituiu a CIHA |
| `ManualCIHA01.zip`, `ManualCIHA02.zip` (2011) | Manuais do aplicativo (não lidos) |

Campos principais (início/tamanho): `NOME_PAC` 2/60, `CEP` 115/8, `DT_NASC` 123/8 (ddmmaaaa), `SEXO` 131/1, `CNS` 132/15, **`PROC_REA` 147/10**, `DIAG_PRIN` 157/4, `DIAG_SEC` 161/4, `DT_ATENDIMENTO` 165/8, `DT_ALTA` 173/8, `TP_ALTA` 181/2, **`TP_FREMU` 183/2 (fonte de remuneração)**, `DS_PROC` 185/40, `REG_ANS` 225/6, `CNPJ_OPER` 231/14, `CO_BENEF` 245/30, `NU_OBITO` 275/11, `NU_NASC` 286/1, `NU_DN1..5` (11 cada), `QT_UTI` 342/3, `NU_PRONT` 345/12, `DT_CMPT` 357/6 (MMAAAA), `QTD_ATENDIMENTO` 363/6, `CO_MODALIDADE` 369/2 (01 ambulatorial, 02 internação), `NU_TISS` 371/20. **Traz nome, endereço, CNS e prontuário: dado de paciente por linha.**
A CIHA existe para hospitais que atendem **fora do SUS** (plano de saúde, particular, filantrópico com convênio): o campo `REG_ANS` e `NU_TISS` ligam à saúde suplementar. **Amostra pública: não existe**; o FTP só tem os instaladores. O leiaute é de 2014.

### 12.2 RAAS: leiaute da atenção domiciliar e amostras

| Documento | Conteúdo |
|---|---|
| `Layout_Exportacao_RAAS.pdf` (abril/2025) | Só a **psicossocial**: 3 tipos de linha (cabeçalho 159, paciente 408, ações 112). O CPF (`ras_cpfpct`) é novo em relação ao leiaute antigo. **Controle**: (soma dos procedimentos + quantidades da linha 16) + (soma de CNES + CNS da linha 15), módulo 1111, mais 1111 |
| `RAAS.xls` (22/05/2013) | **Atenção domiciliar** (RAAS-AD) e a psicossocial antiga. AD paciente (linha 04): 42 campos, 379 posições (306 antes de 05/2013); AD ações (linha 05): 19 campos, 116 posições, com equipe (`ras_equipe_seq`, `ras_equipe_area`) e `ras_CID_PRI`. **Não foi atualizado como o da psicossocial**: a RAAS-AD de hoje pode ter mudado |
| `lerNotas` da RAAS (v02.35, 08/05/2026) e das APAC (`APACMAG`, v04.02) | Histórico de versões do aplicativo do DATASUS, com mudanças de leiaute (ex.: campo CPF do paciente na APAC desde 04/2024, `apa_dtiden` no laudo geral) e acertos |
| Pasta `siasus/homologacao/` (arpoador) | Só instaladores (`APACMAG`, `AUTORIZADOR` da AIH, `FPOMAG`) e notas; **nenhum arquivo de exemplo** |

Conclusão: **não há amostra pública sintética** de RAAS, BPA, APAC, AIH ou CIHA. Para provar o controle e as regras, a amostra tem de vir de um arquivo real do hospital (privacidade) ou ser gerada por nós a partir do leiaute. O `FPO_Leiame.txt` (71 KB) documenta a Ficha de Programação Orçamentária, outra fonte não estudada.

### 12.3 Licença da TUSS e da TISS (levantamento com citações; não é parecer jurídico)

- Site da ANS (`gov.br/ans`, página do Padrão TISS): "Todo o conteúdo deste site está publicado sob a licença **Creative Commons Atribuição-SemDerivações 3.0 Não Adaptada**" (`creativecommons.org/licenses/by-nd/3.0/deed.pt_BR`). **A cláusula ND (sem derivações) conflita, a rigor, com converter a tabela para outro formato ou banco**: ponto para o parecer jurídico. O CNES, em contraste, mostra "Creative Commons Attribution" no `dados.gov.br` (`licenca-dos-dados.md`).
- Os ZIPs (TUSS, XSD de comunicação, auxiliares), as planilhas e os 9 XSD e 11 WSDL **não trazem aviso próprio de licença** (a única licença dentro do pacote é a do `xmldsig-core-schema.xsd`, do W3C).
- **Download**: público, sem login. TUSS: `Padrao_TISS_Representacao_de_Conceitos_em_Saude_202601.zip`, **560 MB** (sem compressão: dá para extrair entradas por faixa de bytes); contém xlsx e pdf das tabelas 18, 19 (mais de 100 MB cada parte), 20, 22, "demais terminologias" e um ZIP interno `TUSS 64` de 233 MB. Comunicação (XSD): 105 KB. Auxiliares: `Padrao_TISS_arquivos_auxiliares_202601.zip`.
- **Alternativa de dados abertos**: `dadosabertos.ans.gov.br/FTP/PDA/terminologia_unificada_saude_suplementar_TUSS-049/` com `pda-049-tuss.zip` (**1,4 MB**) e dicionário `.ods`. Só traz códigos "com forma de envio individualizada" (TUSS 64); as tabelas 18 e 19 completas só vêm no pacote TISS. O índice não declara licença; a página do conjunto no `dados.gov.br` respondeu 401.
- **Direitos de terceiros** (Componente Organizacional): a TUSS 22 tem por base a CBHPM da Associação Médica Brasileira e a CBHPO; a TUSS 20 vem da ANVISA/CMED; a 19, da ANVISA. Nenhum arquivo traz restrição expressa; a menção é de origem.
- Os Planos de Dados Abertos da ANS (2017-2021) declaram "CC Atribuição Não Comercial Sem Derivações 4.0"; não confirmado para os conjuntos de dados.
- **Novo Sistema de Gestão de Terminologias** (Open Concept Lab): download em Excel, CSV e JSON e API, segundo a imprensa especializada (29/07/2026); os Termos de Uso não foram lidos (página em JavaScript).

### 12.4 Ocorrências do SIA (`CODOCO.CNV`)

Fonte: `CNV/CODOCO.CNV` em `TAB_SIA.zip` (liga-se ao campo por `Producao_Ambulatorial.DEF`: `Detalhes_Aprovação, PA_CODOCO`). A tabela é uma árvore; a coluna final é o valor de `PA_CODOCO` seguido do de `PA_FLQT`.

| Grupo | CODOCO | FLQT | Texto oficial |
|---|---|---|---|
| Totalmente aprovada | 1 | K | aprovado totalmente |
| | 1 | R | teto financeiro |
| | 1 | S | teto financeiro da competência atual |
| Parcialmente aprovada | 2 | L | ultrapassou teto físico |
| | 3 | M | ultrapassou teto financeiro |
| | 3 | T | teto financeiro da competência atual |
| Não aprovada | 4 | P | procedimento sem orçamento |
| | 4 | Q | procedimento sem valor unitário |
| | 4 | N | ultrapassou teto físico |
| | 5 | O | ultrapassou teto financeiro |
| (nó extra) | 11 | 1 | produção sem quantidade produzida |

Os valores medidos em MS batem com a tabela (K, R e S com CODOCO 1; M com 3; N com 4; O com 5). O mapa de `PA_INDICA` (5, 6 e 0) foi confirmado pelo `INDICA.cnv` aberto na primeira passagem.

### 12.5 Tabela SUS Paulista (SES-SP): fonte nova

| Item | Achado |
|---|---|
| O que é | Complementação **estadual** de valores da SES-SP para hospitais SUS não estaduais, **construída sobre o SIGTAP**: "Tab SUS MS" + "Complementação TSP" = "Tabela SUS Paulista". Segundo a Nota Técnica, os prestadores recebem até 5 vezes a tabela do MS e prestadores de natureza jurídica pública ficam de fora. Base legal: Resolução SS nº 198, de 29/12/2023 (anexos I hospitalar, II ambulatorial e III OPME), atualizada pelas SS 252/2024 e 16/2025; a SS 108/2026 trata de custeio complementar a hospitais municipais |
| Onde | `saude.sp.gov.br/ses/perfil/cidadao/homepage/outros-destaques/tabela-sus-paulista` (há também um BI em `nies.saude.sp.gov.br`); última carga em 27/08/2026 |
| Formato | **Três XLSX cumulativos** ("2026 - junho"): SIA (1,7 MB, 680 procedimentos), AIH (143 KB, 1.694) e OPME (18 KB, 109). Colunas: código, procedimento, "Tab SUS MS", "Complementação TSP", "Tabela SUS Paulista"; na AIH também `vl_sh_paulista` e `vl_sp_paulista`. Sem competência na planilha (só no nome e na aba); só a versão corrente fica no site; sem CSV; **sem licença declarada** |
| Cuidado | Código vem como número: **perde o zero à esquerda** (201010011 = 0201010011). Abas têm centenas de milhares de linhas vazias formatadas |
| **Validação com o SIGTAP 202606** | A coluna "Tab SUS MS" é **igual ao SIGTAP em 100%**: SIA 680 de 680 (valor SA), AIH 1.692 de 1.694 (SH + SP; 2 códigos não existem em 202606), OPME 109 de 109 (SA + SH + SP). Razão Paulista/MS: SIA mediana 1,5 (mín. 1,0, máx. 4,0); AIH mediana 3,15 (mín. 1,0, máx. 11,25); OPME mediana 1,48 (máx. 5,0). 13, 20 e 15 linhas sem complementação |
| Cobertura | A TSP cobre 680 dos 2.060 procedimentos ambulatoriais vigentes com valor (33%) e 1.691 dos 2.517 hospitalares (67%) |
| **Produção de SP (06/2026)** | Os procedimentos da TSP respondem por **49% do valor aprovado do SIA de SP** (R$ 365,5 mi de R$ 746,1 mi). O **valor aprovado no `PA` é o valor do MS, não o Paulista** (476 de 643 procedimentos têm valor unitário médio igual ao da tabela federal e só 8 igual ao Paulista): **a complementação estadual não está no arquivo federal**. Quantidade × complementação de todos os estabelecimentos dá R$ 166 mi/mês teórico, sem aplicar a regra de elegibilidade |

### 12.6 São Paulo: porte, desempenho e o que se repete (produção de SP, 12 meses, esquema 2)

Banco de produção de SP (816 MB) e CNES de SP (136 MB) carregados pelo usuário e **copiados** para `dados_dev\teste_sp\` (a pasta do cliente não foi tocada).

| Medida | Resultado |
|---|---|
| Volume | `prod_amb` 4.130.936 linhas; `prod_hosp` 516.706; 12 competências (08/2025 a 07/2026) |
| Estabelecimentos por mês | SIA 8.431 a 8.740 (7.241 em 07/2026); SIH 606 a 621 |
| Valor por mês | SIA R$ 677 a 772 mi; SIH R$ 439 a 498 mi (cerca de 1,25 milhão de dias de permanência) |
| Regra de mês completo | SIA de 07/2026: 7.241 contra a mediana de 8.600 = **84%**: marcado incompleto (certo: é o mês mais recente); SIH de 07/2026: 606 contra 615 = 98,5%: completo |
| **Desempenho** (copia do SIGTAP + CNES + produção de SP, CLI, uma execução) | `faturamento-painel` **19,9 s** (pico 28 MB); `faturamento-procedimentos` 16,5 s (29 MB); `faturamento-impacto` 16,9 s (17 MB); `faturamento-unidade` 3,4 s; `faturamento <proc>` 2,7 s; `producao-unidade` 1,4 s; `producao-situacao` 3,6 s. **Memória baixa; o tempo é o problema** |
| Causa do tempo | Os índices por estabelecimento e por procedimento já existem; criar mais não ajudou. O custo está nas **agregações da UF inteira** em `prod_amb`: `GROUP BY proc, comp` com `COUNT(DISTINCT cnes)` leva 14,2 s; sem o distinto, 12,9 s; só por competência, 2,2 s; o mesmo no `prod_hosp`, 1,5 s. Solução a estudar: tabela de **totais da UF por procedimento e competência** calculada na carga (29.726 linhas no SIA de SP) |
| Apta × produz em SP | 10 estabelecimentos com maior produção: **todos os "produz sem aptidão" são `so_38`**, com 3 exceções de `habilitacao` (1 procedimento em cada uma de 3 unidades). O padrão de MS se repete em SP; o maior hospital tem 458 procedimentos nessa classe, R$ 77,8 mi de valor |
| **Apresentado × aprovado em SP** | Em 12/2025, 01/2026 e 02/2026 a diferença chega a **R$ 198 a 216 mi/mês, contra R$ 7 a 40 mi nos outros meses**. **Um único estabelecimento responde por R$ 192,6 mi dos R$ 198 mi de 12/2025**, com cerca de 2 milhões de unidades apresentadas de hemocultura, adenograma e mielograma (334, 7 e 61 estabelecimentos produzem cada um): quantidade absurda, quase certamente erro de apresentação. **A tela de glosa precisa de detecção de valor atípico, ou um estabelecimento domina a UF** |

### 12.7 O que mudou no entendimento da glosa do SIA

Na Fase 4 a diferença apresentado × aprovado foi tratada como glosa. Com o `CODOCO.CNV` e o `PA_FLQT` (12.4): **em MS 07/2026 toda ela é teto financeiro** (`O` ultrapassou, `M` ultrapassou parcialmente), nenhuma é crítica de erro (`PA_FLER` sempre 0). Para o faturista isso muda a conversa: não é "o que errei", é "o que o gestor não pagou por falta de teto". Em SP o maior valor é de outra natureza: apresentação com quantidade fora de qualquer realidade.

### 12.8 `base_aih1.duck` (12 GB): estudado com o arquivo inteiro

O catálogo não pôde ser lido por faixa de bytes (as dimensões apareceram, a tabela de fatos não). O arquivo foi baixado por inteiro (12.000.440.320 bytes, a cerca de 0,8 MB/s) e aberto com DuckDB 1.5.6 (`pip install duckdb`, só no estudo). Resultado do `ler_duck.py`:

**Base consolidada de AIH do SIH, Brasil, de 01/2008 a 04/2026 (220 competências):** tabela de fatos **`stg_aih`: 221.499.268 linhas, 74 colunas**, e 13 dimensões.

| Tabela | Linhas | O que traz |
|---|---|---|
| `dim_cid_subcategoria` | 14.274 | CID completa (subcategoria, categoria, grupo, capítulo), **indicador de causa externa** e sua hierarquia, **indicador e grupo CSAP** (condições sensíveis à atenção primária) |
| `dim_estabelecimento` | 13.284 | CNES, nome, nome empresarial, nome único, CNPJ, município, `in_sihsus` |
| `dim_municipio` | 5.598 | Município com região de saúde, macrorregião, região metropolitana, capital, UF, região, gestor, status |
| `dim_nat_juridica` | 124 | Natureza jurídica, esfera, natureza agregada |
| `dim_procedimento` | 5.663 | Procedimento, forma de organização, subgrupo, grupo, código SIHSUS |
| `dim_mantenedora` | 4.225 | Mantenedora e se é do SIHSUS |
| `dim_tipo_estabelecimento` | 38 | Tipo de estabelecimento e agregado |
| `dim_arranjo_financ`, `dim_atividade_ensino`, `dim_gestao`, `dim_identificacao`, `dim_tipo_aih` | 13, 6, 4, 5, 4 | Domínios |

**Colunas de `stg_aih`** (nomes novos, mais claros que os do `RD`): competência (`DT_COMPET`, inteiro AAAAMM), tipo de AIH, **`NU_AIH`** e sequência, identificação, status, indicadores `QT_AIH`, `QT_INTERNACAO`, `QT_OBITO`, município gestor, gestão, estabelecimento, mantenedora, tipo de estabelecimento, natureza jurídica, município do estabelecimento e **de residência**, **`DT_NASCIMENTO`**, sexo, idade, **faixa etária (`CO_FXETARIA`)**, idade em anos, raça/cor, datas de internação e saída, caráter, procedimento solicitado e realizado, leito, motivo de saída, complexidade, `QT_DIAS_PERM`, `QT_DIARIAS`, tipo e dias de UTI, **tipo e dias de UI (unidade intermediária)**, dias de acompanhante, diagnóstico principal, **diagnóstico externo (`CO_DIAG_EXTERNO`)**, 9 secundários com seus tipos, diagnóstico de óbito, financiamento, rubrica, regra contratual, valores (`VL_SERVICO_HOSPITALAR`, `VL_SH_FEDERAL`, `VL_SH_GESTOR`, `VL_SERVICO_PROFISSIONAL`, `VL_SP_FEDERAL`, `VL_SP_GESTOR`, `VL_AIH`, `VL_UTI`, `VL_UI`), **`CO_ATIVIDADE_ENSINO`**, **`IN_FILANTROPICO`**, fonte orçamentária. **Pessoal: `NU_AIH`, `DT_NASCIMENTO`, município de residência.** O arquivo **não traz o CBO do profissional nem os atos**: para isso é preciso o `SP`.

**Medido:**

| Ano | AIH (milhões) | Valor (R$ bi) | | Ano | AIH (milhões) | Valor (R$ bi) |
|---|---|---|---|---|---|---|
| 2008 | 11,11 | 8,29 | | 2017 | 11,68 | 14,52 |
| 2009 | 11,51 | 10,12 | | 2018 | 12,00 | 15,11 |
| 2010 | 11,72 | 10,74 | | 2019 | 12,36 | 15,82 |
| 2011 | 11,64 | 11,31 | | **2020** | **10,69** | 16,39 |
| 2012 | 11,44 | 11,66 | | **2021** | 11,63 | **22,37** |
| 2013 | 11,52 | 12,70 | | 2022 | 12,52 | 19,08 |
| 2014 | 11,61 | 13,37 | | 2023 | 13,36 | 20,67 |
| 2015 | 11,64 | 13,79 | | 2024 | 14,17 | 23,67 |
| 2016 | 11,53 | 14,00 | | 2025 | 14,64 | 25,77 |
| | | | | 2026 (até abril) | 4,73 | 8,77 |

Todas as linhas têm status "Aprovada" (a base não traz rejeitadas). Tipo de AIH 1 (normal) 217,1 milhões e 5 (longa permanência) 4,4 milhões; identificação 1 (normal) 216,2 milhões e 5 (longa permanência) 5,3 milhões. **Gestão municipal 127,3 milhões (57,5%) e estadual 94,2 milhões (42,5%)**; **hospital filantrópico 48,2 milhões (21,8%)**; atividade de ensino `04` 145 milhões (65,5%), `03` 36 milhões, `05` 35 milhões. Em 2026 há de 1,15 a 1,25 milhão de AIH por mês.

**Conferência com o `RD` de MS, 04/2026:** o `RD` carregado no programa tem 17.649 AIH, R$ 27,58 mi, 80 estabelecimentos; o `.duck` (municípios do estabelecimento começando por 50) tem **16.797 AIH (95%), R$ 26,53 mi (96%), 76 estabelecimentos**. A base consolidada é **próxima, mas não igual** ao `RD`; a diferença não foi explicada (reprocessamento, filtro de status ou de município são as hipóteses).

**Limite técnico:** a máquina de estudo tem 16 GB, com 2,5 GB livres; o DuckDB falhou por memória em agrupamentos simples, e só rodou com `memory_limit` de 1,2 GB, uma thread e arquivo temporário em disco.

**Conclusão para o programa:** a base **não deve ser baixada pelo usuário** (12 GB, mais de 3 horas, paciente por linha). O que ela dá de novo está em colunas que o `RD` já tem ou em derivados simples (faixa etária, causa externa, CSAP, filantropia, ensino). O `RD` por UF e mês continua sendo a fonte, e as dimensões (CSAP, causa externa, hierarquia de CID, natureza jurídica agregada) podem ser extraídas uma vez, no desenvolvimento, como **tabelas auxiliares pequenas** (tamanho de ordem de 1 a 3 MB), se a licença permitir (sem declaração).
