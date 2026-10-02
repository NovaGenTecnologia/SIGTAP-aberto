import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFileSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { gerarDemo } from "../src/demo.mjs";
import { agregar, ler } from "../src/historico.mjs";
import { gerarHtml } from "../src/relatorio.mjs";

const fontes = JSON.parse(readFileSync(new URL("../fontes.json", import.meta.url), "utf8"));

test("catálogo: ids únicos, campos obrigatórios e nenhum endereço quebrado", () => {
  assert.equal(new Set(fontes.map((f) => f.id)).size, fontes.length);
  for (const f of fontes) {
    assert.ok(f.nome && f.grupo && f.uso, f.id);
    if (f.tipo === "ftp") { assert.match(f.host, /^ftp2?\.datasus\.gov\.br$/); assert.ok(f.comando?.cwd || f.comando?.size, f.id); }
    else { assert.equal(f.tipo, "http"); assert.doesNotThrow(() => new URL(f.url), f.id); }
  }
  assert.ok(fontes.some((f) => f.futuro), "inclui fontes futuras");
});

test("relatório: dados embutidos válidos, sem NaN, script compila e texto perigoso é neutralizado", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "demo-"));
  const agora = Date.UTC(2026, 9, 2, 12);
  const n = await gerarDemo(dir, fontes, 100, agora);
  assert.ok(n > 10000);
  const regs = await ler(dir);
  regs.push({ t: agora - 1000, f: fontes[0].id, e: "fora", ms: 10, d: "</script><img src=x onerror=alert(1)>" });
  const html = gerarHtml(agregar(regs, fontes, agora));
  assert.ok(!html.includes("</script><img"), "o texto vindo dos dados não pode fechar o script");
  const m = /<script type="application\/json" id="dados">([\s\S]*?)<\/script>/.exec(html);
  const json = JSON.parse(m[1]);
  assert.equal(json.fontes.length, fontes.length);
  assert.ok(!/NaN|undefined/.test(m[1]));
  assert.ok(json.fontes[0].faixas["7d"].falhas[0].d.includes("</script>"), "o texto original é preservado");
  const cliente = /<script>\n([\s\S]*)<\/script>\s*<\/body>/.exec(html)[1];
  assert.doesNotThrow(() => new vm.Script(cliente));
  assert.ok(html.length < 3_000_000, `tamanho ${html.length}`);
});
