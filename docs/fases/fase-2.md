# Fase 2 — Consulta do faturista

Abertura: 30/09/2026. Plano geral: [SIGTAP Aberto: plano de desenvolvimento por fases](https://claude.ai/code/artifact/2ee9540a-db25-4169-919a-a51acbd95324).

Objetivo: o primeiro programa usável. O faturista abre o `.exe` numa pasta vazia, o programa
baixa o obrigatório e ele consulta qualquer procedimento, em qualquer competência carregada,
com tudo o que o SIGTAP publica, mais o histórico. Paridade com a consulta do SIGTAP oficial e
do UniSUS.

## 1. Levantamento de escopo (abertura)

### 1.1 O que o estudo de abertura mostrou

| Fonte | Achado | Consequência |
|---|---|---|
| Site oficial do SIGTAP (navegador embutido, 30/09/2026) | A ficha mostra: grupo/subgrupo/forma, modalidade, complexidade, financiamento e subtipo, instrumento de registro, sexo, média e tempo de permanência, quantidade máxima, idade mínima e máxima, pontos, atributos complementares, valores (SA, SH, SP e totais) e abas CID, Leito, Serviço/Classificação, Habilitação, Redes, TUSS, Descrição, CBO, Origem, Regra condicionada, RENASES; link "Histórico do procedimento" | É a lista mínima da ficha; a nossa acrescenta compatibilidades, incrementos, SIA/SIH de origem e tudo com histórico |
| Site oficial | O código aparece mascarado com dígito: `03.01.01.007-2` = `0301010072` | Busca aceita com e sem máscara |
| Site oficial | Última competência no site: **08/2026**; no FTP já existe **09/2026** | O programa pode estar à frente do site; mostrar sempre a competência e a data de publicação do ZIP |
| Banco da Fase 1 × site oficial | Para 0301010072 em 08/2026, os 4 atributos complementares, o valor SA (R$ 10,00), o sexo e as idades batem com o site | Prova inicial de que a ficha sai do banco sem perda |
| `Lay-out.xls` (coluna "Preenchimento") | Domínios que **não estão em nenhuma tabela**: `TP_COMPLEXIDADE` (0–3), `TP_SEXO` (M, F, I, N), 9999 = "não se aplica" em quantidade, permanência, pontos e idades, `TP_COMPATIBILIDADE` (1–3), `TP_AGRAVO` (0–2), `ST_PRINCIPAL`, `TP_ESTADIO`, `TP_PROCEDIMENTO` (A, H); valores em centavos | Manifesto de domínios (dados), com a origem; sem ele a ficha mostraria "2" em vez de "Média complexidade" |
| Site oficial | Idade máxima 1.571 meses aparece como "130 anos"; 9999 aparece em branco | Regra de exibição: meses e anos, "não se aplica" para 9999 |
| API de Localidades do IBGE | `municipios?view=nivelado`: 5.571 municípios, 16 campos (código de 7 dígitos, UF, região, micro/mesorregião, regiões imediata e intermediária), 2,4 MB, uma chamada | Fonte dos municípios e UFs |
| API DEMAS `macrorregiao-e-regiao-de-saude/municipio` | 5.570 municípios em 8 páginas; **a página vem com no máximo 860 itens mesmo pedindo 1.000** (paginar até vir vazia); código de 6 dígitos; 439 regiões de saúde, 121 macrorregiões; população estimada IBGE 2022 | Fonte das regiões de saúde e da população; paginação pelo tamanho real devolvido |
| IBGE × DEMAS | Só 1 município do IBGE sem região de saúde (510183, criado depois da base do DEMAS); nenhum ao contrário | Mostrar "sem região de saúde na fonte" em vez de esconder |
| Rede | As duas APIs responderam do ambiente de nuvem e do computador do cliente; o DEMAS derrubou uma conexão durante a paginação | Download com novas tentativas também para HTTP |

### 1.2 Entregas e como cada uma será validada

| Id | Entrega | Validação no fechamento |
|----|---------|-------------------------|
| E01 | Manifesto de domínios do SIGTAP (`manifestos/sigtap_dominios.toml`) com a origem de cada valor | Teste: todo código presente no banco para essas colunas tem descrição |
| E02 | `sa-query`: consultas em JSON — competências, árvore, busca, ficha, histórico, comparação, "o que mudou", CID/CBO/habilitação/serviço → procedimentos | Testes com o banco das 225 competências (resultado conferido por SQL independente) |
| E03 | Busca global: código com e sem máscara, nome sem acento e por partes, CID, CBO, habilitação, serviço/classificação, instrumento | Casos reais escritos antes; tempo medido no Windows |
| E04 | Ficha completa: todos os atributos de `tb_procedimento` e **todas** as tabelas `rl_*` que citam o procedimento, com nomes dos códigos | Teste que falha se alguma `rl_*` com `co_procedimento` ficar fora da ficha; conferência de 30 fichas contra o site oficial |
| E05 | Histórico do procedimento (linha do tempo por campo e por relação) e comparação entre duas competências | Casos reais (ex.: VL_SH que mudou em 202506) conferidos contra os ZIPs |
| E06 | "O que mudou na competência": incluídos, excluídos, alterados, por tabela, usando as chaves naturais | Conferência por amostra com a nota técnica do mês |
| E07 | Pacote de território (`territorio.db`): UF, município (7 e 6 dígitos), região de saúde, macrorregião, população, a partir do IBGE e do DEMAS, com proveniência | 5.571 municípios; 5.570 com região de saúde; o que falta aparece como "sem região na fonte" |
| E08 | Download HTTP com cortesia (território), com novas tentativas e paginação pelo tamanho devolvido | Testes com servidor HTTP falso (queda, página curta); execução real no Windows |
| E09 | Aplicativo: primeira execução (baixa SIGTAP vigente + território, progresso, cancelar, retomar), importação manual (pasta de ZIPs e arquivos do território), módulo opcional "histórico do SIGTAP" | No Windows, numa pasta vazia; com rede e sem rede |
| E10 | Telas: seletor de competência global, árvore, busca, ficha com abas, histórico, comparação, "o que mudou", telas de apoio (CID, CBO, habilitação), painel de frescor, aviso de ferramenta não oficial com fonte e data em toda tela | Protótipo aprovado pelo cliente **antes** da implementação; depois, conferência tela a tela |
| E11 | Favoritos e anotações locais; exportação CSV e XLSX; CLI com saída JSON (`consultar`, `buscar`, `ficha`) | Arquivos abertos no Excel/LibreOffice; JSON validado |
| E12 | Portabilidade mantida (tudo em `dados\` ao lado do `.exe`) | `testar_portatil.bat` estendido: pasta vazia, primeira execução, nada fora da pasta |
| E13 | Desempenho | Busca e ficha medidas no Windows do cliente (meta: resposta abaixo de 300 ms com as 225 competências) |
| E14 | Registro | Fechamento aqui; diário; plano e documento-mestre |

### 1.3 Como a interface será desenhada

1. **Protótipo no Figma** (conector disponível), com a skill de design de interface: telas de
   início/primeira execução, busca, árvore, ficha com abas, histórico e comparação, "o que
   mudou", módulos e frescor. Densidade de informação de ferramenta de trabalho, não de site.
2. **Aprovação do cliente** no protótipo antes de escrever a interface.
3. Implementação em HTML, CSS e JavaScript sem empacotador, consumindo `sa-query` pelos
   comandos do Tauri.

### 1.4 Decisões desta fase

| Decisão | Escolha | Motivo |
|---|---|---|
| Onde fica a lógica de consulta | Toda em `sa-query` (Rust), resposta em JSON | Interface, CLI e testes usam as mesmas consultas |
| Busca por nome sem acento | Índice de texto do SQLite (FTS5) sobre nomes normalizados, por competência vigente e histórica | Rápido e embutido; conferir se o SQLite empacotado traz FTS5 |
| Território | Banco separado `territorio.db` (módulo obrigatório) | Arquitetura por módulo; atualização independente |
| Domínios sem tabela | Manifesto com a origem (`Lay-out.xls`, coluna "Preenchimento") | Nada de texto fixo no código |
| Competência padrão | A mais recente carregada | É o que o faturista usa no dia a dia; troca em um clique |

### 1.5 Riscos

- Escopo de interface grande: o protótipo pode pedir ajustes antes de codificar.
- A API do DEMAS derruba conexões e limita a página; o território precisa de retomada.
- Diferenças de apresentação entre o site oficial e a nossa ficha (ex.: anos × meses) podem
  confundir; cada campo mostra o valor oficial e a conversão.
- `tb_descricao` e textos longos com quebras de linha exigem cuidado na exibição.

### 1.6 Fora desta fase

CNES e qualquer cruzamento com a unidade (Fase 3); produção e rejeições (Fase 4).

## 2. Andamento (30/09/2026)

| Id | Situação | Evidência até agora |
|----|----------|---------------------|
| E01 | Feito | `manifestos/sigtap_dominios.toml`; teste `dominios_cobrem_o_banco` (225 competências): 26 códigos com descrição oficial; **sem descrição na fonte**: compatibilidade 4 (desde 201502) e 5 (desde 201509), sexo `A` (só 0702050369 em 200801) |
| E02 | Feito (Linux) | `sa-query` + `manifestos/sigtap_referencias.toml`; `tests/consulta_real.rs`: 331 fichas em 7 competências, 6.600 relações e 19.280 linhas conferidas por SQL independente; árvore = total de vigentes em 200801 e 202609; 22 históricos iguais à comparação mês a mês; 224 viradas do "o que mudou" iguais aos intervalos; 72 colunas CO_/NU_ cobertas pelo manifesto |
| E03 | Feito (Linux) | Casos reais: "desfibrilador" = 19 (igual a LIKE), sem acento e por partes, código com e sem máscara, prefixo 04.06.01 = 149, CID I42.0, CBO 225120, habilitação 0802 e por nome; pior tempo 32 ms (Linux) |
| E04 | Feito, falta conferência visual de 30 fichas no site oficial | Ficha lista toda tabela que cita o procedimento, inclusive vazias (teste compara com o leiaute da competência) |
| E05 | Feito | 0406010579: 26 competências com mudança; VL_SP alterado em 202206 conferido |
| E06 | Feito | 202608→202609: 3 procedimentos alterados, 574 vínculos, 11 mudanças de apoio |
| E07 | Feito (Linux, download real) | `territorio.db`: 5.571 municípios IBGE, 5.570 DEMAS, 27 UFs, 439 regiões, 121 macros; 5101837 sem região de saúde na fonte |
| E08 | Feito | `sa-download::http` + testes com servidor falso (página curta de 860, queda, 404 sem repetir, 503 com 3 tentativas, limite de tamanho, formato novo recusado) |
| E09 | Em andamento | Comandos do aplicativo prontos (situação, consultas, baixar, importar, cancelar, eventos de progresso); falta executar no Windows |
| E10 | Em andamento | Protótipo no Penpot (6 telas, aguardando aprovação); interface HTML implementada e navegada no Chromium pela ponte de desenvolvimento (`scripts/dev/ponte_ui.py`), sem erros de console |
| E11 | Parcial | CLI com `ficha`, `buscar`, `arvore`, `historico`, `mudou`, `territorio` em JSON; favoritos, anotações e exportação CSV/XLSX pendentes |
| E12–E14 | Pendentes | Validação no Windows e registro |

Achados desta etapa:
- O `Lay-out.xls` diz idade de 0 a 1.331 meses; os dados usam até 1.571 desde 201308.
- Textos oficiais com `||` dentro (ex.: `tb_regra_condicionada` 0015, `tb_descricao_detalhe` 001): parece marcador de quebra de linha, mas não há documentação. Exibido como está até haver prova.
- A ficha mostra o nome de cada código na competência do evento: a habilitação 2902 aparecia em 09/2023 como "Programa Nacional de Redução de Filas de Cirurgias Eletivas" e hoje tem outro nome.
- Dependência nova com licença fora da lista: `webpki-root-certs` (CDLA-Permissive-2.0, lista de certificados raiz da Mozilla). Exceção documentada em `deny.toml`.
- Protótipo migrado do Figma (limite de chamadas do plano Starter) para o Penpot do cliente.

Versionamento das telas (Penpot do cliente): uma página por versão e uma versão salva do
arquivo a cada entrega; a interface do programa segue a versão mais recente.

| Versão | Página no Penpot | Interface (commit) | O que mudou |
|---|---|---|---|
| v1 | "v1 — 1440×900 (30/09)" | 6406dc9 | 6 telas com dados reais |
| v2 | "v2 — 1366×768 (01/10)" | fc4a700 | Pior caso de tela (1366×697 úteis); árvore em escada pela numeração com ancestrais fixos e divisor ajustável; ficha compacta (faixa-chave, abas agrupadas, "Para cobrar"); busca agrupada por forma; início com resumo |

## 3. Fechamento

(preenchido ao final da fase)
