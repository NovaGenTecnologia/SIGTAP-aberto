# Monitor das fontes de dados

Ferramenta paralela ao SIGTAP Aberto, **só para rodar no seu computador**. Ela confere de tempos em
tempos se cada fonte de dados que o programa usa (e as que ele vai usar) está no ar, guarda o
histórico e gera um relatório com gráficos. Não faz parte do programa nem dos pacotes.

- Sem dependências: só o Node.js (22 ou mais novo; o projeto usa o 24).
- Não envia nada para lugar nenhum. Grava só na pasta `dados/` desta pasta (ignorada pelo git).
- Cortesia com os servidores: uma consulta por vez em cada servidor, com pausa, e no máximo uns
  4 KB de dados por verificação. O FTP imita o programa: se a porta de dados não abre em 10 s, tenta
  outra, até 3.

## Como usar

```
node monitor.mjs verificar          # confere todas as fontes agora
node monitor.mjs relatorio --abrir  # gera dados/relatorio.html e abre no navegador
node monitor.mjs rodar --abrir      # os dois de uma vez
node monitor.mjs demo --abrir       # relatório com dados INVENTADOS, só para ver como fica
```

No Windows, dê dois cliques em `verificar-agora.bat` (confere e abre o relatório) ou em
`abrir-relatorio.bat` (só abre o relatório com o que já foi coletado).

### Deixar rodando sozinho (Windows)

```
node monitor.mjs agendar 15     # a cada 15 minutos (de 5 a 1439)
node monitor.mjs situacao       # confere se está agendado
node monitor.mjs desagendar     # remove
```

Usa o Agendador de Tarefas, na sua conta, sem administrador. Só roda enquanto você estiver com o
Windows aberto na sua conta; os intervalos em que o computador esteve desligado aparecem como
"sem dados" no relatório. No Linux ou macOS, use o cron:
`*/15 * * * * node /caminho/monitor.mjs rodar --silencioso`.

## O que cada cor quer dizer

| Estado | Significa |
|---|---|
| Online | Respondeu direito e dentro do tempo. |
| Instável | Respondeu, mas devagar, ou (FTP) o canal de dados só abriu depois de mais de uma porta. |
| Fora do ar | Não conectou, recusou login ou comando, o conteúdo não era o esperado, ou nenhuma das 3 portas de dados abriu. |
| Sem dados | Não houve verificação no intervalo (monitor parado ou computador desligado). |

**Disponibilidade** = verificações Online ÷ todas as verificações do período. Os tempos são medidos
a partir da sua rede, então refletem a sua conexão tanto quanto o servidor.

## Fontes

Estão em `fontes.json`. Há as que o programa usa hoje (FTP do SIGTAP e do CNES, site do SIGTAP e
do CNES, IBGE, DEMAS, GitHub) e as **fontes futuras** (SIA, SIH, APIs de produção e de preços,
ANS, dados.gov.br, Tabela SUS Paulista), marcadas com `"futuro": true`. Das futuras, as de FTP só
conferem que a pasta existe, e as da ANS e da SES-SP monitoram só o portal: acrescente as páginas
exatas quando elas entrarem no programa.

Para acrescentar uma fonte, copie uma entrada:

- **FTP** (`"tipo": "ftp"`): `host`, `comando` (`{"cwd": "/pasta"}` ou `{"size": "/arquivo"}`) e,
  opcional, `dados` (`{"listar": "/pasta", "contem": "texto"}` ou
  `{"parcial": {"caminho": "/arquivo", "inicio": 0, "bytes": 4096}}`) para exercitar o canal de dados.
- **HTTP** (`"tipo": "http"`): `url`, opcional `json` (`true`), `min_itens`, `aceitar` (lista de
  códigos) ou `aceitar_ate` (maior código aceito) e `limite_lento_ms`.

Alguns sites bloqueiam consultas automáticas; se um deles aparecer sempre como "Fora do ar" com
um código HTTP 403, é o bloqueio, e não uma queda.

## Testes

```
npm test
```
