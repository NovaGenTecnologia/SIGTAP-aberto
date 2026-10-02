// Fase 3 na interface: CNES por UF, Minha unidade, aptidão e rede na ficha, favoritos,
// anotações e exportação. Usa os utilitários de app.js e extras.js (el, $, ir, invoke, F...).
"use strict";

// ---------- situação do CNES ----------
async function atualizarCnes() {
  try { E.cnes = await invoke("cnes_situacao"); }
  catch (e) { E.cnes = { ufs: [], minha: null, unidades: [], ufs_disponiveis: [], erro: String(e) }; }
}
const cnesDaUf = (uf) => ((E.cnes && E.cnes.ufs) || []).find((x) => x.uf === uf);
const minhaUnidade = () => (E.cnes && E.cnes.minha) || null;
const minhasUnidades = () => (E.cnes && E.cnes.unidades) || [];

/** Depois de trocar a unidade ativa: a lista da esquerda e a tela refletem a nova. */
async function aposTrocarUnidade() {
  await atualizarCnes();
  desenharArvore();
  desenhar();
}
async function usarUnidade(uf, cnes) {
  await invoke("unidade_definir", { uf, cnes });
  await aposTrocarUnidade();
}

// ---------- marcador de habilitação na lista da esquerda ----------
const ROTULO_HAB = { apta: "A sua unidade está habilitada", ressalva: "Habilitação confere; serviço a confirmar", nao: "A sua unidade não está habilitada" };
/** Pontinho ao lado de cada procedimento: habilitada, a confirmar ou não habilitada. */
async function marcarHabilitacao(botoes) {
  const m = minhaUnidade();
  if (!m || !botoes.length) return;
  const comp = E.comp;
  let r;
  try { r = await invoke("marcadores", { competencia: comp, codigos: botoes.map((b) => b.dataset.codigo) }); } catch { return; }
  const atual = minhaUnidade();
  if (comp !== E.comp || !atual || atual.cnes !== m.cnes) return;
  for (const b of botoes) {
    const e = r[b.dataset.codigo];
    if (!e || b.querySelector(".hab-marca")) continue;
    b.append(el("span", { class: `hab-marca ${e}`, title: ROTULO_HAB[e], role: "img", "aria-label": ROTULO_HAB[e] }));
  }
}

// ---------- exportação ----------
const nomeAba = (s) => String(s).replace(/[\[\]:*?/\\]/g, " ").trim().slice(0, 31) || "Planilha";
/** Abre "Salvar como" e grava .xlsx (todas as abas) ou .csv (a primeira). */
async function exportar(nome, titulo, abas) {
  const vistos = new Set();
  const planilha = { titulo, abas: abas.filter((a) => a.linhas.length).map((a) => {
    let n = nomeAba(a.nome), i = 2;
    while (vistos.has(n.toLowerCase())) n = `${nomeAba(a.nome).slice(0, 28)} ${i++}`;
    vistos.add(n.toLowerCase());
    return { nome: n, colunas: a.colunas, linhas: a.linhas };
  }) };
  if (!planilha.abas.length) { mostrarAviso("exportar", { texto: "Nada para exportar: a lista está vazia." }); return; }
  try {
    const m = await invoke("exportar", { planilha, nome });
    if (!m) return; // a pessoa desistiu na janela "Salvar como"
    mostrarAviso("exportar", { texto: m });
    clearTimeout(exportar.timer);
    exportar.timer = setTimeout(() => tirarAviso("exportar"), 12000);
  } catch (e) { mostrarAviso("exportar", { nivel: "erro", texto: `Não foi possível exportar: ${e}` }); }
}
function botaoExportar(rotulo, montar) {
  return el("button", { class: "botao pequeno exportar", type: "button", title: "Excel (.xlsx) ou texto (.csv)",
    onclick: async (ev) => { const b = ev.currentTarget; b.disabled = true; try { const [nome, titulo, abas] = await montar(); await exportar(nome, titulo, abas); } finally { b.disabled = false; } } },
    rotulo || "Exportar");
}
/** Uma relação da ficha como aba de planilha: código e nome em colunas separadas. */
function abaDaRelacao(r) {
  const cols = r.linhas.length ? r.linhas[0].campos.filter((c) => c.coluna !== "dt_competencia") : [];
  const colunas = [];
  for (const c of cols) { colunas.push(nomeColuna(c)); if (r.linhas.some((l) => nomesDe(l, c.coluna).length)) colunas.push(`${nomeColuna(c)} (nome)`); }
  const linhas = r.linhas.map((l) => {
    const v = [];
    for (const c0 of cols) {
      const c = campoDe(l, c0.coluna);
      v.push(c.unidade === "centavos" ? c.valor / 100 : c.valor);
      if (r.linhas.some((x) => nomesDe(x, c0.coluna).length)) { const n = nomesDe(l, c0.coluna).map(textoNome)[0]; v.push(n ? (n.texto || "") : ""); }
    }
    return v;
  });
  return { nome: nomeRel(r), colunas, linhas };
}
function abasDaFicha(f) {
  const p = f.procedimento[0];
  const geral = { nome: "Procedimento", colunas: ["Campo", "Valor no arquivo oficial", "Leitura"],
    linhas: p.campos.map((c) => [nomeColuna(c), c.valor, F.campo(c)]) };
  return [geral, ...f.relacoes.map(abaDaRelacao)];
}

// ---------- favoritos e anotações ----------
const D_ESTRELA = "M8 1.6l1.9 4 4.4.5-3.3 3 .9 4.3L8 11.3l-3.9 2.1.9-4.3-3.3-3 4.4-.5z";
function svgEstrela(cheia) {
  const s = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  s.setAttribute("viewBox", "0 0 16 16"); s.setAttribute("width", "16"); s.setAttribute("height", "16"); s.setAttribute("aria-hidden", "true");
  const p = document.createElementNS("http://www.w3.org/2000/svg", "path");
  p.setAttribute("d", D_ESTRELA); p.setAttribute("fill", cheia ? "currentColor" : "none"); p.setAttribute("stroke", "currentColor"); p.setAttribute("stroke-width", "1.3"); p.setAttribute("stroke-linejoin", "round");
  s.append(p); return s;
}
/** Estrela e anotação no alto da ficha. */
function marcasDaFicha(topo, codigo) {
  const caixa = el("div", { class: "marcas" });
  topo.append(caixa);
  const desenhar = (m) => {
    limpar(caixa);
    const estrela = el("button", { class: "marca-fav" + (m.favorito ? " ativa" : ""), type: "button", "aria-pressed": String(m.favorito),
      title: m.favorito ? "Tirar dos favoritos" : "Guardar nos favoritos",
      onclick: async () => {
        try { desenhar(await invoke("marcar_favorito", { tipo: "procedimento", codigo, favorito: !m.favorito })); if (E.arvore === "fav") desenharFavoritos(); }
        catch (e) { avisoTopo(String(e)); }
      } }, svgEstrela(m.favorito), m.favorito ? "Favorito" : "Favoritar");
    const nota = el("div", { class: "nota" });
    const mostrarTexto = () => {
      limpar(nota);
      if (m.anotacao) nota.append(el("p", { class: "nota-txt", text: m.anotacao }),
        el("button", { class: "link pequeno", type: "button", onclick: editar }, "editar anotação"));
      else nota.append(el("button", { class: "link pequeno", type: "button", onclick: editar }, "Anotar"));
    };
    const editar = () => {
      limpar(nota);
      const campo = el("textarea", { class: "campo nota-campo", rows: "3", maxlength: "4000", "aria-label": "Anotação deste procedimento",
        placeholder: "Anotação" });
      campo.value = m.anotacao || "";
      const salvar = async (texto) => {
        try { desenhar(await invoke("anotar", { tipo: "procedimento", codigo, texto })); if (E.arvore === "fav") desenharFavoritos(); }
        catch (e) { nota.append(erro(e)); }
      };
      nota.append(campo, el("div", { class: "acoes" },
        el("button", { class: "botao primario pequeno", type: "button", onclick: () => salvar(campo.value.trim()) }, "Salvar anotação"),
        m.anotacao ? el("button", { class: "botao pequeno", type: "button", onclick: () => salvar("") }, "Apagar") : null,
        el("button", { class: "link pequeno", type: "button", onclick: mostrarTexto }, "Cancelar")));
      campo.focus();
    };
    mostrarTexto();
    caixa.append(estrela, nota, el("div", { class: "espaco" }),
      botaoExportar("Exportar ficha", async () => {
        const f = await invoke("ficha", { competencia: E.comp, codigo });
        return [`SIGTAP ${codigo} ${E.comp}`, `Procedimento ${F.mascara(codigo)}, competência ${F.competencia(E.comp)}`, abasDaFicha(f)];
      }));
  };
  invoke("marcado", { tipo: "procedimento", codigo }).then(desenhar)
    .catch(() => desenhar({ favorito: false, anotacao: null }));
}

/** Aba "Favoritos" da coluna da esquerda: favoritos e procedimentos anotados. */
async function desenharFavoritos() {
  const raiz = limpar($("arvore-raiz"));
  $("arvore-total").textContent = "";
  let itens;
  try { itens = await invoke("marcados", { tipo: "procedimento", competencia: E.comp }); }
  catch (e) { raiz.append(el("li", {}, erro(e))); return; }
  if (E.arvore !== "fav") return;
  limpar(raiz);
  if (!itens.length) {
    raiz.append(el("li", { class: "fav-vazio" },
      el("p", { text: "Nenhum favorito ainda." }),
      el("p", { class: "quieto pequeno", text: "Use Favoritar ou Anotar na ficha de um procedimento." })));
    return;
  }
  $("arvore-total").textContent = String(itens.length);
  for (const m of itens) {
    raiz.append(el("li", {}, el("button", { class: "no fav" + (E.selecionado === m.codigo ? " selecionado" : ""), type: "button", "data-codigo": m.codigo,
      onclick: () => ir({ tipo: "ficha", codigo: m.codigo }) },
      el("span", { class: "cod", text: F.mascara(m.codigo) }),
      el("span", { class: "nome" }, m.existe ? m.nome : el("span", { class: "sem-nome", text: `não existe em ${F.competencia(E.comp)}` }),
        m.anotacao ? el("small", { class: "fav-nota", text: m.anotacao }) : null))));
  }
  raiz.append(el("li", { class: "fav-rodape" }, botaoExportar("Exportar favoritos", async () => ["SIGTAP favoritos", "Favoritos e anotações",
    [{ nome: "Favoritos", colunas: ["Código", "Nome", "Favorito", "Anotação", "Existe na competência"], linhas: itens.map((m) => [m.codigo, m.nome, m.favorito, m.anotacao || "", m.existe]) }]])));
}

// ---------- aptidão e rede na ficha ----------
const marca = (tem) => el("span", { class: "tem " + (tem ? "sim" : "nao"), "aria-label": tem ? "a unidade tem" : "a unidade não tem", text: tem ? "✓" : "✕" });
function vereditoAptidao(a) {
  const semExigencia = !a.habilitacao.exige && !a.servico.exige && !a.leito.exige;
  if (semExigencia) return ["livre", "Sem exigência de cadastro", ""];
  if (!a.apta && a.habilitacao.atende) return ["ressalva", "Apta com ressalva", "habilitação confere; serviço não achado (pode ser terceirizado)"];
  if (!a.apta) {
    const falta = [!a.habilitacao.atende && a.habilitacao.exige ? "habilitação" : null, !a.servico.atende && a.servico.exige ? "serviço" : null, !a.leito.atende && a.leito.exige ? "leito" : null].filter(Boolean);
    return ["nao", "Não apta", falta.length ? `falta ${falta.join(" e ")}` : ""];
  }
  if (a.leito.exige && !a.leito.atende) return ["ressalva", "Apta com ressalva", "tipo de leito não achado no cadastro"];
  return ["apta", "Apta", ""];
}
function linhaExigida(codigo, nome, tem, obs) {
  return el("li", { class: tem ? "ok" : "falta" }, marca(tem), el("span", { class: "mono", text: codigo }), el("span", { text: nome || "sem nome na tabela oficial" }),
    obs ? el("small", { class: "ambar-txt", text: obs }) : null);
}
/** Lista de alternativas (OU entre elas, E dentro de um grupo); as atendidas primeiro. */
function alternativasHab(h) {
  const ordem = [...h.alternativas].sort((x, y) => Number(y.atende) - Number(x.atende));
  const ul = el("ul", { class: "exigidos" });
  const MAX = 4;
  ordem.forEach((alt, i) => {
    const li = alt.grupo
      ? el("li", { class: "grupo-alt " + (alt.atende ? "ok" : "falta") },
          el("span", { class: "rotulo-alt" }, marca(alt.atende), `precisa das ${alt.habilitacoes.length} juntas`),
          el("ul", {}, alt.habilitacoes.map((x) => linhaExigida(x.codigo, x.nome, x.tem, x.observacao))))
      : linhaExigida(alt.habilitacoes[0].codigo, alt.habilitacoes[0].nome, alt.habilitacoes[0].tem, alt.habilitacoes[0].observacao);
    if (i >= MAX) li.hidden = true;
    ul.append(li);
  });
  if (ordem.length > MAX) {
    const b = el("button", { class: "link pequeno", type: "button", onclick: () => { for (const li of ul.children) li.hidden = false; b.remove(); } },
      `ver as outras ${ordem.length - MAX} alternativas`);
    return [ul, b];
  }
  return [ul];
}
/** Uma linha: selo, unidade e motivo; "Detalhes" abre o confronto e a rede. */
function blocoAptidao(codigo) {
  const sec = el("section", { class: "bloco aptidao" });
  const m = minhaUnidade();
  if (!m) {
    const temCnes = E.cnes && E.cnes.ufs.length;
    sec.classList.add("convite", "apt-compacto");
    sec.append(el("span", { class: "quieto", text: "Minha unidade pode cobrar este procedimento?" }),
      el("button", { class: "link", type: "button", onclick: () => ir({ tipo: "unidade" }) }, temCnes ? "Escolher a unidade" : "Baixar o CNES e escolher a unidade"));
    return sec;
  }
  sec.append(carregando("Comparando com o cadastro…"));
  invoke("aptidao", { competencia: E.comp, codigo }).then((a) => {
    limpar(sec);
    if (!a) { sec.append(el("p", { class: "aviso", text: `A unidade ${m.cnes} não está no CNES de ${m.uf} carregado. Baixe o CNES de novo ou escolha a unidade outra vez.` })); return; }
    const [classe, titulo, curto] = vereditoAptidao(a);
    sec.classList.add(classe);
    const outras = minhasUnidades();
    const quem = outras.length > 1
      ? el("select", { class: "campo apt-sel", "aria-label": "Unidade", onchange: (ev) => { const [uf, cnes] = ev.target.value.split(":"); usarUnidade(uf, cnes); } },
          outras.map((x) => el("option", { value: `${x.uf}:${x.cnes}`, selected: x.cnes === m.cnes && x.uf === m.uf }, x.nome || `CNES ${x.cnes}`)))
      : el("button", { class: "link", type: "button", title: "Ver a unidade", onclick: () => ir({ tipo: "unidade" }) }, m.nome || `CNES ${m.cnes}`);
    const linha = el("div", { class: "apt-linha" }, el("span", { class: "selo " + classe, text: titulo }), quem, curto ? el("span", { class: "quieto pequeno", text: curto }) : null);
    sec.append(linha);
    if (classe === "livre") return;
    const detalhe = el("div", { class: "apt-detalhe" });
    let montado = false;
    const montar = () => {
      montado = true;
      detalhe.append(el("p", { class: "quieto pequeno", text: `CNES ${m.cnes} em ${F.competencia(a.competencia_cnes)}; SIGTAP de ${F.competencia(a.competencia_sigtap)}.` }));
      for (const t of a.motivos) detalhe.append(el("p", { class: "apt-motivo", text: t }));
      const grade = el("div", { class: "apt-grade" });
      detalhe.append(grade);
      const col = (titulo, exige, atende, sub, ...corpo) => el("div", { class: "apt-col" },
        el("h3", {}, exige ? marca(atende) : null, titulo), el("small", { class: "quieto", text: sub }), ...corpo);
      grade.append(col("Habilitação", a.habilitacao.exige, a.habilitacao.atende,
        a.habilitacao.exige ? (a.habilitacao.alternativas.length > 1 ? "basta uma das alternativas" : "exigida") : "não exigida",
        ...(a.habilitacao.exige ? alternativasHab(a.habilitacao) : [])));
      grade.append(col("Serviço e classificação", a.servico.exige, a.servico.atende,
        a.servico.exige ? (a.servico.pares.length > 1 ? "basta um dos pares" : "exigido") : "não exigido",
        a.servico.exige ? el("ul", { class: "exigidos" }, [...a.servico.pares].sort((x, y) => Number(y.tem) - Number(x.tem)).map((p) =>
          linhaExigida(`${p.servico.codigo}/${p.classificacao.codigo}`, p.classificacao.nome || p.servico.nome, p.tem))) : null));
      grade.append(col("Leito", a.leito.exige, a.leito.atende,
        a.leito.exige ? "tipo de leito no cadastro" : "não exigido",
        a.leito.exige ? el("ul", { class: "exigidos" }, a.leito.tipos.map((t) =>
          linhaExigida(t.tipo.codigo, `${t.tipo.nome || ""}${t.tem ? `, ${F.inteiro(t.leitos_sus)} leito(s) SUS` : ""}`, t.tem))) : null));
      for (const t of a.avisos) detalhe.append(el("p", { class: "aviso pequeno", text: t }));
      detalhe.append(blocoRede(codigo));
    };
    detalhe.hidden = !E.aptAberto;
    if (E.aptAberto) montar();
    const botao = el("button", { class: "link pequeno apt-mais", type: "button", "aria-expanded": String(!!E.aptAberto), onclick: () => {
      E.aptAberto = detalhe.hidden;
      detalhe.hidden = !E.aptAberto;
      if (E.aptAberto && !montado) montar();
      botao.setAttribute("aria-expanded", String(E.aptAberto));
      botao.textContent = E.aptAberto ? "Ocultar" : "Detalhes";
    } }, E.aptAberto ? "Ocultar" : "Detalhes");
    linha.append(el("span", { class: "espaco" }), botao);
    sec.append(detalhe);
  }).catch((e) => limpar(sec).append(erro(e)));
  return sec;
}
/** "Quem faz na rede": três contadores e a lista do escopo escolhido. */
function blocoRede(codigo) {
  const caixa = el("div", { class: "rede" }, el("h3", { text: "Quem faz na rede" }), carregando("Contando…"));
  const lista = el("div", { class: "rede-lista" });
  const carregar = async (escopo, abrir) => {
    const r = await invoke("rede", { competencia: E.comp, codigo, escopo });
    limpar(caixa).append(el("h3", { text: "Quem faz na rede" }));
    if (!r.exige) {
      caixa.append(el("span", { class: "quieto", text: "Sem exigência de habilitação ou serviço." }));
      return;
    }
    const botao = (esc, rotulo, d) => d ? el("button", { class: "rede-n", type: "button", "aria-pressed": String(abrir && esc === escopo),
      title: `${F.inteiro(d.aptos)} de ${F.inteiro(d.estabelecimentos)} estabelecimentos. Clique para ver a lista.`,
      onclick: () => carregar(esc, !(abrir && esc === escopo)).catch((e) => limpar(lista).append(erro(e))) },
      el("b", { text: F.inteiro(d.aptos) }), el("span", { text: rotulo })) : null;
    if (r.exige_servico) caixa.append(el("span", { class: "quieto pequeno", text: "Só serviços próprios; terceirizados não constam no arquivo público." }));
    caixa.append(el("div", { class: "rede-ns" },
      (botao("municipio", r.municipio.nome || "no município", r.municipio)),
      (botao("regiao", r.regiao ? `região de saúde ${capitalizar(r.regiao.nome || "")}` : "", r.regiao)),
      (botao("uf", `em ${r.uf.nome}`, r.uf))), lista);
    limpar(lista);
    if (!abrir) return;
    if (!r.lista.length) { lista.append(el("p", { class: "quieto", text: "Nenhum estabelecimento apto neste escopo, pelo cadastro carregado." })); return; }
    lista.append(el("div", { class: "filtros" },
      el("span", { class: "quieto pequeno", text: r.lista_total > r.lista.length ? `Mostrando ${r.lista.length} de ${F.inteiro(r.lista_total)}` : `${r.lista.length} estabelecimento(s)` }),
      botaoExportar("Exportar lista", async () => [`Rede ${codigo} ${escopo}`, `Quem faz ${F.mascara(codigo)} (${escopo}), CNES ${F.competencia(r.competencia_cnes)}`,
        [{ nome: "Rede", colunas: ["CNES", "Estabelecimento", "Município (código)", "Município", "Tipo"], linhas: r.lista.map((e) => [e.cnes, e.nome, e.municipio, e.municipio_nome, e.tipo_nome || e.tipo]) }]])),
      el("table", { class: "tabela compacta" },
        el("thead", {}, el("tr", {}, ["CNES", "Estabelecimento", "Município", "Tipo"].map((h) => el("th", { text: h })))),
        el("tbody", {}, r.lista.map((e) => el("tr", { class: e.minha ? "minha" : null },
          el("td", { class: "cod", text: e.cnes }),
          el("td", {}, e.nome || el("span", { class: "falta", text: "nome não carregado" }), e.minha ? el("span", { class: "etiqueta verde", text: "minha unidade" }) : null),
          el("td", { text: e.municipio_nome || e.municipio }),
          el("td", { class: "quieto", text: capitalizar(e.tipo_nome || e.tipo) }))))));
  };
  carregar("municipio", false).catch((e) => limpar(caixa).append(el("h3", { text: "Quem faz na rede" }), erro(e)));
  return caixa;
}

// ---------- tela Minha unidade ----------
const ABAS_UNIDADE = ["Procedimentos", "Habilitações", "Serviços", "Leitos", "Equipamentos", "Profissionais"];
const semAcento = (s) => String(s).toLocaleLowerCase("pt-BR").normalize("NFD").replace(/[̀-ͯ]/g, "");
/** Tabela com filtro por texto e limite de linhas desenhadas (listas grandes, como profissionais). */
function tabelaFiltravel(colunas, linhas, opc) {
  const LIMITE = (opc && opc.limite) || 300;
  const corpo = el("tbody");
  const conta = el("span", { class: "quieto pequeno" });
  const desenhar = (q) => {
    limpar(corpo);
    const filtradas = q ? linhas.filter((l) => l.busca.includes(q)) : linhas;
    for (const l of filtradas.slice(0, LIMITE)) corpo.append(l.tr());
    conta.textContent = filtradas.length > LIMITE ? `Mostrando ${LIMITE} de ${F.inteiro(filtradas.length)}. Filtre para ver as demais.`
      : q ? `${F.inteiro(filtradas.length)} de ${F.inteiro(linhas.length)}` : `${F.inteiro(linhas.length)} linha(s)`;
  };
  const filtro = el("input", { type: "search", class: "campo", placeholder: (opc && opc.dica) || "Filtrar por código ou nome", "aria-label": "Filtrar",
    oninput: (ev) => desenhar(semAcento(ev.target.value.trim())) });
  desenhar("");
  return [el("div", { class: "filtros" }, linhas.length > 12 ? filtro : null, conta, el("div", { class: "espaco" }), opc && opc.exportar ? opc.exportar : null),
    el("table", { class: "tabela" }, el("thead", {}, el("tr", {}, colunas.map(([h, cls]) => el("th", { class: cls || null, text: h })))), corpo)];
}
const linhaT = (busca, celulas) => ({ busca: semAcento(busca), tr: () => el("tr", {}, celulas()) });
const simNao = (v) => (v ? "Sim" : "Não");
const vigencia = (c) => (!c || c === "999999" || !/^\d{6}$/.test(c) ? "" : F.competencia(c));
const NOME_ARQ_CNES = { ST: "estabelecimentos", HB: "habilitações", SR: "serviços", LT: "leitos", EQ: "equipamentos", PF: "profissionais da unidade", CAD: "nomes" };

function abasDaUnidade(u) {
  const cod = (c) => c.codigo, nom = (c) => c.nome || "";
  const abas = [
    { nome: "Unidade", colunas: ["Campo", "Código", "Descrição"], linhas: [["CNES", u.cnes, u.nome], ["Razão social", "", u.razao_social], ["Município", u.municipio, u.municipio_nome],
      ["Competência do CNES", u.competencia_cnes, ""], ...u.gerais.map(([r, c]) => [r, c.codigo, c.nome || ""])] },
    { nome: "Habilitações", colunas: ["Código", "Habilitação", "Vigente", "Início", "Fim", "Portaria", "Data da portaria", "Leitos"],
      linhas: u.habilitacoes.map((h) => [h.codigo, h.nome || "", h.vigente, h.inicio, h.fim, h.portaria, h.data_portaria, h.leitos]) },
    { nome: "Serviços", colunas: ["Serviço", "Serviço (nome)", "Classificação", "Classificação (nome)", "Ambulatorial SUS", "Hospitalar SUS", "CNES do terceiro"],
      linhas: u.servicos.map((s) => [cod(s.servico), nom(s.servico), cod(s.classificacao), nom(s.classificacao), s.ambulatorial_sus, s.hospitalar_sus, s.terceiro]) },
    { nome: "Leitos", colunas: ["Tipo", "Tipo (nome)", "Especialidade", "Especialidade (nome)", "Existentes", "SUS", "Não SUS"],
      linhas: u.leitos.map((l) => [cod(l.tipo), nom(l.tipo), cod(l.especialidade), nom(l.especialidade), l.existentes, l.sus, l.nao_sus]) },
    { nome: "Equipamentos", colunas: ["Código", "Equipamento", "Existentes", "Em uso", "Disponível ao SUS"],
      linhas: u.equipamentos.map((e) => [cod(e.equipamento), nom(e.equipamento), e.existentes, e.em_uso, e.disponivel_sus]) },
  ];
  if (u.ocupacoes) abas.push({ nome: "Ocupações (CBO)", colunas: ["CBO", "Ocupação", "Profissionais", "Atendem SUS"],
    linhas: u.ocupacoes.map((o) => [cod(o.cbo), nom(o.cbo), o.profissionais, o.atendem_sus]) });
  if (u.profissionais) abas.push({ nome: "Profissionais", colunas: ["Nome", "CBO", "Ocupação", "Vínculo", "Atende SUS", "Horas ambulatoriais", "Horas hospitalares", "Outras horas"],
    linhas: u.profissionais.map((p) => [p.nome, cod(p.cbo), nom(p.cbo), nom(p.vinculo) || cod(p.vinculo), p.atende_sus, p.horas_ambulatorio, p.horas_hospital, p.horas_outros]) });
  return abas;
}

async function telaUnidade(c, aba) {
  const pg = el("div", { class: "pagina unidade" });
  c.append(pg);
  if (!E.cnes) await atualizarCnes();
  const m = minhaUnidade();
  const alvo = E.rota.uf && E.rota.cnes ? { uf: E.rota.uf, cnes: E.rota.cnes } : null;
  if (!E.cnes.ufs.length) { telaSemCnes(pg); return; }
  if ((!m && !alvo) || E.rota.trocar) { telaEscolherUnidade(pg); return; }
  pg.append(carregando("Abrindo a unidade…"));
  let u;
  try { u = await invoke("unidade_ver", { competencia: E.comp, ...(alvo || {}) }); }
  catch (e) {
    limpar(pg).append(el("h1", { text: "Unidade" }), erro(e),
      el("div", { class: "acoes" }, el("button", { class: "botao", type: "button", onclick: () => ir({ tipo: "unidade", trocar: true }, { substituir: true }) }, "Escolher a unidade de novo"),
        el("button", { class: "botao", type: "button", onclick: () => ir({ tipo: "modulos" }) }, "Ver o CNES em Módulos e dados")));
    return;
  }
  limpar(pg);
  aba = u.ativa || aba !== "Profissionais" ? (aba || "Procedimentos") : "Procedimentos";
  const hVig = u.habilitacoes.filter((h) => h.vigente).length;
  const leitosSus = u.leitos.reduce((s, l) => s + l.sus, 0), leitos = u.leitos.reduce((s, l) => s + l.existentes, 0);
  const guardadas = minhasUnidades();
  if (guardadas.length) pg.append(el("div", { class: "uni-troca", role: "group", "aria-label": "Minhas unidades" },
    guardadas.map((g) => el("button", { class: "chip", type: "button", "aria-pressed": String(u.ativa && g.cnes === u.cnes && g.uf === u.uf),
      title: g.nome || `CNES ${g.cnes}`, onclick: async () => { await usarUnidade(g.uf, g.cnes); ir({ tipo: "unidade", aba }, { substituir: true }); } },
      g.nome || `CNES ${g.cnes}`)),
    el("button", { class: "link pequeno", type: "button", onclick: () => ir({ tipo: "unidade", trocar: true }) }, "+ Adicionar unidade")));
  pg.append(el("div", { class: "uni-cab" },
    el("div", { class: "uni-id" },
      el("h1", { text: u.nome || `CNES ${u.cnes}` }),
      el("p", { class: "quieto" }, el("span", { class: "mono", text: `CNES ${u.cnes}` }), `  ${u.municipio_nome || u.municipio}, ${u.uf}`,
        u.razao_social && u.razao_social !== u.nome ? `  ${u.razao_social}` : "")),
    el("div", { class: "acoes" },
      botaoExportar("Exportar unidade", async () => [`CNES ${u.cnes} ${u.competencia_cnes}`, `${u.nome}, CNES ${u.cnes}, competência ${F.competencia(u.competencia_cnes)}`, abasDaUnidade(u)]),
      u.ativa ? (guardadas.length ? el("button", { class: "botao", type: "button", onclick: async (ev) => {
        const b = ev.currentTarget;
        if (b.dataset.certeza !== "1") { b.dataset.certeza = "1"; b.textContent = "Remover mesmo?"; return; }
        try { await invoke("unidade_remover", { uf: u.uf, cnes: u.cnes }); await aposTrocarUnidade(); ir({ tipo: "unidade" }, { substituir: true }); } catch (e) { avisoTopo(String(e)); }
      } }, "Remover") : null)
        : el("button", { class: "botao primario", type: "button", onclick: async (ev) => { ev.currentTarget.disabled = true; try { await usarUnidade(u.uf, u.cnes); ir({ tipo: "unidade" }, { substituir: true }); } catch (e) { avisoTopo(String(e)); } } }, "Utilizar esta unidade"))));
  pg.append(el("dl", { class: "chave" },
    el("div", {}, el("dt", { text: "CNES de" }), el("dd", { class: "valor", text: F.competencia(u.competencia_cnes) })),
    el("div", {}, el("dt", { text: "Habilitações vigentes" }), el("dd", { text: `${hVig} de ${u.habilitacoes.length}` })),
    el("div", {}, el("dt", { text: "Serviços e classificações" }), el("dd", { text: F.inteiro(u.servicos.length) })),
    el("div", {}, el("dt", { text: "Leitos SUS" }), el("dd", { text: `${F.inteiro(leitosSus)} de ${F.inteiro(leitos)}` })),
    ...u.gerais.slice(0, 2).filter(([, cd]) => cd.nome || cd.codigo).map(([r, cd]) => el("div", {}, el("dt", { text: r }), el("dd", { text: capitalizar(cd.nome || cd.codigo) })))));
  if (u.pessoa_fisica) pg.append(el("p", { class: "aviso", text: "Estabelecimento de pessoa física: dados do titular omitidos." }));

  const contagem = { "Procedimentos": null, "Habilitações": u.habilitacoes.length, "Serviços": u.servicos.length, "Leitos": u.leitos.length, "Equipamentos": u.equipamentos.length,
    "Profissionais": u.ocupacoes ? u.ocupacoes.reduce((s, o) => s + o.profissionais, 0) : null };
  pg.append(el("div", { class: "abas uni-abas", role: "tablist" }, ABAS_UNIDADE.filter((n) => n !== "Profissionais" || u.ativa).map((n) => el("button", { class: "aba", role: "tab", type: "button", "aria-selected": String(n === aba),
    onclick: () => ir({ tipo: "unidade", uf: alvo && alvo.uf, cnes: alvo && alvo.cnes, aba: n }, { substituir: true }) }, n, contagem[n] === null ? null : el("small", { text: F.inteiro(contagem[n]) })))));
  const corpo = el("div", { class: "uni-corpo" });
  pg.append(corpo);
  const vazio = (t) => corpo.append(el("p", { class: "quieto", text: t }));
  if (aba === "Procedimentos") {
    corpo.append(carregando("Conferindo os procedimentos…"));
    let lista;
    try { lista = await invoke("unidade_procedimentos", { competencia: E.comp, uf: u.uf, cnes: u.cnes }); }
    catch (e) { limpar(corpo).append(erro(e)); lista = null; }
    if (lista) {
      limpar(corpo);
      const ROT = { apta: "habilitada", ressalva: "a confirmar" };
      const so = lista;
      if (!so.length) corpo.append(el("p", { class: "quieto", text: "Nenhum procedimento habilitado pelo cadastro." }));
      else corpo.append(...tabelaFiltravel([["Código"], ["Procedimento"], ["Situação"]],
        so.map((p) => linhaT(`${p.codigo} ${p.nome}`, () => [
          el("td", { class: "cod" }, el("button", { class: "link mono", type: "button", onclick: () => ir({ tipo: "ficha", codigo: p.codigo }) }, F.mascara(p.codigo))),
          el("td", { text: p.nome }),
          el("td", {}, el("span", { class: `hab-marca ${p.estado} em-linha`, "aria-hidden": "true" }), ROT[p.estado])])),
        { dica: "Filtrar por código ou nome",
          exportar: botaoExportar("Exportar lista", async () => [`Procedimentos CNES ${u.cnes} ${E.comp}`, `Procedimentos de ${u.nome}, CNES ${u.cnes}, SIGTAP ${F.competencia(E.comp)}`,
            [{ nome: "Procedimentos", colunas: ["Código", "Procedimento", "Situação"], linhas: so.map((p) => [p.codigo, p.nome, ROT[p.estado]]) }]]) }));
    }
  } else if (aba === "Habilitações") {
    if (!u.habilitacoes.length) vazio("O cadastro não tem habilitações para esta unidade.");
    else corpo.append(...tabelaFiltravel([["Código"], ["Habilitação"], ["Situação"], ["Vigência"], ["Portaria"], ["Leitos", "num"]],
      u.habilitacoes.map((h) => linhaT(`${h.codigo} ${h.nome || ""} ${h.portaria}`, () => [
        el("td", { class: "cod" }, el("button", { class: "link mono", type: "button", title: "Ver os procedimentos que pedem esta habilitação",
          onclick: () => { $("busca").value = h.codigo; ir({ tipo: "busca", texto: h.codigo }); } }, h.codigo)),
        el("td", {}, h.nome || el("span", { class: "falta", text: `sem nome no SIGTAP de ${F.competencia(u.competencia_sigtap)}` })),
        el("td", {}, el("span", { class: "tag " + (h.vigente ? "incluido" : "excluido"), text: h.vigente ? "vigente" : "fora da vigência" })),
        el("td", { class: "mono curta", text: vigencia(h.fim) ? `${F.competencia(h.inicio)} a ${vigencia(h.fim)}` : `desde ${F.competencia(h.inicio)}` }),
        el("td", {}, h.portaria || "—", h.data_portaria ? el("span", { class: "nomeado", text: `de ${h.data_portaria}` }) : null),
        el("td", { class: "num", text: h.leitos ? F.inteiro(h.leitos) : "—" })]))));
  } else if (aba === "Serviços") {
    if (!u.servicos.length) vazio("O cadastro não tem serviços especializados para esta unidade.");
    else corpo.append(...tabelaFiltravel([["Serviço"], ["Classificação"], ["Ambulatorial SUS"], ["Hospitalar SUS"], ["Terceiro"]],
      u.servicos.map((s) => linhaT(`${s.servico.codigo} ${s.servico.nome || ""} ${s.classificacao.codigo} ${s.classificacao.nome || ""}`, () => [
        el("td", { class: "codnome" }, el("span", { class: "mono", text: s.servico.codigo }), el("span", { class: "nome", text: s.servico.nome || "" })),
        el("td", { class: "codnome" }, el("span", { class: "mono", text: s.classificacao.codigo }), el("span", { class: "nome", text: s.classificacao.nome || "" })),
        el("td", { text: simNao(s.ambulatorial_sus) }), el("td", { text: simNao(s.hospitalar_sus) }),
        el("td", { class: "mono", text: s.terceiro || "—" })]))));
  } else if (aba === "Leitos") {
    if (!u.leitos.length) vazio("O cadastro não tem leitos para esta unidade.");
    else corpo.append(...tabelaFiltravel([["Tipo"], ["Especialidade"], ["Existentes", "num"], ["SUS", "num"], ["Não SUS", "num"]],
      u.leitos.map((l) => linhaT(`${l.tipo.nome || l.tipo.codigo} ${l.especialidade.codigo} ${l.especialidade.nome || ""}`, () => [
        el("td", { text: l.tipo.nome || l.tipo.codigo }),
        el("td", { class: "codnome" }, el("span", { class: "mono", text: l.especialidade.codigo }), el("span", { class: "nome", text: capitalizar(l.especialidade.nome || "") })),
        el("td", { class: "num", text: F.inteiro(l.existentes) }), el("td", { class: "num", text: F.inteiro(l.sus) }), el("td", { class: "num", text: F.inteiro(l.nao_sus) })]))));
  } else if (aba === "Equipamentos") {
    if (!u.equipamentos.length) vazio("O cadastro não tem equipamentos para esta unidade.");
    else corpo.append(...tabelaFiltravel([["Equipamento"], ["Existentes", "num"], ["Em uso", "num"], ["Disponível ao SUS"]],
      u.equipamentos.map((e) => linhaT(`${e.equipamento.codigo} ${e.equipamento.nome || ""}`, () => [
        el("td", { class: "codnome" }, el("span", { class: "mono", text: e.equipamento.codigo }), el("span", { class: "nome", text: (e.equipamento.nome || "").replace(/^\d+-/, "") })),
        el("td", { class: "num", text: F.inteiro(e.existentes) }), el("td", { class: "num", text: F.inteiro(e.em_uso) }), el("td", { text: simNao(e.disponivel_sus) })]))));
  } else {
    if (!u.ocupacoes) {
      corpo.append(el("section", { class: "bloco convite" },
        el("h2", { text: "Os profissionais desta unidade ainda não foram baixados" }),
        el("p", { class: "quieto", text: `Guarda só os vínculos desta unidade e apaga o arquivo baixado em seguida.` }),
        el("div", { class: "acoes" }, el("button", { class: "botao primario", type: "button", disabled: E.tarefa.ativa,
          onclick: () => comecar("cnes_baixar", { pedido: { uf: u.uf, competencia: u.competencia_cnes } }, `Baixando os profissionais de ${u.uf}`) }, "Baixar os profissionais")),
        painelProgresso()));
    } else {
      const modo = E.rota.pessoas ? "pessoas" : "cbo";
      corpo.append(el("div", { class: "filtros" },
        el("button", { class: "chip", type: "button", "aria-pressed": String(modo === "cbo"), onclick: () => ir({ tipo: "unidade", aba }, { substituir: true }) }, `Por ocupação (CBO) ${u.ocupacoes.length}`),
        el("button", { class: "chip", type: "button", "aria-pressed": String(modo === "pessoas"), onclick: () => ir({ tipo: "unidade", aba, pessoas: true }, { substituir: true }) }, `Vínculos ${F.inteiro(u.profissionais.length)}`),
        ));
      if (modo === "cbo") corpo.append(...tabelaFiltravel([["CBO"], ["Ocupação"], ["Vínculos", "num"], ["Atendem SUS", "num"]],
        u.ocupacoes.map((o) => linhaT(`${o.cbo.codigo} ${o.cbo.nome || ""}`, () => [
          el("td", { class: "cod" }, el("button", { class: "link mono", type: "button", title: "Ver os procedimentos que aceitam este CBO",
            onclick: () => { $("busca").value = o.cbo.codigo; ir({ tipo: "busca", texto: o.cbo.codigo }); } }, o.cbo.codigo)),
          el("td", {}, o.cbo.nome || el("span", { class: "falta", text: "CBO sem nome no SIGTAP desta competência" })),
          el("td", { class: "num", text: F.inteiro(o.profissionais) }), el("td", { class: "num", text: F.inteiro(o.atendem_sus) })])), { dica: "Filtrar por CBO ou ocupação" }));
      else corpo.append(...tabelaFiltravel([["Nome"], ["CBO"], ["Vínculo"], ["Atende SUS"], ["Horas amb.", "num"], ["Horas hosp.", "num"], ["Outras", "num"]],
        u.profissionais.map((p) => linhaT(`${p.nome} ${p.cbo.codigo} ${p.cbo.nome || ""}`, () => [
          el("td", { text: p.nome }),
          el("td", { class: "codnome" }, el("span", { class: "mono", text: p.cbo.codigo }), el("span", { class: "nome", text: p.cbo.nome || "" })),
          el("td", { class: "quieto", text: capitalizar(p.vinculo.nome || p.vinculo.codigo) }), el("td", { text: simNao(p.atende_sus) }),
          el("td", { class: "num", text: String(p.horas_ambulatorio) }), el("td", { class: "num", text: String(p.horas_hospital) }), el("td", { class: "num", text: String(p.horas_outros) })])),
        { dica: "Filtrar por nome ou CBO", limite: 200 }));
    }
  }
  const gerais = u.gerais.filter(([, cd]) => cd.nome || cd.codigo);
  if (gerais.length > 2) pg.append(el("section", { class: "bloco" }, el("h2", { text: "Cadastro geral" }),
    gerais.map(([r, cd]) => el("div", { class: "par" }, el("span", { class: "k", text: r }), el("span", { class: "v", text: capitalizar(cd.nome || "") || cd.codigo }),
      cd.nome ? el("span", { class: "n", text: `código ${cd.codigo}` }) : null))));
  pg.append(el("p", { class: "quieto pequeno" }, "Confira no ",
    el("button", { class: "link pequeno", type: "button", onclick: () => abrirSite("https://cnes.datasus.gov.br/") }, "CNES oficial"), " antes de decidir."));
}

function seletorUf(valor, lista) {
  const s = el("select", { class: "campo uf", "aria-label": "UF" });
  for (const uf of lista) s.append(el("option", { value: uf }, uf));
  if (valor) s.value = valor;
  return s;
}
/** Baixar o CNES de uma UF (usado em Minha unidade e em Módulos e dados). */
function formBaixarCnes(rotulo) {
  const todas = (E.cnes && E.cnes.ufs_disponiveis) || [];
  let salva = null;
  try { salva = localStorage.getItem("cnes-uf"); } catch { /* sem armazenamento */ }
  const uf = seletorUf(salva && todas.includes(salva) ? salva : null, todas);
  const comp = el("select", { class: "campo comp-cnes", "aria-label": "Competência do CNES" }, el("option", { value: "" }, "a mais recente"));
  const ver = el("button", { class: "link pequeno", type: "button", onclick: async () => {
    ver.disabled = true; ver.textContent = "consultando o DATASUS…";
    try {
      const cs = await invoke("cnes_competencias", { uf: uf.value });
      limpar(comp).append(el("option", { value: "" }, "a mais recente"), cs.map((x) => el("option", { value: x.competencia }, F.competencia(x.competencia))));
      ver.textContent = `${cs.length} competências listadas`;
    } catch (e) { ver.textContent = "escolher outra competência"; ver.disabled = false; avisoTopo(String(e)); }
  } }, "escolher outra competência");
  uf.addEventListener("change", () => { limpar(comp).append(el("option", { value: "" }, "a mais recente")); ver.disabled = false; ver.textContent = "escolher outra competência"; });
  return el("div", { class: "acoes baixar-cnes" }, el("label", { class: "rotulo-campo" }, "UF", uf), el("label", { class: "rotulo-campo" }, "Competência", comp), ver,
    el("button", { class: "botao primario", type: "button", onclick: () => {
      try { localStorage.setItem("cnes-uf", uf.value); } catch { /* vale só agora */ }
      comecar("cnes_baixar", { pedido: { uf: uf.value, competencia: comp.value } }, `Baixando o CNES de ${uf.value}`);
    } }, rotulo || "Baixar o CNES"));
}
function formImportarCnes() {
  const todas = (E.cnes && E.cnes.ufs_disponiveis) || [];
  const uf = seletorUf(null, todas);
  const caminho = el("input", { type: "text", class: "campo", placeholder: "Pasta com STUFAAMM.dbc, HB, SR, LT, EQ e TAB_CNES.zip", "aria-label": "Pasta com os arquivos do CNES" });
  return el("details", { class: "manual" }, el("summary", { text: "Sem acesso ao FTP? Importar arquivos baixados por outro caminho" }),
    el("p", { class: "quieto pequeno", text: "Em ftp.datasus.gov.br/dissemin/publicos/CNES/200508_/Dados, baixe da pasta de cada tipo (ST, HB, SR, LT, EQ) o arquivo da UF e do mês, por exemplo STMS2608.dbc. Para os nomes dos estabelecimentos, baixe TAB_CNES.zip da pasta Auxiliar. Junte tudo numa pasta e indique aqui." }),
    el("div", { class: "acoes" }, el("label", { class: "rotulo-campo" }, "UF", uf), caminho,
      el("button", { class: "botao", type: "button", onclick: async () => { try { const p = await invoke("escolher_pasta"); if (p) caminho.value = p; } catch (e) { avisoTopo(String(e)); } } }, "Procurar pasta…"),
      el("button", { class: "botao", type: "button", onclick: () => caminho.value.trim() ? comecar("cnes_importar", { pasta: caminho.value.trim(), uf: uf.value }, `Importando o CNES de ${uf.value}`) : caminho.focus() }, "Importar")));
}

function telaSemCnes(pg) {
  pg.append(el("h1", { text: "Minha unidade" }),
    el("p", { class: "lide", text: "Baixe o CNES da sua UF e escolha a unidade para ver, em cada procedimento, se ela está habilitada." }),
    el("section", { class: "bloco destaque" },
      el("div", { class: "cab-linha" }, el("h2", { text: "CNES da UF" }), el("small", { text: "de 1 a 30 MB conforme a UF" })),
      formBaixarCnes(), painelProgresso(), formImportarCnes()));
}

function telaEscolherUnidade(pg) {
  const m = minhaUnidade();
  const ufs = E.cnes.ufs.filter((x) => x.resumo).map((x) => x.uf);
  if (m) pg.append(botaoVoltar());
  pg.append(el("h1", { text: m ? "Adicionar unidade" : "Qual é a sua unidade?" }),
    el("p", { class: "lide", text: "Nome fantasia ou número do CNES." }));
  const uf = seletorUf(m ? m.uf : ufs[0], ufs);
  const campo = el("input", { type: "search", class: "campo busca-uni", placeholder: "Nome do estabelecimento ou CNES", "aria-label": "Procurar estabelecimento", autocomplete: "off", spellcheck: "false" });
  const saida = el("div", { class: "uni-resultados" });
  let seq = 0, timer = null;
  const procurar = async () => {
    const texto = campo.value.trim();
    const meu = ++seq;
    if (texto.length < 3) { limpar(saida).append(el("p", { class: "quieto", text: "Digite ao menos 3 letras ou o CNES." })); return; }
    try {
      const r = await invoke("cnes_buscar", { uf: uf.value, texto });
      if (meu !== seq) return;
      limpar(saida);
      if (!r.length) { saida.append(el("p", { class: "quieto", text: `Nenhum estabelecimento de ${uf.value} com “${texto}”.` })); return; }
      saida.append(el("table", { class: "tabela" },
        el("thead", {}, el("tr", {}, ["CNES", "Estabelecimento", "Município", "Tipo", ""].map((h) => el("th", { text: h })))),
        el("tbody", {}, r.map((e) => el("tr", {},
          el("td", { class: "cod", text: e.cnes }), el("td", {}, e.nome || el("span", { class: "falta", text: "nome não carregado" })),
          el("td", { text: e.municipio_nome || e.municipio }), el("td", { class: "quieto", text: capitalizar(e.tipo_nome || e.tipo) }),
          el("td", { class: "acao" }, el("button", { class: "botao pequeno", type: "button", onclick: async (ev) => {
            ev.currentTarget.disabled = true; ev.currentTarget.textContent = "Gravando…";
            try { await invoke("unidade_definir", { uf: uf.value, cnes: e.cnes }); await aposTrocarUnidade(); ir({ tipo: "unidade" }, { substituir: true }); }
            catch (x) { limpar(saida).append(erro(x)); }
          } }, "Utilizar este")))))));
      if (r.length >= 30) saida.append(el("p", { class: "quieto pequeno", text: "Mostrando os 30 primeiros. Digite mais para afinar." }));
    } catch (e) { if (meu === seq) limpar(saida).append(erro(e)); }
  };
  campo.addEventListener("input", () => { clearTimeout(timer); timer = setTimeout(procurar, 220); });
  uf.addEventListener("change", procurar);
  pg.append(el("div", { class: "acoes escolher" }, ufs.length > 1 ? el("label", { class: "rotulo-campo" }, "UF", uf) : el("span", { class: "etiqueta verde", text: `CNES de ${ufs[0]}` }), campo), saida);
  pg.append(el("p", { class: "quieto pequeno" }, "Outra UF? ", el("button", { class: "link pequeno", type: "button", onclick: () => ir({ tipo: "modulos" }) }, "Baixe o CNES dela em Módulos e dados"), "."));
  campo.focus();
  procurar();
}

// ---------- Módulos e dados: CNES ----------
function linhaModuloCnes() {
  const ufs = (E.cnes && E.cnes.ufs) || [];
  const boas = ufs.filter((x) => x.resumo);
  if (!ufs.length) return ["Estabelecimentos (CNES)", "não baixado", "—", "por UF, do FTP do DATASUS"];
  const m = minhaUnidade();
  return ["Estabelecimentos (CNES)", ufs.length === boas.length ? `${boas.length} UF(s)` : "com problema",
    boas.map((x) => `${x.uf} ${F.competencia(x.resumo.competencia)}`).join("; ") || "—",
    `${F.inteiro(boas.reduce((s, x) => s + x.resumo.estabelecimentos, 0))} estabelecimentos${m ? `; unidade: ${m.nome || m.cnes} (${m.uf})` : ""}`];
}
function secaoCnes() {
  const ufs = (E.cnes && E.cnes.ufs) || [];
  const guardadas = minhasUnidades();
  const sec = el("section", { class: "bloco", id: "sec-cnes" },
    el("div", { class: "cab-linha" }, el("h2", { text: "CNES por UF" }),
      el("small", { text: "profissionais só da unidade em uso" })));
  if (ufs.length) {
    sec.append(el("table", { class: "tabela" },
      el("thead", {}, el("tr", {}, ["UF", "Competência", "Estabelecimentos", "Arquivos carregados", "Tamanho", ""].map((h) => el("th", { text: h })))),
      el("tbody", {}, ufs.map((x) => x.erro
        ? el("tr", {}, el("td", {}, el("b", { text: x.uf })), el("td", { colspan: "5" }, erro(x.erro)))
        : el("tr", {},
          el("td", {}, el("b", { text: x.uf }), guardadas.some((g) => g.uf === x.uf) ? el("span", { class: "etiqueta verde", text: guardadas.filter((g) => g.uf === x.uf).length > 1 ? `${guardadas.filter((g) => g.uf === x.uf).length} unidades` : "minha unidade" }) : null),
          el("td", { class: "mono", text: F.competencia(x.resumo.competencia) }),
          el("td", { class: "num", text: F.inteiro(x.resumo.estabelecimentos) }),
          el("td", { class: "quieto", text: ["ST", "CAD", "HB", "SR", "LT", "EQ", "PF"].filter((t) => x.resumo.arquivos.some((a) => a.tipo === t)).map((t) => NOME_ARQ_CNES[t]).join(", ") + (x.resumo.tem_nomes ? "" : " (sem nomes dos estabelecimentos)") }),
          el("td", { class: "num", text: F.mb(x.bytes) }),
          el("td", { class: "acao" },
            el("button", { class: "link pequeno", type: "button", title: "Baixa a competência mais recente desta UF", onclick: () => comecar("cnes_baixar", { pedido: { uf: x.uf, competencia: "" } }, `Baixando o CNES de ${x.uf}`) }, "atualizar"),
            " ", guardadas.some((g) => g.uf === x.uf) ? null : el("button", { class: "link pequeno perigo", type: "button", onclick: async (ev) => {
              const b = ev.currentTarget;
              if (b.dataset.certeza !== "1") { b.dataset.certeza = "1"; b.textContent = `apagar o CNES de ${x.uf}?`; return; }
              try { const msg = await invoke("cnes_apagar", { uf: x.uf }); await atualizarCnes(); desenhar(); setTimeout(() => avisoTopo(msg), 0); } catch (e) { avisoTopo(String(e)); }
            } }, "apagar")))))));
  } else {
    sec.append(el("p", { class: "quieto", text: "Nenhuma UF baixada." }));
  }
  sec.append(formBaixarCnes(ufs.length ? "Baixar outra UF ou competência" : "Baixar o CNES"), formImportarCnes());
  return sec;
}

// ---------- ligação com o resto da interface ----------
function iniciarUnidade() {
  $("ir-unidade").addEventListener("click", () => ir({ tipo: "unidade" }));
  $("aba-fav").addEventListener("click", () => E.arvore !== "fav" && escolherArvore("fav"));
}
