// Sonda HTTP(S): GET com limite de tempo; confere o código, e, quando pedido, que o corpo é JSON
// com ao menos `min_itens` itens. Sem dependências (usa o fetch do Node).
const UA = "Mozilla/5.0 (compatible; SIGTAP-Aberto-monitor; +https://github.com/NovaGenTecnologia/SIGTAP-aberto)";

async function lerTexto(resposta, limite) {
  const leitor = resposta.body.getReader();
  const dec = new TextDecoder();
  let texto = "";
  let n = 0;
  for (;;) {
    const { done, value } = await leitor.read();
    if (done) return texto + dec.decode();
    n += value.length;
    if (n > limite) { await leitor.cancel(); throw new Error(`a resposta passa de ${Math.round(limite / 1e6)} MB`); }
    texto += dec.decode(value, { stream: true });
  }
}

async function lerInicio(resposta, bytes) {
  const leitor = resposta.body.getReader();
  let n = 0;
  while (n < bytes) {
    const { done, value } = await leitor.read();
    if (done) return n;
    n += value.length;
  }
  await leitor.cancel();
  return n;
}

function descreverErro(e, tempo) {
  if (e?.name === "TimeoutError" || e?.name === "AbortError") return `sem resposta em ${Math.round(tempo / 1000)} s`;
  const causa = e?.cause?.code || e?.cause?.message;
  return `${e?.message ?? e}${causa ? ` (${causa})` : ""}`;
}

/** `def`: { url, json?, min_itens?, aceitar?: [codigos], aceitar_ate?: codigo máximo, tempo_ms?, limite_lento_ms? }. */
export async function sondaHttp(def, opc = {}) {
  const tempo = def.tempo_ms ?? opc.tempo ?? 20000;
  const lento = def.limite_lento_ms ?? 5000;
  const ini = performance.now();
  const x = {};
  try {
    const r = await fetch(def.url, {
      redirect: "follow",
      signal: AbortSignal.timeout(tempo),
      headers: { "user-agent": UA, accept: def.json ? "application/json" : "text/html,*/*" },
    });
    x.ttfb = Math.round(performance.now() - ini);
    x.http = r.status;
    const bom = def.aceitar_ate ? r.status < def.aceitar_ate + 1 : (def.aceitar ?? [200]).includes(r.status);
    if (!bom) { await r.body?.cancel(); throw new Error(`HTTP ${r.status}`); }
    if (def.json) {
      const texto = await lerTexto(r, 16_000_000);
      let j;
      try { j = JSON.parse(texto); } catch { throw new Error(`HTTP ${r.status}, mas a resposta não é JSON válido`); }
      if (def.min_itens != null) {
        const itens = Array.isArray(j) ? j.length : -1;
        if (itens < def.min_itens) throw new Error(`a resposta traz ${itens < 0 ? "outro formato" : `${itens} itens`}; esperado ao menos ${def.min_itens}`);
      }
      x.bytes = texto.length;
    } else if (r.body) {
      x.bytes = await lerInicio(r, 65536);
    }
    const ms = Math.round(performance.now() - ini);
    if (ms > lento) return { estado: "instavel", ms, detalhe: `resposta lenta (${(ms / 1000).toFixed(1)} s)`, x };
    return { estado: "ok", ms, detalhe: "", x };
  } catch (e) {
    return { estado: "fora", ms: Math.round(performance.now() - ini), detalhe: descreverErro(e, tempo).slice(0, 300), x };
  }
}
