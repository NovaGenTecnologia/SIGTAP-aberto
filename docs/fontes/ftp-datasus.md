# FTP do DATASUS: estrutura e tamanhos

Listagens feitas em 30/09/2026 pelo shell do dispositivo do cliente (o ambiente de nuvem não
alcança o FTP), uma conexão por vez e pausa de 2 s. Só listagem; nada baixado.

## SIGTAP — `ftp2.datasus.gov.br/pub/sistemas/tup/downloads`

- 225 ZIPs `TabelaUnificada_AAAAMM[_vAAMMDDhhmm].zip`, de 200801 a 202609, **uma versão por
  competência** (nenhuma republicação visível na listagem): 441 MB no total.
- Também: `Mapeamento_TUSS_SIGTAP.zip` e `NOTA INFORMATIVA MAPEAMENTO TUSS X SIGTAP 06-03-2017.doc`
  (fonte oficial do DATASUS para o de-para, a comparar com a planilha da ANS na Fase 6);
  instaladores do SIGTAP desktop 1.4 (2017).
- Subpastas: `notastecnicas/` (225 PDFs, um por competência), `manual/` (manuais do SIGTAP web e
  desktop, 2011, 3,6 MB e 5,0 MB), `documentacao/` (1 informe de 2009), `antigas/`,
  `instaladores antigos/`, `relatorios/`.
- Consequência: republicação e retroativo (Fase 1) serão testados com arquivos sintéticos
  derivados dos reais, porque não há exemplo real no FTP hoje.

## CNES — `ftp.datasus.gov.br/dissemin/publicos/CNES/200508_/Dados/<tipo>/`

Arquivos `<tipo><UF><AAMM>.dbc`, 27 UFs, de 0508 até **2608**.

| Tipo | Arquivos | Total | MS 2608 |
|---|---|---|---|
| ST estabelecimentos | 6.831 | 3,36 GB | 331 KB |
| SR serviços | 6.829 | 1,66 GB | 160 KB |
| EQ equipamentos | 6.830 | 1,59 GB | 142 KB |
| EP equipes | 6.291 | 607 MB | 69 KB |
| LT leitos | 6.777 | 150 MB | 12 KB |
| HB habilitações | 6.319 | 146 MB | 16 KB |
| DC dados complementares | 6.831 | 128 MB | 7 KB |
| RC regra contratual | 6.258 | 81 MB | 12 KB |
| IN incentivos | 6.034 | 46 MB | 7 KB |
| GM gestão e metas | 5.950 | 14 MB | 3 KB |
| EF estabelecimento filantrópico | 5.850 | 12 MB | 2 KB |
| EE entidades de ensino (até 2107) | 3.201 | 5 MB | — |
| PF profissionais | 6.831 | **46,3 GB** | 5,1 MB |

Auxiliar: `TAB_CNES.zip` **127,5 MB**. Documentação: `doc/IT_CNES_1706.pdf` (743 KB).

## SIA — `…/SIASUS/200801_/Dados`

54.478 arquivos, **431 GB**, 27 UFs, até **2607**. MS 2607: PA 40,3 MB, BI 41,2 MB, AM 1,7 MB,
PS 583 KB, AQ 287 KB, AD 171 KB, AR 11 KB. Auxiliar: `TAB_SIA.zip` **73,4 MB** (mais três
históricos de 4–5 MB).

## SIH — `…/SIHSUS/200801_/Dados`

22.915 arquivos, **66,5 GB**, até **2607**. MS 2607: SP 4,1 MB, RD 1,3 MB, RJ 51 KB, ER 20 KB.
Auxiliar: `TAB_SIH.zip` 6,0 MB. Na raiz de `SIHSUS/` há também `base_aih1.duck` (12 GB, DuckDB)
e pastas `CSV/`, `DBF/`, `XML/`, por ano: não estudadas.

## Correções ao plano

- `TAB_CNES.zip` (127,5 MB) e `TAB_SIA.zip` (73,4 MB) estavam "a medir"; ambos abaixo do limite
  de aviso de 500 MB.
- `EQMS2608.dbc` = 142 KB; `SPMS2607.dbc` = 4,1 MB (o plano citava SPMS2604; usar a mais recente
  que tiver RD e ER do mesmo mês).
- SIA e SIH vão até 2607; CNES até 2608.
