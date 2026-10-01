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
| v2.1 | mesma página da v2 (versão salva "v2.1") | a4f4de1 | Árvore sem recuo: o código inteiro faz a escada; prefixo do pai em cinza claro, pedaço do nível em verde escuro |
| v2.2 | página "v2.2 — 1366×768 (01/10)" (pendente: aba do Penpot suspensa) | 388c65d | Busca com sugestões ao digitar; Voltar e "Procedimentos" na barra; barra de progresso única com "Fazendo download X de N"; progresso no rodapé ao sair da tela; downloads parciais (6/12/24 meses) com tamanho real; apagar ZIPs; Procurar pasta e instruções de download manual; "ver mais" no O que mudou; cópia com Ctrl+clique e do nome; mês do histórico pisca; seta da árvore maior |

| v2.3 | (pendente: Penpot) | (este commit) | Aviso de dados novos e de versão nova do programa; atualizador do próprio programa; CIDs em árvore (aba); expandir/recolher tudo; opções de download já feitas em cinza; link do SIGTAP no rodapé; Sobre; Sugerir ou relatar; saúde do banco (verificar, recriar, recuperação automática); passo a passo manual reescrito; correção do bug dos "ligados" repetidos |

### 2.1 Entrega v2.2 (01/10/2026): o que foi provado e onde

Provado no Linux (contêiner), com dados reais:
- Download e carga em duas linhas de trabalho (`sa-app`, testes `servico::testes`): FTP local servindo
  4 ZIPs oficiais (202606–202609). A carga começa antes do fim dos downloads; ordem da mais recente
  para a mais antiga; a barra nunca volta e termina em 100%; o banco montado de trás para frente
  (`resumo_logico`) é idêntico ao montado em ordem, inclusive depois de acrescentar uma competência
  mais antiga; com "apagar ZIPs" só fica o ZIP de 09/2026; cancelar para as duas linhas sem deixar
  arquivo pela metade com nome final.
- Carga retroativa medida: 2,1–2,5 s por competência contra 1,4–1,5 s em ordem; por isso a mais recente
  vem primeiro (fica utilizável logo) e as antigas entram de trás para frente.
- "Ver mais" do O que mudou: páginas de 7 itens de cada tabela, concatenadas, reproduzem a lista
  completa (08/2026→09/2026). Consultas reais: 7 testes passando contra o banco de 225 competências.
- Importação manual do território: páginas `demas*.json` salvas do navegador são juntadas; página
  repetida é recusada (município repetido); arquivo estranho é recusado com o nome.
- Interface pela ponte de desenvolvimento (download simulado): sugestões, teclado, cópias (sem pontos,
  com pontos, nome), piscar, ver mais, voltar, rodapé, primeira execução cabendo em 1366×697 sem rolar.
- Largura mínima: sem rolagem horizontal em todas as telas a 1024 px, inclusive com a árvore alargada
  ao máximo (a árvore é limitada para o conteúdo nunca ficar abaixo de 730 px; a tabela mais larga,
  Compatíveis, pede ~716 px). A 960 px já aparece rolagem; o mínimo da janela fica 1024×640.

Não testado: nada disso no Windows; o FTP real do DATASUS com as duas linhas (o contêiner não alcança);
a janela "Procurar pasta" (tauri-plugin-dialog 2.8.1, MIT/Apache-2.0) só existe no programa compilado.
Dependência nova conferida com `cargo deny check licenses`.

Achado: o banco não tinha `busy_timeout`; consulta e carga simultâneas poderiam falhar com "database is
locked". Agora 30 s.

### 2.2 Entrega v2.3 (01/10/2026): o que foi provado e onde

Pedido do cliente em 01/10, 14 itens. Estado de cada um:

| Item | Estado | Prova |
|---|---|---|
| Bug: clicar de novo num CID repetia os procedimentos ligados | Corrigido | A seção "ligados" agora é substituída. Na ponte de desenvolvimento, 4 cliques seguidos em T742 deixam 1 seção com 5 linhas (antes cada clique acrescentava outra) |
| Aviso de dados novos | Feito | `Servico::verificar_dados` compara a lista do servidor com o banco: competência mais nova que a última carregada = "nova"; versão do ZIP mais nova que a carregada = "republicada". Teste com FTP local e ZIPs reais: 1 nova, 1 republicada, depois "tudo em dia"; não baixa nada. A interface confere 20 s depois de abrir e a cada 6 h, nunca durante um download (uma conexão por servidor) |
| Opções já baixadas em cinza | Feito | Uma opção fica cinza e desabilitada quando todas as competências dela estão no banco na versão do servidor; a seleção pula para a primeira opção livre. Na ponte: vigente e 6 meses cinza, 12 meses marcado |
| "SIGTAP" no rodapé abre o site | Feito | Comando `abrir_site` com lista de endereços permitidos (site do SIGTAP e repositório); teste de unidade com endereços aceitos e recusados. Site conferido por WebFetch em 01/10 (abre; título "SIGTAP - Sistema de Gerenciamento da Tabela de Procedimentos, Medicamentos e OPM do SUS") |
| CIDs em árvore | Feito | Aba "CIDs" na árvore da esquerda: letra → categoria (3) → subcategoria (4), com a contagem de procedimentos ligados. Estudo dos dados: `tb_cid` traz categorias e subcategorias com nome (14.246 códigos em 09/2026: 2.045 de 3 caracteres e 12.201 de 4); **capítulos e blocos da CID-10 não vêm no SIGTAP e não foram inventados** (módulo futuro, de fonte oficial). Prova: `arvore_de_cids_bate_com_sql_independente` em 2010-01 e 2026-09 (categorias e subcategorias iguais ao SQL; T74.2 = 5 procedimentos, igual ao SQL). Achado: em 2010-01 só existem códigos de 4 caracteres (2.044 categorias só como prefixo) |
| Recolher/expandir tudo | Feito | Um ícone no alto da árvore. Expandir abre todos os níveis menos a lista final (procedimentos ou subcategorias): árvore de procedimentos 9→502 linhas; CIDs 26→2.074 |
| Linha do nível mais marcada | Feito | 2 px em tom mais escuro dentro da própria linha (a sombra de 1 px ficava escondida pelo nível seguinte) |
| Atualizador do programa | Feito, não testado de ponta a ponta | `sa-download::atualizador`: consulta o último lançamento do GitHub, compara versões, baixa o ZIP, confere o SHA-256 publicado, extrai o .exe (confere o cabeçalho MZ), renomeia o atual para `.antigo.exe`, põe o novo e reabre. 5 testes: versões, leitura do lançamento (recusa rascunho, pré-lançamento e endereço fora do repositório), hash, extração, troca com desfazer. **Não testado:** download real (o repositório ainda não existe), a troca do .exe em uso no Windows, o fluxo `.github/workflows/release.yml`. Limite: o SHA-256 vem do mesmo lançamento; o .exe não é assinado |
| Gramática e clareza do download manual | Feito | Reescrito em 5 passos numerados, frases curtas, com dicas (extensões ocultas, FileZilla, não usar Chrome/Edge para ftp). Não testado: o "Salvar como" do Edge/Chrome para as páginas JSON |
| Sobre | Feito | Agradecimento, missão, gratuito/AGPL, apoio voluntário opcional (Pix, chave aleatória). Chave Pix e GitHub Sponsors vêm de `crates/app/ui/apoio.js` (vazio: aparece "em breve") |
| Sugerir ou relatar | Feito | Abre uma Issue do GitHub com título e texto prontos (versão, Windows, WebView2, competência, tela; nada de paciente), ou e-mail (se `apoio.js` tiver e-mail), ou copia o texto. Aviso fixo contra dados de paciente. Limite: precisa de conta no GitHub; Issues de repositório privado só aparecem para quem tem acesso |
| Verificar/recriar o banco + recuperação automática | Feito | `sa-packs::saude` (`quick_check`/`integrity_check` só leitura; quarentena em `dados\banco_com_problema_N` com LEIAME, nunca apaga). Na abertura o programa confere os dois bancos; achando dano, guarda e refaz do que há em `dados` (ZIPs e JSON do território). Teste com ZIPs reais: 64 páginas estragadas no meio do arquivo → achado na abertura, quarentena, refeito com as mesmas 3 competências e os mesmos SHA-256. Competência sem ZIP guardado é listada e precisa de novo download |
| GitHub privado + upload | **Pendente do cliente** | A API da sessão bloqueia a criação de repositório (`POST /user/repos`) e a lista de repositórios vem vazia. Falta o repositório existir; o histórico local está limpo (103 arquivos, o maior com 122 KB; nenhum zip, banco, pdf ou arquivo de paciente) |

Provado no Linux: `cargo test --workspace --release` com ZIPs reais e o banco de 225 competências, sem falhas;
`cargo clippy -D warnings`, `cargo fmt`, `cargo deny check licenses` (nova dependência direta `zip` em
`sa-download`, MIT). Interface (Playwright, ponte de desenvolvimento): sem erros no console; sem rolagem
horizontal em 1024, 1100 e 1366 px; primeira execução cabe em 1366×697.

Achado de interface: o corpo da página era uma grade de 3 linhas; um aviso no alto fazia o corpo cair
para a linha errada. Agora são 4 linhas (barra, avisos, corpo, rodapé) e a linha de avisos fica com
altura zero quando vazia.

Não testado: tudo isto no Windows; o FTP real; `rundll32` abrindo o navegador; WebView2.

## 3. Fechamento

(preenchido ao final da fase)
