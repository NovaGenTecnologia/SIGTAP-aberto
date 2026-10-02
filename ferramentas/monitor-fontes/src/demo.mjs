// Histórico inventado (só para ver o relatório sem esperar dias de coleta). Nada disto é medição.
import { anexar } from "./historico.mjs";

function gerador(semente) {
  let a = semente >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export async function gerarDemo(dir, fontes, dias = 100, agora = Date.now()) {
  const regs = [];
  const passo = 15 * 60e3;
  fontes.forEach((f, i) => {
    const sorte = gerador(1000 + i * 77);
    const base = f.tipo === "ftp" ? 1800 : f.url?.includes("ibge") ? 3200 : 700;
    for (let t = agora - dias * 86400e3; t <= agora; t += passo) {
      const dia = (agora - t) / 86400e3;
      let e = "ok";
      let d = "";
      let ms = Math.round(base * (0.7 + sorte() * 0.8) + (Math.sin(t / 3.6e6) + 1) * base * 0.15);
      const portas = f.tipo === "ftp" && f.dados && sorte() < 0.07 ? 2 : 1;
      if (portas === 2) { e = "instavel"; d = "o canal de dados precisou de 2 portas"; ms += 10000; }
      if (f.id === "sihd-site" && dia > 3 && dia < 3.25) { e = "fora"; d = "conexão com www2.datasus.gov.br:80 falhou (ETIMEDOUT)"; }
      if (f.id === "ses-sp-sus-paulista" && dia > 1 && dia < 1.4) { e = "fora"; d = "HTTP 503"; }
      if (f.id === "cnes-ftp-auxiliar" && dia > 10 && dia < 10.5) { e = "fora"; d = "canal de dados: nenhuma das 3 portas abriu (conexão com ftp.datasus.gov.br:50123 sem resposta em 10 s)"; }
      if (f.id === "demas-api" && dia > 20 && dia < 24) { e = "instavel"; d = "resposta lenta (7.4 s)"; ms = Math.round(7400 + sorte() * 900); }
      if (f.id === "bps-api" && dia > 40) continue;
      if (sorte() < 0.002) continue;
      regs.push({ t, f: f.id, e, ms: e === "fora" ? 20000 : ms, d, x: {} });
    }
  });
  await anexar(dir, regs);
  return regs.length;
}
