# CNES — arquivos de disseminação (DATASUS)

Estudo feito em 01/10/2026 com os arquivos reais de MS (01/2008, 01/2012, 01/2016, 01/2020,
01/2024 e 08/2026). Os arquivos de estudo ficam fora do repositório.

## Onde está

| O quê | Endereço |
|---|---|
| Dados | `ftp://ftp.datasus.gov.br/dissemin/publicos/CNES/200508_/Dados/<TIPO>/<TIPO><UF><AAMM>.dbc` |
| Informe técnico (campos) | `.../CNES/200508_/doc/IT_CNES_1706.pdf` (06/2017) |
| Tabelas auxiliares | `.../CNES/200508_/Auxiliar/TAB_CNES.zip` (127.493.068 bytes, 1.016 entradas em 15/09/2026) |
| Consulta oficial por estabelecimento | `https://cnes.datasus.gov.br/` |

Tipos usados: ST (estabelecimentos), HB (habilitações), SR (serviços especializados), LT (leitos),
EQ (equipamentos), PF (profissionais). Tamanhos em MS 08/2026: 331 KB, 16 KB, 160 KB, 12 KB,
142 KB e 2,5 MB. Registros: 7.108, 537, 15.968, 1.036, 15.658 e 99.946.

## Formato `.dbc`

Cabeçalho de DBF (o tamanho está nos bytes 8–9), 4 bytes de CRC e, em seguida, os registros
comprimidos com PKWare DCL "implode". Todos os arquivos conferidos usam literais não codificados
e dicionário de 4 KB. O descompressor (`sa-sources::dcl`) foi escrito a partir da descrição pública
do formato e conferido byte a byte com 26 arquivos reais.

Dois cabeçalhos (ST de 01/2024 e de 08/2026) vêm sem o byte terminador `0x0D`; o leitor aceita e
registra (`sa_arquivo.cabecalho_padrao = 0`).

## Campos e mudanças no tempo

O esquema é lido do próprio arquivo e gravado em `sa_campo`; nenhum campo é descartado, fora os da
privacidade. ST tem 208 campos em 08/2026. `NAT_JUR` aparece a partir de 2016; sete campos
`AP0xCV07` aparecem depois de 2020. ST não traz o nome do estabelecimento.

## Nomes e decodificadores (`TAB_CNES.zip`)

- `DBF/CADGER<UF>.dbf`: nome fantasia e razão social por CNES.
- `CNV/*.cnv`: tabelas de código e descrição; os arquivos `.def` dizem qual tabela decodifica cada campo.
- Equipamentos: `equipam2508.cnv` vale a partir de 08/2025 (chave `TIPEQUIP` + `CODEQUIP`, 196 de 196 códigos de MS); `Equip_Tp.cnv`, mais antigo, só cobria 93.
- `TP_UNID` 16 não tem descrição em `TP_ESTAB.CNV` (1 estabelecimento em MS); a esfera administrativa "M" também não tem.

O programa não baixa o ZIP inteiro: lê o índice (no fim do arquivo) e só os trechos do cadastro da
UF e das tabelas usadas, com `REST` do FTP. Para MS foram cerca de 4,5 MB.

## Dados pessoais

| Campo | Onde | Tratamento |
|---|---|---|
| `CPF_PROF`, `CNS_PROF` | PF | Nunca gravados. Na origem o `CPF_PROF` já vem embaralhado |
| Demais campos de PF (nome, CBO, conselho, vínculo, horas) | PF | Só para a unidade escolhida pelo usuário |
| `CPF_CNPJ` quando `PF_PJ = 1` | ST, HB, SR, LT, EQ, PF | Apagado (é CPF do titular) |
| Conta bancária quando `PF_PJ = 1` | ST | Apagada |
| CPF, razão social, telefone, fax, e-mail quando pessoa física | `CADGER` | Apagados |

O que foi descartado fica contado em `sa_privacidade`. O arquivo PF é apagado depois da carga.
`CPFUNICO` em PF é um indicador de um caractere, não um CPF.

## Cruzamento com o SIGTAP (MS 08/2026 × SIGTAP 09/2026)

| Chave | Encontrados |
|---|---|
| Habilitação (`SGRUPHAB` × `co_habilitacao`) | 537 de 537 |
| Serviço/classificação (`SERV_ESP` + `CLASS_SR`) | 15.947 de 15.968 |
| Leito: CNES presente em ST | 1.036 de 1.036 |
| Tipos de leito com correspondência no manifesto | 1.000 de 1.036 |

Dos 3.728 procedimentos que exigem habilitação ou serviço, 3.563 têm ao menos um estabelecimento
apto em MS pela regra simples (qualquer habilitação) e 3.561 pela regra com grupos.

## Serviço terceirizado não está no arquivo público

Nos seis arquivos SR de MS, o campo `CARACTER` vale 1 (próprio) em todas as linhas, com exceção de
2 linhas de 2008; `CNESTERC` está vazio desde 2012. O site oficial mostra, para a unidade
conferida, 17 pares de serviço/classificação terceirizados que não existem no arquivo. A aptidão
por serviço, portanto, só enxerga serviço próprio; o programa avisa.

## Regra de aptidão: o que se achou em documento oficial

Nenhum documento achado descreve a regra completa. O que sustenta a leitura adotada:

- SIGTAP: `rl_procedimento_habilitacao` com `nu_grupo_habilitacao` e `tb_grupo_habilitacao`, cujo nome é literalmente a combinação ("0801 e 0803").
- Críticas do SIHD: "PROCEDIMENTO REALIZADO EXIGE HABILITAÇÃO" e "HOSPITAL NÃO POSSUI O SERVICO/CLASSIFICACAO EXIGIDOS" (Manual Técnico do SIH, `bvsms.saude.gov.br/bvs/publicacoes/manual_tecnico_sistema_informacao_hospitalar_sus.pdf`).
- Críticas 3 e 32 do SIA, em fonte secundária (instrutivo estadual).
- Wiki do SIGTAP (`wiki.saude.gov.br/sigtap`) e perguntas frequentes (`webatendimento.saude.gov.br/faq/sigtap`).

Falta, para confirmar: um arquivo rejeitado por habilitação ou serviço com o retorno oficial.

## Esfera administrativa e falhas de FTP (conferido em 02/10/2026)

- `ESFERA_A` em MS 08/2026 coincide linha a linha com `TPGESTAO` (D=45, E=48, M=7.015); o `EsferAdm.CNV` descreve outra codificação (01 a 04) e não bate com os dados. O programa mostra os nomes fixos do manifesto; a esfera jurídica real está em `NAT_JUR` (`ESFERAJUR.CNV`).
- O FTP `ftp.datasus.gov.br` anuncia, de forma intermitente, portas PASV sem escuta: cerca de metade das sessões novas falha em ~20 s (EOF ao enviar `REST`/`RETR` ou conexão recusada). Reaproveitar a sessão entre trechos e repetir PASV na mesma sessão evita o custo de abrir sessões novas.
