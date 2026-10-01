// SIGTAP Aberto: interface. Sem empacotador; consome os comandos do aplicativo (sa-query).
// Regra: todo texto vindo dos dados entra por textContent (nunca innerHTML).
"use strict";

const F = Formatos;
const tauri = window.__TAURI__;
const invoke = (cmd, args) => tauri.core.invoke(cmd, args || {});

// ---------- utilidades de DOM ----------
function el(tag, attrs, ...filhos) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === null || v === undefined || v === false) continue;
    if (k === "class") e.className = v;
    else if (k === "text") e.textContent = v;
    else if (k.startsWith("on")) e.addEventListener(k.slice(2), v);
    else e.setAttribute(k, v === true ? "" : v);
  }
  for (const f of filhos.flat(Infinity)) {
    if (f === null || f === undefined || f === false) continue;
    e.append(f instanceof Node ? f : document.createTextNode(String(f)));
  }
  return e;
}
const $ = (id) => document.getElementById(id);
function limpar(n) { while (n.firstChild) n.firstChild.remove(); return n; }

// ---------- nomes para exibição (apresentação, não dados) ----------
const NOME_RELACAO = {
  "rl_procedimento_cid.co_procedimento": "CID",
  "rl_procedimento_ocupacao.co_procedimento": "CBO",
  "rl_procedimento_habilitacao.co_procedimento": "Habilitação",
  "rl_procedimento_servico.co_procedimento": "Serviço",
  "rl_procedimento_leito.co_procedimento": "Leito",
  "rl_procedimento_incremento.co_procedimento": "Incremento",
  "rl_procedimento_compativel.co_procedimento_principal": "Compatíveis",
  "rl_procedimento_compativel.co_procedimento_compativel": "É compatível de",
  "rl_excecao_compatibilidade.co_procedimento_restricao": "Exceção: restrição",
  "rl_excecao_compatibilidade.co_procedimento_principal": "Exceção: principal",
  "rl_excecao_compatibilidade.co_procedimento_compativel": "Exceção: compatível",
  "rl_procedimento_regra_cond.co_procedimento": "Regras condicionadas",
  "rl_procedimento_sia_sih.co_procedimento": "Origem SIA/SIH",
  "rl_procedimento_origem.co_procedimento": "Origem",
  "rl_procedimento_origem.co_procedimento_origem": "É origem de",
  "rl_procedimento_renases.co_procedimento": "RENASES",
  "rl_procedimento_tuss.co_procedimento": "TUSS",
  "rl_procedimento_comp_rede.co_procedimento": "Redes",
  "rl_procedimento_detalhe.co_procedimento": "Atributos",
  "rl_procedimento_modalidade.co_procedimento": "Modalidade",
  "rl_procedimento_registro.co_procedimento": "Instrumento",
  "tb_descricao.co_procedimento": "Descrição",
};
const NOME_TABELA = {
  tb_procedimento: "Procedimento", tb_cid: "CID", tb_ocupacao: "CBO", tb_habilitacao: "Habilitação",
  tb_grupo_habilitacao: "Grupo de habilitação", tb_servico: "Serviço", tb_servico_classificacao: "Classificação de serviço",
  tb_detalhe: "Atributo complementar", tb_descricao_detalhe: "Descrição de atributo", tb_tipo_leito: "Tipo de leito",
  tb_modalidade: "Modalidade", tb_registro: "Instrumento de registro", tb_regra_condicionada: "Regra condicionada",
  tb_renases: "RENASES", tb_tuss: "TUSS", tb_componente_rede: "Componente de rede", tb_rede_atencao: "Rede de atenção",
  tb_financiamento: "Financiamento", tb_rubrica: "Rubrica", tb_sia_sih: "Procedimento SIA/SIH", tb_grupo: "Grupo",
  tb_sub_grupo: "Subgrupo", tb_forma_organizacao: "Forma de organização", tb_descricao: "Descrição do procedimento",
  rl_procedimento_cid: "CID do procedimento", rl_procedimento_ocupacao: "CBO do procedimento",
  rl_procedimento_habilitacao: "Habilitação", rl_procedimento_servico: "Serviço", rl_procedimento_leito: "Leito",
  rl_procedimento_incremento: "Incremento", rl_procedimento_compativel: "Compatibilidade",
  rl_excecao_compatibilidade: "Exceção de compatibilidade", rl_procedimento_regra_cond: "Regra condicionada",
  rl_procedimento_sia_sih: "Origem SIA/SIH", rl_procedimento_origem: "Origem", rl_procedimento_renases: "RENASES",
  rl_procedimento_tuss: "TUSS", rl_procedimento_comp_rede: "Rede", rl_procedimento_detalhe: "Atributo complementar",
  rl_procedimento_modalidade: "Modalidade", rl_procedimento_registro: "Instrumento",
};
const NOME_COLUNA = {
  co_cid: "CID", st_principal: "Principal", co_ocupacao: "CBO", co_habilitacao: "Habilitação",
  nu_grupo_habilitacao: "Grupo", co_servico: "Serviço", co_classificacao: "Classificação", co_tipo_leito: "Leito",
  co_registro: "Instrumento", co_modalidade: "Modalidade", co_detalhe: "Atributo", co_regra_condicionada: "Regra",
  co_renases: "RENASES", co_tuss: "TUSS", co_procedimento_sia_sih: "Código SIA/SIH", tp_procedimento: "Tipo",
  co_procedimento: "Procedimento", co_procedimento_compativel: "Procedimento compatível",
  co_registro_compativel: "Instrumento do compatível", tp_compatibilidade: "Tipo", qt_permitida: "Qtd. permitida",
  co_procedimento_principal: "Procedimento principal", co_registro_principal: "Instrumento do principal",
  co_procedimento_restricao: "Procedimento de restrição", co_procedimento_origem: "Procedimento de origem",
  co_componente_rede: "Componente da rede", vl_percentual_sh: "% SH", vl_percentual_sa: "% SA", vl_percentual_sp: "% SP",
  ds_procedimento: "Descrição", no_procedimento: "Nome", tp_complexidade: "Complexidade", tp_sexo: "Sexo",
  qt_maxima_execucao: "Quantidade máxima", qt_dias_permanencia: "Permanência (dias)", qt_pontos: "Pontos",
  vl_idade_minima: "Idade mínima", vl_idade_maxima: "Idade máxima", vl_sh: "Valor SH", vl_sa: "Valor SA",
  vl_sp: "Valor SP", co_financiamento: "Financiamento", co_rubrica: "Rubrica", qt_tempo_permanencia: "Tempo de permanência",
};
const nomeColuna = (c) => NOME_COLUNA[c.coluna] || c.coluna_origem || c.coluna;

// ---------- estado ----------
const E = {
  situacao: null,
  comps: [],          // CompetenciaInfo, da mais antiga para a mais recente
  comp: null,         // AAAAMM selecionada
  rota: { tipo: "inicio" },
  abertos: new Set(), // nós abertos da árvore
  selecionado: null,  // código de procedimento aberto
};

function compInfo(c) { return E.comps.find((x) => x.competencia === c); }

function rodape() {
  const i = compInfo(E.comp);
  $("rodape-fonte").textContent = i
    ? `Fonte: DATASUS, ${i.arquivo}${i.publicado_em ? `, publicado em ${i.publicado_em.replace(" ", " às ")}` : ""}`
    : "Sem tabela carregada";
}

function erro(msg) { return el("p", { class: "erro", text: String(msg) }); }
function carregando(txt) { return el("p", { class: "carregando", text: txt || "Carregando…" }); }

// ---------- navegação ----------
function ir(rota) { E.rota = rota; desenhar(); }

async function desenhar() {
  const c = limpar($("conteudo"));
  for (const b of ["ir-mudou", "ir-modulos"]) $(b).removeAttribute("aria-current");
  try {
    switch (E.rota.tipo) {
      case "busca": await telaBusca(c, E.rota.texto); break;
      case "ficha": await telaFicha(c, E.rota.codigo, E.rota.aba || "Resumo"); break;
      case "mudou": $("ir-mudou").setAttribute("aria-current", "page"); await telaMudou(c); break;
      case "modulos": $("ir-modulos").setAttribute("aria-current", "page"); telaModulos(c); break;
      default: telaInicio(c);
    }
  } catch (e) {
    limpar(c).append(el("div", { class: "pagina" }, erro(e)));
  }
}

// ---------- árvore ----------
async function abrirNo(li, no) {
  const filhos = li.querySelector("ul");
  if (filhos) { filhos.remove(); E.abertos.delete(no.codigo); li.querySelector(".seta").textContent = "▸"; return; }
  E.abertos.add(no.codigo);
  li.querySelector(".seta").textContent = "▾";
  const ul = el("ul", { role: "group" });
  li.append(ul);
  await preencherArvore(ul, no.codigo);
}

async function preencherArvore(ul, pai) {
  let nos;
  try {
    nos = await invoke("arvore", { competencia: E.comp, pai: pai || null });
  } catch (e) { ul.append(el("li", {}, erro(e))); return; }
  const nivel = pai ? pai.length / 2 : 0;
  for (const no of nos) {
    const folha = no.nivel === "procedimento";
    const btn = el("button", {
      class: "no" + (folha && no.codigo === E.selecionado ? " selecionado" : ""),
      type: "button", role: "treeitem", "data-codigo": no.codigo,
      title: no.nome || "",
    },
      el("span", { class: "seta", text: folha ? "" : "▸" }),
      el("span", { class: "cod", text: folha ? no.codigo_mascarado : pontuar(no.codigo) }),
      no.nome ? el("span", { class: "nome", text: folha ? capitalizar(no.nome) : no.nome })
              : el("span", { class: "nome sem-nome", text: "sem nome na tabela de estrutura" }),
    );
    btn.style.paddingLeft = `${14 + Math.min(nivel, 3) * 14}px`;
    const li = el("li", {}, btn);
    btn.addEventListener("click", () => folha ? ir({ tipo: "ficha", codigo: no.codigo }) : abrirNo(li, no));
    ul.append(li);
    if (!folha && E.abertos.has(no.codigo)) { E.abertos.delete(no.codigo); await abrirNo(li, no); }
  }
}

function pontuar(c) { return (c.match(/.{2}/g) || [c]).join("."); }
function capitalizar(s) {
  // Árvore: nome oficial em caixa alta fica menos legível em lista longa; a ficha mostra o oficial.
  const t = s.toLocaleLowerCase("pt-BR");
  return t.charAt(0).toLocaleUpperCase("pt-BR") + t.slice(1);
}

async function desenharArvore() {
  const raiz = limpar($("arvore-raiz"));
  if (!E.comp) { $("arvore-total").textContent = ""; return; }
  await preencherArvore(raiz, null);
  const total = [...raiz.querySelectorAll(":scope > li > .no")].length;
  $("arvore-total").textContent = total ? "" : "vazia";
}

async function revelarNaArvore(codigo) {
  for (const p of [codigo.slice(0, 2), codigo.slice(0, 4), codigo.slice(0, 6)]) E.abertos.add(p);
  await desenharArvore();
  const b = document.querySelector(`.no[data-codigo="${codigo}"]`);
  if (b) b.scrollIntoView({ block: "center" });
}

// ---------- início ----------
function telaInicio(c) {
  c.append(el("div", { class: "vazio" },
    el("h1", { text: "Consulte a Tabela de Procedimentos do SUS" }),
    el("p", { text: "Digite um código (com ou sem pontos), parte do nome, um CID, um CBO ou uma habilitação na busca acima, ou navegue pela árvore à esquerda." }),
    el("p", { class: "quieto", text: "Exemplos: 04.06.01.057-9, consulta medica, I42.0, 225120, 0802." }),
  ));
}

// ---------- busca ----------
async function telaBusca(c, texto) {
  c.append(carregando("Buscando…"));
  const r = await invoke("buscar", { competencia: E.comp, texto });
  limpar(c);
  const pg = el("div", { class: "pagina" });
  c.append(pg);
  const titulo = r.modo === "codigo"
    ? `${F.inteiro(r.total_procedimentos)} procedimento(s) com código começando em “${r.consulta}”`
    : `${F.inteiro(r.total_procedimentos)} procedimento(s) com “${r.consulta}” no nome`;
  pg.append(el("div", { class: "cab-linha" }, el("h1", { text: titulo }),
    el("span", { class: "quieto", text: `em ${F.competencia(r.competencia)}; a busca ignora acentos e maiúsculas` })));
  if (r.procedimentos.length) {
    const instr = {};
    for (const p of r.procedimentos) for (const i of p.instrumentos) instr[i] = (instr[i] || 0) + 1;
    let filtro = null;
    const filtros = el("div", { class: "filtros" }, el("span", { class: "quieto pequeno", text: "Instrumento" }));
    const corpo = el("tbody");
    const desenharLinhas = () => {
      limpar(corpo);
      for (const p of r.procedimentos.filter((p) => !filtro || p.instrumentos.includes(filtro))) {
        corpo.append(el("tr", { class: "clicavel", onclick: () => ir({ tipo: "ficha", codigo: p.codigo }) },
          el("td", { class: "cod", text: p.codigo_mascarado }),
          el("td", { text: p.nome }),
          el("td", { text: p.instrumentos.join("; ") || "—" }),
          el("td", { text: p.complexidade || p.tp_complexidade }),
          el("td", { class: "num", text: F.moeda(p.valor_total_centavos) })));
      }
      for (const b of filtros.querySelectorAll(".chip")) b.setAttribute("aria-pressed", String((b.dataset.v || null) === filtro));
    };
    const chip = (rotulo, v) => el("button", { class: "chip", type: "button", "data-v": v || "", onclick: () => { filtro = v; desenharLinhas(); } }, rotulo);
    filtros.append(chip(`Todos ${r.procedimentos.length}`, null));
    for (const [k, n] of Object.entries(instr)) filtros.append(chip(`${k} ${n}`, k));
    pg.append(filtros);
    pg.append(el("table", { class: "tabela" },
      el("thead", {}, el("tr", {}, ["Código", "Nome", "Instrumento", "Complexidade", "Valor total (R$)"].map((h, i) => el("th", { class: i === 4 ? "num" : null, text: h })))),
      corpo));
    desenharLinhas();
    if (r.total_procedimentos > r.procedimentos.length)
      pg.append(el("p", { class: "aviso", text: `Mostrando ${r.procedimentos.length} de ${F.inteiro(r.total_procedimentos)}. Refine a busca para ver os demais.` }));
  }
  if (r.apoio.length) {
    pg.append(el("h2", { text: "Também encontrado nas tabelas de apoio" }));
    const t = el("tbody");
    for (const a of r.apoio) {
      t.append(el("tr", { class: a.procedimentos ? "clicavel" : null, onclick: a.procedimentos ? () => ligados(pg, a) : null },
        el("td", { text: NOME_TABELA[a.tabela] || a.tabela }),
        el("td", { class: "cod", text: a.codigo.join(" ") }),
        el("td", { text: a.nome }),
        el("td", { class: "num", text: a.procedimentos ? `${F.inteiro(a.procedimentos)} procedimento(s)` : "nenhum procedimento" })));
    }
    pg.append(el("table", { class: "tabela" }, el("thead", {}, el("tr", {}, ["Tabela", "Código", "Nome", "Ligados"].map((h) => el("th", { text: h })))), t));
  }
  if (!r.procedimentos.length && !r.apoio.length)
    pg.append(el("p", { class: "quieto", text: "Nada encontrado. Confira a grafia, tente parte do nome ou o código com ou sem pontos." }));
}

async function ligados(pg, a) {
  const lista = await invoke("ligados", { competencia: E.comp, tabela: a.tabela, codigo: a.codigo });
  const sec = el("section", { class: "bloco" }, el("div", { class: "cab-linha" },
    el("h2", { text: `${NOME_TABELA[a.tabela] || a.tabela} ${a.codigo.join(" ")}: ${a.nome}` }),
    el("small", { text: `${lista.length} procedimento(s) ligados em ${F.competencia(E.comp)}` })));
  const t = el("tbody");
  for (const p of lista) t.append(el("tr", { class: "clicavel", onclick: () => ir({ tipo: "ficha", codigo: p.codigo }) },
    el("td", { class: "cod", text: p.codigo_mascarado }), el("td", { text: p.nome }),
    el("td", { text: p.instrumentos.join("; ") }), el("td", { class: "num", text: F.moeda(p.valor_total_centavos) })));
  sec.append(el("table", { class: "tabela" }, t));
  pg.append(sec);
  sec.scrollIntoView({ block: "start" });
}

// ---------- ficha ----------
function campoDe(linha, coluna) { return linha.campos.find((c) => c.coluna === coluna); }
function nomesDe(linha, coluna) {
  // Nome do código: referência cuja última coluna é esta.
  return linha.nomes.filter((n) => n.colunas[n.colunas.length - 1] === coluna);
}
function textoNome(n) {
  if (!n.tabela_presente) return { falta: `${NOME_TABELA[n.tabela] || n.tabela} não veio no ZIP desta competência` };
  if (!n.encontrados.length) return { falta: "sem nome nesta competência" };
  return { texto: n.encontrados.map((m) => Object.values(m).filter(Boolean)[0] || "").join(" / ") };
}

async function telaFicha(c, codigo, aba) {
  c.append(carregando());
  const f = await invoke("ficha", { competencia: E.comp, codigo });
  limpar(c);
  if (!f) {
    c.append(el("div", { class: "vazio" },
      el("h1", { text: `${F.mascara(codigo)} não existe em ${F.competencia(E.comp)}` }),
      el("p", { text: "Ele pode ter sido incluído depois ou excluído antes desta competência. Troque a competência no alto ou veja o histórico." }),
      el("button", { class: "botao", type: "button", onclick: () => ir({ tipo: "ficha", codigo, aba: "Histórico" }) }, "Ver histórico")));
    if (aba !== "Histórico") return;
  }
  if (E.selecionado !== codigo) { E.selecionado = codigo; revelarNaArvore(codigo); }
  const p = f ? f.procedimento[0] : null;
  const topo = el("div", { class: "ficha-topo" });
  c.append(topo);
  if (f) {
    topo.append(el("div", { class: "trilha" }, f.estrutura.map((n, i) => [i ? "  /  " : "",
      el("button", { type: "button", onclick: () => { E.abertos.add(n.codigo); revelarNaArvore(codigo); } },
        `${n.codigo.slice(-2)} ${n.nome || "sem nome na tabela de estrutura"}`)])));
    const partes = [[codigo.slice(0, 2), "grupo"], [codigo.slice(2, 4), "subgrupo"], [codigo.slice(4, 6), "forma"], [codigo.slice(6, 9), "procedimento"], [codigo.slice(9), "dígito"]];
    topo.append(el("div", { class: "linha-cod" },
      el("div", { class: "caixas", "aria-label": f.codigo_mascarado }, partes.map(([v, l]) => el("div", { class: "caixa" }, el("b", { text: v }), l))),
      el("div", { class: "espaco" }),
      el("button", { class: "botao", type: "button", onclick: (ev) => copiar(codigo, ev.currentTarget) }, `Copiar ${codigo}`),
      el("button", { class: "botao primario", type: "button", onclick: () => ir({ tipo: "ficha", codigo, aba: "Histórico" }) }, "Ver histórico")));
    topo.append(el("h1", { class: "nome-proc", text: campoDe(p, "no_procedimento").valor }));
    const desc = f.relacoes.find((r) => r.tabela === "tb_descricao");
    if (desc && desc.linhas.length) topo.append(el("p", { class: "descricao", text: `Descrição oficial: ${campoDe(desc.linhas[0], "ds_procedimento").valor}` }));
    const etq = el("div", { class: "etiquetas" });
    const cx = campoDe(p, "tp_complexidade"); if (cx) etq.append(el("span", { class: "etiqueta", text: F.campo(cx) }));
    for (const r of f.relacoes.filter((r) => r.tabela === "rl_procedimento_registro" || r.tabela === "rl_procedimento_modalidade"))
      for (const l of r.linhas) for (const n of l.nomes) { const t = textoNome(n); if (t.texto) etq.append(el("span", { class: "etiqueta", text: t.texto })); }
    const fin = nomesDe(p, "co_financiamento")[0]; if (fin) { const t = textoNome(fin); if (t.texto) etq.append(el("span", { class: "etiqueta", text: t.texto })); }
    if (f.procedimento.length > 1) etq.append(el("span", { class: "etiqueta ambar", text: `${f.procedimento.length} linhas para este código no arquivo oficial` }));
    topo.append(etq);
  } else {
    topo.append(el("h1", { class: "nome-proc", text: F.mascara(codigo) }));
  }
  // Abas: Resumo, Histórico e uma por tabela que cita o procedimento (inclusive vazias).
  const abas = el("div", { class: "abas", role: "tablist" });
  const lista = [["Resumo", null], ["Histórico", null]];
  if (f) {
    // Ordem de uso do faturista; tabelas vazias no fim; tabela nova (sem nome) aparece mesmo assim.
    const ordem = Object.keys(NOME_RELACAO);
    const pos = (r) => { const i = ordem.indexOf(`${r.tabela}.${r.coluna}`); return (r.linhas.length ? 0 : 1000) + (i < 0 ? 500 : i); };
    for (const r of [...f.relacoes].sort((a, b) => pos(a) - pos(b))) {
      if (r.tabela === "tb_descricao") continue;
      lista.push([NOME_RELACAO[`${r.tabela}.${r.coluna}`] || `${r.tabela} (${r.coluna})`, r]);
    }
  }
  for (const [nome, r] of lista) {
    if (!f && nome !== "Histórico") continue;
    abas.append(el("button", {
      class: "aba" + (r && !r.linhas.length ? " vazia" : ""), role: "tab", type: "button",
      "aria-selected": String(nome === aba), onclick: () => ir({ tipo: "ficha", codigo, aba: nome }),
    }, nome, r ? el("small", { text: String(r.linhas.length) }) : null));
  }
  topo.append(abas);
  const corpo = el("div");
  c.append(corpo);
  if (aba === "Resumo") resumo(corpo, f, p);
  else if (aba === "Histórico") await abaHistorico(corpo, codigo);
  else {
    const r = lista.find(([n]) => n === aba);
    if (r && r[1]) tabelaRelacao(corpo, r[1]);
  }
}

async function copiar(texto, botao) {
  try { await navigator.clipboard.writeText(texto); botao.textContent = "Copiado"; }
  catch { botao.textContent = "Não foi possível copiar"; }
  setTimeout(() => { botao.textContent = `Copiar ${texto}`; }, 1500);
}

function par(k, campo, extra) {
  return el("div", { class: "par" },
    el("span", { class: "k", text: k }),
    el("span", { class: "v" + (campo && campo.unidade === "centavos" ? " num" : ""), text: campo ? F.campo(campo) : "—" }),
    el("span", { class: "n", text: extra || (campo ? F.notaOficial(campo) : "") }));
}

function resumo(corpo, f, p) {
  const cols = el("div", { class: "colunas" });
  corpo.append(cols);
  const A = el("div", { class: "coluna" }), B = el("div", { class: "coluna" });
  cols.append(A, B);
  const v = (c) => campoDe(p, c);
  const sh = v("vl_sh"), sa = v("vl_sa"), sp = v("vl_sp");
  A.append(el("section", { class: "bloco" },
    el("div", { class: "cab-linha" }, el("h2", { text: "Valores" }), el("small", { text: "em reais; no arquivo oficial, em centavos" })),
    par("Serviço hospitalar (SH)", sh), par("Serviço profissional (SP)", sp), par("Serviço ambulatorial (SA)", sa),
    par("Total", { valor: (sh?.valor || 0) + (sa?.valor || 0) + (sp?.valor || 0), unidade: "centavos" }, "SH + SA + SP")));
  const im = v("vl_idade_minima"), ix = v("vl_idade_maxima");
  const idade = im && ix
    ? (im.sentinela || ix.sentinela ? { valor: "Não se aplica" } : { valor: `${F.idade(im.valor)} a ${F.idade(ix.valor)}` })
    : null;
  const usos = el("section", { class: "bloco" }, el("div", { class: "cab-linha" }, el("h2", { text: "Regras de uso" })),
    par("Sexo", v("tp_sexo")),
    el("div", { class: "par" }, el("span", { class: "k", text: "Idade" }), el("span", { class: "v", text: idade ? idade.valor : "—" }),
      el("span", { class: "n", text: im && ix ? `${im.valor} a ${ix.valor} meses no arquivo oficial` : "" })),
    par("Quantidade máxima", v("qt_maxima_execucao")),
    par("Permanência (dias)", v("qt_dias_permanencia")),
    v("qt_tempo_permanencia") ? par("Tempo de permanência", v("qt_tempo_permanencia")) : null,
    par("Pontos", v("qt_pontos")));
  A.append(usos);
  const fin = nomesDe(p, "co_financiamento")[0], rub = nomesDe(p, "co_rubrica")[0];
  A.append(el("section", { class: "bloco" }, el("div", { class: "cab-linha" }, el("h2", { text: "Financiamento" })),
    par("Financiamento", { valor: fin ? (textoNome(fin).texto || textoNome(fin).falta) : (v("co_financiamento")?.valor || "—") }, `código ${v("co_financiamento")?.valor || "—"}`),
    par("Rubrica", { valor: v("co_rubrica")?.valor ? (rub ? (textoNome(rub).texto || textoNome(rub).falta) : v("co_rubrica").valor) : "Sem rubrica" }, v("co_rubrica")?.valor ? `código ${v("co_rubrica").valor}` : "")));
  // Coluna B: atributos, incremento, regras.
  const rel = (t) => f.relacoes.find((r) => r.tabela === t && r.coluna === "co_procedimento");
  const blocoItens = (titulo, r, col, extra) => {
    const b = el("section", { class: "bloco" }, el("div", { class: "cab-linha" }, el("h2", { text: titulo }), el("small", { text: String(r ? r.linhas.length : 0) })));
    if (!r || !r.linhas.length) { b.append(el("span", { class: "quieto", text: "Nenhum nesta competência." })); return b; }
    for (const l of r.linhas) {
      const cod = campoDe(l, col)?.valor;
      const ns = nomesDe(l, col).map(textoNome);
      b.append(el("div", { class: "item" }, el("span", { class: "c", text: cod }),
        el("span", { text: ns[0]?.texto || ns[0]?.falta || "" }), el("span", { text: extra ? extra(l) : "" }),
        ns.slice(1).filter((n) => n.texto).map((n) => el("span", { class: "d", text: n.texto }))));
    }
    return b;
  };
  B.append(blocoItens("Atributos complementares", rel("rl_procedimento_detalhe"), "co_detalhe"));
  B.append(blocoItens("Incremento por habilitação", rel("rl_procedimento_incremento"), "co_habilitacao", (l) =>
    ["vl_percentual_sh", "vl_percentual_sa", "vl_percentual_sp"].map((k) => [k.slice(-2).toUpperCase(), campoDe(l, k)?.valor || 0])
      .filter(([, n]) => n).map(([k, n]) => `+${F.percentual(n)} ${k}`).join(", ")));
  B.append(blocoItens("Regras condicionadas", rel("rl_procedimento_regra_cond"), "co_regra_condicionada"));
}

function tabelaRelacao(corpo, r) {
  const sec = el("div", { class: "secao" });
  corpo.append(sec);
  if (!r.linhas.length) {
    sec.append(el("p", { class: "quieto", text: `Nenhuma linha em ${NOME_TABELA[r.tabela] || r.tabela} para este procedimento nesta competência.` }));
    return;
  }
  const cols = r.linhas[0].campos.filter((c) => c.coluna !== r.coluna && c.coluna !== "dt_competencia");
  const temQtd = r.linhas.some((l) => l.quantidade > 1);
  const corpoT = el("tbody");
  for (const l of r.linhas) {
    const tr = el("tr");
    for (const c0 of cols) {
      const c = campoDe(l, c0.coluna);
      const ns = nomesDe(l, c0.coluna).map(textoNome);
      const ehProc = /^co_procedimento/.test(c.coluna) && /^\d{10}$/.test(c.valor);
      const td = el("td", { class: /^(co_|nu_)/.test(c.coluna) ? "cod" : null },
        ehProc ? el("button", { class: "link", type: "button", onclick: () => ir({ tipo: "ficha", codigo: c.valor }) }, F.mascara(c.valor)) : F.campo(c),
        c.situacao && c.situacao !== "oficial" ? el("span", { class: "falta", text: F.notaOficial(c) }) : null,
        ns.map((n) => n.texto ? el("span", { class: "nomeado", text: n.texto }) : el("span", { class: "falta", text: n.falta })));
      tr.append(td);
    }
    if (temQtd) tr.append(el("td", { class: "num", text: String(l.quantidade) }));
    corpoT.append(tr);
  }
  sec.append(el("table", { class: "tabela" },
    el("thead", {}, el("tr", {}, cols.map((c) => el("th", { text: nomeColuna(c) })), temQtd ? el("th", { text: "Repetições no arquivo" }) : null)),
    corpoT));
  sec.append(el("p", { class: "quieto pequeno", text: `Tabela oficial: ${r.tabela.toUpperCase()}, ${r.linhas.length} linha(s) em ${F.competencia(E.comp)}.` }));
}

// ---------- histórico ----------
function resumoLinha(l, ignorar) {
  if (!l) return "";
  const partes = [];
  for (const c of l.campos) {
    if (c.coluna === ignorar || c.coluna === "dt_competencia" || c.coluna === "co_procedimento") continue;
    if (!/^(co_|nu_|tp_|st_)/.test(c.coluna)) continue;
    const n = nomesDe(l, c.coluna).map(textoNome).find((x) => x.texto);
    partes.push(`${c.valor}${n ? " " + n.texto : (c.situacao === "oficial" ? " " + c.descricao : "")}`);
  }
  return partes.join("; ");
}

async function abaHistorico(corpo, codigo) {
  corpo.append(carregando("Montando o histórico…"));
  const h = await invoke("historico", { codigo });
  limpar(corpo);
  const sec = el("div", { class: "secao" });
  corpo.append(sec);
  const com = new Set(h.competencias_com_mudanca);
  const qtd = {}; for (const e of h.eventos) qtd[e.competencia] = (qtd[e.competencia] || 0) + 1;
  const faixa = el("div", { class: "faixa", role: "img", "aria-label": `${com.size} competências com mudança` });
  for (const c of E.comps) {
    const i = el("i", { class: com.has(c.competencia) ? "m" : null, title: `${F.competencia(c.competencia)}${qtd[c.competencia] ? `: ${qtd[c.competencia]} mudança(s)` : ""}` });
    if (qtd[c.competencia]) i.style.height = `${Math.min(10 + qtd[c.competencia] * 5, 40)}px`;
    if (com.has(c.competencia)) i.addEventListener("click", () => document.getElementById(`ev-${c.competencia}`)?.scrollIntoView({ block: "center" }));
    faixa.append(i);
  }
  const anos = el("div", { class: "anos" }, el("span", { text: F.competencia(h.primeira_carregada) }), el("span", { text: F.competencia(h.ultima_carregada) }));
  sec.append(el("section", { class: "bloco" },
    el("div", { class: "cab-linha" }, el("h2", { text: `${com.size} competência(s) com mudança entre ${F.competencia(h.primeira_carregada)} e ${F.competencia(h.ultima_carregada)}` }),
      el("small", { text: `${h.competencias_carregadas} competência(s) carregadas` })),
    faixa, anos,
    h.competencias_carregadas < 2 ? el("p", { class: "aviso", text: "Só uma competência carregada: baixe o histórico completo em Módulos e dados para ver as mudanças." }) : null));
  const lista = el("section", { class: "bloco" });
  let atual = null, grupo = null;
  for (const e of h.eventos) {
    if (e.competencia !== atual) {
      atual = e.competencia;
      grupo = el("div");
      lista.append(el("div", { class: "evento", id: `ev-${atual}` }, el("span", { class: "mono", text: e.rotulo }), grupo));
    }
    const nomeT = NOME_TABELA[e.tabela] || e.tabela;
    let desc;
    if (e.tipo === "alterado") {
      desc = el("span", {}, e.campos_alterados.map((col) => {
        const a = e.antes && campoDe(e.antes, col), d = e.depois && campoDe(e.depois, col);
        return el("span", { class: "mud-campo" }, `${NOME_COLUNA[col] || col}: `,
          el("span", { class: "antes", text: a ? F.campo(a) || "vazio" : "campo ausente" }), " → ",
          el("span", { class: "depois", text: d ? F.campo(d) || "vazio" : "campo ausente" }), "  ");
      }));
    } else desc = el("span", { text: resumoLinha(e.antes || e.depois, e.coluna) });
    const nota = e.tabela_ausente ? " (a tabela não veio no ZIP desta competência)" : e.tabela_voltou ? " (a tabela voltou a vir no ZIP)" : "";
    grupo.append(el("div", { class: "mud" },
      el("span", { class: `tag ${e.tipo}`, text: { incluido: "incluído", excluido: "excluído", alterado: "alterado" }[e.tipo] }),
      el("span", { text: nomeT }), el("span", {}, desc, nota ? el("span", { class: "quieto", text: nota }) : null)));
  }
  if (!h.eventos.length) lista.append(el("p", { class: "quieto", text: "Nenhuma mudança nas competências carregadas." }));
  sec.append(lista);
}

// ---------- o que mudou ----------
async function telaMudou(c) {
  c.append(carregando("Comparando competências…"));
  const pos = E.comps.findIndex((x) => x.competencia === E.comp);
  const de = E.rota.de || (pos > 0 ? E.comps[pos - 1].competencia : null);
  if (!de) {
    limpar(c).append(el("div", { class: "vazio" }, el("h1", { text: "Não há competência anterior carregada" }),
      el("p", { text: "Para comparar, baixe o histórico completo (ou a competência anterior) em Módulos e dados." })));
    return;
  }
  const m = await invoke("mudou", { de, para: E.comp });
  limpar(c);
  const pg = el("div", { class: "pagina" });
  c.append(pg);
  const sel = el("select", { "aria-label": "Comparar com", onchange: (ev) => ir({ tipo: "mudou", de: ev.target.value }) },
    E.comps.filter((x) => x.competencia < E.comp).reverse().map((x) => el("option", { value: x.competencia, selected: x.competencia === m.de }, F.competencia(x.competencia))));
  pg.append(el("div", { class: "cab-linha" }, el("h1", { text: `O que mudou em ${F.competencia(m.para)}` }),
    el("label", { class: "quieto" }, "comparado com ", sel)));
  const proc = m.tabelas.find((t) => t.tabela === "tb_procedimento");
  const rl = m.tabelas.filter((t) => t.tabela.startsWith("rl_"));
  const tb = m.tabelas.filter((t) => t.tabela.startsWith("tb_") && t.tabela !== "tb_procedimento");
  const soma = (ts, k) => ts.reduce((s, t) => s + t[k], 0);
  pg.append(el("div", { class: "numeros" },
    el("div", {}, el("b", { text: F.inteiro(proc ? proc.incluidos : 0) }), "procedimentos incluídos"),
    el("div", {}, el("b", { text: F.inteiro(proc ? proc.alterados : 0) }), "procedimentos alterados"),
    el("div", {}, el("b", { text: F.inteiro(proc ? proc.excluidos : 0) }), "procedimentos excluídos"),
    el("div", {}, el("b", { text: F.inteiro(soma(rl, "incluidos") + soma(rl, "excluidos") + soma(rl, "alterados") + soma(tb, "incluidos") + soma(tb, "excluidos") + soma(tb, "alterados")) }), "mudanças em vínculos e tabelas de apoio")));
  if (!m.tabelas.length) pg.append(el("p", { class: "quieto", text: "As duas competências são iguais em todas as tabelas." }));
  for (const t of [proc, ...rl, ...tb].filter(Boolean)) {
    const b = el("section", { class: "bloco" }, el("div", { class: "cab-linha" },
      el("h2", { text: NOME_TABELA[t.tabela] || t.tabela }),
      el("small", { text: [t.incluidos && `${F.inteiro(t.incluidos)} incluído(s)`, t.alterados && `${F.inteiro(t.alterados)} alterado(s)`, t.excluidos && `${F.inteiro(t.excluidos)} excluído(s)`].filter(Boolean).join(", ") })));
    if (!t.presente_antes) b.append(el("p", { class: "aviso", text: "Esta tabela não veio no ZIP da competência anterior." }));
    if (!t.presente_depois) b.append(el("p", { class: "aviso", text: "Esta tabela não veio no ZIP desta competência." }));
    const mostrar = t.itens.slice(0, 25);
    for (const i of mostrar) {
      const l = i.depois || i.antes;
      const codProc = l && campoDe(l, "co_procedimento")?.valor;
      const desc = i.tipo === "alterado"
        ? i.campos_alterados.map((col) => `${NOME_COLUNA[col] || col}: ${F.campo(campoDe(i.antes, col)) || "vazio"} → ${F.campo(campoDe(i.depois, col)) || "vazio"}`).join("; ")
        : resumoLinha(l, "co_procedimento") || Object.values(i.chave).join(" ");
      b.append(el("div", { class: "mud" },
        el("span", { class: `tag ${i.tipo}`, text: { incluido: "incluído", excluido: "excluído", alterado: "alterado" }[i.tipo] }),
        codProc ? el("button", { class: "link mono", type: "button", onclick: () => ir({ tipo: "ficha", codigo: codProc }) }, F.mascara(codProc)) : el("span", { class: "mono", text: Object.values(i.chave).join(" ") }),
        el("span", { text: (t.tabela === "tb_procedimento" && campoDe(l, "no_procedimento") ? campoDe(l, "no_procedimento").valor + ": " : "") + desc })));
    }
    const resto = t.itens.length - mostrar.length + t.itens_omitidos;
    if (resto > 0) b.append(el("p", { class: "quieto pequeno", text: `E mais ${F.inteiro(resto)} item(ns). A linha de comando exporta tudo: sigtap-aberto-cli mudou --de ${m.de} --competencia ${m.para}` }));
    pg.append(b);
  }
}

// ---------- módulos e dados ----------
function telaModulos(c) {
  const s = E.situacao || {};
  const pg = el("div", { class: "pagina" });
  c.append(pg);
  pg.append(el("div", { class: "cab-linha" }, el("h1", { text: "Módulos e dados" }), el("span", { class: "quieto", text: `Pasta: ${s.pasta_dados || ""}` })));
  const ult = E.comps[E.comps.length - 1];
  const ter = s.territorio;
  const linhas = [
    ["Tabela de procedimentos (SIGTAP)", ult ? "carregada" : "não baixada", ult ? F.competencia(ult.competencia) : "—",
      ult ? `${ult.arquivo}${ult.publicado_em ? `, publicado em ${ult.publicado_em}` : ""}` : "ftp2.datasus.gov.br"],
    ["Histórico da tabela", `${E.comps.length} competência(s)`, E.comps.length ? `${F.competencia(E.comps[0].competencia)} a ${F.competencia(ult.competencia)}` : "—",
      `${s.zips_guardados || 0} ZIP(s) oficiais guardados em dados\\zips; o banco pode ser refeito a partir deles`],
    ["Território", ter ? (ter.resumo.sem_regiao_saude.length || ter.resumo.sem_ibge.length ? "com aviso" : "em dia") : "não baixado", ter ? "base das fontes" : "—",
      ter ? `IBGE: ${F.inteiro(ter.resumo.municipios_ibge)} municípios. Ministério da Saúde: ${F.inteiro(ter.resumo.municipios_saude)}, ${ter.resumo.regioes_saude} regiões de saúde.` +
        (ter.resumo.sem_regiao_saude.length ? ` Sem região de saúde na fonte: ${ter.resumo.sem_regiao_saude.join(", ")}.` : "") +
        ter.fontes.map((f) => ` ${f.fonte === "ibge" ? "IBGE" : "Ministério da Saúde"} obtido em ${f.origem.obtido_em}.`).join("") : "IBGE e Ministério da Saúde"],
    ["Estabelecimentos (CNES)", "próxima fase", "—", "por UF ou município; chega na fase 3"],
    ["Produção ambulatorial e hospitalar (SIA, SIH)", "próxima fase", "—", "por UF e competência; chega na fase 4"],
    ["TUSS e TISS (ANS)", "próxima fase", "—", "correlação com o SIGTAP como apoio, sempre com a data da fonte"],
  ];
  pg.append(el("table", { class: "tabela" },
    el("thead", {}, el("tr", {}, ["Módulo", "Situação", "Competências", "Origem e frescor"].map((h) => el("th", { text: h })))),
    el("tbody", {}, linhas.map((l) => el("tr", {}, el("td", {}, el("b", { text: l[0] })), l.slice(1).map((x) => el("td", { text: x })))))));
  const prog = painelProgresso();
  const confirmar = el("div", { class: "aviso", hidden: true },
    "O histórico completo tem cerca de 360 MB (225 arquivos), baixados um por vez, e a carga no banco leva vários minutos. ",
    el("button", { class: "botao", type: "button", onclick: () => { confirmar.hidden = true; baixar({ sigtap_vigente: true, territorio: false, historico: true }); } }, "Baixar mesmo assim"));
  const caminho = el("input", { type: "text", class: "caminho", placeholder: "Ex.: D:\\Downloads\\SIGTAP", "aria-label": "Pasta para importar", size: "48" });
  pg.append(el("div", { class: "acoes" },
    el("button", { class: "botao primario", type: "button", onclick: () => baixar({ sigtap_vigente: true, territorio: true, historico: false }) }, "Procurar atualizações"),
    el("button", { class: "botao", type: "button", onclick: () => { confirmar.hidden = false; } }, "Baixar o histórico completo"),
    el("button", { class: "botao", type: "button", onclick: () => invoke("cancelar") }, "Cancelar o que está em andamento")));
  pg.append(confirmar, prog);
  pg.append(el("section", { class: "bloco" }, el("h2", { text: "Importar de uma pasta" }),
    el("p", { class: "quieto", text: "Sem internet ou com o FTP bloqueado? Copie para uma pasta os arquivos TabelaUnificada_AAAAMM_*.zip (do site do DATASUS) e, se quiser, ibge_municipios.json e demas_municipios.json, e indique a pasta. O programa confere cada arquivo antes de usar." }),
    el("div", { class: "acoes" }, caminho,
      el("button", { class: "botao", type: "button", onclick: () => caminho.value.trim() && importar(caminho.value.trim()) }, "Importar"))));
}

// ---------- tarefas em segundo plano ----------
let painelAtual = null;
function painelProgresso() {
  painelAtual = el("div", { class: "progresso", hidden: !(E.situacao && E.situacao.ocupado) },
    el("div", { class: "trilho" }, el("div", { class: "barra-prog" })), el("span", { class: "msg" }));
  return painelAtual;
}
function mostrarProgresso(p) {
  for (const alvo of [painelAtual, $("primeira-progresso")]) {
    if (!alvo) continue;
    alvo.hidden = false;
    const barra = alvo.querySelector(".barra-prog");
    const msg = alvo.querySelector(".msg") || $("primeira-msg");
    if (p.total > 0) barra.style.width = `${Math.min(100, (100 * p.feito) / p.total).toFixed(0)}%`;
    msg.textContent = p.total > 0 && p.etapa !== "carga" && p.feito < p.total
      ? `${p.mensagem}: ${(p.feito / 1e6).toFixed(1)} de ${(p.total / 1e6).toFixed(1)} MB` : p.mensagem;
  }
}
async function baixar(pedido) {
  try { await invoke("baixar", { pedido }); mostrarProgresso({ mensagem: "Iniciando…", feito: 0, total: 0 }); }
  catch (e) { mostrarFalha(e); }
}
async function importar(pasta) {
  try { await invoke("importar", { pasta }); mostrarProgresso({ mensagem: "Importando…", feito: 0, total: 0 }); }
  catch (e) { mostrarFalha(e); }
}
function mostrarFalha(e) {
  if (!$("primeira").hidden) { $("primeira-erro").hidden = false; $("primeira-erro").textContent = String(e); }
  else if (painelAtual) { painelAtual.hidden = false; painelAtual.querySelector(".msg").textContent = String(e); }
}

// ---------- inicialização ----------
async function atualizarSituacao() {
  E.situacao = await invoke("situacao");
  E.comps = E.situacao.competencias || [];
  const sel = limpar($("competencia"));
  for (const c of [...E.comps].reverse()) sel.append(el("option", { value: c.competencia }, F.competencia(c.competencia)));
  if (!E.comp || !compInfo(E.comp)) E.comp = E.comps.length ? E.comps[E.comps.length - 1].competencia : null;
  if (E.comp) sel.value = E.comp;
  sel.disabled = !E.comps.length;
  rodape();
  $("primeira").hidden = !E.situacao.primeira_execucao;
}

async function iniciar() {
  $("form-busca").addEventListener("submit", (ev) => {
    ev.preventDefault();
    const t = $("busca").value.trim();
    if (t) ir({ tipo: "busca", texto: t });
  });
  document.addEventListener("keydown", (ev) => {
    if (ev.ctrlKey && ev.key.toLowerCase() === "k") { ev.preventDefault(); $("busca").focus(); $("busca").select(); }
  });
  $("competencia").addEventListener("change", async (ev) => {
    E.comp = ev.target.value; rodape(); await desenharArvore(); desenhar();
  });
  $("ir-mudou").addEventListener("click", () => ir({ tipo: "mudou" }));
  $("ir-modulos").addEventListener("click", () => ir({ tipo: "modulos" }));
  $("primeira-baixar").addEventListener("click", () => {
    $("primeira-erro").hidden = true;
    $("primeira-baixar").disabled = true;
    baixar({ sigtap_vigente: true, territorio: true, historico: $("primeira-historico").checked });
  });
  $("primeira-cancelar").addEventListener("click", () => invoke("cancelar"));
  $("primeira-importar").addEventListener("click", () => { $("primeira").hidden = true; ir({ tipo: "modulos" }); });
  await tauri.event.listen("progresso", (ev) => mostrarProgresso(ev.payload));
  await tauri.event.listen("tarefa_fim", async (ev) => {
    const f = ev.payload;
    $("primeira-baixar").disabled = false;
    await atualizarSituacao();
    await desenharArvore();
    if (f.ok) { mostrarProgresso({ mensagem: f.mensagem, feito: 1, total: 1, etapa: "fim" }); if (E.rota.tipo === "modulos") desenhar(); }
    else mostrarFalha(f.cancelada ? `Cancelado. ${f.mensagem}` : f.mensagem);
  });
  try {
    await atualizarSituacao();
    await desenharArvore();
  } catch (e) {
    $("conteudo").append(el("div", { class: "pagina" }, erro(e)));
  }
  desenhar();
}

iniciar();
