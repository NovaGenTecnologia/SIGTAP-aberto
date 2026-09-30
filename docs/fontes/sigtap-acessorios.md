# SIGTAP: arquivos acessórios do ZIP da Tabela Unificada

Estudo da Fase 0 (30/09/2026). Amostras: `TabelaUnificada_200801.zip`,
`TabelaUnificada_201501_v1501051026.zip`, `TabelaUnificada_202609_v2609171117.zip`
(FTP `ftp2.datasus.gov.br/pub/sistemas/tup/downloads`).

## Conteúdo além das tabelas

| Arquivo | 200801 | 201501 | 202609 | O que é |
|---|---|---|---|---|
| `<tabela>_layout.txt` | 30 | 34 | 41 | Leiaute de cada tabela: `Coluna,Tamanho,Inicio,Fim,Tipo` |
| `layout.txt` | sim | sim | sim | Todos os leiautes num arquivo só; em 202609 é **idêntico** aos 41 `_layout.txt` |
| `DATASUS - Tabela de Procedimentos - Lay-out.xls` | sim | sim | sim | Planilha com colunas **e descrição de cada coluna** |
| `DATASUS - Tabela de Procedimentos.xls` | sim | não | não | Só em 2008 |
| `LEIA_ME.TXT` | sim | sim | sim | Histórico de mudanças do formato de exportação |
| `config.inf` | não | `Version=1.0.0` | `Version=1.0.0` | Sem uso aparente |
| `versao` | não | `1.1` | `1.1` | Versão do formato de exportação |

## Achados

1. **O `*_layout.txt` é a única fonte confiável de posições.** A planilha `Lay-out.xls` está
   congelada: o arquivo de 201501 é idêntico byte a byte ao de 202609 (MD5 `c0318317…`), e
   contra os `_layout.txt` de 202609 ela:
   - não tem 7 tabelas: `rl_procedimento_comp_rede`, `rl_procedimento_renases`,
     `rl_procedimento_tuss`, `tb_componente_rede`, `tb_rede_atencao`, `tb_renases`, `tb_tuss`;
   - dá `VL_SH`, `VL_SA`, `VL_SP` com 10 posições em `tb_procedimento`; o leiaute real tem **12**;
   - não tem `DT_COMPETENCIA` em `tb_sia_sih` e `rl_procedimento_sia_sih`;
   - traz `DS_GRUPO_HABILITACAO` com tamanho 25 e fim 274 (incoerente; o real é 250).
   Decisão: posições sempre do `_layout.txt` do próprio ZIP. A planilha serve só como fonte das
   **descrições** das colunas (133 colunas, todas com descrição), sinalizadas como "descrição de
   2015 ou anterior" e nunca como leiaute.
2. **Codificação.** Todas as tabelas `.txt` das três épocas são ISO-8859-1 (nenhuma é UTF-8
   válida quando tem acento). O `LEIA_ME.TXT` mudou: ISO-8859-1 em 2008, **UTF-8** em 2015 e 2026.
   O leitor não pode presumir a codificação por época; decide por arquivo e registra.
3. **Fim de linha.** CRLF em todos os `.txt`, exceto os vazios. Em 202609,
   `rl_procedimento_tuss.txt` tem **0 byte** (relação SIGTAP↔TUSS vazia).
4. **Idade 9999.** O `LEIA_ME.TXT` confirma: `VL_IDADE_MINIMA` e `VL_IDADE_MAXIMA` iguais a
   `9999` significam que o fator idade não se aplica.
5. **O `LEIA_ME.TXT` parou no tempo:** o texto de 2026 ainda diz "versão gerada em 01/09/2008".
   Não serve para descobrir mudanças recentes de formato; a linha do tempo do esquema tem de ser
   extraída dos `_layout.txt` das 225 competências (Fase 1).
6. **Notas técnicas mensais.** O FTP tem `downloads/notastecnicas/` com 225 PDFs
   (`nota_tecnica_cgsi_sigtap_AAAA_MM.pdf`, 70–400 KB): uma por competência. São a fonte oficial
   das mudanças de cada mês e candidatas a explicar a regra de aptidão (Fase 3) e a tela
   "o que mudou na competência" (Fase 2).

## Consequências para a Fase 1

- Esquema do banco gerado a partir do `_layout.txt` de cada ZIP (41 tabelas em 2026, 30 em 2008).
- Leitura em ISO-8859-1 com verificação; um byte inválido para o leiaute vira erro com posição.
- Tabela vazia é carga válida (não é erro), registrada como "vazia na fonte".
- Descrições de coluna da planilha entram como metadado opcional, com a data da planilha.
