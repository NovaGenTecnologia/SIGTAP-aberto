// Histórico em arquivos de texto (uma linha JSON por verificação, um arquivo por mês) e a
// agregação que alimenta o relatório. Estados: "ok", "instavel" e "fora".
import { appendFile, mkdir, readFile, readdir } from "node:fs/promises";
import path from "node:path";

const mesDe = (t) => new Date(t).toISOString().slice(0, 7);

export const FAIXAS = [
  { id: "24h", rotulo: "24 horas", dur: 24 * 3600e3, balde: 15 * 60e3 },
  { id: "7d", rotulo: "7 dias", dur: 7 * 86400e3, balde: 3600e3 },
  { id: "30d", rotulo: "30 dias", dur: 30 * 86400e3, balde: 6 * 3600e3 },
  { id: "90d", rotulo: "90 dias", dur: 90 * 86400e3, balde: 86400e3 },
  { id: "365d", rotulo: "1 ano", dur: 365 * 86400e3, balde: 86400e3 },
];

export async function anexar(dir, registros) {
  if (!registros.length) return;
  await mkdir(dir, { recursive: true });
  const porMes = new Map();
  for (const r of registros) {
    const m = mesDe(r.t);
    if (!porMes.has(m)) porMes.set(m, []);
    porMes.get(m).push(JSON.stringify(r));
  }
  for (const [m, linhas] of porMes) await appendFile(path.join(dir, `historico-${m}.jsonl`), `${linhas.join("\n")}\n`);
}

export async function ler(dir, desdeMs = 0) {
  let nomes;
  try { nomes = await readdir(dir); } catch { return []; }
  const desde = mesDe(desdeMs);
  const arquivos = nomes.filter((n) => /^historico-\d{4}-\d{2}\.jsonl$/.test(n) && n.slice(10, 17) >= desde).sort();
  const regs = [];
  for (const nome of arquivos) {
    const texto = await readFile(path.join(dir, nome), "utf8");
    for (const linha of texto.split("\n")) {
      if (!linha) continue;
      try {
        const r = JSON.parse(linha);
        if (typeof r.t === "number" && typeof r.f === "string" && ["ok", "instavel", "fora"].includes(r.e) && r.t >= desdeMs) regs.push(r);
      } catch { /* linha cortada por queda de energia: ignora */ }
    }
  }
  return regs.sort((a, b) => a.t - b.t);
}

export function mediana(v) {
  if (!v.length) return null;
  const o = [...v].sort((a, b) => a - b);
  const m = o.length >> 1;
  return o.length % 2 ? o[m] : Math.round((o[m - 1] + o[m]) / 2);
}

const estadoDoBalde = (b) => {
  if (b.n === 0) return "sem";
  if (b.fora > 0 && b.ok === 0 && b.inst === 0) return "fora";
  return b.fora > 0 || b.inst > 0 ? "instavel" : "ok";
};

/** Resume o histórico por fonte e por faixa de tempo (24 h a 1 ano), já em baldes para os gráficos. */
export function agregar(regs, fontes, agora = Date.now()) {
  const porFonte = new Map(fontes.map((f) => [f.id, []]));
  for (const r of regs) porFonte.get(r.f)?.push(r);
  const chave = { ok: "ok", instavel: "inst", fora: "fora" };
  const saida = {
    geradoEm: agora,
    verificacoes: regs.length,
    primeiro: regs.length ? regs[0].t : null,
    faixas: FAIXAS.map(({ id, rotulo, dur, balde }) => ({ id, rotulo, dur, balde })),
    fontes: [],
  };
  for (const f of fontes) {
    const rs = porFonte.get(f.id).sort((a, b) => a.t - b.t);
    const ultimo = rs.at(-1) ?? null;
    const faixas = {};
    for (const fx of FAIXAS) {
      const ini = agora - fx.dur;
      const n = Math.round(fx.dur / fx.balde);
      const baldes = Array.from({ length: n }, (_, i) => ({ t0: ini + i * fx.balde, n: 0, ok: 0, inst: 0, fora: 0, ms: [] }));
      const dentro = [];
      for (const r of rs) {
        if (r.t < ini || r.t > agora) continue;
        const b = baldes[Math.min(n - 1, Math.floor((r.t - ini) / fx.balde))];
        b.n += 1;
        b[chave[r.e]] += 1;
        if (r.e !== "fora" && typeof r.ms === "number") b.ms.push(r.ms);
        dentro.push(r);
      }
      const ok = dentro.filter((r) => r.e === "ok").length;
      faixas[fx.id] = {
        baldes: baldes.map((b) => ({
          t0: b.t0, n: b.n, ok: b.ok, inst: b.inst, fora: b.fora, estado: estadoDoBalde(b),
          med: mediana(b.ms), max: b.ms.length ? Math.max(...b.ms) : null,
        })),
        total: dentro.length,
        ok,
        disp: dentro.length ? ok / dentro.length : null,
        med: mediana(dentro.filter((r) => r.e !== "fora" && typeof r.ms === "number").map((r) => r.ms)),
        falhas: dentro.filter((r) => r.e !== "ok").slice(-5).reverse().map((r) => ({ t: r.t, e: r.e, d: r.d || "" })),
      };
    }
    saida.fontes.push({
      id: f.id, nome: f.nome, grupo: f.grupo, uso: f.uso ?? "", tipo: f.tipo,
      futuro: Boolean(f.futuro), fase: f.fase ?? null,
      ultimo: ultimo && { t: ultimo.t, e: ultimo.e, ms: ultimo.ms, d: ultimo.d || "" },
      faixas,
    });
  }
  return saida;
}
