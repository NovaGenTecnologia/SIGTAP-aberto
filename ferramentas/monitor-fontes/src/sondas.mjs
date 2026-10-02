// Roda as sondas do catálogo. Cortesia com os servidores: um servidor por vez dentro do mesmo
// host (com pausa entre as consultas) e hosts diferentes em paralelo.
import { sondaFtp } from "./ftp.mjs";
import { sondaHttp } from "./http.mjs";

const espera = (ms) => new Promise((ok) => setTimeout(ok, ms));
const hostDe = (f) => (f.tipo === "ftp" ? `ftp:${f.host}` : `http:${new URL(f.url).host}`);

export async function executar(fontes, { pausaMs = 1000, aoTerminar = () => {}, ...opc } = {}) {
  const grupos = new Map();
  for (const f of fontes) {
    const h = hostDe(f);
    if (!grupos.has(h)) grupos.set(h, []);
    grupos.get(h).push(f);
  }
  const registros = [];
  await Promise.all([...grupos.values()].map(async (lista) => {
    for (let i = 0; i < lista.length; i += 1) {
      const f = lista[i];
      const t = Date.now();
      const r = f.tipo === "ftp" ? await sondaFtp(f, opc) : await sondaHttp(f, opc);
      const reg = { t, f: f.id, e: r.estado, ms: r.ms, d: r.detalhe, x: r.x };
      registros.push(reg);
      aoTerminar(f, reg);
      if (i < lista.length - 1) await espera(pausaMs);
    }
  }));
  return registros.sort((a, b) => a.t - b.t);
}
