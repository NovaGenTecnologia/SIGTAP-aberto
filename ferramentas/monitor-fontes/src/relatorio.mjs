// Gera o relatório: um único arquivo HTML, sem recursos externos, com os dados embutidos.
import { readFileSync } from "node:fs";

const css = readFileSync(new URL("./relatorio.css", import.meta.url), "utf8");
const js = readFileSync(new URL("./relatorio-cliente.js", import.meta.url), "utf8");

export function gerarHtml(agregado) {
  const dados = JSON.stringify(agregado)
    .replace(/</g, "\\u003c")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
  return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'">
<title>Monitor das fontes</title>
<style>
${css}</style>
</head>
<body>
<main>
<h1>Monitor das fontes de dados</h1>
<p class="sub" id="gerado"></p>
<div id="raiz"></div>
<noscript><p>Este relatório precisa de JavaScript para mostrar os gráficos.</p></noscript>
</main>
<script type="application/json" id="dados">${dados}</script>
<script>
${js}</script>
</body>
</html>
`;
}
