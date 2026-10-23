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
  pilha: [],          // rotas anteriores (botão Voltar)
  tarefa: { ativa: false, ultimo: null, falhou: false, ate: 0 }, // download/importação em segundo plano
  ofertas: null,      // competências do servidor (tamanhos dos downloads parciais)
};

function compInfo(c) { return E.comps.find((x) => x.competencia === c); }

function rodape() {
  limpar($("rodape-fonte")).textContent = compInfo(E.comp) ? "" : "Sem tabela carregada";
}

function erro(msg) {
  const p = el("p", { class: "erro", text: String(msg) });
  if (typeof pareceBancoDanificado === "function" && pareceBancoDanificado(msg))
    p.append(" ", el("button", { class: "link", type: "button", onclick: () => ir({ tipo: "modulos" }) }, "Verificar e refazer o banco"));
  return p;
}
/**
 * Indicador de espera: três pontos que pulam (movimento sempre visível, para a tela não parecer travada) e
 * o texto do que está sendo feito. Passados 2 s, mostra há quanto tempo está trabalhando; passados 8 s,
 * avisa que o programa não travou. O contador para sozinho quando o elemento sai da tela.
 */
function carregando(txt) {
  const tempo = el("small", { class: "carregando-tempo" });
  const p = el("p", { class: "carregando", role: "status" },
    el("span", { class: "roda", "aria-hidden": "true" }, el("i"), el("i"), el("i")),
    el("span", { class: "carregando-txt" }, el("span", { text: txt || "Carregando…" }), tempo));
  const inicio = Date.now();
  const relogio = setInterval(() => {
    if (!p.isConnected) { if (Date.now() - inicio > 500) clearInterval(relogio); return; }
    const s = Math.floor((Date.now() - inicio) / 1000);
    if (s < 2) return;
    tempo.textContent = s < 8
      ? `Ainda trabalhando… ${s} s`
      : `Ainda trabalhando… ${s} s. Isto pode levar um tempo (principalmente na primeira vez); o programa não travou.`;
  }, 1000);
  return p;
}

// ---------- navegação ----------
const CONSULTA = new Set(["inicio", "busca", "ficha"]);
function ir(rota, opc) {
  if (!(opc && opc.substituir) && E.rota) { E.pilha.push(E.rota); if (E.pilha.length > 60) E.pilha.shift(); }
  E.rota = rota; desenhar();
}
function voltar() { E.rota = E.pilha.pop() || { tipo: "inicio" }; desenhar(); }
/** "Procedimentos": volta à última tela de consulta (ficha ou busca); já nela, vai ao início. */
function irProcedimentos() {
  if (CONSULTA.has(E.rota.tipo)) { if (E.rota.tipo !== "inicio") ir({ tipo: "inicio" }); return; }
  const r = [...E.pilha].reverse().find((x) => CONSULTA.has(x.tipo));
  ir(r || { tipo: "inicio" });
}
function botaoVoltar() {
  const anterior = E.pilha[E.pilha.length - 1];
  const destino = !anterior ? "início" : anterior.tipo === "ficha" ? F.mascara(anterior.codigo) : anterior.tipo === "busca" ? "busca" : anterior.tipo === "mudou" ? "O que mudou" : anterior.tipo === "modulos" ? "Módulos e dados" : anterior.tipo === "unidade" ? "Minha unidade" : "início";
  return el("button", { class: "link voltar", type: "button", onclick: voltar, title: "Alt+seta para a esquerda" }, `← Voltar para ${destino}`);
}

async function desenhar() {
  const c = limpar($("conteudo"));
  c.scrollTop = 0;
  for (const b of ["ir-inicio", "ir-mudou", "ir-unidade", "ir-modulos"]) $(b).removeAttribute("aria-current");
  if (CONSULTA.has(E.rota.tipo)) $("ir-inicio").setAttribute("aria-current", "page");
  atualizarRodapeProgresso();
  try {
    switch (E.rota.tipo) {
      case "busca": await telaBusca(c, E.rota.texto); break;
      case "ficha": await telaFicha(c, E.rota.codigo, E.rota.aba || "Resumo"); break;
      case "mudou": $("ir-mudou").setAttribute("aria-current", "page"); await telaMudou(c); break;
      case "unidade": $("ir-unidade").setAttribute("aria-current", "page"); await telaUnidade(c, E.rota.aba); break;
      case "modulos": $("ir-modulos").setAttribute("aria-current", "page"); telaModulos(c); break;
      default: telaInicio(c);
    }
  } catch (e) {
    limpar(c).append(el("div", { class: "pagina" }, erro(e)));
  }
}

// ---------- busca em tempo real (sugestões) ----------
const Sug = { seq: 0, itens: [], ativo: -1, timer: null };
function fecharSug() {
  $("sugestoes").hidden = true; $("busca").setAttribute("aria-expanded", "false");
  Sug.ativo = -1; $("busca").removeAttribute("aria-activedescendant");
}
function moverSug(d) {
  if (!Sug.itens.length) return;
  Sug.ativo = (Sug.ativo + d + Sug.itens.length) % Sug.itens.length;
  Sug.itens.forEach((it, i) => it.no.setAttribute("aria-selected", String(i === Sug.ativo)));
  const ativo = Sug.itens[Sug.ativo].no;
  $("busca").setAttribute("aria-activedescendant", ativo.id);
  ativo.scrollIntoView({ block: "nearest" });
}
async function sugerir(texto) {
  const n = ++Sug.seq;
  let r = null, falha = null, unidades = [];
  try { r = await invoke("buscar", { competencia: E.comp, texto }); } catch (e) { falha = e; }
  if (!falha && texto.length >= 3 && E.cnes && E.cnes.ufs.length) { try { unidades = await invoke("unidades_buscar", { texto }); } catch { /* sem unidades */ } }
  if (n !== Sug.seq || $("busca").value.trim() !== texto) return; // resposta de uma digitação antiga
  const box = limpar($("sugestoes"));
  Sug.itens = []; Sug.ativo = -1;
  const item = (conteudo, acao) => {
    const b = el("div", { class: "sug", role: "option", id: `sug-${Sug.itens.length}`, "aria-selected": "false",
      onpointerdown: (ev) => { ev.preventDefault(); acao(); } }, conteudo);
    Sug.itens.push({ no: b, acao }); return b;
  };
  const abrirFicha = (codigo) => () => { fecharSug(); ir({ tipo: "ficha", codigo }); };
  const verTudo = (ligar) => () => { fecharSug(); ir({ tipo: "busca", texto, ligar }); };
  if (falha) box.append(el("p", { class: "sug-nada", text: String(falha) }));
  else {
    const procs = r.procedimentos.slice(0, 8);
    if (procs.length) {
      box.append(el("div", { class: "sug-cab" }, el("span", { text: "Procedimentos" }), el("small", { text: F.inteiro(r.total_procedimentos) })));
      for (const p of procs) box.append(item([el("span", { class: "c", text: p.codigo_mascarado }),
        el("span", { class: "t" }, el("span", { class: "n", text: p.nome }), el("small", { text: [p.instrumentos.join("; "), `R$ ${F.moeda(p.valor_total_centavos)}`].filter(Boolean).join("; ") }))], abrirFicha(p.codigo)));
    }
    const apoio = r.apoio.slice(0, 4);
    if (apoio.length) {
      box.append(el("div", { class: "sug-cab" }, el("span", { text: "Tabelas de apoio" }), el("small", { text: F.inteiro(r.apoio.length) })));
      for (const a of apoio) box.append(item([el("span", { class: "c", text: a.codigo.join(" ") }),
        el("span", { class: "t" }, el("span", { class: "n", text: a.nome }), el("small", { text: `${NOME_TABELA[a.tabela] || a.tabela}; ${a.procedimentos ? `${F.inteiro(a.procedimentos)} procedimento(s) ligados` : "nenhum procedimento ligado"}` }))], verTudo(a)));
    }
    if (unidades.length) {
      box.append(el("div", { class: "sug-cab" }, el("span", { text: "Unidades (CNES)" }), el("small", { text: F.inteiro(unidades.length) })));
      for (const u of unidades) box.append(item([el("span", { class: "c", text: u.cnes }),
        el("span", { class: "t" }, el("span", { class: "n", text: u.nome || "nome não carregado" }), el("small", { text: `${u.municipio_nome || u.municipio}, ${u.uf}` }))],
        () => { fecharSug(); ir({ tipo: "unidade", uf: u.uf, cnes: u.cnes, aba: "Procedimentos" }); }));
    }
    if (!procs.length && !apoio.length && !unidades.length) box.append(el("p", { class: "sug-nada", text: `Nada encontrado para “${texto}” em ${F.competencia(E.comp)}.` }));
    else box.append(item(el("span", { class: "sug-todos" }, `Ver todos os resultados`, el("kbd", { text: "Enter" })), verTudo(null)));
  }
  box.hidden = false; $("busca").setAttribute("aria-expanded", "true");
}
function iniciarSugestoes() {
  const inp = $("busca");
  inp.addEventListener("input", () => {
    clearTimeout(Sug.timer);
    const t = inp.value.trim();
    if (t.length < 2 || !E.comp) { Sug.seq++; fecharSug(); return; }
    Sug.timer = setTimeout(() => sugerir(t), 160);
  });
  inp.addEventListener("keydown", (ev) => {
    if ($("sugestoes").hidden) return;
    if (ev.key === "ArrowDown") { ev.preventDefault(); moverSug(1); }
    else if (ev.key === "ArrowUp") { ev.preventDefault(); moverSug(-1); }
    else if (ev.key === "Escape") { ev.preventDefault(); fecharSug(); }
    else if (ev.key === "Enter" && Sug.ativo >= 0) { ev.preventDefault(); Sug.itens[Sug.ativo].acao(); }
  });
  inp.addEventListener("focus", () => { if (inp.value.trim().length >= 2 && $("sugestoes").childElementCount) { $("sugestoes").hidden = false; inp.setAttribute("aria-expanded", "true"); } });
  document.addEventListener("pointerdown", (ev) => { if (!$("form-busca").contains(ev.target)) fecharSug(); });
}

// ---------- árvore ----------
async function abrirNo(li, no) {
  const filhos = li.querySelector("ul");
  if (filhos) { filhos.remove(); li.classList.remove("aberto"); E.abertos.delete(no.codigo); li.querySelector(".seta").textContent = "▸"; atualizarBotaoTudo(); return; }
  E.abertos.add(no.codigo);
  li.classList.add("aberto");
  li.querySelector(".seta").textContent = "▾";
  const ul = el("ul", { role: "group" });
  li.append(ul);
  await preencherArvore(ul, no.codigo);
  atualizarBotaoTudo();
}

async function preencherArvore(ul, pai) {
  let nos;
  try {
    nos = await invoke("arvore", { competencia: E.comp, pai: pai || null });
  } catch (e) { ul.append(el("li", {}, erro(e))); return; }
  const nivel = pai ? pai.length / 2 : 0;
  const folhas = [];
  for (const no of nos) {
    const folha = no.nivel === "procedimento";
    // Sem recuo: o próprio código cria a escada (04, 04.06, 04.06.01, 04.06.01.054-4).
    // O prefixo do pai fica cinza claro e o pedaço deste nível em verde escuro.
    const completo = folha ? no.codigo_mascarado : pontuar(no.codigo);
    const corte = folha ? 9 : completo.length - 2;
    const btn = el("button", {
      class: "no" + (folha ? " folha" : "") + (folha && no.codigo === E.selecionado ? " selecionado" : ""),
      type: "button", role: "treeitem", "data-codigo": no.codigo, "aria-level": String(nivel + 1),
      title: `${completo} ${no.nome || ""}`.trim(),
    },
      el("span", { class: "seta", text: folha ? "" : "▸" }),
      el("span", { class: "texto-no" },
        el("span", { class: "cod" }, el("span", { class: "pai", text: completo.slice(0, corte) }), el("span", { class: "seg", text: completo.slice(corte) })),
        " ",
        no.nome ? el("span", { class: "nome", text: folha ? capitalizar(no.nome) : no.nome })
                : el("span", { class: "nome sem-nome", text: "sem nome na tabela de estrutura" })),
    );
    btn.style.setProperty("--nivel", String(Math.min(nivel, 3)));
    const li = el("li", {}, btn);
    btn.addEventListener("click", () => folha ? ir({ tipo: "ficha", codigo: no.codigo }) : abrirNo(li, no));
    ul.append(li);
    if (folha) folhas.push(btn);
    // "Expandir tudo" abre grupos e subgrupos (a lista final de procedimentos fica fechada).
    if (!folha && (E.abertos.has(no.codigo) || (E.expandir && no.codigo.length <= 4))) { E.abertos.delete(no.codigo); await abrirNo(li, no); }
  }
  if (folhas.length) marcarHabilitacao(folhas);
}

function pontuar(c) { return (c.match(/.{2}/g) || [c]).join("."); }
function capitalizar(s) {
  // Árvore: nome oficial em caixa alta fica menos legível em lista longa; a ficha mostra o oficial.
  const t = s.toLocaleLowerCase("pt-BR");
  return t.charAt(0).toLocaleUpperCase("pt-BR") + t.slice(1);
}

async function desenharArvore() {
  if (E.arvore === "cid") return desenharArvoreCid();
  if (E.arvore === "fav") return desenharFavoritos();
  const raiz = limpar($("arvore-raiz"));
  if (!E.comp) { $("arvore-total").textContent = ""; return; }
  await preencherArvore(raiz, null);
  const total = [...raiz.querySelectorAll(":scope > li > .no")].length;
  $("arvore-total").textContent = total ? "" : "vazia";
  atualizarBotaoTudo();
}

async function revelarNaArvore(codigo) {
  if (E.arvore === "fav") { for (const b of document.querySelectorAll(".no.fav")) b.classList.toggle("selecionado", b.dataset.codigo === codigo); return; }
  if (E.arvore !== "proc") return; // quem está olhando os CIDs não perde a árvore de lugar
  for (const p of [codigo.slice(0, 2), codigo.slice(0, 4), codigo.slice(0, 6)]) E.abertos.add(p);
  await desenharArvore();
  const b = document.querySelector(`.no[data-codigo="${codigo}"]`);
  if (b) b.scrollIntoView({ block: "center" });
}

// ---------- início ----------
function telaInicio(c) {
  const pg = el("div", { class: "pagina inicio" });
  c.append(pg);
  pg.append(el("h1", { text: "Consulte a Tabela de Procedimentos do SUS" }));
  pg.append(el("p", { class: "quieto", text: "Digite na busca acima um código (com ou sem pontos), parte do nome, um CID, um CBO ou uma habilitação. Ou navegue pela árvore à esquerda." }));
  const ex = el("div", { class: "filtros" }, el("span", { class: "quieto pequeno", text: "Experimente" }));
  for (const t of ["04.06.01.057-9", "consulta medica", "I42.0", "225120", "0802"])
    ex.append(el("button", { class: "chip", type: "button", onclick: () => { $("busca").value = t; ir({ tipo: "busca", texto: t }); } }, t));
  pg.append(ex);
  const cartoes = el("div", { class: "cartoes" });
  pg.append(cartoes);
  painelFaturista(cartoes);
  const ult = E.comps[E.comps.length - 1];
  cartoes.append(el("section", { class: "bloco" },
    el("h2", { text: "Dados carregados" }),
    el("div", { class: "par" }, el("span", { class: "k", text: "Competência em uso" }), el("span", { class: "v num", text: F.competencia(E.comp) }), el("span")),
    el("div", { class: "par" }, el("span", { class: "k", text: "Competências guardadas" }), el("span", { class: "v num", text: String(E.comps.length) }),
      el("span", { class: "n", text: E.comps.length ? `${F.competencia(E.comps[0].competencia)} a ${F.competencia(ult.competencia)}` : "" })),
    el("button", { class: "link", type: "button", onclick: () => ir({ tipo: "modulos" }) }, "Ver módulos e dados")));
  const mud = el("section", { class: "bloco" }, el("h2", { text: `O que mudou em ${F.competencia(E.comp)}` }), el("span", { class: "quieto", text: "Comparando com a competência anterior…" }));
  cartoes.append(mud);
  const pos = E.comps.findIndex((x) => x.competencia === E.comp);
  if (pos > 0) {
    invoke("mudou", { de: E.comps[pos - 1].competencia, para: E.comp }).then((m) => {
      limpar(mud).append(el("h2", { text: `O que mudou em ${F.competencia(m.para)}` }));
      const proc = m.tabelas.find((t) => t.tabela === "tb_procedimento") || { incluidos: 0, excluidos: 0, alterados: 0 };
      const outros = m.tabelas.filter((t) => t.tabela !== "tb_procedimento").reduce((s, t) => s + t.incluidos + t.excluidos + t.alterados, 0);
      for (const [k, n] of [["Procedimentos incluídos", proc.incluidos], ["Procedimentos alterados", proc.alterados], ["Procedimentos excluídos", proc.excluidos], ["Vínculos e tabelas de apoio", outros]])
        mud.append(el("div", { class: "par" }, el("span", { class: "k", text: k }), el("span", { class: "v num", text: F.inteiro(n) }), el("span")));
      mud.append(el("button", { class: "link", type: "button", onclick: () => ir({ tipo: "mudou" }) }, `Ver o que mudou de ${F.competencia(m.de)} para ${F.competencia(m.para)}`));
    }).catch((e) => limpar(mud).append(erro(e)));
  } else {
    limpar(mud).append(el("h2", { text: "O que mudou" }), el("p", { class: "quieto", text: "Só há uma competência carregada. Baixe o histórico em Módulos e dados para comparar." }));
  }
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
    el("span", { class: "quieto", text: `em ${F.competencia(r.competencia)}` }),
    el("div", { class: "espaco" }),
    r.procedimentos.length ? botaoExportar("Exportar", async () => [`SIGTAP busca ${r.consulta}`, `Busca por "${r.consulta}", competência ${F.competencia(r.competencia)}`,
      [{ nome: "Procedimentos", colunas: ["Código", "Nome", "Instrumentos", "Complexidade", "Valor total (R$)"],
        linhas: r.procedimentos.map((p) => [p.codigo, p.nome, p.instrumentos.join("; "), p.complexidade || p.tp_complexidade, p.valor_total_centavos / 100]) }]]) : null));
  if (r.procedimentos.length) {
    const instr = {};
    for (const p of r.procedimentos) for (const i of p.instrumentos) instr[i] = (instr[i] || 0) + 1;
    let filtro = null;
    const filtros = el("div", { class: "filtros" }, el("span", { class: "quieto pequeno", text: "Instrumento" }));
    const corpo = el("tbody");
    const desenharLinhas = () => {
      limpar(corpo);
      // Agrupado pela forma de organização, na ordem do código.
      let forma = null;
      const lista = r.procedimentos.filter((p) => !filtro || p.instrumentos.includes(filtro));
      const porForma = {};
      for (const p of lista) porForma[p.forma] = (porForma[p.forma] || 0) + 1;
      for (const p of lista) {
        if (p.forma !== forma) {
          forma = p.forma;
          corpo.append(el("tr", { class: "grupo" }, el("td", { colspan: "5" },
            el("span", { class: "mono", text: pontuar(p.forma) }), " ", p.forma_nome || "forma sem nome na tabela de estrutura",
            el("small", { text: ` ${porForma[p.forma]}` }))));
        }
        corpo.append(el("tr", { class: "clicavel", tabindex: "0", onclick: () => ir({ tipo: "ficha", codigo: p.codigo }),
          onkeydown: (ev) => { if (ev.key === "Enter") ir({ tipo: "ficha", codigo: p.codigo }); } },
          el("td", { class: "cod", text: p.codigo_mascarado }),
          el("td", { text: p.nome }),
          el("td", { class: "instr", text: p.instrumentos.join("; ") || "—" }),
          el("td", { class: "curta", text: p.complexidade || p.tp_complexidade }),
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
        el("td", { class: "curta", text: NOME_TABELA[a.tabela] || a.tabela }),
        el("td", { class: "cod", text: a.codigo.join(" ") }),
        el("td", { text: a.nome }),
        el("td", { class: "num", text: a.procedimentos ? `${F.inteiro(a.procedimentos)} procedimento(s)` : "nenhum procedimento" })));
    }
    pg.append(el("table", { class: "tabela" }, el("thead", {}, el("tr", {}, ["Tabela", "Código", "Nome", "Ligados"].map((h, i) => el("th", { class: i === 3 ? "num" : null, text: h })))), t));
  }
  let unidades = [];
  if (texto.length >= 3 && E.cnes && E.cnes.ufs.length) { try { unidades = await invoke("unidades_buscar", { texto }); } catch { /* sem unidades */ } }
  if (unidades.length) {
    pg.append(el("h2", { text: "Unidades (CNES)" }), el("table", { class: "tabela" },
      el("thead", {}, el("tr", {}, ["CNES", "Estabelecimento", "Município"].map((h) => el("th", { text: h })))),
      el("tbody", {}, unidades.map((u) => el("tr", { class: "clicavel", tabindex: "0", onclick: () => ir({ tipo: "unidade", uf: u.uf, cnes: u.cnes, aba: "Procedimentos" }),
        onkeydown: (ev) => { if (ev.key === "Enter") ir({ tipo: "unidade", uf: u.uf, cnes: u.cnes, aba: "Procedimentos" }); } },
        el("td", { class: "cod", text: u.cnes }), el("td", { text: u.nome || "nome não carregado" }), el("td", { text: `${u.municipio_nome || u.municipio}, ${u.uf}` }))))));
  }
  if (!r.procedimentos.length && !r.apoio.length && !unidades.length)
    pg.append(el("p", { class: "quieto", text: "Nada encontrado. Confira a grafia, tente parte do nome ou o código com ou sem pontos." }));
  const ligar = E.rota.ligar && r.apoio.find((a) => a.tabela === E.rota.ligar.tabela && a.codigo.join() === E.rota.ligar.codigo.join());
  if (ligar && ligar.procedimentos) await ligados(pg, ligar);
}

async function ligados(pg, a) {
  const lista = await invoke("ligados", { competencia: E.comp, tabela: a.tabela, codigo: a.codigo });
  const sec = el("section", { class: "bloco" }, el("div", { class: "cab-linha" },
    el("h2", { text: `${NOME_TABELA[a.tabela] || a.tabela} ${a.codigo.join(" ")}: ${a.nome}` }),
    el("small", { text: `${lista.length} procedimento(s) ligados em ${F.competencia(E.comp)}` })));
  const t = el("tbody");
  for (const p of lista) t.append(el("tr", { class: "clicavel", onclick: () => ir({ tipo: "ficha", codigo: p.codigo }) },
    el("td", { class: "cod", text: p.codigo_mascarado }), el("td", { text: p.nome }),
    el("td", { class: "curta", text: p.instrumentos.join("; ") }), el("td", { class: "num", text: F.moeda(p.valor_total_centavos) })));
  sec.append(el("table", { class: "tabela" }, t));
  // Um único bloco de "ligados" por tela: clicar de novo substitui, não acrescenta.
  pg.querySelectorAll("section.ligados").forEach((s) => s.remove());
  sec.classList.add("ligados");
  pg.append(sec);
  sec.scrollIntoView({ block: "start" });
}

// ---------- ficha ----------
function campoDe(linha, coluna) { return linha && linha.campos.find((c) => c.coluna === coluna); }
function nomesDe(linha, coluna) {
  // Nome do código: referência cuja última coluna é esta.
  return linha ? linha.nomes.filter((n) => n.colunas[n.colunas.length - 1] === coluna) : [];
}
function textoNome(n) {
  if (!n.tabela_presente) return { falta: `${NOME_TABELA[n.tabela] || n.tabela} não veio no ZIP desta competência` };
  if (!n.encontrados.length) return { falta: "sem nome nesta competência" };
  // Nome curto primeiro (no_*); descrições longas (ds_*) só no "Texto oficial".
  const curto = (m) => { const ks = Object.keys(m).sort((a, b) => (b.startsWith("no_") - a.startsWith("no_"))); const k = ks.find((x) => m[x]); return k ? m[k] : ""; };
  return { texto: n.encontrados.map(curto).join(" / ") };
}
function nomeDe(linha, coluna) { const n = nomesDe(linha, coluna)[0]; return n ? (textoNome(n).texto || textoNome(n).falta) : ""; }

// Grupos de abas (ordem de uso do faturista). Tabela nova, sem grupo, cai em "Relações".
const GRUPOS_ABA = [
  ["Exigências para cobrar", ["rl_procedimento_registro.co_procedimento", "rl_procedimento_cid.co_procedimento", "rl_procedimento_ocupacao.co_procedimento",
    "rl_procedimento_habilitacao.co_procedimento", "rl_procedimento_servico.co_procedimento", "rl_procedimento_leito.co_procedimento",
    "rl_procedimento_modalidade.co_procedimento"]],
  ["Valores e regras", ["rl_procedimento_incremento.co_procedimento", "rl_procedimento_regra_cond.co_procedimento", "rl_procedimento_detalhe.co_procedimento"]],
  ["Relações", ["rl_procedimento_compativel.co_procedimento_principal", "rl_procedimento_compativel.co_procedimento_compativel",
    "rl_excecao_compatibilidade.co_procedimento_principal", "rl_excecao_compatibilidade.co_procedimento_compativel",
    "rl_excecao_compatibilidade.co_procedimento_restricao", "rl_procedimento_origem.co_procedimento", "rl_procedimento_origem.co_procedimento_origem",
    "rl_procedimento_sia_sih.co_procedimento", "rl_procedimento_renases.co_procedimento", "rl_procedimento_tuss.co_procedimento",
    "rl_procedimento_comp_rede.co_procedimento"]],
];
const chaveRel = (r) => `${r.tabela}.${r.coluna}`;
const nomeRel = (r) => NOME_RELACAO[chaveRel(r)] || `${r.tabela} (${r.coluna})`;

async function telaFicha(c, codigo, aba) {
  c.append(carregando());
  const f = await invoke("ficha", { competencia: E.comp, codigo });
  limpar(c);
  if (!f) {
    c.append(el("div", { class: "vazio" },
      el("h1", { text: `${F.mascara(codigo)} não existe em ${F.competencia(E.comp)}` }),
      el("p", { text: "Ele pode ter sido incluído depois ou excluído antes desta competência. Troque a competência no alto ou veja o histórico abaixo." })));
    const corpo = el("div"); c.append(corpo);
    await abaHistorico(corpo, codigo);
    return;
  }
  if (E.selecionado !== codigo) { E.selecionado = codigo; revelarNaArvore(codigo); }
  const p = f.procedimento[0];
  const rel = (t, col) => f.relacoes.find((r) => r.tabela === t && r.coluna === (col || "co_procedimento"));
  const topo = el("div", { class: "ficha-topo" });
  c.append(topo);
  topo.append(el("div", { class: "trilha" }, f.estrutura.map((n, i) => [i ? " / " : "",
    el("button", { type: "button", onclick: () => { E.abertos.add(n.codigo); revelarNaArvore(codigo); } },
      `${n.codigo.slice(-2)} ${n.nome || "sem nome na tabela de estrutura"}`)])));
  const partes = [[codigo.slice(0, 2), "grupo"], [codigo.slice(2, 4), "subgrupo"], [codigo.slice(4, 6), "forma"], [codigo.slice(6, 9), "procedimento"], [codigo.slice(9), "dígito"]];
  const caixas = el("button", { class: "caixas", type: "button", title: "Clique: copia sem pontos. Ctrl+clique: copia com pontos.",
    "aria-label": `Copiar o código ${codigo}; com Ctrl, com pontos`,
    onclick: (ev) => { const comPontos = ev.ctrlKey || ev.metaKey; copiar(comPontos ? F.mascara(codigo) : codigo, ev.currentTarget, comPontos ? "copiado com pontos" : "copiado sem pontos"); } },
    partes.map(([v, l]) => el("span", { class: "caixa" }, el("b", { text: v }), l)),
    el("span", { class: "copiado", role: "status", text: "" }));
  const nome = campoDe(p, "no_procedimento").valor;
  topo.append(el("div", { class: "linha-cod" }, caixas,
    el("h1", { class: "nome-proc" }, el("button", { class: "copiar-nome", type: "button", title: "Clique para copiar o nome completo",
      onclick: (ev) => copiar(nome, ev.currentTarget, "nome copiado") }, nome, el("span", { class: "copiado", role: "status", text: "" })))));
  // Faixa com o que o faturista confere primeiro.
  const sh = campoDe(p, "vl_sh"), sa = campoDe(p, "vl_sa"), sp = campoDe(p, "vl_sp");
  const total = (sh?.valor || 0) + (sa?.valor || 0) + (sp?.valor || 0);
  const instr = (rel("rl_procedimento_registro")?.linhas || []).map((l) => nomeDe(l, "co_registro")).filter(Boolean);
  const modal = (rel("rl_procedimento_modalidade")?.linhas || []).map((l) => nomeDe(l, "co_modalidade")).filter(Boolean);
  const chave = el("dl", { class: "chave" },
    el("div", {}, el("dt", { text: "Valor total" }), el("dd", { class: "valor", text: `R$ ${F.moeda(total)}` })),
    el("div", {}, el("dt", { text: "Instrumento" }), el("dd", { text: instr.join("; ") || "—" })),
    el("div", {}, el("dt", { text: "Complexidade" }), el("dd", { text: F.campo(campoDe(p, "tp_complexidade")) })),
    el("div", {}, el("dt", { text: "Modalidade" }), el("dd", { text: modal.join("; ") || "—" })),
    el("div", {}, el("dt", { text: "Financiamento" }), el("dd", { text: nomeDe(p, "co_financiamento") || campoDe(p, "co_financiamento")?.valor || "—" })));
  if (f.procedimento.length > 1) chave.append(el("div", {}, el("dt", { text: "Atenção" }), el("dd", { class: "ambar", text: `${f.procedimento.length} linhas para este código no arquivo oficial` })));
  topo.append(chave);
  marcasDaFicha(topo, codigo);
  // Abas agrupadas; as vazias ficam escondidas atrás de um botão.
  const abas = el("div", { class: "abas", role: "tablist" });
  const aba_ = (nome, r) => el("button", {
    class: "aba" + (r && !r.linhas.length ? " vazia" : ""), role: "tab", type: "button",
    "aria-selected": String(nome === aba), onclick: () => ir({ tipo: "ficha", codigo, aba: nome }),
  }, nome, r ? el("small", { text: String(r.linhas.length) }) : null);
  abas.append(el("div", { class: "grupo-abas" }, aba_("Resumo"), aba_("Histórico")));
  const usadas = new Set();
  const vazias = [];
  const grupos = GRUPOS_ABA.map(([g, chaves]) => [g, chaves.map((k) => f.relacoes.find((r) => chaveRel(r) === k)).filter(Boolean)]);
  const semGrupo = f.relacoes.filter((r) => r.tabela !== "tb_descricao" && !GRUPOS_ABA.some(([, ks]) => ks.includes(chaveRel(r))));
  grupos[2][1].push(...semGrupo);
  let abaVazia = false;
  for (const [g, rs] of grupos) {
    const cheias = rs.filter((r) => r.linhas.length);
    for (const r of rs) { usadas.add(nomeRel(r)); if (!r.linhas.length) { vazias.push(r); if (nomeRel(r) === aba) abaVazia = true; } }
    if (cheias.length) abas.append(el("div", { class: "grupo-abas" }, el("span", { class: "rotulo-grupo", text: g }), cheias.map((r) => aba_(nomeRel(r), r))));
  }
  if (vazias.length) {
    const box = el("div", { class: "grupo-abas", hidden: !abaVazia }, el("span", { class: "rotulo-grupo", text: "Sem linhas nesta competência" }), vazias.map((r) => aba_(nomeRel(r), r)));
    abas.append(el("button", { class: "link pequeno mais-abas", type: "button", onclick: (ev) => { box.hidden = !box.hidden; ev.currentTarget.textContent = box.hidden ? `+ ${vazias.length} vazias` : "esconder vazias"; } }, abaVazia ? "esconder vazias" : `+ ${vazias.length} vazias`), box);
  }
  topo.append(abas);
  const corpo = el("div");
  c.append(corpo);
  if (aba === "Resumo") resumo(corpo, f, p, rel, codigo);
  else if (aba === "Histórico") await abaHistorico(corpo, codigo);
  else {
    const r = f.relacoes.find((x) => nomeRel(x) === aba);
    if (r) tabelaRelacao(corpo, r);
  }
}

async function copiar(texto, botao, rotulo) {
  const aviso = botao.querySelector(".copiado");
  try { await navigator.clipboard.writeText(texto); aviso.textContent = `${rotulo || "copiado"}: ${texto.length > 40 ? texto.slice(0, 40) + "…" : texto}`; }
  catch { aviso.textContent = "não foi possível copiar; selecione o texto e use Ctrl+C"; }
  clearTimeout(botao._t);
  botao._t = setTimeout(() => { aviso.textContent = ""; }, 1800);
}

function par(k, campo, extra) {
  return el("div", { class: "par" },
    el("span", { class: "k", text: k }),
    el("span", { class: "v" + (campo && campo.unidade === "centavos" ? " num" : ""), text: campo ? F.campo(campo) : "—" }),
    el("span", { class: "n", text: extra || (campo ? F.notaOficial(campo) : "") }));
}

/** Linha da conferência: rótulo, resumo e atalho para a aba. */
function conf(k, valor, nota, irPara, codigo) {
  return el("div", { class: "par conf" },
    el("span", { class: "k", text: k }),
    el("span", { class: "v", text: valor }),
    el("span", { class: "n" }, nota || "", irPara ? el("button", { class: "link pequeno", type: "button", onclick: () => ir({ tipo: "ficha", codigo, aba: irPara }) }, " ver") : null));
}

function listaCurta(r, col, max) {
  if (!r || !r.linhas.length) return "nenhum";
  // Códigos distintos (a habilitação, por exemplo, repete o código em grupos diferentes).
  const vistos = new Map();
  for (const l of r.linhas) { const c = campoDe(l, col).valor; if (!vistos.has(c)) vistos.set(c, `${c} ${nomeDe(l, col)}`.trim()); }
  const itens = [...vistos.values()];
  return itens.slice(0, max).join("; ") + (itens.length > max ? `; e mais ${itens.length - max}` : "");
}

function resumo(corpo, f, p, rel, codigo) {
  // Descrição oficial no topo do resumo, recolhida em uma linha (economiza altura em 1366×768).
  const desc = rel("tb_descricao");
  if (desc && desc.linhas.length) {
    const d = el("p", { class: "descricao recolhida", text: campoDe(desc.linhas[0], "ds_procedimento").valor });
    const b = el("button", { class: "link pequeno", type: "button", onclick: () => { d.classList.toggle("recolhida"); b.textContent = d.classList.contains("recolhida") ? "mostrar inteira" : "recolher"; } }, "mostrar inteira");
    corpo.append(el("div", { class: "desc-bloco" }, el("span", { class: "rotulo", text: "Descrição oficial" }), d, b));
  }
  corpo.append(el("div", { class: "apt-secao" }, blocoAptidao(codigo)));
  corpo.append(el("div", { class: "apt-secao" }, blocoProducao(codigo)));
  corpo.append(el("div", { class: "apt-secao" }, blocoFaturamentoProcedimento(codigo, false)));
  const cols = el("div", { class: "colunas" });
  corpo.append(cols);
  const A = el("div", { class: "coluna" }), B = el("div", { class: "coluna" });
  cols.append(A, B);
  const v = (c) => campoDe(p, c);
  // Coluna A: o que precisa estar certo para cobrar.
  const im = v("vl_idade_minima"), ix = v("vl_idade_maxima");
  const idade = im && ix ? (im.sentinela || ix.sentinela ? "Não se aplica" : `${F.idade(im.valor)} a ${F.idade(ix.valor)}`) : "—";
  const cid = rel("rl_procedimento_cid");
  const princ = cid ? cid.linhas.filter((l) => campoDe(l, "st_principal")?.valor === "S").length : 0;
  const hab = rel("rl_procedimento_habilitacao");
  const gruposHab = hab ? new Set(hab.linhas.map((l) => campoDe(l, "nu_grupo_habilitacao")?.valor).filter(Boolean)).size : 0;
  const serv = rel("rl_procedimento_servico");
  const n = (r) => (r ? r.linhas.length : 0);
  A.append(el("section", { class: "bloco destaque" },
    el("div", { class: "cab-linha" }, el("h2", { text: "Para cobrar" }), el("small", { text: "o que o registro precisa respeitar" })),
    par("Sexo", v("tp_sexo")),
    el("div", { class: "par" }, el("span", { class: "k", text: "Idade" }), el("span", { class: "v", text: idade }),
      el("span", { class: "n", text: im && ix ? `${im.valor} a ${ix.valor} meses no arquivo oficial` : "" })),
    par("Quantidade máxima", v("qt_maxima_execucao")),
    par("Permanência (dias)", v("qt_dias_permanencia")),
    v("qt_tempo_permanencia") ? par("Tempo de permanência", v("qt_tempo_permanencia")) : null,
    par("Pontos", v("qt_pontos")),
    conf("CID", n(cid) ? `${n(cid)} aceito(s)` : "sem exigência de CID", n(cid) ? `${princ} como principal. ${listaCurta(cid, "co_cid", 3)}` : "", n(cid) ? "CID" : null, codigo),
    conf("CBO", n(rel("rl_procedimento_ocupacao")) ? `${n(rel("rl_procedimento_ocupacao"))} ocupação(ões)` : "sem exigência de CBO", listaCurta(rel("rl_procedimento_ocupacao"), "co_ocupacao", 3), n(rel("rl_procedimento_ocupacao")) ? "CBO" : null, codigo),
    conf("Habilitação", n(hab) ? `${n(hab)} vínculo(s)` : "sem exigência", n(hab) ? `${gruposHab ? `${gruposHab} grupo(s); ` : ""}${listaCurta(hab, "co_habilitacao", 3)}` : "", n(hab) ? "Habilitação" : null, codigo),
    conf("Serviço/classificação", n(serv) ? `${n(serv)} combinação(ões)` : "sem exigência", n(serv) ? serv.linhas.slice(0, 3).map((l) => `${campoDe(l, "co_servico").valor}/${campoDe(l, "co_classificacao").valor} ${nomeDe(l, "co_classificacao")}`).join("; ") : "", n(serv) ? "Serviço" : null, codigo),
    conf("Leito", n(rel("rl_procedimento_leito")) ? listaCurta(rel("rl_procedimento_leito"), "co_tipo_leito", 4) : "sem exigência", "", null, codigo)));
  // Coluna B: valores e regras.
  const sh = v("vl_sh"), sa = v("vl_sa"), sp = v("vl_sp");
  B.append(el("section", { class: "bloco" },
    el("div", { class: "cab-linha" }, el("h2", { text: "Valores" }), el("small", { text: "em reais; no arquivo oficial, em centavos" })),
    par("Serviço hospitalar (SH)", sh), par("Serviço profissional (SP)", sp), par("Serviço ambulatorial (SA)", sa),
    el("div", { class: "par total" }, el("span", { class: "k", text: "Total" }), el("span", { class: "v num", text: F.moeda((sh?.valor || 0) + (sa?.valor || 0) + (sp?.valor || 0)) }), el("span", { class: "n", text: "SH + SA + SP" })),
    el("div", { class: "par" }, el("span", { class: "k", text: "Financiamento" }), el("span", { class: "v", text: nomeDe(p, "co_financiamento") || "—" }), el("span", { class: "n", text: `código ${v("co_financiamento")?.valor || "—"}` })),
    el("div", { class: "par" }, el("span", { class: "k", text: "Rubrica" }), el("span", { class: "v", text: v("co_rubrica")?.valor ? (nomeDe(p, "co_rubrica") || v("co_rubrica").valor) : "sem rubrica" }), el("span", { class: "n", text: v("co_rubrica")?.valor ? `código ${v("co_rubrica").valor}` : "" }))));
  const blocoItens = (titulo, r, col, extra) => {
    const b = el("section", { class: "bloco" }, el("div", { class: "cab-linha" }, el("h2", { text: titulo }), el("small", { text: String(r ? r.linhas.length : 0) })));
    if (!r || !r.linhas.length) { b.append(el("span", { class: "quieto", text: "Nenhum nesta competência." })); return b; }
    for (const l of r.linhas) {
      const ns = nomesDe(l, col).map(textoNome);
      const detalhes = ns.slice(1).filter((x) => x.texto);
      b.append(el("div", { class: "item" }, el("span", { class: "c", text: campoDe(l, col)?.valor }),
        el("span", { text: ns[0]?.texto || ns[0]?.falta || "" }), el("span", { class: "x", text: extra ? extra(l) : "" }),
        detalhes.length ? el("details", { class: "d" }, el("summary", { text: "Texto oficial" }), detalhes.map((x) => el("p", { text: x.texto }))) : null));
    }
    return b;
  };
  B.append(blocoItens("Incremento por habilitação", rel("rl_procedimento_incremento"), "co_habilitacao", (l) =>
    ["vl_percentual_sh", "vl_percentual_sa", "vl_percentual_sp"].map((k) => [{ sh: "serviço hospitalar", sa: "serviço ambulatorial", sp: "serviço profissional" }[k.slice(-2)], campoDe(l, k)?.valor || 0])
      .filter(([, x]) => x).map(([k, x]) => `+${F.percentual(x)} no ${k}`).join("; ")));
  B.append(blocoItens("Regras condicionadas", rel("rl_procedimento_regra_cond"), "co_regra_condicionada"));
  B.append(blocoItens("Atributos complementares", rel("rl_procedimento_detalhe"), "co_detalhe"));
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
  const linhas = [];
  for (const l of r.linhas) {
    const tr = el("tr");
    const textos = [];
    for (const c0 of cols) {
      const c = campoDe(l, c0.coluna);
      const ns = nomesDe(l, c0.coluna).map(textoNome);
      const ehCod = /^(co_|nu_)/.test(c.coluna);
      const ehProc = /^co_procedimento/.test(c.coluna) && /^\d{10}$/.test(c.valor);
      const principal = ns[0];
      const td = el("td", { class: ehCod ? "codnome" : null },
        ehProc ? el("button", { class: "link mono", type: "button", onclick: () => ir({ tipo: "ficha", codigo: c.valor }) }, F.mascara(c.valor))
               : el("span", { class: ehCod ? "mono" : null, text: F.campo(c) }),
        principal ? (principal.texto ? el("span", { class: "nome", text: principal.texto }) : el("span", { class: "falta", text: principal.falta })) : null,
        c.situacao && c.situacao !== "oficial" ? el("span", { class: "falta", text: F.notaOficial(c) }) : null,
        ns.slice(1).filter((x) => x.texto).length ? el("details", {}, el("summary", { text: "Texto oficial" }), ns.slice(1).filter((x) => x.texto).map((x) => el("p", { text: x.texto }))) : null);
      textos.push(td.textContent);
      tr.append(td);
    }
    if (temQtd) tr.append(el("td", { class: "num", text: String(l.quantidade) }));
    corpoT.append(tr);
    linhas.push([tr, textos.join(" ").toLocaleLowerCase("pt-BR").normalize("NFD").replace(/[̀-ͯ]/g, "")]);
  }
  if (r.linhas.length > 12) {
    const conta = el("span", { class: "quieto pequeno", text: `${r.linhas.length} linha(s)` });
    const filtro = el("input", { type: "search", class: "campo", placeholder: "Filtrar por código ou nome", "aria-label": "Filtrar linhas",
      oninput: (ev) => {
        const q = ev.target.value.toLocaleLowerCase("pt-BR").normalize("NFD").replace(/[̀-ͯ]/g, "").trim();
        let n = 0;
        for (const [tr, t] of linhas) { const ok = !q || t.includes(q); tr.hidden = !ok; if (ok) n++; }
        conta.textContent = q ? `${n} de ${r.linhas.length} linha(s)` : `${r.linhas.length} linha(s)`;
      } });
    sec.append(el("div", { class: "filtros" }, filtro, conta));
  }
  sec.append(el("table", { class: "tabela" },
    el("thead", {}, el("tr", {}, cols.map((c) => el("th", { text: nomeColuna(c) })), temQtd ? el("th", { text: "Repetições no arquivo" }) : null)),
    corpoT));
  sec.append(el("div", { class: "filtros" },
    el("span", { class: "quieto pequeno", text: `Tabela oficial ${r.tabela.toUpperCase()}: ${r.linhas.length} linha(s) em ${F.competencia(E.comp)}.` }),
    el("div", { class: "espaco" }),
    botaoExportar("Exportar esta tabela", async () => [`SIGTAP ${E.selecionado} ${nomeRel(r)}`, `${nomeRel(r)} de ${F.mascara(E.selecionado)}, competência ${F.competencia(E.comp)}`, [abaDaRelacao(r)]])));
}

// ---------- histórico ----------
function resumoLinha(l, ignorar) {
  if (!l) return "";
  const partes = [];
  for (const c of l.campos) {
    if (c.coluna === ignorar || c.coluna === "dt_competencia" || c.coluna === "co_procedimento") continue;
    if (!/^(co_|nu_|tp_|st_)/.test(c.coluna)) continue;
    if (c.valor === "" || c.valor === null) continue;
    const n = nomesDe(l, c.coluna).map(textoNome).find((x) => x.texto);
    partes.push(`${c.valor}${n ? " " + n.texto : (c.situacao === "oficial" ? " " + c.descricao : "")}`);
  }
  return partes.join(", ");
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
  const anos = el("div", { class: "anos" });
  let anoVisto = null;
  E.comps.forEach((c, i) => {
    const marca = el("i", { class: com.has(c.competencia) ? "m" : null, title: `${F.competencia(c.competencia)}${qtd[c.competencia] ? `: ${qtd[c.competencia]} mudança(s)` : ""}` });
    if (qtd[c.competencia]) marca.style.height = `${Math.min(10 + qtd[c.competencia] * 5, 40)}px`;
    if (com.has(c.competencia)) marca.addEventListener("click", () => {
      const alvo = document.getElementById(`ev-${c.competencia}`);
      if (!alvo) return;
      alvo.scrollIntoView({ block: "center" });
      alvo.classList.remove("piscar"); void alvo.offsetWidth; // reinicia a animação
      alvo.classList.add("piscar");
    });
    faixa.append(marca);
    const ano = c.competencia.slice(0, 4);
    if (ano !== anoVisto && Number(ano) % 2 === 0) { const s = el("span", { text: ano }); s.style.left = `${(100 * i) / E.comps.length}%`; anos.append(s); }
    anoVisto = ano;
  });
  sec.append(el("section", { class: "bloco" },
    el("div", { class: "cab-linha" }, el("h2", { text: `${com.size} competência(s) com mudança entre ${F.competencia(h.primeira_carregada)} e ${F.competencia(h.ultima_carregada)}` }),
      el("small", { text: `${h.competencias_carregadas} competência(s) carregadas; clique numa barra para ir ao mês` })),
    faixa, anos,
    h.competencias_carregadas < 2 ? el("p", { class: "aviso", text: "Só uma competência carregada: baixe o histórico completo em Módulos e dados para ver as mudanças." }) : null));
  if (ufDaProducao()) sec.append(blocoFaturamentoProcedimento(codigo, true));
  const lista = el("section", { class: "bloco lista-eventos" });
  // Agrupa por competência e, dentro dela, inclusões/exclusões da mesma tabela numa linha só.
  const porComp = new Map();
  for (const e of h.eventos) { if (!porComp.has(e.competencia)) porComp.set(e.competencia, []); porComp.get(e.competencia).push(e); }
  for (const [comp, evs] of porComp) {
    const grupo = el("div", { class: "eventos" });
    lista.append(el("div", { class: "evento", id: `ev-${comp}` }, el("span", { class: "mono", text: evs[0].rotulo }), grupo));
    const juntos = new Map();
    for (const e of evs) {
      if (e.tipo === "alterado") {
        const desc = el("span", {}, e.campos_alterados.map((col) => {
          const a = e.antes && campoDe(e.antes, col), d = e.depois && campoDe(e.depois, col);
          return el("span", { class: "mud-campo" }, `${NOME_COLUNA[col] || col}: `,
            el("span", { class: "antes", text: a ? F.campo(a) || "vazio" : "campo ausente" }), " → ",
            el("span", { class: "depois", text: d ? F.campo(d) || "vazio" : "campo ausente" }));
        }));
        const k = resumoLinha(e.depois, e.coluna);
        grupo.append(linhaEvento("alterado", NOME_TABELA[e.tabela] || e.tabela, [e.tabela !== "tb_procedimento" && k ? el("span", { class: "quieto", text: `${k}: ` }) : null, desc], e));
      } else {
        const chave = `${e.tipo}|${e.tabela}|${e.tabela_ausente}|${e.tabela_voltou}`;
        if (!juntos.has(chave)) juntos.set(chave, { e, itens: [] });
        juntos.get(chave).itens.push(resumoLinha(e.antes || e.depois, e.coluna));
      }
    }
    for (const { e, itens } of juntos.values())
      grupo.append(linhaEvento(e.tipo, NOME_TABELA[e.tabela] || e.tabela, el("span", {}, itens.filter(Boolean).map((t) => el("span", { class: "item-ev", text: t }))), e));
  }
  if (!h.eventos.length) lista.append(el("p", { class: "quieto", text: "Nenhuma mudança nas competências carregadas." }));
  sec.append(lista);
}

function linhaEvento(tipo, nomeT, desc, e) {
  const nota = e.tabela_ausente ? " (a tabela não veio no ZIP desta competência)" : e.tabela_voltou ? " (a tabela voltou a vir no ZIP)" : "";
  return el("div", { class: "mud" },
    el("span", { class: `tag ${tipo}`, text: { incluido: "incluído", excluido: "excluído", alterado: "alterado" }[tipo] }),
    el("span", { class: "tabela-ev", text: nomeT }),
    el("span", {}, desc, nota ? el("span", { class: "quieto", text: nota }) : null));
}

// ---------- o que mudou ----------
async function telaMudou(c) {
  c.append(carregando("Comparando competências…"));
  const pos = E.comps.findIndex((x) => x.competencia === E.comp);
  const de = E.rota.de || (pos > 0 ? E.comps[pos - 1].competencia : null);
  if (!de) {
    limpar(c).append(el("div", { class: "vazio" }, botaoVoltar(), el("h1", { text: "Não há competência anterior carregada" }),
      el("p", { text: "Para comparar, baixe o histórico (ou a competência anterior) em Módulos e dados." }),
      el("button", { class: "botao", type: "button", onclick: () => ir({ tipo: "modulos" }) }, "Ir para Módulos e dados")));
    return;
  }
  const m = await invoke("mudou", { de, para: E.comp });
  limpar(c);
  const pg = el("div", { class: "pagina" });
  c.append(pg);
  const sel = el("select", { "aria-label": "Comparar com", onchange: (ev) => ir({ tipo: "mudou", de: ev.target.value }, { substituir: true }) },
    E.comps.filter((x) => x.competencia < E.comp).reverse().map((x) => el("option", { value: x.competencia, selected: x.competencia === m.de }, F.competencia(x.competencia))));
  pg.append(botaoVoltar(), el("div", { class: "cab-linha" }, el("h1", { text: `O que mudou em ${F.competencia(m.para)}` }),
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
  await secaoImpactoMudancas(pg, m);
  for (const t of [proc, ...rl, ...tb].filter(Boolean)) {
    const b = el("section", { class: "bloco" }, el("div", { class: "cab-linha" },
      el("h2", { text: NOME_TABELA[t.tabela] || t.tabela }),
      el("small", { text: [t.incluidos && `${F.inteiro(t.incluidos)} incluído(s)`, t.alterados && `${F.inteiro(t.alterados)} alterado(s)`, t.excluidos && `${F.inteiro(t.excluidos)} excluído(s)`].filter(Boolean).join(", ") })));
    if (!t.presente_antes) b.append(el("p", { class: "aviso", text: "Esta tabela não veio no ZIP da competência anterior." }));
    if (!t.presente_depois) b.append(el("p", { class: "aviso", text: "Esta tabela não veio no ZIP desta competência." }));
    // Primeiro 25; "ver mais" mostra mais 100 de cada vez, pedindo ao programa os que não vieram.
    const lista = el("div", { class: "lista-mud" });
    const mais = el("button", { class: "botao mais", type: "button" });
    b.append(lista, mais);
    let mostrados = 0;
    const total = t.incluidos + t.excluidos + t.alterados;
    const atualizarMais = () => {
      const resto = total - mostrados;
      mais.hidden = resto <= 0;
      mais.textContent = `Ver mais ${F.inteiro(Math.min(100, resto))} (faltam ${F.inteiro(resto)})`;
    };
    const mostrar = (n) => {
      for (const i of t.itens.slice(mostrados, mostrados + n)) lista.append(linhaMudanca(t, i));
      mostrados = Math.min(t.itens.length, mostrados + n);
      atualizarMais();
    };
    mais.addEventListener("click", async () => {
      if (mostrados + 100 > t.itens.length && t.itens_omitidos > 0) {
        mais.disabled = true; mais.textContent = "Carregando…";
        try {
          const r = await invoke("mudou", { de: m.de, para: m.para, tabela: t.tabela, desde: t.itens.length });
          const nt = r && r.tabelas ? r.tabelas[0] : r; if (nt) { t.itens.push(...nt.itens); t.itens_omitidos = nt.itens_omitidos; }
        } catch (e) { b.append(erro(e)); }
        mais.disabled = false;
      }
      mostrar(100);
    });
    mostrar(25);
    pg.append(b);
  }
}

function linhaMudanca(t, i) {
  const l = i.depois || i.antes;
  const codProc = l && campoDe(l, "co_procedimento")?.valor;
  const desc = i.tipo === "alterado"
    ? i.campos_alterados.map((col) => `${NOME_COLUNA[col] || col}: ${F.campo(campoDe(i.antes, col)) || "vazio"} → ${F.campo(campoDe(i.depois, col)) || "vazio"}`).join("; ")
    : resumoLinha(l, "co_procedimento") || Object.values(i.chave).join(" ");
  return el("div", { class: "mud" },
    el("span", { class: `tag ${i.tipo}`, text: { incluido: "incluído", excluido: "excluído", alterado: "alterado" }[i.tipo] }),
    codProc ? el("button", { class: "link mono", type: "button", onclick: () => ir({ tipo: "ficha", codigo: codProc }) }, F.mascara(codProc)) : el("span", { class: "mono", text: Object.values(i.chave).join(" ") }),
    el("span", { text: (t.tabela === "tb_procedimento" && campoDe(l, "no_procedimento") ? campoDe(l, "no_procedimento").valor + ": " : "") + desc }));
}

// ---------- módulos e dados ----------
function telaModulos(c) {
  const s = E.situacao || {};
  const pg = el("div", { class: "pagina modulos" });
  c.append(pg);
  const ABAS_MOD = ["Dados", "Baixar e importar", "Atualizações", "Armazenamento"];
  const aba = ABAS_MOD.includes(E.rota.aba) ? E.rota.aba : "Dados";
  pg.append(botaoVoltar(), el("div", { class: "cab-linha" }, el("h1", { text: "Módulos e dados" }), el("span", { class: "quieto", text: `Pasta: ${s.pasta_dados || ""}` })),
    el("div", { class: "abas", role: "tablist" }, ABAS_MOD.map((n) => el("button", { class: "aba", role: "tab", type: "button", "aria-selected": String(n === aba),
      onclick: () => ir({ tipo: "modulos", aba: n }, { substituir: true }) }, n,
      n === "Atualizações" && Vigia && (pedidoDados() || novasCnes().length || (Vigia.versao && Vigia.versao.nova)) ? el("small", { text: "•" }) : null))));
  const ult = E.comps[E.comps.length - 1];
  const ter = s.territorio;
  const z = s.zips || {};
  const base = [
    ["Tabela de procedimentos (SIGTAP)", ult ? "carregada" : "não baixada", ult ? F.competencia(ult.competencia) : "—",
      ult ? `${ult.arquivo}${ult.publicado_em ? `, publicado em ${ult.publicado_em}` : ""}` : "ftp2.datasus.gov.br"],
    ["Histórico da tabela", `${E.comps.length} competência(s)`, E.comps.length ? `${F.competencia(E.comps[0].competencia)} a ${F.competencia(ult.competencia)}` : "—",
      `${z.arquivos || 0} ZIP(s) oficiais guardados em dados\\zips (${F.mb(z.bytes || 0)}); com eles o banco pode ser refeito`],
    ["Território", ter ? (ter.resumo.sem_regiao_saude.length || ter.resumo.sem_ibge.length ? "com aviso" : "em dia") : "não baixado", ter ? "base das fontes" : "—",
      ter ? `IBGE: ${F.inteiro(ter.resumo.municipios_ibge)} municípios. Ministério da Saúde: ${F.inteiro(ter.resumo.municipios_saude)}, ${ter.resumo.regioes_saude} regiões de saúde.` +
        (ter.resumo.sem_regiao_saude.length ? ` Sem região de saúde na fonte: ${ter.resumo.sem_regiao_saude.join(", ")}.` : "") +
        ter.fontes.map((f) => ` ${f.fonte === "ibge" ? "IBGE" : "Ministério da Saúde"} obtido em ${f.origem.obtido_em}.`).join("") : "IBGE e Ministério da Saúde"],
  ];
  const opcionais = [linhaModuloCnes(), linhaModuloProducao()];
  const embreve = [
    ["TUSS e TISS (ANS)", "em breve", "—", "correlação com o SIGTAP, com a data da fonte"],
  ];
  const grupo = (nome, ls) => [el("tr", { class: "grupo-linha" }, el("th", { colspan: "4", text: nome })),
    ...ls.map((l) => el("tr", {}, el("td", {}, el("b", { text: l[0] })), l.slice(1).map((x) => el("td", { text: x }))))];
  const quadro = el("table", { class: "tabela modulos-tab" },
    el("thead", {}, el("tr", {}, ["Módulo", "Situação", "Competências", "Origem"].map((h) => el("th", { text: h })))),
    el("tbody", {}, ...grupo("Base", base), ...grupo("Opcional", opcionais), ...grupo("Em breve", embreve)));
  const pagina = { "Dados": [], "Baixar e importar": [], "Atualizações": [], "Armazenamento": [] };
  pagina["Dados"].push(quadro);
  pagina["Atualizações"].push(secaoAtualizacoes());

  // Baixar: escopo, apagar depois, progresso.
  const escolha = { escopo: "vigente" };
  const apagar = el("input", { type: "checkbox" });
  const apagarTxt = el("span");
  const apagarRotulo = el("label", { class: "apagar-zips" }, apagar, apagarTxt);
  let botaoBaixar = null;
  const atualizarApagar = () => {
    textoApagar(escolha.escopo, apagarRotulo, apagarTxt);
    if (botaoBaixar) botaoBaixar.disabled = !escolha.escopo;
  };
  const escopos = el("fieldset", { class: "escopo" }, el("legend", {}, el("b", { text: "O que baixar da tabela" })));
  opcoesEscopo(escopos, "escopo-modulos", escolha, atualizarApagar);
  atualizarApagar();
  const ocupado = () => E.tarefa.ativa;
  pagina["Baixar e importar"].push(el("section", { class: "bloco" },
    el("div", { class: "cab-linha" }, el("h2", { text: "Baixar do DATASUS" }),
      el("small", { text: "um arquivo por vez; enquanto um baixa, o anterior já entra no banco" })),
    escopos, apagarRotulo,
    el("div", { class: "acoes" },
      botaoBaixar = el("button", { class: "botao primario", type: "button", onclick: () => escolha.escopo && baixar({ sigtap: escolha.escopo, territorio: false, apagar_zips: apagar.checked }) }, "Baixar"),
      el("button", { class: "botao", type: "button", title: "Competência mais recente e território", onclick: () => baixar({ sigtap: "vigente", territorio: true, apagar_zips: false }) }, "Procurar atualizações"),
      el("button", { class: "botao", type: "button", onclick: () => invoke("cancelar") }, "Cancelar o que está em andamento")),
    painelProgresso()));

  pagina["Baixar e importar"].push(secaoCnes());
  pagina["Baixar e importar"].push(secaoProducao());

  // Espaço em disco: apagar ZIPs já carregados.
  const conf = el("div", { class: "aviso", hidden: true },
    `Apagar ${z.apagaveis} ZIP(s)? O banco continua com todas as competências, mas não poderá ser refeito a partir desses arquivos sem baixá-los de novo. `,
    el("button", { class: "botao", type: "button", onclick: async (ev) => {
      ev.currentTarget.disabled = true;
      try { const m = await invoke("apagar_zips"); await atualizarSituacao(); desenhar(); setTimeout(() => avisoTopo(m), 0); }
      catch (e) { conf.replaceWith(erro(e)); }
    } }, "Apagar"),
    " ", el("button", { class: "link", type: "button", onclick: () => { conf.hidden = true; } }, "Não apagar"));
  pagina["Armazenamento"].push(el("section", { class: "bloco" },
    el("div", { class: "cab-linha" }, el("h2", { text: "Espaço em disco" }), el("small", { text: `${z.arquivos || 0} ZIP(s), ${F.mb(z.bytes || 0)}` })),
    z.apagaveis
      ? el("p", {}, `${z.apagaveis} ZIP(s) já estão no banco e podem ser apagados, liberando ${F.mb(z.bytes_apagaveis)}. O da competência mais recente (${F.competencia(z.mantida)}) fica sempre guardado.`)
      : el("p", { class: "quieto", text: z.arquivos ? `Nada a apagar: só o ZIP da competência mais recente${z.mantida ? ` (${F.competencia(z.mantida)})` : ""} ou ZIPs ainda não carregados.` : "Nenhum ZIP guardado." }),
    z.apagaveis ? el("div", { class: "acoes" }, el("button", { class: "botao", type: "button", disabled: ocupado(), onclick: () => { conf.hidden = false; } }, `Apagar ZIPs já carregados (libera ${F.mb(z.bytes_apagaveis)})`)) : null,
    conf));

  // Importar de uma pasta.
  const caminho = el("input", { type: "text", class: "campo", placeholder: "Ex.: D:\\Downloads\\SIGTAP", "aria-label": "Pasta para importar" });
  pagina["Baixar e importar"].push(el("section", { class: "bloco", id: "importar" }, el("h2", { text: "Importar de uma pasta" }),
    el("p", { class: "quieto", text: "Sem internet ou com o FTP bloqueado? Baixe os arquivos por outro caminho, junte numa pasta e indique a pasta aqui. O programa confere cada arquivo antes de usar." }),
    el("div", { class: "acoes" }, caminho,
      el("button", { class: "botao", type: "button", onclick: async () => {
        try { const p = await invoke("escolher_pasta"); if (p) caminho.value = p; } catch (e) { avisoTopo(String(e)); }
      } }, "Procurar pasta…"),
      el("button", { class: "botao primario", type: "button", onclick: () => caminho.value.trim() ? importar(caminho.value.trim()) : caminho.focus() }, "Importar")),
    instrucoesManuais()));

  pagina["Armazenamento"].push(secaoSaude());
  pg.append(...pagina[aba]);
}

/** Passo a passo para baixar à mão (rede que bloqueia FTP ou computador sem internet). */
function instrucoesManuais() {
  const url = (u) => el("span", { class: "url" },
    el("button", { class: "botao pequeno", type: "button", title: "Copiar o endereço", onclick: (ev) => copiar(u, ev.currentTarget.parentNode, "copiado") }, "Copiar"),
    el("code", { text: u }), el("span", { class: "copiado", role: "status" }));
  const IBGE = "https://servicodados.ibge.gov.br/api/v1/localidades/municipios?view=nivelado";
  const DEMAS = "https://apidadosabertos.saude.gov.br/macrorregiao-e-regiao-de-saude/municipio";
  const FTP = "ftp://ftp2.datasus.gov.br/pub/sistemas/tup/downloads/";
  const paginas = [0, 860, 1720, 2580, 3440, 4300, 5160];
  const passo = (titulo, ...corpo) => el("li", {}, el("div", { class: "passo-titulo", text: titulo }), el("div", { class: "passo-corpo" }, ...corpo));
  const dica = (...t) => el("p", { class: "dica" }, el("b", { text: "Dica: " }), ...t);
  return el("details", { class: "manual" },
    el("summary", { text: "Como baixar os arquivos à mão" }),
    el("p", { class: "quieto", text: "Use este passo a passo quando o programa não conseguir baixar sozinho, por exemplo se a rede do hospital bloqueia os servidores do DATASUS. Você baixa os arquivos (pode ser em outro computador ou em outra rede), junta tudo numa pasta e pede ao programa que importe essa pasta." }),
    el("ol", { class: "passos" },
      passo("Crie uma pasta para os arquivos",
        el("p", { text: "Abra o Explorador de Arquivos (tecla Windows + E). Num lugar fácil de achar, como a Área de Trabalho, clique com o botão direito, escolha Novo e depois Pasta. Dê a ela o nome Arquivos SIGTAP." })),
      passo("Baixe a Tabela de Procedimentos (SIGTAP)",
        el("p", { text: "1. Copie este endereço:" }), url(FTP),
        el("p", { text: "2. No Explorador de Arquivos, clique na barra de endereço (no alto da janela), cole o endereço com Ctrl+V e tecle Enter. Use o Explorador: o Chrome e o Edge não abrem endereços que começam com ftp." }),
        el("p", { text: "3. Vai aparecer uma lista de arquivos. Procure os que começam com TabelaUnificada_ seguido do ano e do mês. Por exemplo, TabelaUnificada_202609_v2609171117.zip é a tabela de setembro de 2026." }),
        el("p", { text: "4. Clique no arquivo, tecle Ctrl+C, abra a pasta Arquivos SIGTAP e tecle Ctrl+V. Copie o mês mais recente e, se quiser consultar o histórico, os meses anteriores." }),
        dica("se houver dois arquivos do mesmo mês, copie o que tem o número maior depois da letra v: é a versão republicada, a mais nova."),
        dica("se o Explorador não abrir o endereço, use um programa gratuito de FTP, como o FileZilla: servidor ftp2.datasus.gov.br, usuário anonymous, pasta /pub/sistemas/tup/downloads.")),
      passo("Baixe a lista de municípios do IBGE",
        el("p", { text: "1. Copie este endereço:" }), url(IBGE),
        el("p", { text: "2. Abra o Edge ou o Chrome, cole o endereço na barra e tecle Enter. Vai aparecer um texto longo e sem enfeites; isso é normal." }),
        el("p", { text: "3. Tecle Ctrl+S. Em Nome do arquivo, escreva ibge_municipios.json, escolha a pasta Arquivos SIGTAP e clique em Salvar." }),
        dica("se o navegador perguntar o tipo do arquivo, escolha Todos os arquivos ou Somente HTML. Não escolha Página da Web, completa.")),
      passo("Baixe as regiões de saúde do Ministério da Saúde",
        el("p", { text: "A lista é grande e vem em 7 partes. Para cada parte: copie o endereço, abra no navegador, tecle Ctrl+S e salve na pasta Arquivos SIGTAP com o nome indicado." }),
        el("div", { class: "urls" }, paginas.map((o, k) => el("div", { class: "parte" },
          el("b", { text: `Parte ${k + 1}: salvar como demas_${k + 1}.json` }), url(`${DEMAS}?limit=1000&offset=${o}`)))),
        el("p", { text: "Para conferir que não faltou nada, abra também este endereço. Não precisa salvar: a lista deve vir vazia. Se vierem municípios, o servidor mudou; avise o projeto pelo botão Sugerir ou relatar." }),
        url(`${DEMAS}?limit=1000&offset=6020`)),
      passo("Importe a pasta no programa",
        el("p", { text: "Volte a esta tela, clique em Procurar pasta…, escolha a pasta Arquivos SIGTAP e clique em Importar. Espere a barra de progresso chegar a Concluído." }),
        el("p", { text: "O programa confere cada arquivo antes de usar. Se recusar algum, ele diz qual e por quê; nesse caso confira o nome e baixe o arquivo de novo." }),
        dica("para ver o final dos nomes (.zip, .json), clique em Exibir no Explorador e marque Extensões de nomes de arquivos (no Windows 11, fica em Exibir, Mostrar). Assim você confere que o nome ficou ibge_municipios.json e não ibge_municipios.json.txt."))));
}

function avisoTopo(msg) {
  const pg = document.querySelector("#conteudo .pagina");
  if (pg) pg.insertBefore(el("p", { class: "aviso", role: "status", text: msg }), pg.children[1] || null);
}

// ---------- escopo do download ----------
const ESCOPOS = [
  ["vigente", "Só a competência mais recente", 1],
  ["6", "Últimos 6 meses", 6],
  ["12", "Últimos 12 meses", 12],
  ["24", "Últimos 24 meses", 24],
  ["tudo", "Histórico completo", Infinity],
];
function calcEscopo(n) {
  const cs = E.ofertas && E.ofertas.competencias;
  if (!cs || !cs.length) return null;
  const sel = cs.slice(-Math.min(n, cs.length));
  const baixar = sel.filter((c) => !c.guardado);
  return {
    n: sel.length, de: sel[0].competencia, ate: sel[sel.length - 1].competencia,
    nBaixar: baixar.length, bytes: baixar.reduce((s, c) => s + c.tamanho, 0),
    libera: sel.slice(0, -1).filter((c) => !c.carregado).reduce((s, c) => s + c.tamanho, 0),
  };
}
function textoEscopo(n) {
  if (E.ofertas === "falhou") return "tamanho indisponível: o servidor não respondeu agora";
  const k = calcEscopo(n);
  if (!k) return "consultando o tamanho no servidor…";
  const faixa = k.n > 1 ? `${k.n} competências, ${F.competencia(k.de)} a ${F.competencia(k.ate)}` : F.competencia(k.ate);
  return `${faixa}; ${k.nBaixar ? `${k.nBaixar} a baixar, ${F.mb(k.bytes)}` : "já guardada(s)"}`;
}
/** Todas as competências do escopo já estão no banco, na versão do servidor. */
function escopoCompleto(n) {
  const cs = E.ofertas && E.ofertas.competencias;
  if (!cs || !cs.length) return false;
  return cs.slice(-Math.min(n, cs.length)).every((c) => c.carregado);
}
function opcoesEscopo(caixa, nome, escolha, aoMudar, rotulos) {
  const itens = [];
  for (const [v, rotulo0, n] of ESCOPOS) {
    const rotulo = (rotulos && rotulos[v]) || rotulo0;
    const sp = el("small", { text: textoEscopo(n) });
    const radio = el("input", { type: "radio", name: nome, value: v, checked: v === escolha.escopo, onchange: () => { escolha.escopo = v; aoMudar && aoMudar(); } });
    const rot = el("label", { class: "opcao" }, radio, el("span", {}, rotulo, " ", sp));
    itens.push({ v, n, sp, radio, rot });
    caixa.append(rot);
  }
  caixa._atualizar = () => {
    for (const x of itens) {
      const feito = escopoCompleto(x.n);
      x.rot.classList.toggle("feito", feito);
      x.radio.disabled = feito;
      x.sp.textContent = feito ? "já baixado e importado" : textoEscopo(x.n);
    }
    // A escolha não pode ficar numa opção cinza: vai para a primeira ainda possível.
    const atual = itens.find((x) => x.v === escolha.escopo);
    if (!atual || atual.radio.disabled) {
      const livre = itens.find((x) => !x.radio.disabled);
      escolha.escopo = livre ? livre.v : null;
      for (const x of itens) x.radio.checked = x.v === escolha.escopo;
    }
  };
  carregarOfertas().then(() => { caixa._atualizar(); aoMudar && aoMudar(); });
}
let ofertasPromessa = null;
function carregarOfertas() {
  if (!ofertasPromessa) ofertasPromessa = invoke("ofertas", {}).then((o) => { E.ofertas = o; }).catch(() => { E.ofertas = "falhou"; ofertasPromessa = null; });
  return ofertasPromessa;
}
function textoApagar(escopo, rotulo, txt) {
  if (!escopo) { rotulo.hidden = true; return; }
  const n = (ESCOPOS.find((x) => x[0] === escopo) || [])[2] || 1;
  rotulo.hidden = n === 1;
  const k = calcEscopo(n);
  txt.textContent = `Apagar os ZIPs depois de carregá-los no banco${k && k.libera ? ` (libera cerca de ${F.mb(k.libera)})` : ""}. ` +
    "O da competência mais recente fica guardado. Sem os demais, o banco só pode ser refeito baixando-os de novo.";
}

// ---------- tarefas em segundo plano (download, importação) ----------
/** Painel de progresso; todos os painéis com data-tarefa mostram o mesmo estado. */
function painelProgresso() {
  const p = el("div", { class: "progresso", "data-tarefa": "" },
    el("div", { class: "trilho" }, el("div", { class: "barra-prog" })),
    el("div", { class: "prog-txt" }, el("b", { class: "resumo" }), el("span", { class: "msg" })));
  p.hidden = !E.tarefa.ultimo;
  if (E.tarefa.ultimo) desenharProgresso(p, E.tarefa.ultimo);
  return p;
}
function pct(p) { return `${Math.floor(100 * (p.fracao || 0))}%`; }
function desenharProgresso(alvo, p) {
  alvo.hidden = false;
  alvo.classList.toggle("indeterminado", !!p.indeterminado);
  alvo.classList.toggle("falhou", !!p.falhou);
  const barra = alvo.querySelector(".barra-prog");
  barra.style.width = p.indeterminado ? "" : `${(100 * (p.fracao || 0)).toFixed(1)}%`;
  const res = alvo.querySelector(".resumo"), msg = alvo.querySelector(".msg");
  if (res) {
    res.textContent = p.indeterminado ? (p.resumo || "Preparando") : `${pct(p)}${p.resumo ? ` ${p.resumo}` : ""}`;
    msg.textContent = p.mensagem || "";
  } else if (E.tarefa.ativa) {
    msg.textContent = p.indeterminado ? (p.mensagem || "Preparando") : `${pct(p)} ${p.resumo || p.mensagem || ""}`;
  } else {
    msg.textContent = `${p.resumo} ${p.mensagem || ""}`; // fim: o resultado por extenso
  }
}
function mostrarProgresso(p) {
  E.tarefa.ultimo = p;
  for (const alvo of document.querySelectorAll("[data-tarefa]")) desenharProgresso(alvo, p);
  atualizarRodapeProgresso();
}
/** Barra no rodapé, à direita, quando a tela atual não mostra o progresso. */
function atualizarRodapeProgresso() {
  const r = $("rodape-progresso");
  const visivelNaTela = !$("primeira").hidden || !!$("conteudo").querySelector("[data-tarefa]");
  const mostrar = !!E.tarefa.ultimo && (E.tarefa.ativa || E.tarefa.falhou || Date.now() < E.tarefa.ate) && !visivelNaTela;
  r.hidden = !mostrar;
  if (mostrar) { desenharProgresso(r, E.tarefa.ultimo); r.title = `${E.tarefa.ultimo.resumo || ""}\n${E.tarefa.ultimo.mensagem || ""}\nClique para ver em Módulos e dados`.trim(); }
}
function iniciarTarefa(msg) {
  tirarAviso("falha");
  E.tarefa = { ativa: true, ultimo: null, falhou: false, ate: 0 };
  $("primeira-cortesia").hidden = true;
  $("primeira").classList.add("rodando");
  mostrarProgresso({ resumo: msg, mensagem: "", fracao: 0, indeterminado: true });
}
async function comecar(cmd, args, msg) {
  const antes = E.tarefa;
  iniciarTarefa(msg);
  try { await invoke(cmd, args); }
  catch (e) {
    E.tarefa = antes.ativa ? antes : { ...antes, ativa: false };
    for (const alvo of document.querySelectorAll("[data-tarefa]")) alvo.hidden = !E.tarefa.ultimo;
    atualizarRodapeProgresso();
    E.aposPrimeira = null; E.fila = [];
    $("primeira-baixar").disabled = false;
    $("primeira").classList.remove("rodando");
    mostrarFalha(e);
  }
}
const baixar = (pedido) => comecar("baixar", { pedido }, "Iniciando o download");
const importar = (pasta) => comecar("importar", { pasta }, "Importando");
function mostrarFalha(e) {
  if (!$("primeira").hidden) { $("primeira-erro").hidden = false; $("primeira-erro").textContent = String(e); }
  else avisoTopo(String(e));
}
async function fimTarefa(f) {
  const antes = E.tarefa.ultimo || { fracao: 0 };
  E.recuperando = false;
  E.tarefa.ativa = false;
  E.tarefa.falhou = !f.ok;
  E.tarefa.ate = Date.now() + 10000;
  // Primeira execução: terminado o obrigatório, segue para o CNES da UF escolhida.
  const seguinte = E.aposPrimeira && !E.aposPrimeira.fase && f.ok ? E.aposPrimeira : null;
  const fimCnes = E.aposPrimeira && E.aposPrimeira.fase === "cnes" ? E.aposPrimeira : null;
  if (seguinte) {
    seguinte.fase = "cnes";
    comecar("cnes_baixar", { pedido: { uf: seguinte.uf, competencia: "" } }, `Baixando o CNES de ${seguinte.uf}`);
  } else {
    E.aposPrimeira = null;
    $("primeira").classList.remove("rodando");
    $("primeira-baixar").disabled = false;
    $("primeira-continuar").hidden = true;
  }
  await atualizarSituacao();
  await atualizarCnes();
  await atualizarProducao();
  if (!$("arvore-raiz").querySelector(".no")) await desenharArvore();
  if (!seguinte) mostrarProgresso({
    resumo: f.ok ? "Concluído." : f.cancelada ? "Cancelado." : "Não concluído.",
    mensagem: f.mensagem, fracao: f.ok ? 1 : antes.fracao, indeterminado: false, falhou: !f.ok,
  });
  if (!f.ok && !$("primeira").hidden) { $("primeira-erro").hidden = false; $("primeira-erro").textContent = f.mensagem; }
  if (fimCnes && f.ok) { $("primeira").hidden = true; ir({ tipo: "unidade" }, { substituir: true }); }
  else if (E.rota.tipo === "modulos" || E.rota.tipo === "inicio" || E.rota.tipo === "unidade") desenhar();
  carregarOfertasDeNovo();
  aposTarefa(f);
  if (f.ok) tirarAviso("recuperacao");
  setTimeout(atualizarRodapeProgresso, 10100);
}
function carregarOfertasDeNovo() { ofertasPromessa = null; if (E.ofertas && E.ofertas !== "falhou") carregarOfertas(); }

/** Dados novos no meio de uma tarefa (primeira competência carregada, território gravado). */
async function dadosAtualizados() {
  await atualizarSituacao();
  if (E.comps.length && !$("arvore-raiz").querySelector(".no")) await desenharArvore();
  if (E.rota.tipo === "inicio" && $("primeira").hidden) desenhar();
  $("primeira-continuar").hidden = !(E.tarefa.ativa && !E.situacao.primeira_execucao && !$("primeira").hidden);
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
  // A janela da primeira execução abre quando falta o obrigatório; durante um download ela
  // só fecha quando a pessoa escolhe continuar.
  if (E.situacao.primeira_execucao && !E.recuperando) $("primeira").hidden = false;
  else if (E.recuperando) $("primeira").hidden = true;
  else if (!E.tarefa.ativa) $("primeira").hidden = true;
  atualizarRodapeProgresso();
}

function primeiraExecucao() {
  const escolha = { escopo: "vigente" };
  const apagarTxt = $("primeira-apagar-txt");
  const atualizar = () => textoApagar(escolha.escopo, $("primeira-apagar-rotulo"), apagarTxt);
  const caixa = $("primeira-escopo");
  caixa.querySelectorAll("label").forEach((x) => x.remove());
  opcoesEscopo(caixa, "escopo-primeira", escolha, atualizar, { vigente: "Agora não, só a competência mais recente" });
  atualizar();
  // CNES da UF (opcional): depois do obrigatório, baixa o CNES e leva à escolha da unidade.
  const usarCnes = $("primeira-cnes-usar"), ufCnes = $("primeira-cnes-uf");
  usarCnes.addEventListener("change", async () => {
    $("primeira-cnes-linha").hidden = !usarCnes.checked;
    if (usarCnes.checked && !ufCnes.options.length) {
      if (!E.cnes) await atualizarCnes();
      let salva = null;
      try { salva = localStorage.getItem("cnes-uf"); } catch { /* sem armazenamento */ }
      for (const u of (E.cnes && E.cnes.ufs_disponiveis) || []) ufCnes.append(el("option", { value: u }, u));
      if (salva) ufCnes.value = salva;
    }
  });
  $("primeira-baixar").addEventListener("click", () => {
    $("primeira-erro").hidden = true;
    $("primeira-baixar").disabled = true;
    E.aposPrimeira = usarCnes.checked && ufCnes.value ? { uf: ufCnes.value } : null;
    if (E.aposPrimeira) { try { localStorage.setItem("cnes-uf", ufCnes.value); } catch { /* vale só agora */ } }
    baixar({ sigtap: escolha.escopo, territorio: true, apagar_zips: $("primeira-apagar").checked });
  });
  $("primeira-cancelar").addEventListener("click", () => invoke("cancelar"));
  $("primeira-continuar").addEventListener("click", () => { $("primeira").hidden = true; $("primeira-continuar").hidden = true; desenhar(); });
  $("primeira-importar").addEventListener("click", () => {
    $("primeira").hidden = true; ir({ tipo: "modulos", aba: "Baixar e importar" });
    setTimeout(() => $("importar")?.scrollIntoView({ block: "start" }), 0);
  });
}

function divisorArvore() {
  const corpo = document.querySelector(".corpo");
  let pedida = 296;
  const aplicar = (px) => { pedida = px; corpo.style.setProperty("--largura-arvore", `${Math.max(220, Math.min(limiteArvore(), px))}px`); };
  window.addEventListener("resize", () => aplicar(pedida));
  let salva = 0;
  try { salva = Number(localStorage.getItem("largura-arvore")) || 0; } catch { /* sem armazenamento: usa o padrão */ }
  aplicar(salva || 296);
  const d = $("divisor");
  d.addEventListener("pointerdown", (ev) => {
    d.setPointerCapture(ev.pointerId);
    const mover = (e) => aplicar(e.clientX);
    const soltar = (e) => {
      d.removeEventListener("pointermove", mover); d.removeEventListener("pointerup", soltar);
      try { localStorage.setItem("largura-arvore", String(Math.round(e.clientX))); } catch { /* ignora */ }
    };
    d.addEventListener("pointermove", mover); d.addEventListener("pointerup", soltar);
  });
  d.addEventListener("keydown", (ev) => {
    const atual = $("arvore").getBoundingClientRect().width;
    if (ev.key === "ArrowLeft") aplicar(atual - 24);
    if (ev.key === "ArrowRight") aplicar(atual + 24);
  });
}

/** Largura máxima da árvore: o conteúdo nunca fica mais estreito que o mínimo legível. */
const CONTEUDO_MIN = 730; // medido: a tabela mais larga (compatíveis) pede ~716 px
function limiteArvore() { return Math.max(220, Math.min(560, window.innerWidth - CONTEUDO_MIN)); }

async function iniciar() {
  await iniciarExtras();
  divisorArvore();
  iniciarSugestoes();
  $("form-busca").addEventListener("submit", (ev) => {
    ev.preventDefault();
    clearTimeout(Sug.timer); Sug.seq++; fecharSug();
    const t = $("busca").value.trim();
    if (t) ir({ tipo: "busca", texto: t });
  });
  document.addEventListener("keydown", (ev) => {
    if (ev.ctrlKey && ev.key.toLowerCase() === "k") { ev.preventDefault(); $("busca").focus(); $("busca").select(); }
    if (ev.altKey && ev.key === "ArrowLeft" && E.pilha.length) { ev.preventDefault(); voltar(); }
  });
  document.addEventListener("mouseup", (ev) => { if (ev.button === 3 && E.pilha.length) { ev.preventDefault(); voltar(); } });
  $("competencia").addEventListener("change", async (ev) => {
    E.comp = ev.target.value; rodape(); await desenharArvore(); desenhar();
  });
  $("ir-inicio").addEventListener("click", irProcedimentos);
  $("ir-mudou").addEventListener("click", () => ir({ tipo: "mudou" }));
  $("ir-modulos").addEventListener("click", () => ir({ tipo: "modulos" }));
  iniciarUnidade();
  $("rodape-sigtap").addEventListener("click", abrirSigtap);
  $("rodape-progresso").addEventListener("click", () => ir({ tipo: "modulos", aba: "Baixar e importar" }));
  primeiraExecucao();
  await tauri.event.listen("progresso", (ev) => { if (E.tarefa.ativa) mostrarProgresso(ev.payload); });
  await tauri.event.listen("dados_atualizados", () => dadosAtualizados());
  await tauri.event.listen("tarefa_fim", (ev) => fimTarefa(ev.payload));
  try {
    await atualizarSituacao();
  } catch (e) {
    $("conteudo").append(el("div", { class: "pagina" }, erro(e)));
    return;
  }
  await atualizarCnes();
  await atualizarProducao();
  desenhar();
  $("arvore-raiz").append(el("li", {}, carregando("Carregando a árvore…")));
  desenharArvore().catch((e) => limpar($("arvore-raiz")).append(el("li", {}, erro(e))));
  tratarRecuperacao();
  iniciarVigia();
}

iniciar();
