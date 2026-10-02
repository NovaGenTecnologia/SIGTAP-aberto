(() => {
  "use strict";
  const D = JSON.parse(document.getElementById("dados").textContent);
  const NS = "http://www.w3.org/2000/svg";
  const ESTADOS = { ok: ["✓", "Online"], instavel: ["!", "Instável"], fora: ["✕", "Fora do ar"], sem: ["○", "Sem dados"], velho: ["○", "Sem verificação recente"] };
  const COR = { ok: "var(--good)", instavel: "var(--warn)", fora: "var(--crit)", sem: "var(--grid)" };
  const VELHO_MS = 2 * 3600e3;

  function montar(criar, tag, atr, filhos) {
    const e = criar(tag);
    for (const [k, v] of Object.entries(atr || {})) {
      if (v === false || v == null) continue;
      if (k === "class") e.setAttribute("class", v);
      else if (k.startsWith("on")) e.addEventListener(k.slice(2), v);
      else e.setAttribute(k, v === true ? "" : String(v));
    }
    for (const f of filhos.flat()) if (f != null && f !== false) e.append(f.nodeType ? f : document.createTextNode(String(f)));
    return e;
  }
  const h = (tag, atr, ...f) => montar((t) => document.createElement(t), tag, atr, f);
  const s = (tag, atr, ...f) => montar((t) => document.createElementNS(NS, t), tag, atr, f);

  const fmtMs = (ms) => (ms == null ? "—" : ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} s`);
  const fmtPct = (x) => (x == null ? "—" : `${(x * 100).toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`);
  const fmtDH = new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" });
  const fmtDia = new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit" });
  const fmtDiaAno = new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit", year: "2-digit" });
  const fmtHora = new Intl.DateTimeFormat("pt-BR", { hour: "2-digit", minute: "2-digit" });
  const atras = (t) => {
    const m = Math.round((D.geradoEm - t) / 60000);
    if (m < 1) return "agora";
    if (m < 60) return `há ${m} min`;
    const hh = Math.round(m / 60);
    return hh < 48 ? `há ${hh} h` : `há ${Math.round(hh / 24)} dias`;
  };
  const bonito = (max) => {
    if (!(max > 0)) return 1000;
    const p = 10 ** Math.floor(Math.log10(max));
    for (const m of [1, 2, 2.5, 5, 10]) if (m * p >= max) return m * p;
    return 10 * p;
  };
  const estadoAtual = (f) => (!f.ultimo ? "sem" : D.geradoEm - f.ultimo.t > VELHO_MS ? "velho" : f.ultimo.e);
  const selo = (e) => h("span", { class: `ic ${e}`, "aria-hidden": "true" }, ESTADOS[e][0]);

  let faixaId = ["24h", "7d", "30d", "90d", "365d"].includes(location.hash.slice(1)) ? location.hash.slice(1) : "7d";

  function grafico(f, faixa) {
    const dadosF = f.faixas[faixa.id];
    const bs = dadosF.baldes;
    const n = bs.length;
    const temLatencia = bs.some((b) => b.med != null);
    const wrap = h("div", { class: "grafico" });
    const dica = h("div", { class: "dica", hidden: true, role: "status" });
    let atual = n - 1;

    // Desenha na largura real do cartão (L em pixels), para o texto ficar em tamanho normal.
    wrap.montar = (L) => {
      const A = 156, PL = 46, PR = 8, PW = L - PL - PR, FY = 2, FH = 12, PY = 32, PH = 96;
      const w = PW / n;
      const gap = w >= 8 ? 2 : w >= 4 ? 1 : 0;
      const xc = (i) => PL + (i + 0.5) * w;
      const yMax = bonito(Math.max(0, ...bs.map((b) => b.med ?? 0)));
      const y = (v) => PY + PH - (v / yMax) * PH;
      const svg = s("svg", {
        width: L, height: A, viewBox: `0 0 ${L} ${A}`, role: "img", tabindex: "0",
        "aria-label": `${f.nome}: estado e tempo de resposta nos últimos ${faixa.rotulo}. Use as setas para percorrer os intervalos.`,
      });
      bs.forEach((b, i) => {
        svg.append(s("rect", { x: PL + i * w + gap / 2, y: FY, width: Math.max(0.5, w - gap), height: FH, rx: w >= 6 ? 2 : 0, fill: COR[b.estado] }));
      });
      for (const v of [0, yMax / 2, yMax]) {
        svg.append(s("line", { x1: PL, x2: L - PR, y1: y(v), y2: y(v), stroke: v === 0 ? "var(--axis)" : "var(--grid)", "stroke-width": 1 }));
        svg.append(s("text", { x: PL - 6, y: y(v) + 4, "text-anchor": "end" }, v === 0 ? "0" : fmtMs(v)));
      }
      const rotX = (i) => (faixa.id === "24h" ? fmtHora : faixa.dur >= 90 * 86400e3 ? fmtDiaAno : fmtDia).format(bs[i].t0);
      svg.append(s("text", { x: PL, y: A - 6, "text-anchor": "start" }, rotX(0)));
      svg.append(s("text", { x: PL + PW / 2, y: A - 6, "text-anchor": "middle" }, rotX(n >> 1)));
      svg.append(s("text", { x: L - PR, y: A - 6, "text-anchor": "end" }, rotX(n - 1)));

      let ultimoPonto = -1;
      let seg = [];
      const fechar = () => {
        if (seg.length > 1) {
          const pts = seg.map((i) => `${xc(i)},${y(bs[i].med)}`);
          svg.append(s("path", { d: `M${pts.join("L")}L${xc(seg.at(-1))},${PY + PH}L${xc(seg[0])},${PY + PH}Z`, fill: "var(--series)", "fill-opacity": 0.1 }));
          svg.append(s("path", { d: `M${pts.join("L")}`, fill: "none", stroke: "var(--series)", "stroke-width": 2, "stroke-linejoin": "round", "stroke-linecap": "round" }));
        } else if (seg.length === 1) {
          svg.append(s("circle", { cx: xc(seg[0]), cy: y(bs[seg[0]].med), r: 4, fill: "var(--series)", stroke: "var(--surface)", "stroke-width": 2 }));
        }
        seg = [];
      };
      bs.forEach((b, i) => { if (b.med != null) { seg.push(i); ultimoPonto = i; } else fechar(); });
      fechar();
      if (ultimoPonto >= 0) svg.append(s("circle", { cx: xc(ultimoPonto), cy: y(bs[ultimoPonto].med), r: 4, fill: "var(--series)", stroke: "var(--surface)", "stroke-width": 2 }));
      const mira = s("line", { y1: FY, y2: PY + PH, stroke: "var(--axis)", "stroke-width": 1, visibility: "hidden" });
      svg.append(mira);
      svg.append(s("rect", { class: "sensor", x: 0, y: 0, width: L, height: A, fill: "transparent" }));

      const mostrar = (i) => {
        atual = Math.max(0, Math.min(n - 1, i));
        const b = bs[atual];
        const linha = (valor, rot) => h("div", { class: "lin" }, h("strong", {}, valor), h("span", {}, rot));
        dica.replaceChildren(...[
          h("div", { class: "hora" }, `${fmtDH.format(b.t0)} a ${fmtDH.format(b.t0 + faixa.balde)}`),
          h("div", { class: "lin" }, selo(b.estado), h("strong", {}, ESTADOS[b.estado][1])),
          b.n
            ? [linha(fmtMs(b.med), "mediana"), linha(fmtMs(b.max), "máxima"), linha(String(b.n), `verificações${b.inst || b.fora ? ` (${b.inst} instável, ${b.fora} fora)` : ""}`)]
            : h("div", { class: "hora" }, "Nenhuma verificação neste intervalo (computador desligado ou monitor parado)."),
        ].flat());
        const px = xc(atual) / L;
        dica.style.left = `${px * 100}%`;
        dica.style.transform = px > 0.62 ? "translateX(calc(-100% - 10px))" : "translateX(10px)";
        dica.hidden = false;
        mira.setAttribute("x1", xc(atual));
        mira.setAttribute("x2", xc(atual));
        mira.setAttribute("visibility", "visible");
      };
      const esconder = () => { dica.hidden = true; mira.setAttribute("visibility", "hidden"); };
      const doPonteiro = (ev) => {
        const r = svg.getBoundingClientRect();
        mostrar(Math.floor((ev.clientX - r.left - PL) / w));
      };
      svg.addEventListener("pointermove", doPonteiro);
      svg.addEventListener("pointerdown", doPonteiro);
      svg.addEventListener("pointerleave", esconder);
      svg.addEventListener("focus", () => mostrar(atual));
      svg.addEventListener("blur", esconder);
      svg.addEventListener("keydown", (ev) => {
        if (ev.key === "Escape") { esconder(); return; }
        const alvo = { ArrowLeft: atual - 1, ArrowRight: atual + 1, Home: 0, End: n - 1 }[ev.key];
        if (alvo !== undefined) { ev.preventDefault(); mostrar(alvo); }
      });
      wrap.replaceChildren(...[svg, dica, temLatencia ? null : h("p", { class: "vazio-g" }, dadosF.total ? "Nenhuma resposta bem-sucedida no período: não há tempo de resposta para mostrar." : "Sem verificações no período.")].filter(Boolean));
    };
    return wrap;
  }

  function montarGraficos() {
    for (const g of document.querySelectorAll(".grafico")) g.montar(Math.max(260, Math.round(g.clientWidth)));
  }

  function tabela(f, faixa) {
    const d = f.faixas[faixa.id];
    const linhas = [...d.baldes].reverse().filter((b) => b.n > 0).slice(0, 200);
    return h("details", {},
      h("summary", {}, "Ver tabela e últimas falhas"),
      linhas.length
        ? h("div", { class: "tabela" }, h("table", {},
            h("thead", {}, h("tr", {}, ["Início", "Estado", "Verificações", "Mediana", "Máxima"].map((c) => h("th", {}, c)))),
            h("tbody", {}, linhas.map((b) => h("tr", {}, h("td", {}, fmtDH.format(b.t0)), h("td", {}, selo(b.estado), ESTADOS[b.estado][1]), h("td", {}, b.n), h("td", {}, fmtMs(b.med)), h("td", {}, fmtMs(b.max)))))))
        : h("p", { class: "mudo" }, "Sem verificações no período."),
      d.falhas.length
        ? h("ul", { class: "falhas" }, d.falhas.map((x) => h("li", {}, h("span", { class: "mudo" }, `${fmtDH.format(x.t)} `), selo(x.e), ESTADOS[x.e][1], x.d ? `: ${x.d}` : "")))
        : null,
    );
  }

  function cartao(f, faixa) {
    const e = estadoAtual(f);
    const d = f.faixas[faixa.id];
    return h("article", { class: "cartao" },
      h("div", { class: "cab" },
        h("div", {}, h("h3", {}, f.nome), h("p", { class: "uso" }, f.uso), f.futuro ? h("span", { class: "futuro" }, `Fonte futura${f.fase ? ` (fase ${f.fase})` : ""}`) : null),
        h("div", { class: "estado" }, selo(e), ESTADOS[e][1])),
      h("div", { class: "numeros" },
        h("div", {}, h("b", {}, fmtPct(d.disp)), h("span", {}, "disponibilidade")),
        h("div", {}, h("b", {}, fmtMs(d.med)), h("span", {}, "mediana")),
        h("div", {}, h("b", {}, f.ultimo ? atras(f.ultimo.t) : "—"), h("span", {}, "última verificação"))),
      f.ultimo && f.ultimo.e !== "ok" && e !== "velho" ? h("p", { class: "uso" }, `Agora: ${f.ultimo.d || ESTADOS[f.ultimo.e][1]}`) : null,
      grafico(f, faixa),
      tabela(f, faixa));
  }

  function desenhar() {
    const faixa = D.faixas.find((x) => x.id === faixaId);
    const raiz = document.getElementById("raiz");
    const comDados = D.fontes.filter((f) => f.ultimo);
    const online = D.fontes.filter((f) => estadoAtual(f) === "ok").length;
    const problemas = D.fontes.filter((f) => ["instavel", "fora"].includes(estadoAtual(f))).length;
    const disps = D.fontes.map((f) => f.faixas[faixa.id].disp).filter((x) => x != null);
    const media = disps.length ? disps.reduce((a, b) => a + b, 0) / disps.length : null;

    const filtros = h("div", { class: "filtros" },
      h("span", { class: "rotulo" }, "Período"),
      h("div", { class: "seg", role: "group", "aria-label": "Período" }, D.faixas.map((x) =>
        h("button", { type: "button", "aria-pressed": String(x.id === faixaId), onclick: () => { faixaId = x.id; history.replaceState(null, "", `#${x.id}`); desenhar(); } }, x.rotulo))));
    const resumo = h("section", { class: "resumo", "aria-label": "Resumo" },
      h("div", { class: "bloco" }, h("div", { class: "heroi" }, String(online), h("small", {}, ` de ${D.fontes.length}`)), h("div", { class: "rot" }, "fontes online na última verificação")),
      h("div", { class: "bloco" }, h("div", { class: "valor" }, fmtPct(media)), h("div", { class: "rot" }, `disponibilidade média nas últimas ${faixa.rotulo}`)),
      h("div", { class: "bloco" }, h("div", { class: "valor" }, String(problemas)), h("div", { class: "rot" }, `instáveis ou fora do ar agora${comDados.length < D.fontes.length ? ` (${D.fontes.length - comDados.length} sem dados)` : ""}`)));
    const legenda = h("p", { class: "legenda" }, ["ok", "instavel", "fora", "sem"].map((k) => h("span", {}, selo(k), ESTADOS[k][1])), h("span", { class: "mudo" }, "Faixa colorida: pior estado de cada intervalo."));

    const grupos = [...new Set(D.fontes.map((f) => f.grupo))];
    const secoes = grupos.map((g) => [h("h2", {}, g), h("div", { class: "grade" }, D.fontes.filter((f) => f.grupo === g).map((f) => cartao(f, faixa)))]);
    const nota = h("p", { class: "nota" },
      "Disponibilidade = verificações com estado Online ÷ todas as verificações do período. Instável = a fonte respondeu, mas devagar ou, no FTP, o canal de dados só abriu depois de mais de uma porta (o programa faz o mesmo: tenta até 3). Fora do ar = não conectou, recusou o login ou o comando, ou nenhuma porta de dados abriu. ",
      "Sem dados = o computador estava desligado ou o monitor parado. Os tempos são do computador que roda o monitor e dependem da sua rede.");
    raiz.replaceChildren(filtros, resumo, legenda, ...secoes.flat(), nota);
    montarGraficos();
  }

  document.getElementById("gerado").textContent = D.verificacoes
    ? `Gerado em ${fmtDH.format(D.geradoEm)}. ${D.verificacoes.toLocaleString("pt-BR")} verificações desde ${fmtDH.format(D.primeiro)}.`
    : `Gerado em ${fmtDH.format(D.geradoEm)}. Ainda não há verificações: rode "node monitor.mjs verificar".`;
  desenhar();
  let espera = null;
  window.addEventListener("resize", () => { clearTimeout(espera); espera = setTimeout(montarGraficos, 150); });
})();
