import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { agregar, anexar, ler, mediana } from "../src/historico.mjs";

const H = 3600e3;
const agora = Date.UTC(2026, 9, 2, 12, 0, 0);
const fontes = [{ id: "a", nome: "A", grupo: "G", tipo: "http" }, { id: "b", nome: "B", grupo: "G", tipo: "ftp" }];

test("mediana", () => {
  assert.equal(mediana([]), null);
  assert.equal(mediana([5, 1, 3]), 3);
  assert.equal(mediana([1, 2, 3, 4]), 3);
});

test("anexar e ler: separa por mês, ignora linha cortada e filtra por data", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "mon-"));
  await anexar(dir, [
    { t: Date.UTC(2026, 8, 30, 23, 59), f: "a", e: "ok", ms: 10 },
    { t: Date.UTC(2026, 9, 1, 0, 1), f: "a", e: "fora", ms: 20000, d: "x" },
  ]);
  await writeFile(path.join(dir, "historico-2026-10.jsonl"), `${await readFile(path.join(dir, "historico-2026-10.jsonl"), "utf8")}{"t":1,"f"\n`);
  const todos = await ler(dir);
  assert.equal(todos.length, 2);
  const recentes = await ler(dir, Date.UTC(2026, 9, 1));
  assert.equal(recentes.length, 1);
  assert.deepEqual(await ler(path.join(dir, "nao-existe")), []);
});

test("agregar: disponibilidade, mediana, baldes e falhas recentes", () => {
  const regs = [
    { t: agora - 5 * H, f: "a", e: "ok", ms: 100 },
    { t: agora - 4 * H, f: "a", e: "ok", ms: 300 },
    { t: agora - 3 * H, f: "a", e: "instavel", ms: 9000, d: "lento" },
    { t: agora - 2 * H, f: "a", e: "fora", ms: 20000, d: "HTTP 503" },
    { t: agora - 90 * 60e3, f: "a", e: "ok", ms: 200 },
  ];
  const r = agregar(regs, fontes, agora);
  const a = r.fontes[0].faixas["24h"];
  assert.equal(a.total, 5);
  assert.equal(a.disp, 3 / 5);
  assert.equal(a.med, 250);
  assert.equal(a.baldes.length, 96);
  assert.deepEqual(a.falhas.map((f) => f.e), ["fora", "instavel"]);
  const estados = new Set(a.baldes.map((b) => b.estado));
  assert.deepEqual([...estados].sort(), ["fora", "instavel", "ok", "sem"]);
  assert.equal(r.fontes[1].faixas["24h"].disp, null);
  assert.equal(r.fontes[1].ultimo, null);
  assert.equal(r.fontes[0].ultimo.e, "ok");
  assert.equal(r.fontes[0].faixas["7d"].baldes.length, 168);
  assert.equal(r.fontes[0].faixas["365d"].baldes.length, 365);
});
