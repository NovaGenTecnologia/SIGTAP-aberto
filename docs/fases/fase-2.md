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

## 2. Fechamento

(preenchido ao final da fase)
