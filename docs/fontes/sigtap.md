# SIGTAP: esquema das 225 competências (200801 a 202609)

Gerado em 30/09/2026 a partir dos `*_layout.txt` de cada ZIP de `historico_zips\` (estudo da
Fase 1). Posições e tipos vêm sempre do leiaute do próprio ZIP; este documento só registra o
que mudou ao longo do tempo.

## Estrutura do arquivo (vale para todas as competências)

- Registro de largura fixa + CRLF em **8.442 de 8.442** arquivos de tabela; 17 arquivos de
  `tb_regra_condicionada` têm LF (e alguns CRLF) dentro do texto: ler por tamanho, nunca por linha.
- Leiautes contíguos (soma dos tamanhos = largura) em todos os arquivos.
- Texto (VARCHAR2, CHAR, DATE) completado com espaços à direita; NUMBER com zeros à esquerda.
- `DT_COMPETENCIA`, quando existe, é igual à competência do arquivo em todas as linhas.
- Codificação ISO-8859-1.
- 1.342 arquivos não estão em ordem de bytes (ordem física do banco de origem); o SIGTAP
  Aberto guarda essa ordem para a reconstrução ser idêntica.
- Em 201412–201503 o leiaute de `tb_regra_condicionada` traz a coluna
  `REPLACE(DS_REGRA_CONDICIONADA,CHR(10),NULL)`; o manifesto `crates/sources/manifestos/sigtap.toml`
  normaliza para `DS_REGRA_CONDICIONADA`.
- `rl_procedimento_tuss` existe desde 201404 e está **vazia em todas as competências**.
- 201404 foi republicada em 26/02/2020 já com as 7 tabelas criadas depois (rede de atenção,
  RENASES, TUSS). Por isso elas "aparecem" em 201404, somem e só voltam em 201504 (tabelas
  `tb_*`) e 201508 (relacionamentos `rl_*`).

## Tabelas

| Tabela | Competências | Versões do leiaute | Registros na 1ª → última |
|---|---|---|---|
| `rl_excecao_compatibilidade` | 200801–202609 (225) | 2: 201109: DT_COMPETENCIA 6→6 DATE→CHAR | 5 → 5 |
| `rl_procedimento_cid` | 200801–202609 (225) | 2: 201109: DT_COMPETENCIA 6→6 DATE→CHAR | 49.108 → 82.103 |
| `rl_procedimento_comp_rede` | 201404–202609 (135), ausente em 201405–201507 | 1: — | 0 → 4 |
| `rl_procedimento_compativel` | 200801–202609 (225) | 2: 201109: DT_COMPETENCIA 6→6 DATE→CHAR | 8.125 → 12.407 |
| `rl_procedimento_detalhe` | 200801–202609 (225) | 2: 201109: DT_COMPETENCIA 6→6 DATE→CHAR | 4.121 → 10.623 |
| `rl_procedimento_habilitacao` | 200801–202609 (225) | 2: 201109: DT_COMPETENCIA 6→6 DATE→CHAR | 4.364 → 11.304 |
| `rl_procedimento_incremento` | 200801–202609 (225) | 2: 201109: DT_COMPETENCIA 6→6 DATE→CHAR | 1.440 → 2.710 |
| `rl_procedimento_leito` | 200801–202609 (225) | 2: 201109: DT_COMPETENCIA 6→6 DATE→CHAR | 2.122 → 4.120 |
| `rl_procedimento_modalidade` | 200801–202609 (225) | 2: 201109: DT_COMPETENCIA 6→6 DATE→CHAR | 5.499 → 8.080 |
| `rl_procedimento_ocupacao` | 200801–202609 (225) | 2: 201109: DT_COMPETENCIA 6→6 DATE→CHAR | 12.180 → 195.072 |
| `rl_procedimento_origem` | 200801–202609 (225) | 2: 201109: DT_COMPETENCIA 6→6 DATE→CHAR | 0 → 4 |
| `rl_procedimento_registro` | 200801–202609 (225) | 2: 201109: DT_COMPETENCIA 6→6 DATE→CHAR | 5.017 → 7.767 |
| `rl_procedimento_regra_cond` | 201211–202609 (167) | 1: — | 58 → 3.861 |
| `rl_procedimento_renases` | 201404–202609 (135), ausente em 201405–201507 | 1: — | 4.998 → 5.372 |
| `rl_procedimento_servico` | 200801–202609 (225) | 2: 201109: DT_COMPETENCIA 6→6 DATE→CHAR | 2.525 → 4.144 |
| `rl_procedimento_sia_sih` | 200801–202609 (225) | 2: 201109: DT_COMPETENCIA 6→6 DATE→CHAR | 6.006 → 5.381 |
| `rl_procedimento_tuss` | 201404–202609 (135), ausente em 201405–201507 | 1: — | 0 → 0 |
| `tb_cid` | 200801–202609 (225) | 2: 201104: +TP_ESTADIO, +VL_CAMPOS_IRRADIADOS | 12.422 → 14.246 |
| `tb_componente_rede` | 201404–202609 (139), ausente em 201405–201503 | 3: 201504: −CO_REDE_ATENCAO; 201508: +CO_REDE_ATENCAO | 20 → 20 |
| `tb_descricao` | 200910–202609 (204) | 2: 201109: DT_COMPETENCIA 6→6 DATE→CHAR | 1.451 → 4.325 |
| `tb_descricao_detalhe` | 201009–202609 (193) | 2: 201109: DT_COMPETENCIA 6→6 DATE→CHAR | 20 → 60 |
| `tb_detalhe` | 200801–202609 (225) | 2: 201109: DT_COMPETENCIA 6→6 DATE→CHAR | 12 → 60 |
| `tb_financiamento` | 200801–202609 (225) | 2: 201109: DT_COMPETENCIA 6→6 DATE→CHAR | 6 → 7 |
| `tb_forma_organizacao` | 200801–202609 (225) | 2: 201109: DT_COMPETENCIA 6→6 DATE→CHAR | 301 → 422 |
| `tb_grupo` | 200801–202609 (225) | 2: 201109: DT_COMPETENCIA 6→6 DATE→CHAR | 8 → 9 |
| `tb_grupo_habilitacao` | 200801–202609 (225) | 1: — | 10 → 31 |
| `tb_habilitacao` | 200801–202609 (225) | 2: 201109: DT_COMPETENCIA 6→6 DATE→CHAR | 177 → 347 |
| `tb_modalidade` | 200801–202609 (225) | 2: 201109: DT_COMPETENCIA 6→6 DATE→CHAR | 5 → 4 |
| `tb_ocupacao` | 200801–202609 (225) | 1: — | 2.443 → 2.719 |
| `tb_procedimento` | 200801–202609 (225) | 4: 201109: DT_COMPETENCIA 6→6 DATE→CHAR; 201209: +QT_TEMPO_PERMANENCIA; 202506: VL_SH 10→12, VL_SA 10→12, VL_SP 10→12 | 4.190 → 5.023 |
| `tb_rede_atencao` | 201404–202609 (139), ausente em 201405–201503 | 1: — | 4 → 5 |
| `tb_registro` | 200801–202609 (225) | 2: 201109: DT_COMPETENCIA 6→6 DATE→CHAR | 7 → 10 |
| `tb_regra_condicionada` | 201211–202609 (167) | 3: 201412: +REPLACE(DS_REGRA_CONDICIONADA,CHR(10),NULL), −DS_REGRA_CONDICIONADA; 201504: +DS_REGRA_CONDICIONADA, −REPLACE(DS_REGRA_CONDICIONADA,CHR(10),NULL) | 2 → 15 |
| `tb_renases` | 201404–202609 (139), ausente em 201405–201503 | 1: — | 201 → 201 |
| `tb_rubrica` | 200801–202609 (225) | 2: 201109: DT_COMPETENCIA 6→6 DATE→CHAR | 41 → 43 |
| `tb_servico` | 200801–202609 (225) | 2: 201109: DT_COMPETENCIA 6→6 DATE→CHAR | 46 → 75 |
| `tb_servico_classificacao` | 200801–202609 (225) | 2: 201109: DT_COMPETENCIA 6→6 DATE→CHAR | 183 → 436 |
| `tb_sia_sih` | 200801–202609 (225) | 2: 201109: DT_COMPETENCIA 6→6 DATE→CHAR | 8.383 → 8.383 |
| `tb_sub_grupo` | 200801–202609 (225) | 2: 201109: DT_COMPETENCIA 6→6 DATE→CHAR | 58 → 71 |
| `tb_tipo_leito` | 200801–202609 (225) | 4: 201109: DT_COMPETENCIA 6→6 DATE→CHAR; 202006: NO_TIPO_LEITO 60→100; 202007: NO_TIPO_LEITO 100→60 | 26 → 41 |
| `tb_tuss` | 201404–202609 (139), ausente em 201405–201503 | 3: 201504: NO_TUSS 450→150; 201507: NO_TUSS 150→450 | 5.694 → 5.766 |

## Volume

64.310.859 registros somando as 225 competências; 395.276 em 202609. No banco do SIGTAP
Aberto viram 489.569 conteúdos distintos e 506.748 intervalos de vigência (banco de 99,7 MB).

## Contagens do documento-mestre, explicadas

| Número citado | O que é | Vigentes em 202609 |
|---|---|---|
| 19.010 compatibilidades | intervalos de `rl_procedimento_compativel` (todo o histórico) | 12.407 |
| 100.754 vínculos CID | intervalos de `rl_procedimento_cid` | 82.103 |
| 32.183 linhas de `tb_cid` | intervalos de `tb_cid` (o banco novo conta 32.181) | 14.246 |
| 11.522 termos TUSS | intervalos de `tb_tuss` | 5.766 |
| 5.023 procedimentos | vigentes em `tb_procedimento` | 5.023 |

