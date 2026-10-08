# Fase 3 — CNES e Minha unidade

Abertura e desenvolvimento: 01/10/2026. Plano geral: [SIGTAP Aberto: plano de desenvolvimento por fases](https://claude.ai/code/artifact/2ee9540a-db25-4169-919a-a51acbd95324).

Objetivo: o programa passa a conhecer os estabelecimentos. O faturista escolhe a sua unidade e,
em cada procedimento, vê se o cadastro dela no CNES tem o que o SIGTAP exige e quem mais faz o
procedimento na rede. A pedido do cliente, a fase também fecha as pendências da Fase 2
(favoritos, anotações, exportação, conferência de 30 fichas, telas no Penpot, prova no Windows).

## 1. Levantamento de escopo

### 1.1 O que o estudo de abertura mostrou

Detalhes e evidências em [`docs/fontes/cnes.md`](../fontes/cnes.md).

| Fonte | Achado | Consequência |
|---|---|---|
| FTP `dissemin/publicos/CNES/200508_/Dados/<TIPO>/` | Um `.dbc` por tipo, UF e mês (`STMS2608.dbc`). MS 08/2026: ST 331 KB, HB 16 KB, SR 160 KB, LT 12 KB, EQ 142 KB, PF 2,5 MB | Módulo por UF; download pequeno; um arquivo por vez |
| Formato `.dbc` | Cabeçalho DBF (tamanho nos bytes 8–9) + 4 bytes de CRC + fluxo PKWare DCL "implode" | Descompressor próprio, sem dependência nova |
| Arquivos reais (26, de 2008 a 2026) | Os do DATASUS usam literais não codificados; 2 cabeçalhos (ST 2401 e 2608) vêm sem o terminador `0x0D` | Leitor de DBF tolerante; `dbfread` (Python) falha nesses dois |
| Esquema ao longo do tempo | ST tem 208 campos em 2026; `NAT_JUR` entra em 2016; sete campos `AP0xCV07` entram depois de 2020 | O esquema vem do próprio arquivo; nada de posição fixa no código |
| ST | Não traz o nome do estabelecimento | Nomes vêm de `CADGER<UF>.dbf`, dentro de `Auxiliar/TAB_CNES.zip` (127 MB, 1.016 entradas) |
| `TAB_CNES.zip` | O índice do ZIP fica no fim; cada entrada tem posição e tamanho | Leitura parcial pelo FTP (`REST`): baixa o índice, o cadastro da UF e as tabelas de nomes, cerca de 5 MB em vez de 127 MB |
| PF | Traz `CPF_PROF` (embaralhado na origem) e `CNS_PROF` de todas as pessoas da UF | Nunca gravados; PF só entra para a unidade escolhida; o arquivo é apagado depois da carga |
| SIGTAP × CNES em MS 08/2026 | Habilitações 537/537; serviço/classificação 15.947/15.968; leitos 1.036/1.036 | Chaves de junção servem |
| Regra de aptidão | O SIGTAP lista habilitações soltas e em grupo (`tb_grupo_habilitacao`, nome literal "0801 e 0803") | Grupo = todas juntas; alternativas = uma basta. Regra **não confirmada** com rejeição real |

### 1.2 Entregas e validação

| Id | Entrega | Como foi validada | Situação |
|----|---------|-------------------|----------|
| F01 | Descompressor `.dbc` (DCL implode) escrito do zero (`sa-sources::dcl`, `dbc`) | 26 arquivos reais idênticos byte a byte ao oráculo (`datasus-dbc`); vetor da especificação; literais codificados cobrindo os 256 bytes | Feito |
| F02 | Leitor de DBF tolerante (`sa-sources::dbf`) | Contagens iguais às do oráculo; dois cabeçalhos fora do padrão lidos | Feito |
| F03 | Módulo CNES por UF, um SQLite por UF (`dados\cnes\<UF>.db`), ST/HB/SR/LT/EQ completos e PF só da unidade escolhida | `cnes_real.rs` (MS): 7.108, 537, 15.968, 1.036, 15.658; nenhum campo descartado além dos da privacidade | Feito |
| F04 | Privacidade por manifesto (`manifestos/cnes.toml`) | Teste automatizado: sem coluna `CPF_PROF`/`CNS_PROF`; CPF de titular pessoa física apagado; profissionais de outra unidade = 0; arquivo PF não fica em disco | Feito |
| F05 | Download com cortesia do FTP do CNES por UF e competência, com retomada e modo manual | Servidor FTP falso (4 testes) e **download real** de MS 08/2026 (48 s, 4,8 MB) | Feito |
| F06 | Tela "Minha unidade": habilitações (portaria e vigência), serviços e classificações, leitos, equipamentos, profissionais e CBO | Ponte de desenvolvimento com dados reais de MS; capturas em 1366×697 e 1024×640; sem erro no console | Feito (Linux) |
| F07 | Na ficha: "minha unidade está apta?" com o motivo | 900 procedimentos conferidos por cálculo independente; casos apta, não apta, ressalva e sem exigência vistos na tela | Feito; regra não confirmada |
| F08 | Na ficha: "quem faz na rede" por município, região de saúde e UF | Contagem por SQL independente (3.563 de 3.728 na regra simples; 3.561 com grupos) | Feito; regra não confirmada |
| F09 | Aviso da competência do CNES ao lado da do SIGTAP | Visto na barra; muda de cor quando as competências diferem | Feito |
| F10 | Unidade do hospital do cliente conferida com cnes.datasus.gov.br | Ver 2.3 | Feito, com achado |
| F11 | Favoritos e anotações locais (`dados\usuario.db`) | Testes de unidade; fluxo na tela | Feito (Linux) |
| F12 | Exportação CSV e XLSX (ficha, tabela, busca, unidade, rede, favoritos) | XLSX aberto com openpyxl e LibreOffice; CSV com `;`, BOM e proteção contra fórmula | Feito (Linux); "Salvar como" do Windows não testado |
| F13 | Conferência de 30 fichas contra o site oficial do SIGTAP | Ver 2.4 | Feito |
| F14 | Telas no Penpot | Ver 2.6 | Ver 2.6 |
| F15 | Prova no Windows | `scripts\windows\provar_fase3.bat` | **Pendente do cliente** |
| F16 | Registro | Este documento, `docs/fontes/cnes.md`, diário, plano, documento-mestre | Feito |

Fora do escopo (plano): produção do SIA e do SIH, glosas e rejeições.

### 1.3 Decisões desta fase

| Decisão | Escolha | Motivo |
|---|---|---|
| Cruzamento SIGTAP × CNES | Em Rust, com duas conexões (uma por banco), e não com `ATTACH` | **Desvio do plano.** A consulta do SIGTAP já resolve a vigência por competência em Rust; repetir isso em SQL com `ATTACH` duplicaria a regra. O `ATTACH` continua previsto para os cruzamentos de produção (Fase 4) |
| Onde fica a lógica da unidade | Crate novo `sa-unidade`, usado pelo aplicativo e pela linha de comando | A ponte de desenvolvimento e os testes exercitam o mesmo código da janela |
| Profissionais | Só da unidade escolhida; sem `CPF_PROF` e sem `CNS_PROF`; nome, CBO, conselho, vínculo e horas ficam | O faturista confere CBO de quem executa; identificadores pessoais não são necessários para isso. **A Fase 5 (conferência pré-envio) pode precisar casar o CNS do profissional do arquivo com o do CNES: decidir então, com resumo criptográfico e nunca o número** |
| Arquivo bruto de PF | Apagado logo depois da carga | Traz todas as pessoas da UF. Trocar de unidade pede baixar de novo (2,5 MB em MS) |
| Arquivos brutos HB, SR, LT, EQ e `cnv\` | Guardados em `dados\cnes\arquivos\<UF>\` | O banco pode ser refeito sem baixar |
| ST e `CADGER` | **Apagados depois da carga** (decisão do cliente, 05/10/2026) | Trazem o CPF de titulares pessoa física (1.669 estabelecimentos em MS). Em produção nunca ficam guardados, como o PF. Refazer o banco do CNES pede baixar de novo. A cópia local de desenvolvimento fica em `dados_dev\`, fora do programa e do repositório |
| Unidade escolhida, favoritos, anotações | `dados\usuario.db`, separado dos bancos de dados oficiais | Não pode ser refeito de fonte oficial; não é tocado quando um banco é refeito |
| Versão do esquema | `cnes` = 1, `usuario` = 1; versão anterior refaz dos arquivos guardados; versão mais nova recusa sem alterar | Mesma regra da Fase 2 |
| Exportação | XLSX escrito à mão com o `zip` que o projeto já usa | Sem dependência nova |

## 2. O que foi feito, provado e achado

### 2.1 Leitores e módulo

- `sa-sources`: `dcl` (explode), `dbc`, `dbf`, `cnes` (manifesto), `zip_parcial`.
- `sa-packs`: `cnes` (banco por UF; tabelas `cnes_<tipo>` com **todos** os campos do DBF, `cnes_cad`, `cnes_decod`, `sa_arquivo`, `sa_campo`, `sa_privacidade`) e `usuario`.
- `sa-download`: `cnes` (competências do servidor, download, auxiliares por leitura parcial, importação de pasta) e `Ftp::baixar_trecho`.
- `sa-query`: `cnes` (resumo, busca, unidade, aptidão, rede, cobertura) e `exportar`.
- `sa-unidade`: junta tudo para o aplicativo e a linha de comando.

### 2.2 Regra de aptidão (não confirmada)

- Habilitação: cada linha sem grupo é uma alternativa; cada grupo é uma alternativa que exige todas as suas habilitações; basta uma alternativa. Vigência conferida na competência do CNES (`CMPT_INI` ≤ competência ≤ `CMPT_FIM`; `999999` ou vazio = sem fim).
- Serviço/classificação: basta um dos pares exigidos.
- Habilitação **e** serviço precisam ser atendidos.
- Leito: aparece como requisito de cadastro; a correspondência entre o tipo de leito do SIGTAP e o do CNES é por nome igual (14 linhas no manifesto) e também não está confirmada.
- Habilitações 38.xx (Agora Tem Especialistas): aviso de regra própria.
- Críticas oficiais que sustentam a leitura: SIHD "PROCEDIMENTO REALIZADO EXIGE HABILITAÇÃO" e "HOSPITAL NÃO POSSUI O SERVICO/CLASSIFICACAO EXIGIDOS"; SIA 3 e 32 (fonte secundária). Fontes em `docs/fontes/cnes.md`.
- A tela mostra sempre "regra não confirmada". Só muda com arquivo rejeitado + retorno oficial.

### 2.3 Unidade do hospital do cliente × site oficial do CNES (01/10/2026)

Programa (CNES de disseminação, 08/2026) × `cnes.datasus.gov.br` (carga de 20/09/2026):

| Item | Programa | Site | Resultado |
|---|---|---|---|
| Nome, município, tipo, gestão | iguais | iguais | Confere |
| Habilitações | 3 (0901, 1901, 1902; 01/2019 a 12/2030; portaria 4521) | as mesmas 3, mesmas datas e portaria | Confere |
| Leitos | 9 especialidades, mesmos existentes e SUS | as mesmas 9 | Confere |
| Serviço/classificação | 37 pares | 54 pares: os mesmos 37 próprios **mais 17 terceirizados** | **Achado** |

**Achado: o arquivo público de serviços (SR) só traz serviço próprio.** Nos seis arquivos de MS
conferidos (2008 a 2026) não há nenhuma linha de serviço terceirizado (em 08/2026, as 15.968
linhas têm `CARACTER = 1`). No site, a unidade tem laboratório clínico (145), anatomia patológica
(120) e outros por terceiros. Consequência: sem aviso, o programa diria "não apta" para exames
de laboratório dessa unidade. Tratamento: quando falta só o serviço, a tela diz "Serviço não
achado no cadastro" (ressalva, não "não apta"), explica que terceirizados não aparecem e manda
conferir no site; a rede avisa que conta só serviço próprio.

Decisão de produto em aberto: buscar os serviços terceirizados **só da unidade escolhida** no
serviço público do site do CNES (uma consulta, com cortesia). Não foi feito: é fonte nova e
merece decisão do cliente.

### 2.4 Trinta fichas × site oficial do SIGTAP (08/2026)

O site só tinha até 08/2026 (09/2026 responde "página não encontrada"); a conferência usou 08/2026.
30 procedimentos de todos os grupos, 26 itens cada (nome, modalidade, complexidade, financiamento,
instrumento, sexo, permanência, quantidade, idades, pontos, atributos, três valores, CID principal
e secundário, CBO, leito, serviço, habilitação, grupos, incremento, SIA/SIH, regra condicionada,
RENASES): **780 comparações, 761 idênticas, 19 diferenças, todas explicadas e nenhuma de dado**:

| Diferença | Casos | Explicação |
|---|---|---|
| CBO | 15 | O site mostra famílias ("Categoria CBO") e só os CBO fora delas; o ZIP traz a lista expandida. Em 7 casos conferidos contra o ZIP: todo CBO nosso está na lista do site ou numa família listada, e nenhum do site falta |
| Complexidade | 3 | O site escreve "Atenção Básica"; o `Lay-out.xls` oficial escreve "Atenção Básica Complexidade" (é o que o programa mostra) |
| Atributo complementar | 1 | O site abrevia o nome do atributo 065; o programa mostra o nome do `tb_detalhe` do ZIP |

### 2.5 Download real

No computador do cliente (máquina Linux da sessão, que alcança o FTP): `cnes-competencias MS`
listou as competências; `cnes-baixar MS` baixou ST, HB, SR, LT, EQ de 08/2026, o cadastro de MS e
13 tabelas de nomes por leitura parcial do `TAB_CNES.zip` (4,8 MB no total, 48 s) e carregou
7.108 estabelecimentos. Com a unidade escolhida, baixou o PF, carregou 7.227 vínculos da unidade
e apagou o arquivo.

### 2.6 Telas no Penpot

Ver o diário do projeto (registro de 01/10/2026).

### 2.7 O que foi testado e onde

- **Linux (nuvem):** `cargo test --workspace` com dados reais (ZIPs do SIGTAP, banco de 225 competências, território, `.dbc` de MS), `cargo clippy -D warnings`, `cargo fmt`; interface pela ponte de desenvolvimento com os comandos reais da linha de comando (Playwright, 1366×697 e 1024×640, sem erro no console).
- **Linux (computador do cliente):** download real do CNES de MS.
- **Não testado:** nada desta fase no Windows (janela, "Salvar como", tempo de resposta, portabilidade com `dados\cnes` e `usuario.db`); UFs grandes (SP: ST e PF muito maiores; tempo de carga e de aptidão por medir); leitura parcial do `TAB_CNES.zip` em rede com FTP instável; competências antigas do CNES na tela.

### 2.8 Revisão de 02/10/2026

- **Download do CNES.** Medido no FTP real (`ftp.datasus.gov.br`, IP único): cerca de metade das sessões novas falha em 19,5 a 21 s, por EOF no controle ao enviar `REST`/`RETR` ou por conexão recusada na porta PASV anunciada. O servidor anuncia portas de dados mortas, de forma intermitente. O código antigo abria uma sessão nova por trecho (~5 por download dos auxiliares) e cada uma precisava vencer 4 tentativas, o que dava ~27% de downloads falhos. Correção: uma sessão por arquivo, reaproveitada entre trechos; PASV repetido na mesma sessão com tempo curto (10 s, 3 vezes); tentativas 6 com espera 3 s dobrando até 30 s. Provado com servidor FTP falso (portas mortas, uma só conexão de controle); **não provado** contra o servidor real nem no Windows.
- **Interface.** Primeira execução oferece o CNES da UF; "Utilizar este"; várias unidades com troca rápida; marcador de habilitação na lista da esquerda; aptidão resumida na ficha, com "Detalhes"; busca por unidade lista os procedimentos habilitados; ícone de atualizações (SIGTAP, CNES por UF, programa) com "Baixar" e "Atualizar tudo"; Módulos e dados em abas (Dados, Baixar e importar, Atualizações, Armazenamento), já com lugar para SIA/SIH e TUSS/TISS; CID por capítulo; textos curtos; "regra não confirmada" saiu da tela (o aviso geral de ferramenta não oficial permanece).
- **Esfera administrativa (`ESFERA_A`).** Nas 7.108 linhas de MS é idêntica a `TPGESTAO` (D=45, E=48, M=7.015). O `EsferAdm.CNV` oficial descreve 01 Federal, 02 Estadual, 03 Municipal, 04 Privada, o que contradiz os dados reais. Os nomes (Dupla, Estadual, Municipal, Sem gestão) ficam fixos no manifesto (`[[valor_fixo]]`), conforme os valores de gestão. A esfera jurídica de fato vem de `NAT_JUR`.
- **"Incentivo de SP".** Não existe dado com esse nome no SIGTAP nem no CNES. "SP" na ficha é Serviço Profissional (valores e incremento); as siglas passaram a ser escritas por extenso. Nenhuma ocultação por UF foi criada sem evidência de dado que varie por UF.

### 2.9 Revisão de 05/10/2026 (Windows, sem rede)

Mesmo ambiente e resultados da Fase 2 (3.1). Específico desta fase:

- `cargo test --workspace` passou. Os 3 testes CNES reais (`packs/cnes_real`, `query/cnes_real`,
  `unidade::cnes_do_download_a_aptidao_e_a_rede`) falharam na primeira rodada por falta do
  `PFMS2608.dbc`, que o programa apaga de propósito. A pasta de dados do cliente tinha uma cópia
  dele (e `tab_cnes\`); com `SA_CNES_DBC` apontando para ela, **os 3 passaram no Windows** (MS 08/2026:
  7.108 / 537 / 15.968 / 1.036 / 15.658; cruzamentos; do download à aptidão e à rede em 12,5 s).
  **F03, F04, F07 e F08 estão provados no Windows para MS.** Outras UFs seguem sem prova.
- O `dbc_reais` terminou sem rodar (precisa de `SA_CNES_ORACULO`, ferramenta de referência externa).
- A pasta de dados do cliente tem CNES de **MS e MT** já carregados (`MS.db` e `MT.db`) e um
  `STMS2608.dbc.parcial` vazio, sobra de download interrompido (não apaguei; pode ser removido).
- ~~Os arquivos oficiais ST e CADGER continuam guardados~~: decidido, ver 2.10.

### 2.10 Regra de privacidade do ST e do CADGER (05/10/2026)

Decisão do cliente: arquivos com CPF de titulares **nunca ficam salvos em produção**, mas deve existir
uma cópia local para desenvolvimento, para não baixar a cada teste.

- **Produção:** depois de uma carga completa do CNES, o programa apaga `ST<UF>AAMM.dbc` e
  `CADGER<UF>.dbf` (`apagar_arquivos_com_cpf`, `crates/unidade/src/lib.rs`). Ficam `HB`, `SR`, `LT`, `EQ` e `cnv\`.
  Carregar só os profissionais da unidade escolhida deixou de exigir o ST. Se o esquema do banco do CNES
  mudar e não houver ST, o programa **não move** o banco antigo: pede para baixar de novo.
- **Desenvolvimento:** `SA_MANTER_ARQUIVOS_CNES=1` mantém os arquivos; a cópia fica em
  `D:\Projetos\Tabela SIGTAP\dados_dev\` (LEIAME próprio), fora de `sigtap-aberto\`.
- **Prova:** teste `st_e_cadastro_oficial_nao_ficam_guardados_e_os_outros_ficam`; no programa real
  (Windows), a importação por pasta de MS carregou 7.108 / 537 / 15.968 / 1.036 / 15.658 e deixou só
  `EQ HB LT SR cnv`. Um defeito achado nessa prova (aviso falso "nomes indisponíveis", porque o
  CADGER era conferido depois de apagado) foi corrigido e reconferido.
- **Efeito:** o banco do CNES não pode mais ser refeito sozinho a partir da pasta; "Baixar de novo" é o caminho.
- **Não testado:** baixar de novo pelo FTP real depois da mudança (servidor fora do ar).

## 3. Riscos que seguem

1. Regra de aptidão e correspondência de leitos **não confirmadas**.
2. Serviços terceirizados fora do arquivo público (2.3).
3. CNES publicado depois do SIGTAP: a aptidão cruza competências diferentes (a tela avisa).
4. ~~Arquivos oficiais guardados com CPF de titulares pessoa física~~: resolvido em 05/10/2026 (2.10); a cópia de desenvolvimento em `dados_dev\` segue com esses arquivos e não pode sair da máquina.
5. `TP_UNID` 16 não tem descrição nas tabelas do DATASUS (mostrado como código).
6. Prova no Windows pendente.
