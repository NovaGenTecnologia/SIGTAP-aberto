// Informações para o faturista na interface: rejeições, tendência, curva ABC, apresentado × aprovado,
// financiamento, o que a unidade produz × pode produzir, impacto das mudanças da tabela e o painel do
// início. Usa os utilitários de app.js, unidade.js e producao.js (el, ir, invoke, F, reais, periodo...).
"use strict";

// ---------- formatação ----------
const dec1 = (x) => (x == null ? "—" : x.toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 }));
const variacaoTxt = (x) => (x == null ? "—" : `${x > 0 ? "+" : ""}${dec1(x)}%`);
const reaisAno = (c) => `${c < 0 ? "−" : c > 0 ? "+" : ""}R$ ${F.moeda(Math.abs(c))}`;
const mesCurto = (c) => `${c.slice(4)}/${c.slice(2, 4)}`;
const ROTULO_CLASSE = {
  apta_nao_produz: "Pode e não produz",
  produz_apta: "Produz e pode",
  produz_com_ressalva: "Produz, serviço a confirmar",
  produz_sem_aptidao: "Produz sem aptidão no cadastro",
  produz_sem_exigencia: "Produz, sem exigência",
  produz_fora_da_tabela: "Produz, fora do SIGTAP",
};
const AJUDA_CLASSE = {
  apta_nao_produz: "Procedimentos com exigência de habilitação ou serviço que o cadastro da unidade atende e que ela não produziu nos meses completos. Ordem: o que a UF toda produziu, em valor. É um ponto de partida para conversar com a gestão, não uma previsão.",
  produz_apta: "A unidade produziu e o cadastro confirma habilitação e serviço.",
  produz_com_ressalva: "A habilitação confere; o serviço exigido não está entre os serviços próprios do CNES. Provável serviço terceirizado: confira no site do CNES.",
  produz_sem_aptidao: "A unidade produziu, mas o cadastro público não mostra a habilitação exigida. Veja o motivo de cada linha: habilitações 38.xx não foram condição para a aprovação na produção real de MS.",
  produz_sem_exigencia: "Procedimentos sem exigência de habilitação ou serviço no SIGTAP.",
  produz_fora_da_tabela: "Produzidos pela unidade, mas sem vigência no SIGTAP da competência em uso.",
};
const ROTULO_MOTIVO = { so_38: "só habilitação 38.xx", so_servico: "só o serviço (provável terceirizado)", habilitacao: "falta habilitação", habilitacao_e_servico: "falta habilitação e serviço", com_ressalva_de_servico: "serviço a confirmar" };

/** Gráfico de barras simples (SVG): `pontos` = [{ rotulo, valor, apagado, dica }]. */
function barras(pontos, descricao, altura = 44) {
  const NS = "http://www.w3.org/2000/svg";
  const L = 20, G = 6, H = altura;
  const max = Math.max(1e-9, ...pontos.map((p) => p.valor || 0));
  const svg = document.createElementNS(NS, "svg");
  svg.setAttribute("viewBox", `0 0 ${pontos.length * (L + G)} ${H + 14}`);
  svg.setAttribute("class", "fat-barras");
  svg.style.width = `${Math.min(pontos.length * (L + G), 520)}px`;
  svg.setAttribute("role", "img");
  svg.setAttribute("aria-label", descricao);
  pontos.forEach((p, i) => {
    const h = Math.max(1, ((p.valor || 0) / max) * H);
    const r = document.createElementNS(NS, "rect");
    r.setAttribute("x", String(i * (L + G))); r.setAttribute("y", String(H - h)); r.setAttribute("width", String(L)); r.setAttribute("height", String(h));
    r.setAttribute("class", p.apagado ? "apagada" : "cheia");
    const t = document.createElementNS(NS, "title"); t.textContent = p.dica || p.rotulo; r.append(t);
    svg.append(r);
    if (pontos.length <= 14 || i % 2 === 0) {
      const x = document.createElementNS(NS, "text");
      x.setAttribute("x", String(i * (L + G) + L / 2)); x.setAttribute("y", String(H + 11)); x.setAttribute("text-anchor", "middle"); x.textContent = p.rotulo;
      x.setAttribute("font-size", "8");
      svg.append(x);
    }
  });
  return svg;
}

function chipTendencia(t, nome) {
  if (!t) return el("span", { class: "quieto pequeno", text: `${nome}: precisa de 6 meses completos` });
  const rot = { sobe: "sobe", cai: "cai", estavel: "estável" }[t.sentido];
  return el("span", { class: `etiqueta ${t.sentido === "cai" ? "ambar" : "verde"}`, title: "Média dos 3 últimos meses completos contra a dos 3 anteriores" }, `${nome}: ${rot} ${variacaoTxt(t.variacao_percentual)}`);
}

const temProducao = (uf) => !!producaoDaUf(uf);


/** Permanência média real das AIH contra a prevista no SIGTAP, nos procedimentos que fogem do previsto. */
function blocoPermanencia(p) {
  const dec = (x) => x.toFixed(1).replace(".", ",");
  return el("section", { class: "bloco" },
    el("div", { class: "cab-linha" }, el("h2", { text: "SIH: permanência média × prevista no SIGTAP" }), el("small", { text: "12 meses completos" })),
    p.itens.length
      ? el("div", {},
        el("p", { text: `${F.inteiro(p.fora_do_previsto)} de ${F.inteiro(p.analisados)} procedimentos com ${p.limiares.min_aih} AIH ou mais fogem do previsto no SIGTAP (mais de ${String(p.limiares.razao).replace(".", ",")}× ou menos de 1/${String(p.limiares.razao).replace(".", ",")}) e da média da UF (${Math.round((p.limiares.razao_uf - 1) * 100)}% ou mais).` }),
        el("table", { class: "tabela compacta" },
          el("thead", {}, el("tr", {}, ["Código", "Procedimento", "AIH", "Média real (dias)", "Média da UF", "Previsto no SIGTAP"].map((h, k) => el("th", { class: k >= 2 ? "num" : null, text: h })))),
          el("tbody", {}, p.itens.map((x) => el("tr", {},
            el("td", { class: "cod" }, el("button", { class: "link mono", type: "button", onclick: () => ir({ tipo: "ficha", codigo: x.procedimento }) }, F.mascara(x.procedimento))),
            el("td", { text: x.nome || "" }), el("td", { class: "num", text: F.inteiro(x.aih) }),
            el("td", { class: "num", text: dec(x.media_real) }), el("td", { class: "num", text: x.media_uf == null ? "—" : dec(x.media_uf) }),
            el("td", { class: "num", text: F.inteiro(x.previsto) }))))))
      : el("p", { class: "quieto", text: `Nenhum dos ${F.inteiro(p.analisados)} procedimentos com ${p.limiares.min_aih} AIH ou mais foge do previsto.` }),
    el("p", { class: "quieto pequeno", text: p.aviso }));
}

/** Parte do valor apresentado em cada mês que é de meses anteriores, ao lado da UF. */
function blocoReapresentacao(r) {
  const pct = (x, t) => (t ? `${(100 * x / t).toFixed(1).replace(".", ",")}%` : "—");
  return el("section", { class: "bloco" },
    el("div", { class: "cab-linha" }, el("h2", { text: "SIA: produção de meses anteriores apresentada agora" }), el("small", { text: "12 meses completos" })),
    el("p", { text: `${pct(r.anteriores_centavos, r.total_centavos)} do valor apresentado pela unidade é de meses anteriores (${reais(r.anteriores_centavos)}). Na UF: ${pct(r.uf_anteriores_centavos, r.uf_total_centavos)}.` }),
    el("table", { class: "tabela compacta" },
      el("thead", {}, el("tr", {}, ["Mês do arquivo", "Do próprio mês", "De meses anteriores", "% anteriores", "% anteriores na UF"].map((h, k) => el("th", { class: k >= 1 ? "num" : null, text: h })))),
      el("tbody", {}, r.meses.map((m) => el("tr", {},
        el("td", { text: F.competencia(m.competencia) }),
        el("td", { class: "num", text: reais(m.do_mes_centavos) }), el("td", { class: "num", text: reais(m.anteriores_centavos) }),
        el("td", { class: "num", text: pct(m.anteriores_centavos, m.do_mes_centavos + m.anteriores_centavos) }),
        el("td", { class: "num", text: pct(m.uf_anteriores_centavos, m.uf_do_mes_centavos + m.uf_anteriores_centavos) }))))),
    r.origem_dos_atrasos.length
      ? el("p", { class: "quieto pequeno", text: "Meses de origem, do maior valor para o menor: " + r.origem_dos_atrasos.map((o) => `${F.competencia(o.competencia)} (${reais(o.valor_centavos)})`).join("; ") + "." })
      : null,
    el("p", { class: "quieto pequeno", text: r.aviso }));
}

/** Serviço/classificação executado no SIA contra o cadastro do CNES da unidade. */
function blocoServicos(sv) {
  const situacao = { cadastrado_sus: "cadastrado", cadastrado_sem_ambulatorial_sus: "cadastrado, sem ambulatorial SUS", fora_do_cadastro: "fora do cadastro" };
  const problema = sv.fora_do_cadastro_centavos + sv.sem_marca_sus_centavos;
  return el("section", { class: "bloco" },
    el("div", { class: "cab-linha" }, el("h2", { text: "SIA: serviço executado × cadastro do CNES" }), el("small", { text: "12 meses completos" })),
    el("p", { class: problema ? "" : "quieto", text: problema
      ? `Fora do cadastro: ${reais(sv.fora_do_cadastro_centavos)}. Cadastrado sem a marca de ambulatorial SUS: ${reais(sv.sem_marca_sus_centavos)}.`
      : "Todos os serviços informados na produção constam no cadastro como ambulatorial SUS." }),
    el("table", { class: "tabela compacta" },
      el("thead", {}, el("tr", {}, ["Serviço/classificação", "Situação", "Quantidade", "Valor"].map((h, k) => el("th", { class: k >= 2 ? "num" : null, text: h })))),
      el("tbody", {}, sv.itens.map((x) => el("tr", { class: x.situacao === "cadastrado_sus" ? null : "destaque" },
        el("td", { text: `${x.codigo.slice(0, 3)}-${x.codigo.slice(3)} · ${x.nome || "sem nome no SIGTAP"}` }),
        el("td", { text: situacao[x.situacao] || x.situacao }),
        el("td", { class: "num", text: F.inteiro(x.quantidade) }), el("td", { class: "num", text: reais(x.valor_centavos) }))))),
    el("p", { class: "quieto pequeno", text: sv.sem_servico_centavos ? `${reais(sv.sem_servico_centavos)} foram apresentados sem serviço informado. ${sv.aviso}` : sv.aviso }));
}

/** De que é feito o valor das AIH da unidade (SH, SP, complementos, OPM, FAEC), comparado com a UF. */
function blocoComposicaoAih(c) {
  const pct = (x, t) => (t ? `${(100 * x / t).toFixed(1).replace(".", ",")}%` : "—");
  const linha = (nome, v, vuf) => el("tr", {},
    el("td", { text: nome }), el("td", { class: "num", text: reais(v) }),
    el("td", { class: "num", text: pct(v, c.total_centavos) }), el("td", { class: "num", text: pct(vuf, c.total_uf_centavos) }));
  return el("section", { class: "bloco" },
    el("div", { class: "cab-linha" }, el("h2", { text: "SIH: de que é feito o valor das AIH" }), el("small", { text: "12 meses completos" })),
    el("table", { class: "tabela compacta" },
      el("thead", {}, el("tr", {}, ["Parte do valor", "Valor", "% da unidade", "% da UF"].map((h, k) => el("th", { class: k >= 1 ? "num" : null, text: h })))),
      el("tbody", {},
        ...c.tipos.map((t) => linha(t.nome, t.valor_centavos, t.valor_uf_centavos)),
        linha("Órteses, próteses e materiais (grupo 07)", c.opm_centavos, c.opm_uf_centavos),
        linha("Procedimentos com financiamento FAEC", c.faec_centavos, c.faec_uf_centavos),
        c.uti_centavos == null ? null : el("tr", {},
          el("td", { text: "UTI (já dentro do hospitalar)" }), el("td", { class: "num", text: reais(c.uti_centavos) }),
          el("td", { class: "num", text: pct(c.uti_centavos, c.total_centavos) }), el("td", { class: "num", text: "—" })),
        el("tr", { class: "total" }, el("td", { text: "Total das AIH" }), el("td", { class: "num", text: reais(c.total_centavos) }), el("td", {}), el("td", {})))),
    el("p", { class: "quieto pequeno", text: c.aviso }));
}

/** Marcas do CNES que mudam o pagamento, valor por regra contratual e complementos da unidade. */
function blocoPerfil(p) {
  const nomeCampo = { PA_VL_CL: "Complemento local (SIA)", PA_VL_CF: "Complemento federal (SIA)", PA_VL_CRD: "Crédito (SIA)", VAL_SH_FED: "Serviços hospitalares, federal", VAL_SP_FED: "Serviços profissionais, federal", VAL_SH_GES: "Serviços hospitalares, gestor", VAL_SP_GES: "Serviços profissionais, gestor", VAL_UTI: "UTI" };
  const tipoNome = { RC: "Regra contratual", IN: "Incentivo", GM: "Gestão e metas", EF: "Hospital filantrópico" };
  const origem = (o) => (o === "SIA" ? "Ambulatorial" : "Hospitalar");
  const semRegra = (c) => c === "" || /^0+$/.test(c);
  const marcas = p.marcas.length
    ? el("table", { class: "tabela compacta" },
      el("thead", {}, el("tr", {}, ["Tipo", "Código", "Descrição", "Vigência", ""].map((h) => el("th", { text: h })))),
      el("tbody", {}, p.marcas.map((m) => el("tr", {},
        el("td", { text: tipoNome[m.tipo] || m.tipo }), el("td", { class: "mono", text: m.codigo }),
        el("td", { text: m.descricao ? m.descricao.replace(/\s+/g, " ").trim() : "sem descrição na tabela oficial" }),
        el("td", { text: `${F.competencia ? F.competencia(m.inicio) : m.inicio} a ${!m.fim || m.fim === "999999" ? "sem fim" : (F.competencia ? F.competencia(m.fim) : m.fim)}` }),
        el("td", { text: m.sem_credito ? "não gera crédito" : (m.vigente ? "" : "fora da vigência") })))))
    : el("p", { class: "quieto pequeno", text: "Nenhuma regra, incentivo ou meta no CNES carregado para esta unidade (ou os arquivos RC, IN, GM e EF não foram baixados)." });
  const regras = p.regras.length
    ? el("table", { class: "tabela compacta" },
      el("thead", {}, el("tr", {}, ["Origem", "Regra contratual", "Quantidade", "Valor"].map((h, k) => el("th", { class: k >= 2 ? "num" : null, text: h })))),
      el("tbody", {}, p.regras.map((r) => el("tr", {},
        el("td", { text: origem(r.origem) }),
        el("td", { text: semRegra(r.codigo) ? "sem regra" : `${r.codigo} · ${r.descricao ? r.descricao.replace(/\s+/g, " ").trim() : "sem descrição"}` }),
        el("td", { class: "num", text: F.inteiro(r.quantidade) }), el("td", { class: "num", text: reais(r.valor_centavos) })))))
    : null;
  const comp = p.complementos.filter((c) => c.valor_centavos !== 0);
  const complementos = comp.length
    ? el("table", { class: "tabela compacta" },
      el("thead", {}, el("tr", {}, ["Origem", "Complemento", "Valor"].map((h, k) => el("th", { class: k === 2 ? "num" : null, text: h })))),
      el("tbody", {}, comp.map((c) => el("tr", {},
        el("td", { text: origem(c.origem) }), el("td", { text: nomeCampo[c.campo] || c.campo }),
        el("td", { class: "num", text: reais(c.valor_centavos) })))))
    : null;
  return el("section", { class: "bloco" },
    el("div", { class: "cab-linha" }, el("h2", { text: "Regra contratual, incentivos e complementos" }), el("small", { text: "12 meses completos" })),
    marcas, regras, complementos,
    el("p", { class: "quieto pequeno", text: p.aviso }));
}

/** Valor por instrumento de registro (BPA, APAC, RAAS) e registros fora do que o SIGTAP lista para o procedimento. */
function blocoInstrumentos(i) {
  const total = i.da_unidade.reduce((s, x) => s + x.valor_centavos, 0);
  const d = i.divergencias_da_uf;
  return el("section", { class: "bloco" },
    el("div", { class: "cab-linha" }, el("h2", { text: "SIA: valor por instrumento de registro" }), el("small", { text: "12 meses completos" })),
    el("table", { class: "tabela compacta" },
      el("thead", {}, el("tr", {}, ["Instrumento", "Quantidade", "Valor aprovado", "% do valor"].map((h, k) => el("th", { class: k >= 1 ? "num" : null, text: h })))),
      el("tbody", {}, i.da_unidade.map((x) => el("tr", {},
        el("td", { text: `${x.codigo} · ${x.descricao ? x.descricao.replace(/\s+/g, " ").trim() : "sem descrição na tabela oficial"}` }),
        el("td", { class: "num", text: F.inteiro(x.quantidade) }), el("td", { class: "num", text: reais(x.valor_centavos) }),
        el("td", { class: "num", text: total ? `${(100 * x.valor_centavos / total).toFixed(1).replace(".", ",")}%` : "—" }))))),
    d.procedimentos
      ? el("details", {},
        el("summary", { text: `Na UF, ${F.inteiro(d.procedimentos)} procedimento(s) foram registrados em instrumento que o SIGTAP não lista (${reais(d.valor_centavos)})` }),
        el("table", { class: "tabela compacta" },
          el("thead", {}, el("tr", {}, ["Código", "Procedimento", "Instrumento usado", "Registros do SIGTAP", "Valor na UF"].map((h, k) => el("th", { class: k === 4 ? "num" : null, text: h })))),
          el("tbody", {}, d.itens.map((x) => el("tr", {},
            el("td", { class: "cod" }, el("button", { class: "link mono", type: "button", onclick: () => ir({ tipo: "ficha", codigo: x.procedimento }) }, F.mascara(x.procedimento))),
            el("td", { text: x.nome || "" }), el("td", { text: x.instrumento }),
            el("td", { text: x.registros_do_sigtap ? x.registros_do_sigtap.join(", ") : "nenhum" }),
            el("td", { class: "num", text: reais(x.valor_centavos) }))))))
      : null,
    el("p", { class: "quieto pequeno", text: i.aviso }));
}

/** Quantidade apresentada fora do padrão da unidade e dos outros estabelecimentos (limiares vêm do servidor). */
function tabelaQuantidadesAtipicas(a) {
  if (!a.atipicas || !a.atipicas.length) return null;
  const l = a.limiares_atipica || {};
  return el("div", {},
    el("h3", { text: "Quantidade apresentada fora do padrão" }),
    el("p", { class: "quieto pequeno", text: `Mais de ${l.razao}× a mediana dos meses anteriores da unidade (base de ${l.meses_base} meses ou mais) e dos outros estabelecimentos da UF, com pelo menos ${l.excesso_minimo} a mais. Pode ser erro de digitação ou de lote: confira antes de enviar.` }),
    el("table", { class: "tabela compacta" },
      el("thead", {}, el("tr", {}, ["Código", "Procedimento", "Mês", "Apresentado", "Mediana da unidade", "Mediana dos outros", "Valor apresentado"].map((h, i) => el("th", { class: i >= 3 ? "num" : null, text: h })))),
      el("tbody", {}, a.atipicas.map((x) => el("tr", {},
        el("td", { class: "cod" }, el("button", { class: "link mono", type: "button", onclick: () => ir({ tipo: "ficha", codigo: x.procedimento }) }, F.mascara(x.procedimento))),
        el("td", { text: x.nome || "" }), el("td", { text: x.competencia }),
        el("td", { class: "num", text: F.inteiro(x.quantidade_apresentada) }),
        el("td", { class: "num", text: F.inteiro(Math.round(x.mediana_propria)) }),
        el("td", { class: "num", text: x.mediana_uf == null ? "—" : F.inteiro(Math.round(x.mediana_uf)) }),
        el("td", { class: "num", text: reais(x.valor_apresentado_centavos) }))))));
}

/** Por que o SIA não pagou: a diferença dividida pelo motivo oficial. Teto não é erro do faturamento. */
function tabelaMotivosNaoPago(a) {
  if ((!a.motivos || !a.motivos.length) && a.valor_apresentado_centavos <= a.valor_aprovado_centavos) return null;
  if (!a.motivos || !a.motivos.length) return el("p", { class: "quieto pequeno", text: "Sem divisão por motivo: os meses desta unidade foram baixados antes do esquema novo. Baixe a produção de novo (e ligue \"Guardar os arquivos baixados\" para não precisar baixar outra vez)." });
  const teto = a.motivos.filter((m) => "MONLTP".includes(m.codigo)).reduce((s, m) => s + m.valor_apresentado_centavos - m.valor_aprovado_centavos, 0);
  const total = a.valor_apresentado_centavos - a.valor_aprovado_centavos;
  return el("div", {},
    el("h3", { text: "Por que não foi pago" }),
    el("table", { class: "tabela compacta" },
      el("thead", {}, el("tr", {}, ["Motivo oficial (PA_FLQT)", "Qtd. apresentada", "Qtd. aprovada", "Valor apresentado", "Valor aprovado", "Diferença"].map((h, i) => el("th", { class: i >= 1 ? "num" : null, text: h })))),
      el("tbody", {}, a.motivos.map((m) => el("tr", {},
        el("td", { text: `${m.codigo} · ${m.descricao ? m.descricao.replace(/\s+/g, " ").trim() : "sem descrição na tabela oficial"}` }),
        el("td", { class: "num", text: F.inteiro(m.quantidade_apresentada) }), el("td", { class: "num", text: F.inteiro(m.quantidade_aprovada) }),
        el("td", { class: "num", text: reais(m.valor_apresentado_centavos) }), el("td", { class: "num", text: reais(m.valor_aprovado_centavos) }),
        el("td", { class: "num", text: reais(m.valor_apresentado_centavos - m.valor_aprovado_centavos) }))))),
    teto > 0 && total > 0 ? el("p", { class: "quieto pequeno", text: `${Math.round(100 * teto / total)}% da diferença é teto (físico ou financeiro) ou falta de orçamento: é limite do gestor, não erro de faturamento.` }) : null);
}
function avisoCamposNovos(meses) {
  if (!meses || !meses.length) return null;
  return el("p", { class: "aviso pequeno" }, `${meses.length} mês(es) da produção foram baixados antes dos campos novos (apresentado, financiamento, dias de internação). Para ver esses números, `,
    el("button", { class: "link", type: "button", onclick: () => ir({ tipo: "modulos", aba: "Baixar e importar" }) }, "baixe a produção de novo"), ".");
}

// ---------- Minha unidade > Produção: o que o faturista precisa ver primeiro ----------
async function blocosFaturamentoUnidade(corpo, u) {
  let r;
  try { r = await invoke("faturamento_unidade", { competencia: E.comp, uf: u.uf, cnes: u.cnes }); }
  catch (e) { corpo.append(erro(e)); return; }
  if (!r.disponivel) return;
  const sec = el("div", { class: "fat" });
  corpo.append(sec);
  const nota = avisoCamposNovos(r.sem_campos_novos);
  if (nota) sec.append(nota);
  const ultSia = r.cobertura.sia.at(-1), ultSih = r.cobertura.sih.at(-1);
  const incompletos = [["SIA", ultSia], ["SIH", ultSih]].filter(([, m]) => m && !m.completo);
  if (incompletos.length) sec.append(el("p", { class: "quieto pequeno", text: incompletos.map(([n, m]) => `O ${n} de ${F.competencia(m.competencia)} está incompleto (${F.inteiro(m.estabelecimentos)} estabelecimentos): as análises usam os meses completos.`).join(" ") }));

  // Rejeições
  const rj = r.rejeicoes;
  const bRej = el("section", { class: "bloco" }, el("div", { class: "cab-linha" }, el("h2", { text: "Rejeições do SIH por 100 AIH" }), el("small", { text: `últimos ${r.janela.sih.length} mês(es) completos` })));
  if (!r.tem_rejeicoes) bRej.append(el("p", { class: "quieto", text: "Os arquivos de AIH rejeitada (ER) não foram carregados para esta UF." }));
  else {
    const pares = r.pares && r.pares.taxa_mediana_dos_pares != null ? el("div", {}, el("dt", { text: `Mediana de ${F.inteiro(r.pares.pares_com_taxa)} ${r.pares.nome_tipo ? r.pares.nome_tipo.toLowerCase() : "unidades do mesmo tipo"}` }), el("dd", { text: dec1(r.pares.taxa_mediana_dos_pares) })) : null;
    bRej.append(el("dl", { class: "chave" },
      el("div", {}, el("dt", { text: "Por 100 AIH aprovadas" }), el("dd", { class: "valor", text: dec1(rj.por_100_aih) })),
      el("div", {}, el("dt", { text: "Rejeições" }), el("dd", { text: F.inteiro(rj.janela_rejeicoes) })),
      el("div", {}, el("dt", { text: "AIH aprovadas" }), el("dd", { text: F.inteiro(rj.janela_aih) })),
      pares));
    bRej.append(barras(rj.por_mes.map((m) => ({ rotulo: mesCurto(m.competencia), valor: m.por_100_aih || 0, apagado: !m.completo, dica: `${F.competencia(m.competencia)}: ${m.rejeicoes} rejeição(ões) para ${m.aih} AIH${m.por_100_aih == null ? "" : ` (${dec1(m.por_100_aih)} por 100)`}` })), "Rejeições por 100 AIH, mês a mês"));
    if (rj.motivos.length) bRej.append(el("table", { class: "tabela compacta" },
      el("thead", {}, el("tr", {}, ["Motivo", "Descrição oficial", "Total", "Mês a mês"].map((h, i) => el("th", { class: i === 2 ? "num" : null, text: h })))),
      el("tbody", {}, rj.motivos.map((x) => el("tr", {},
        el("td", { class: "cod", text: x.motivo }),
        el("td", {}, x.descricao || el("span", { class: "falta", text: "descrição oficial não carregada" }),
          x.bloqueio ? el("span", { class: "etiqueta", text: "bloqueio de AIH" }) : null,
          x.encerrado ? el("span", { class: "etiqueta ambar", text: `motivo encerrado em ${F.competencia(x.vigencia[1])}` }) : null,
          x.vigencia && !x.encerrado ? el("span", { class: "falta", text: `vale desde ${F.competencia(x.vigencia[0])}` }) : null),
        el("td", { class: "num", text: F.inteiro(x.total) }),
        el("td", { class: "quieto pequeno", text: x.por_mes.map(([c, n]) => `${mesCurto(c)}: ${n}`).join(" · ") }))))));
    bRej.append(el("p", { class: "quieto pequeno", text: rj.aviso }));
  }
  sec.append(bRej);

  // Evolução do valor
  const serie = (campo, jan) => r.meses.filter((m) => jan.includes(m.competencia)).map((m) => ({ rotulo: mesCurto(m.competencia), valor: m[campo] / 100, dica: `${F.competencia(m.competencia)}: ${reais(m[campo])}` }));
  // Com mais de 12 meses baixados, o gráfico mostra a série longa (até 60 meses); as contas continuam nos 12 meses.
  const longa = (o) => (r.janela_longa && r.janela_longa[o].length > r.janela[o].length ? r.janela_longa[o] : r.janela[o]);
  const anual = (v, nome) => {
    if (!v) return null;
    const txt = v.variacao_percentual == null ? "sem base no ano anterior" : variacaoTxt(v.variacao_percentual);
    return el("span", { class: "quieto pequeno", title: `${F.competencia(v.competencia)}: ${reais(v.valor_centavos)}; ${F.competencia(v.competencia_anterior)}: ${reais(v.valor_anterior_centavos)}` },
      ` ${nome} ${F.competencia(v.competencia)} contra ${F.competencia(v.competencia_anterior)}: ${txt}`);
  };
  sec.append(el("section", { class: "bloco" }, el("div", { class: "cab-linha" }, el("h2", { text: "Valor aprovado por mês" }), el("small", { text: "só meses completos" })),
    el("div", { class: "fat-duas" },
      el("div", {}, el("b", { text: "SIA" }), " ", chipTendencia(r.tendencia.sia_valor, "SIA"), anual(r.ano_anterior && r.ano_anterior.sia, "SIA"), barras(serie("sia_valor_centavos", longa("sia")), "Valor aprovado no SIA por mês")),
      el("div", {}, el("b", { text: "SIH" }), " ", chipTendencia(r.tendencia.sih_valor, "SIH"), anual(r.ano_anterior && r.ano_anterior.sih, "SIH"), barras(serie("sih_valor_centavos", longa("sih")), "Valor das AIH aprovadas por mês"))),
    el("p", { class: "quieto pequeno", text: `Tendência: ${r.tendencia.criterio}.` })));

  // Curva ABC
  const abc = (nome, x, unid) => {
    if (!x.total_procedimentos) return null;
    const tot = ["A", "B", "C"].reduce((s, k) => s + x.resumo[k].valor_centavos, 0) || 1;
    return el("div", { class: "abc" }, el("h3", { text: `${nome}: ${F.inteiro(x.total_procedimentos)} procedimentos` }),
      el("p", { class: "quieto pequeno", text: ["A", "B", "C"].map((k) => `${k}: ${F.inteiro(x.resumo[k].procedimentos)} procedimento(s), ${Math.round((x.resumo[k].valor_centavos * 100) / tot)}% do valor`).join(" · ") }),
      el("table", { class: "tabela compacta" },
        el("thead", {}, el("tr", {}, ["Classe", "Código", "Procedimento", unid, "Valor", "% do valor", "Acumulado"].map((h, i) => el("th", { class: i >= 3 ? "num" : null, text: h })))),
        el("tbody", {}, x.itens.slice(0, 15).map((i) => el("tr", {},
          el("td", {}, el("span", { class: `tag ${i.classe === "A" ? "incluido" : i.classe === "B" ? "alterado" : "excluido"}`, text: i.classe })),
          el("td", { class: "cod" }, el("button", { class: "link mono", type: "button", onclick: () => ir({ tipo: "ficha", codigo: i.procedimento }) }, F.mascara(i.procedimento))),
          el("td", { text: i.nome || "fora do SIGTAP desta competência" }),
          el("td", { class: "num", text: F.inteiro(i.quantidade) }), el("td", { class: "num", text: reais(i.valor_centavos) }),
          el("td", { class: "num", text: `${dec1(i.percentual)}%` }), el("td", { class: "num", text: `${dec1(i.acumulado)}%` }))))),
      x.itens.length > 15 || x.omitidos ? el("p", { class: "quieto pequeno", text: "Os 15 de maior valor. A planilha exportada traz mais." }) : null);
  };
  sec.append(el("section", { class: "bloco" }, el("div", { class: "cab-linha" }, el("h2", { text: "Curva ABC por valor" }), el("small", { text: "A até 80% do valor, B até 95%, C o resto" })),
    abc("SIA", r.abc.sia, "Aprovados"), abc("SIH", r.abc.sih, "AIH")));

  // Instrumento de registro
  if (r.instrumentos) sec.append(blocoInstrumentos(r.instrumentos));
  // Regra contratual e complementos
  if (r.perfil) sec.append(blocoPerfil(r.perfil));
  // Composição do valor das AIH
  if (r.composicao_aih) sec.append(blocoComposicaoAih(r.composicao_aih));
  // Serviço executado × cadastro do CNES
  if (r.servicos) sec.append(blocoServicos(r.servicos));
  // Produção de meses anteriores apresentada agora
  if (r.reapresentacao) sec.append(blocoReapresentacao(r.reapresentacao));
  // Permanência média real × SIGTAP
  if (r.permanencia) sec.append(blocoPermanencia(r.permanencia));
  // Apresentado × aprovado
  if (r.apresentado) {
    const a = r.apresentado;
    sec.append(el("section", { class: "bloco" }, el("div", { class: "cab-linha" }, el("h2", { text: "SIA: apresentado × aprovado" }), el("small", { text: `${a.competencias.length} mês(es) com o campo` })),
      el("dl", { class: "chave" },
        el("div", {}, el("dt", { text: "Apresentado" }), el("dd", { text: reais(a.valor_apresentado_centavos) })),
        el("div", {}, el("dt", { text: "Aprovado" }), el("dd", { text: reais(a.valor_aprovado_centavos) })),
        el("div", {}, el("dt", { text: "Diferença" }), el("dd", { class: a.valor_apresentado_centavos > a.valor_aprovado_centavos ? "valor ambar" : "valor", text: reais(a.valor_apresentado_centavos - a.valor_aprovado_centavos) }))),
      tabelaMotivosNaoPago(a),
      tabelaQuantidadesAtipicas(a),
      a.maiores.length ? el("table", { class: "tabela compacta" },
        el("thead", {}, el("tr", {}, ["Código", "Procedimento", "Qtd. apresentada", "Qtd. aprovada", "Valor apresentado", "Valor aprovado", "Diferença"].map((h, i) => el("th", { class: i >= 2 ? "num" : null, text: h })))),
        el("tbody", {}, a.maiores.map((d) => el("tr", {},
          el("td", { class: "cod" }, el("button", { class: "link mono", type: "button", onclick: () => ir({ tipo: "ficha", codigo: d.procedimento }) }, F.mascara(d.procedimento))),
          el("td", { text: d.nome || "" }),
          el("td", { class: "num", text: F.inteiro(d.quantidade_apresentada) }), el("td", { class: "num", text: F.inteiro(d.quantidade_aprovada) }),
          el("td", { class: "num", text: reais(d.valor_apresentado_centavos) }), el("td", { class: "num", text: reais(d.valor_aprovado_centavos) }),
          el("td", { class: "num", text: reais(d.valor_apresentado_centavos - d.valor_aprovado_centavos) }))))) : el("p", { class: "quieto", text: "Em nenhum procedimento o apresentado passou do aprovado." }),
      el("p", { class: "quieto pequeno", text: a.aviso })));
  }

  // Financiamento
  const fin = (nome, v) => v.length ? el("div", {}, el("h3", { text: nome }), el("table", { class: "tabela compacta" },
    el("thead", {}, el("tr", {}, ["Financiamento", "Quantidade", "Valor"].map((h, i) => el("th", { class: i ? "num" : null, text: h })))),
    el("tbody", {}, v.map((f) => el("tr", {}, el("td", { text: f.codigo ? `${f.codigo} ${f.nome || ""}` : "não informado (baixe de novo)" }), el("td", { class: "num", text: F.inteiro(f.quantidade) }), el("td", { class: "num", text: reais(f.valor_centavos) })))))) : null;
  const fs = [fin("SIA", r.financiamento.sia), fin("SIH", r.financiamento.sih)].filter(Boolean);
  if (fs.length) sec.append(el("section", { class: "bloco" }, el("div", { class: "cab-linha" }, el("h2", { text: "Valor por financiamento" }), el("small", { text: "nos meses completos" })), el("div", { class: "fat-duas" }, ...fs)));

  // Pares
  const pr = r.pares;
  if (pr && pr.pares_com_producao) sec.append(el("section", { class: "bloco" }, el("div", { class: "cab-linha" }, el("h2", { text: `Comparação com ${pr.nome_tipo ? pr.nome_tipo.toLowerCase() : "unidades do mesmo tipo"}` }), el("small", { text: `${F.inteiro(pr.pares_com_producao)} outros estabelecimentos com produção` })),
    el("dl", { class: "chave" },
      el("div", {}, el("dt", { text: "Valor SIA: posição" }), el("dd", { text: pr.valor_sia_percentil == null ? "—" : `maior que ${Math.round(pr.valor_sia_percentil)}% dos pares` })),
      el("div", {}, el("dt", { text: "Valor SIH: posição" }), el("dd", { text: pr.valor_sih_percentil == null ? "—" : `maior que ${Math.round(pr.valor_sih_percentil)}% dos pares` })),
      el("div", {}, el("dt", { text: "Rejeições por 100 AIH" }), el("dd", { text: pr.taxa_da_unidade == null ? "—" : `${dec1(pr.taxa_da_unidade)} (mediana ${dec1(pr.taxa_mediana_dos_pares)})` }))),
    pr.grupos && pr.grupos.length
      ? el("table", { class: "tabela compacta" },
        el("thead", {}, el("tr", {}, ["Grupo mais estreito", "Pares com produção", "Valor SIA", "Valor SIH", "Rejeições por 100 AIH"].map((h, k) => el("th", { class: k >= 1 ? "num" : null, text: h })))),
        el("tbody", {}, pr.grupos.map((g) => el("tr", {},
          el("td", { text: g.rotulo }), el("td", { class: "num", text: F.inteiro(g.pares_com_producao) }),
          el("td", { class: "num", text: g.valor_sia_percentil == null ? "—" : `maior que ${Math.round(g.valor_sia_percentil)}%` }),
          el("td", { class: "num", text: g.valor_sih_percentil == null ? "—" : `maior que ${Math.round(g.valor_sih_percentil)}%` }),
          el("td", { class: "num", text: g.taxa_da_unidade == null ? "—" : `${dec1(g.taxa_da_unidade)}${g.taxa_mediana_dos_pares == null ? "" : ` (mediana ${dec1(g.taxa_mediana_dos_pares)})`}` }))))) : null,
    el("p", { class: "quieto pequeno", text: `${pr.aviso} A taxa só compara pares com pelo menos ${pr.minimo_aih_para_taxa} AIH no período.` })));
  corpo.append(el("p", { class: "quieto pequeno", text: r.aviso }));
}

// ---------- Minha unidade > Procedimentos: o que produz e o que poderia produzir ----------
async function procedimentosComProducao(corpo, u) {
  corpo.append(carregando("Cruzando o cadastro com a produção…"));
  let r;
  try { r = await invoke("faturamento_procedimentos", { competencia: E.comp, uf: u.uf, cnes: u.cnes }); }
  catch (e) { limpar(corpo).append(erro(e)); return; }
  limpar(corpo);
  if (!r.disponivel) { corpo.append(el("p", { class: "quieto", text: r.mensagem })); return; }
  const ordem = Object.keys(ROTULO_CLASSE).filter((k) => r.classes[k]);
  const escolhida = ordem.includes(E.rota.classe) ? E.rota.classe : (ordem.includes("apta_nao_produz") ? "apta_nao_produz" : ordem[0]);
  corpo.append(el("div", { class: "filtros", role: "group", "aria-label": "Classe de procedimento" }, ordem.map((k) =>
    el("button", { class: "chip", type: "button", "aria-pressed": String(k === escolhida), onclick: () => ir({ tipo: "unidade", aba: "Procedimentos", visao: "producao", classe: k, uf: E.rota.uf, cnes: E.rota.cnes }, { substituir: true }) },
      `${ROTULO_CLASSE[k]} ${F.inteiro(r.classes[k].procedimentos)}${k === "apta_nao_produz" ? ` (${F.inteiro(r.classes[k].com_producao_na_uf)} produzidos na UF)` : ""}`))));
  if (!ordem.length) { corpo.append(el("p", { class: "quieto", text: "Nada para mostrar: a unidade não tem produção nos meses completos nem procedimentos com exigência atendida." })); return; }
  const c = r.classes[escolhida];
  corpo.append(el("p", { class: "quieto", text: AJUDA_CLASSE[escolhida] }));
  if (escolhida === "produz_com_ressalva" || escolhida === "apta_nao_produz") corpo.append(el("p", { class: "quieto pequeno", text: r.aviso_terceirizados }));
  if (escolhida === "produz_sem_aptidao") corpo.append(el("p", { class: "aviso pequeno", text: r.aviso_38 }));
  if (escolhida === "apta_nao_produz") corpo.append(el("p", { class: "quieto pequeno", text: r.oportunidade }));
  const motivo = (i) => i.motivo ? ROTULO_MOTIVO[i.motivo] || i.motivo : "";
  let itens = c.itens;
  if (escolhida === "apta_nao_produz" && !E.rota.todos) {
    itens = itens.filter((i) => i.uf.valor_centavos > 0);
    corpo.append(el("p", { class: "quieto pequeno" }, `Mostrando só os ${F.inteiro(itens.length)} que alguém produziu na UF nos meses completos. `,
      el("button", { class: "link", type: "button", onclick: () => ir({ tipo: "unidade", aba: "Procedimentos", visao: "producao", classe: escolhida, todos: true, uf: E.rota.uf, cnes: E.rota.cnes }, { substituir: true }) }, `Mostrar também os ${F.inteiro(c.procedimentos - itens.length)} que ninguém produziu`)));
  }
  const linhas = itens.map((i) => linhaT(`${i.codigo} ${i.nome || ""} ${motivo(i)}`, () => [
    el("td", { class: "cod" }, el("button", { class: "link mono", type: "button", onclick: () => ir({ tipo: "ficha", codigo: i.codigo }) }, F.mascara(i.codigo))),
    el("td", {}, i.nome || el("span", { class: "falta", text: `fora do SIGTAP de ${F.competencia(E.comp)}` })),
    el("td", { class: "quieto", text: motivo(i) || "—" }),
    el("td", { class: "num", text: i.sia.valor_centavos ? `${reais(i.sia.valor_centavos)} (${F.inteiro(i.sia.quantidade)})` : "—" }),
    el("td", { class: "num", text: i.sih.valor_centavos ? `${reais(i.sih.valor_centavos)} (${F.inteiro(i.sih.aih)} AIH)` : "—" }),
    el("td", { class: "num", text: i.uf.valor_centavos ? `${reais(i.uf.valor_centavos)} · ${F.inteiro(Math.max(i.uf.produtores_sia, i.uf.produtores_sih))} prod.` : "—" })]));
  corpo.append(...tabelaFiltravel([["Código"], ["Procedimento"], ["Motivo"], ["Unidade SIA", "num"], ["Unidade SIH", "num"], ["UF no período", "num"]], linhas, {
    dica: "Filtrar por código, nome ou motivo",
    exportar: botaoExportar("Exportar lista", async () => [`${ROTULO_CLASSE[escolhida]} CNES ${u.cnes}`, `${ROTULO_CLASSE[escolhida]}: ${u.nome || ""}, CNES ${u.cnes}, SIGTAP ${F.competencia(E.comp)}`,
      [{ nome: ROTULO_CLASSE[escolhida].slice(0, 30), colunas: ["Código", "Procedimento", "Motivo", "SIA valor (R$)", "SIA quantidade", "SIH valor (R$)", "SIH AIH", "UF valor (R$)", "Produtores SIA", "Produtores SIH"],
        linhas: itens.map((i) => [i.codigo, i.nome || "", motivo(i), i.sia.valor_centavos / 100, i.sia.quantidade, i.sih.valor_centavos / 100, i.sih.aih, i.uf.valor_centavos / 100, i.uf.produtores_sia, i.uf.produtores_sih]) }]]) }));
  if (c.omitidos && itens === c.itens) corpo.append(el("p", { class: "quieto pequeno", text: `Mostrando ${F.inteiro(c.itens.length)} de ${F.inteiro(c.procedimentos)}.` }));
}

/** Aba Procedimentos: alterna entre "pelo cadastro" e "com a produção". */
function chavesDeVisaoProcedimentos(u, alvo) {
  if (!temProducao(u.uf)) return null;
  const aqui = (v) => () => ir({ tipo: "unidade", uf: alvo && alvo.uf, cnes: alvo && alvo.cnes, aba: "Procedimentos", ...(v ? { visao: v } : {}) }, { substituir: true });
  return el("div", { class: "filtros", role: "group", "aria-label": "Visão dos procedimentos" },
    el("button", { class: "chip", type: "button", "aria-pressed": String(E.rota.visao !== "producao"), onclick: aqui(null) }, "Pelo cadastro"),
    el("button", { class: "chip", type: "button", "aria-pressed": String(E.rota.visao === "producao"), onclick: aqui("producao") }, "Com a produção"));
}

// ---------- Minha unidade > Habilitações: produção ligada a cada habilitação ----------
async function blocoHabilitacoesProducao(corpo, u) {
  if (!temProducao(u.uf)) return;
  const sec = el("section", { class: "bloco" }, el("h2", { text: "Produção ligada às habilitações" }), carregando("Cruzando…"));
  corpo.append(sec);
  let r;
  try { r = await invoke("faturamento_procedimentos", { competencia: E.comp, uf: u.uf, cnes: u.cnes }); }
  catch (e) { limpar(sec).append(el("h2", { text: "Produção ligada às habilitações" }), erro(e)); return; }
  limpar(sec).append(el("h2", { text: "Produção ligada às habilitações" }));
  if (!r.disponivel || !r.habilitacoes) { sec.append(el("p", { class: "quieto", text: r.mensagem || "Sem dados." })); return; }
  const hs = r.habilitacoes;
  const sem = hs.filter((h) => !h.programa_38 && h.procedimentos_que_citam && !h.procedimentos_produzidos);
  sec.append(el("p", { class: "quieto", text: `${F.inteiro(hs.length)} habilitação(ões) vigentes. ${sem.length ? `${sem.length} sem nenhuma produção nos procedimentos que as citam (marcadas).` : "Todas têm produção ligada, ou não são citadas por procedimento."}` }));
  sec.append(...tabelaFiltravel([["Código"], ["Habilitação"], ["Procedimentos que a citam", "num"], ["Produzidos", "num"], ["Valor produzido", "num"], [""]],
    hs.map((h) => linhaT(`${h.codigo} ${h.nome || ""}`, () => [
      el("td", { class: "cod mono", text: h.codigo }),
      el("td", {}, h.nome || el("span", { class: "falta", text: "sem nome" }), h.programa_38 ? el("span", { class: "etiqueta", text: "38.xx" }) : null),
      el("td", { class: "num", text: F.inteiro(h.procedimentos_que_citam) }), el("td", { class: "num", text: F.inteiro(h.procedimentos_produzidos) }),
      el("td", { class: "num", text: h.valor_centavos ? reais(h.valor_centavos) : "—" }),
      el("td", {}, !h.programa_38 && h.procedimentos_que_citam && !h.procedimentos_produzidos ? el("span", { class: "etiqueta ambar", text: "sem produção" }) : null)])), { dica: "Filtrar por código ou nome" }));
  sec.append(el("p", { class: "quieto pequeno", text: r.habilitacoes_aviso }));
}

// ---------- Minha unidade > Leitos: internações por leito e ocupação aproximada ----------
async function blocoLeitosProducao(corpo, u) {
  if (!temProducao(u.uf)) return;
  let r;
  try { r = await invoke("faturamento_unidade", { competencia: E.comp, uf: u.uf, cnes: u.cnes }); } catch { return; }
  if (!r.disponivel || !r.leitos) return;
  const l = r.leitos;
  const temDias = l.por_mes.some((m) => m.ocupacao_percentual != null);
  const sec = el("section", { class: "bloco" }, el("div", { class: "cab-linha" }, el("h2", { text: "Internações e leitos" }), el("small", { text: `${F.inteiro(l.leitos_sus)} leitos SUS de ${F.inteiro(l.leitos_existentes)}` })));
  if (l.por_mes.length) {
    sec.append(el("table", { class: "tabela compacta" },
      el("thead", {}, el("tr", {}, ["Mês", "AIH aprovadas", "AIH por leito SUS", "Dias de permanência", "Ocupação aproximada"].map((h, i) => el("th", { class: i ? "num" : null, text: h })))),
      el("tbody", {}, l.por_mes.map((m) => el("tr", {}, el("td", { class: "mono", text: F.competencia(m.competencia) }), el("td", { class: "num", text: F.inteiro(m.aih) }),
        el("td", { class: "num", text: m.aih_por_leito_sus == null ? "—" : dec1(m.aih_por_leito_sus) }),
        el("td", { class: "num", text: m.dias_de_permanencia == null ? "—" : F.inteiro(m.dias_de_permanencia) }),
        el("td", { class: "num", text: m.ocupacao_percentual == null ? "—" : `${dec1(m.ocupacao_percentual)}%` }))))));
    if (!temDias) sec.append(avisoCamposNovos([...l.por_mes.map((m) => m.competencia)]));
  } else sec.append(el("p", { class: "quieto", text: "Sem AIH aprovadas desta unidade nos meses completos." }));
  sec.append(el("p", { class: "quieto pequeno", text: l.aviso }));
  corpo.append(sec);
}

// ---------- Ficha: o procedimento na UF ao longo dos meses ----------
function blocoFaturamentoProcedimento(codigo, aberto) {
  const sec = el("section", { class: "bloco fat-proc" });
  const uf = ufDaProducao();
  if (!uf) return sec;
  const detalhe = el("div", { class: "fat-detalhe", hidden: !aberto });
  let montado = false;
  const montar = async () => {
    montado = true;
    detalhe.append(carregando("Somando mês a mês…"));
    let r;
    try { r = await invoke("faturamento_procedimento", { competencia: E.comp, codigo, uf }); }
    catch (e) { limpar(detalhe).append(erro(e)); return; }
    limpar(detalhe);
    if (!r.disponivel) { detalhe.append(el("p", { class: "quieto", text: r.mensagem })); return; }
    const nota = avisoCamposNovos(r.sem_campos_novos); if (nota) detalhe.append(nota);
    const eventos = Object.fromEntries(r.eventos_da_tabela.map((e) => [e.competencia, e]));
    for (const [chave, nome, unid] of [["sia", "SIA", "Aprovados"], ["sih", "SIH", "AIH"]]) {
      const x = r[chave];
      if (!x.serie.length) continue;
      const sia = chave === "sia";
      detalhe.append(el("h3", { text: `${nome} em ${r.uf}` }));
      detalhe.append(el("dl", { class: "chave" },
        el("div", {}, el("dt", { text: `${unid} (${x.meses_na_janela} mês(es) completos)` }), el("dd", { text: F.inteiro(x.quantidade_na_janela) })),
        el("div", {}, el("dt", { text: "Valor" }), el("dd", { text: reais(x.valor_na_janela_centavos) })),
        el("div", {}, el("dt", { text: sia ? "Valor médio por unidade" : "Valor médio da AIH" }), el("dd", { text: x.valor_medio_centavos == null ? "—" : reais(x.valor_medio_centavos) })),
        el("div", {}, el("dt", { text: "Estabelecimentos (máx. por mês)" }), el("dd", { text: F.inteiro(x.estabelecimentos_na_janela) })),
        el("div", {}, el("dt", { text: "Os 3 maiores produzem" }), el("dd", { text: x.concentracao_top3_percentual == null ? "—" : `${Math.round(x.concentracao_top3_percentual)}%` }))));
      detalhe.append(el("p", {}, chipTendencia(x.tendencia, `Valor no ${nome}`)));
      detalhe.append(barras(x.serie.map((m) => ({ rotulo: mesCurto(m.competencia), valor: m.valor_centavos / 100, apagado: !m.completo, dica: `${F.competencia(m.competencia)}: ${F.inteiro(m.quantidade)} em ${m.estabelecimentos} estabelecimento(s), ${reais(m.valor_centavos)}${m.completo ? "" : " (mês incompleto)"}` })), `${nome}: valor por mês`));
      const cols = ["Mês", "Estabelecimentos", unid, "Valor"].concat(sia ? ["Quantidade × tabela", "Diferença", "Apresentado"] : []);
      detalhe.append(el("table", { class: "tabela compacta" },
        el("thead", {}, el("tr", {}, cols.map((h, i) => el("th", { class: i ? "num" : null, text: h })))),
        el("tbody", {}, x.serie.map((m) => {
          const ev = eventos[m.competencia];
          return el("tr", { class: m.completo ? null : "incompleto" },
            el("td", { class: "mono" }, F.competencia(m.competencia), m.completo ? null : el("span", { class: "etiqueta ambar", text: "incompleto" }), ev ? el("span", { class: "etiqueta", title: "O valor da tabela mudou neste mês", text: "tabela mudou" }) : null),
            el("td", { class: "num", text: F.inteiro(m.estabelecimentos) }), el("td", { class: "num", text: F.inteiro(m.quantidade) }), el("td", { class: "num", text: reais(m.valor_centavos) }),
            ...(sia ? [el("td", { class: "num", text: m.esperado_centavos == null ? "—" : reais(m.esperado_centavos) }),
              el("td", { class: "num", text: m.esperado_centavos == null ? "—" : reais(m.valor_centavos - m.esperado_centavos) }),
              el("td", { class: "num", text: m.apresentado_centavos == null ? "—" : reais(m.apresentado_centavos) })] : []));
        }))));
      if (sia) detalhe.append(el("p", { class: "quieto pequeno", text: "Diferença = valor aprovado − quantidade × valor SA da tabela do mês. Pode ser incremento por habilitação, ajuste da crítica ou valor de outra competência: o arquivo não diz qual." }));
      else detalhe.append(el("p", { class: "quieto pequeno", text: x.aviso_valor }));
      if (x.financiamento.length) detalhe.append(el("p", { class: "quieto pequeno", text: `Financiamento: ${x.financiamento.map((f) => `${f.codigo ? `${f.codigo} ${f.nome || ""}`.trim() : "não informado"} ${reais(f.valor_centavos)}`).join("; ")}.` }));
    }
    if (r.eventos_da_tabela.length) detalhe.append(el("div", {}, el("h3", { text: "Mudanças de valor na tabela" }), r.eventos_da_tabela.map((e) => {
      const v = (t) => (t ? `SA ${reais(t.sa)}, SH ${reais(t.sh)}, SP ${reais(t.sp)}` : "fora da tabela");
      return el("p", { class: "pequeno", text: `${F.competencia(e.competencia)}: ${v(e.antes)} → ${v(e.depois)}` });
    })));
    detalhe.append(el("p", { class: "quieto pequeno", text: r.aviso }));
  };
  const botao = el("button", { class: "link", type: "button", "aria-expanded": String(!!aberto), onclick: async () => {
    detalhe.hidden = !detalhe.hidden;
    if (!detalhe.hidden && !montado) await montar();
    botao.setAttribute("aria-expanded", String(!detalhe.hidden));
    botao.textContent = detalhe.hidden ? "Série mensal, tendência e financiamento" : "Ocultar a série mensal";
  } }, aberto ? "Ocultar a série mensal" : "Série mensal, tendência e financiamento");
  sec.append(botao, detalhe);
  if (aberto) montar();
  return sec;
}

/** Quanto pesa cada exigência entre quem produziu (ficha, junto de "quem produziu"). */
function tabelaPesoDasExigencias(peso) {
  if (!peso || !peso.itens.length || !peso.produtores_no_cadastro) return null;
  return el("div", {}, el("h3", { text: "Exigências e quem as tem" }),
    el("table", { class: "tabela compacta" },
      el("thead", {}, el("tr", {}, ["Exigência", "Produtores que a têm", "de"].map((h, i) => el("th", { class: i ? "num" : null, text: h })))),
      el("tbody", {}, peso.itens.map((i) => el("tr", {},
        el("td", {}, i.tipo === "habilitacao" ? `Habilitação ${i.codigo} ${i.nome || ""}`.trim() : `Serviço ${i.codigo}${i.classificacao ? `/${i.classificacao}` : ""} ${i.nome || ""}`.trim(), i.programa_38 ? el("span", { class: "etiqueta", text: "38.xx" }) : null),
        el("td", { class: "num", text: F.inteiro(i.produtores_com) }), el("td", { class: "num", text: F.inteiro(peso.produtores_no_cadastro) }))))),
    el("p", { class: "quieto pequeno", text: "Uma exigência que quase nenhum produtor tem não é o que separa quem produz de quem não produz. O procedimento pode aceitar mais de uma alternativa de habilitação." }));
}

// ---------- Mudou: impacto financeiro estimado ----------
async function secaoImpactoMudancas(pg, m) {
  const algum = ((E.producao && E.producao.ufs) || []).length;
  if (!algum) return;
  const sec = el("section", { class: "bloco" }, el("div", { class: "cab-linha" }, el("h2", { text: "Impacto estimado na produção" }), el("small", { text: "quantidade produzida × diferença de valor, em 12 meses" })), carregando("Estimando…"));
  pg.append(sec);
  let r;
  try { r = await invoke("faturamento_impacto", { de: m.de, para: m.para }); }
  catch (e) { limpar(sec).append(el("h2", { text: "Impacto estimado na produção" }), erro(e)); return; }
  limpar(sec).append(el("div", { class: "cab-linha" }, el("h2", { text: "Impacto estimado na produção" }), el("small", { text: "quantidade produzida × diferença de valor, em 12 meses" })));
  if (!r.disponivel) { sec.append(el("p", { class: "quieto", text: r.mensagem })); return; }
  sec.append(el("dl", { class: "chave" },
    el("div", {}, el("dt", { text: `Mudanças de valor (${r.mudancas_com_producao} com produção em ${r.uf})` }), el("dd", { text: F.inteiro(r.mudancas_de_valor) })),
    el("div", {}, el("dt", { text: `Impacto na UF ${r.uf}` }), el("dd", { class: `valor ${r.impacto_uf_anual_centavos < 0 ? "ambar" : ""}`, text: reaisAno(r.impacto_uf_anual_centavos) })),
    r.cnes ? el("div", {}, el("dt", { text: `Impacto na unidade ${r.cnes}` }), el("dd", { class: `valor ${r.impacto_unidade_anual_centavos < 0 ? "ambar" : ""}`, text: reaisAno(r.impacto_unidade_anual_centavos) })) : null));
  const comProducao = r.valores.filter((x) => x.quantidade_sia_uf || x.aih_uf);
  if (comProducao.length) sec.append(el("table", { class: "tabela compacta" },
    el("thead", {}, el("tr", {}, ["Código", "Procedimento", "Antes (SA / SH+SP)", "Depois", "Produção na UF", "Impacto na UF", "Na unidade"].map((h, i) => el("th", { class: i >= 4 ? "num" : null, text: h })))),
    el("tbody", {}, comProducao.slice(0, 40).map((x) => el("tr", {},
      el("td", { class: "cod" }, el("button", { class: "link mono", type: "button", onclick: () => ir({ tipo: "ficha", codigo: x.procedimento }) }, F.mascara(x.procedimento))),
      el("td", { text: x.nome || "" }),
      el("td", { class: "mono", text: `${reais(x.antes.sa)} / ${reais(x.antes.sh + x.antes.sp)}` }), el("td", { class: "mono", text: `${reais(x.depois.sa)} / ${reais(x.depois.sh + x.depois.sp)}` }),
      el("td", { class: "num", text: [x.quantidade_sia_uf ? `${F.inteiro(x.quantidade_sia_uf)} SIA` : "", x.aih_uf ? `${F.inteiro(x.aih_uf)} AIH` : ""].filter(Boolean).join(" · ") }),
      el("td", { class: "num", text: reaisAno(x.impacto_uf_anual_centavos) }),
      el("td", { class: "num", text: x.unidade_produz ? reaisAno(x.impacto_unidade_anual_centavos) : "não produz" }))))));
  else sec.append(el("p", { class: "quieto", text: r.mudancas_de_valor ? `Nenhuma das ${F.inteiro(r.mudancas_de_valor)} mudanças de valor atinge procedimento produzido em ${r.uf} nos meses completos.` : "Nenhum procedimento mudou de valor entre as duas competências." }));
  if (r.excluidos_com_producao.length) sec.append(el("div", {}, el("h3", { text: "Excluídos da tabela com produção na UF" }), r.excluidos_com_producao.map((x) => el("p", { class: "pequeno" },
    el("button", { class: "link mono", type: "button", onclick: () => ir({ tipo: "ficha", codigo: x.procedimento }) }, F.mascara(x.procedimento)), ` ${x.nome || ""}: ${F.inteiro(x.produtores_na_uf)} produtor(es), ${reais(x.valor_uf_janela_centavos)}${x.unidade_produz ? "; a sua unidade produz" : ""}`))));
  if (r.exigencias_novas_com_producao.length) sec.append(el("div", {}, el("h3", { text: `Exigência de habilitação ou serviço alterada, com produção na UF (${r.exigencias_novas_com_producao.length})` }),
    el("p", { class: "quieto pequeno", text: `${r.exigencias_realmente_novas_com_producao ? `${r.exigencias_realmente_novas_com_producao} passaram a exigir algo que não exigiam. ` : "Nenhuma passou a exigir algo que antes não exigia: são alterações de uma exigência que já existia (podem relaxar ou restringir). "}A coluna mostra a situação da sua unidade na competência nova.` }),
    el("table", { class: "tabela compacta" },
      el("thead", {}, el("tr", {}, ["Código", "Procedimento", "Produtores na UF", "Sua unidade produz", "Situação pelo cadastro"].map((h) => el("th", { text: h })))),
      el("tbody", {}, r.exigencias_novas_com_producao.slice(0, 40).map((x) => el("tr", {},
        el("td", { class: "cod" }, el("button", { class: "link mono", type: "button", onclick: () => ir({ tipo: "ficha", codigo: x.procedimento }) }, F.mascara(x.procedimento))),
        el("td", { text: x.nome || "" }), el("td", { class: "num", text: F.inteiro(x.produtores_na_uf) }), el("td", { text: x.unidade_produz ? "sim" : "não" }),
        el("td", { text: { apta: "habilitada", ressalva: "a confirmar", nao: "não habilitada" }[x.estado_da_unidade] || "—" })))))));
  sec.append(el("p", { class: "quieto pequeno", text: `${r.aviso} Janela: SIA ${r.janela_sia.length ? `${r.janela_sia[0]} a ${r.janela_sia.at(-1)}` : "—"}; SIH ${r.janela_sih.length ? `${r.janela_sih[0]} a ${r.janela_sih.at(-1)}` : "—"}.` }));
}

// ---------- Início: painel do faturista ----------
async function painelFaturista(cartoes) {
  const m = minhaUnidade();
  if (!m) return;
  const sec = el("section", { class: "bloco painel-faturista" }, el("h2", { text: "Painel do faturista" }));
  cartoes.prepend(sec);
  if (!temProducao(m.uf)) {
    sec.append(el("p", { class: "quieto", text: `Baixe a produção de ${m.uf} para ver o resumo da sua unidade: valor aprovado, rejeições, alertas e oportunidades.` }),
      el("button", { class: "link", type: "button", onclick: () => ir({ tipo: "modulos", aba: "Baixar e importar" }) }, "Baixar a produção"));
    return;
  }
  sec.append(carregando("Montando o painel…"));
  let r;
  try { r = await invoke("faturamento_painel", { competencia: E.comp }); }
  catch (e) { limpar(sec).append(el("h2", { text: "Painel do faturista" }), erro(e)); return; }
  limpar(sec).append(el("div", { class: "cab-linha" }, el("h2", { text: "Painel do faturista" }), el("small", { text: m.nome || `CNES ${m.cnes}` })));
  if (!r.disponivel) { sec.append(el("p", { class: "quieto", text: r.mensagem })); return; }
  const mes = (x, nome, unid) => !x ? el("div", {}, el("dt", { text: nome }), el("dd", { text: "—" })) :
    el("div", {}, el("dt", { text: `${nome} em ${F.competencia(x.competencia)}` }), el("dd", { class: "valor", text: reais(x.valor_centavos) }),
      el("small", { class: "quieto", text: `${F.inteiro(x.quantidade)} ${unid}; ${variacaoTxt(x.variacao_mes_anterior)} no mês, ${variacaoTxt(x.variacao_media_3_meses)} sobre a média de 3 meses` }));
  sec.append(el("dl", { class: "chave" }, mes(r.sia, "SIA aprovado", "aprovados"), mes(r.sih, "SIH aprovado", "AIH"),
    el("div", {}, el("dt", { text: "Rejeições por 100 AIH" }), el("dd", { class: "valor", text: dec1(r.rejeicoes.por_100_aih) }), el("small", { class: "quieto", text: `${F.inteiro(r.rejeicoes.janela_rejeicoes)} rejeições em ${F.inteiro(r.rejeicoes.janela_aih)} AIH` }))));
  if (r.alertas.length) sec.append(el("ul", { class: "alertas" }, r.alertas.map((a) => el("li", { class: `alerta ${a.gravidade}` }, el("span", { class: "etiqueta " + (a.gravidade === "atencao" ? "ambar" : ""), text: a.gravidade === "atencao" ? "atenção" : "info" }), ` ${a.texto}`))));
  else sec.append(el("p", { class: "quieto", text: "Nenhum alerta para os meses carregados." }));
  if (r.oportunidades && r.oportunidades.total) sec.append(el("div", {}, el("h3", { text: `Pode e não produz, mas a UF produz: ${F.inteiro(r.oportunidades.total)} procedimento(s)` }),
    (r.oportunidades.itens || []).map((x) => el("p", { class: "pequeno" }, el("button", { class: "link mono", type: "button", onclick: () => ir({ tipo: "ficha", codigo: x.codigo }) }, F.mascara(x.codigo)), ` ${x.nome || ""}: ${reais(x.uf.valor_centavos)} produzidos na UF`)),
    el("button", { class: "link", type: "button", onclick: () => ir({ tipo: "unidade", aba: "Procedimentos", visao: "producao", classe: "apta_nao_produz" }) }, "Ver todos")));
  sec.append(el("div", { class: "acoes" }, el("button", { class: "botao", type: "button", onclick: () => ir({ tipo: "unidade", aba: "Produção" }) }, "Ver a produção da unidade")),
    el("p", { class: "quieto pequeno", text: `Produção até ${r.fontes.producao_sia_ate ? F.competencia(r.fontes.producao_sia_ate) : "—"} (SIA) e ${r.fontes.producao_sih_ate ? F.competencia(r.fontes.producao_sih_ate) : "—"} (SIH); SIGTAP ${F.competencia(r.fontes.sigtap)}. ${r.aviso}` }));
}
