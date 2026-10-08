// Fase 4 na interface: produção do SUS (SIA e SIH) e rejeições. Usa os utilitários de app.js,
// extras.js e unidade.js (el, $, ir, invoke, F, tabelaFiltravel, botaoExportar...).
"use strict";

// ---------- situação ----------
async function atualizarProducao() {
  try { E.producao = await invoke("producao_situacao"); }
  catch (e) { E.producao = { ufs: [], erro: String(e) }; }
}
const producaoDaUf = (uf) => ((E.producao && E.producao.ufs) || []).find((x) => x.uf === uf);
/** UF cuja produção a ficha mostra: a da unidade, se baixada; senão a primeira baixada. */
function ufDaProducao() {
  const m = minhaUnidade();
  if (m && producaoDaUf(m.uf)) return m.uf;
  const l = (E.producao && E.producao.ufs) || [];
  return l.length ? l[0].uf : null;
}
const reais = (centavos) => `R$ ${F.moeda(centavos)}`;
const periodo = (de, ate) => (!de ? "" : de === ate ? F.competencia(de) : `${F.competencia(de)} a ${F.competencia(ate)}`);
/** Competências dos registros dos arquivos somados (não as do nome do arquivo). */
const competenciasDe = (x) => [...new Set(x.arquivos.flatMap((a) => a.competencias || []))].sort();
const NOME_PROD = { PA: "Ambulatorial (SIA)", RD: "Hospitalar (SIH)", ER: "Rejeitadas (SIH)" };
const AVISO_CAMPOS = "Os nomes dos campos desses arquivos ainda não foram conferidos com um arquivo oficial real. Confira os totais no TabNet antes de confiar neles.";

// ---------- ficha: quem produziu o procedimento ----------
function blocoProducao(codigo) {
  const sec = el("section", { class: "bloco producao" });
  const uf = ufDaProducao();
  if (!uf) {
    sec.classList.add("convite", "apt-compacto");
    sec.append(el("span", { class: "quieto", text: "Quem produziu este procedimento no SUS?" }),
      el("button", { class: "link", type: "button", onclick: () => ir({ tipo: "modulos", aba: "Baixar e importar" }) }, "Baixar a produção da UF"));
    return sec;
  }
  sec.append(carregando("Somando a produção…"));
  invoke("producao_procedimento", { competencia: E.comp, codigo, uf }).then((r) => {
    limpar(sec);
    if (!r.disponivel) { sec.append(el("p", { class: "quieto", text: r.mensagem })); return; }
    const sia = r.sia, sih = r.sih;
    const de = [sia.de, sih.de].filter(Boolean).sort()[0] || "";
    const ate = [sia.ate, sih.ate].filter(Boolean).sort().pop() || "";
    const nada = !sia.estabelecimentos && !sih.estabelecimentos;
    const resumo = el("div", { class: "prod-linha" },
      el("b", { text: "Produção no SUS" }), el("span", { class: "quieto", text: ` em ${r.uf}${de ? `, ${periodo(de, ate)}` : ""}` }));
    sec.append(resumo);
    if (nada) {
      sec.append(el("p", { class: "quieto", text: `Nenhum estabelecimento de ${r.uf} produziu este procedimento nas competências carregadas (${periodo(r.competencias_sia[0] || r.competencias_sih[0] || "", r.competencias_sia.at(-1) || r.competencias_sih.at(-1) || "")}).` }));
      return;
    }
    const parte = (nome, x, unid) => x.estabelecimentos
      ? el("span", { class: "prod-n" }, el("b", { text: F.inteiro(x.quantidade) }), ` ${unid} em `, el("b", { text: F.inteiro(x.estabelecimentos) }), ` estabelecimento(s), ${reais(x.valor_centavos)}`, el("small", { class: "quieto", text: ` ${nome}` }))
      : null;
    sec.append(el("div", { class: "prod-ns" }, parte("SIA", sia, "aprovados"), parte("SIH", sih, "AIH")));
    if (r.minha) sec.append(el("p", { class: "pequeno" }, "Minha unidade: ", el("b", { text: F.inteiro(r.minha.sia) }), " no SIA e ", el("b", { text: F.inteiro(r.minha.sih) }), " AIH no SIH."));
    const detalhe = el("div", { class: "prod-detalhe", hidden: true });
    const montar = () => {
      limpar(detalhe);
      const tabela = (titulo, x, unid) => x.lista.length ? el("div", {},
        el("h3", { text: `${titulo}: maiores produtores` }),
        el("table", { class: "tabela compacta" },
          el("thead", {}, el("tr", {}, ["CNES", "Estabelecimento", "Município", unid, "Valor", "Meses"].map((h, i) => el("th", { class: i >= 3 ? "num" : null, text: h })))),
          el("tbody", {}, x.lista.map((p) => el("tr", { class: p.minha ? "minha" : null },
            el("td", { class: "cod", text: p.cnes }),
            el("td", {}, p.estabelecimento.nome || el("span", { class: "falta", text: "nome não carregado" }), p.minha ? el("span", { class: "etiqueta verde", text: "minha unidade" }) : null),
            el("td", { class: "quieto", text: p.estabelecimento.municipio_nome || p.estabelecimento.municipio || "" }),
            el("td", { class: "num", text: F.inteiro(p.quantidade) }), el("td", { class: "num", text: reais(p.valor_centavos) }), el("td", { class: "num", text: String(p.meses) })))))) : null;
      detalhe.append(...[tabela("SIA", sia, "Aprovados"), tabela("SIH", sih, "AIH")].filter(Boolean));
      const c = r.confronto;
      if (c && c.exige && c.no_cadastro) {
        const pct = Math.round((c.aptos / c.no_cadastro) * 100);
        detalhe.append(el("p", { class: "pequeno" }, `Dos ${F.inteiro(c.no_cadastro)} produtores que estão no CNES carregado, a regra de aptidão considera ${F.inteiro(c.aptos)} aptos (${pct}%)${c.exige_servico ? "; serviço terceirizado não aparece no arquivo público" : ""}. A regra ainda não foi confirmada: este número ajuda a testá-la.`));
      }
      const pesoEx = tabelaPesoDasExigencias(r.peso_exigencias);
      if (pesoEx) detalhe.append(pesoEx);
      detalhe.append(el("p", { class: "quieto pequeno", text: r.aviso }));
      if (!r.campos_confirmados) detalhe.append(el("p", { class: "aviso pequeno", text: AVISO_CAMPOS }));
      detalhe.append(botaoExportar("Exportar produtores", async () => [`Produção ${codigo} ${r.uf}`, `Produção de ${F.mascara(codigo)} em ${r.uf}, ${periodo(de, ate)}`,
        [{ nome: "SIA", colunas: ["CNES", "Estabelecimento", "Município (código)", "Aprovados", "Valor (R$)", "Meses"], linhas: sia.lista.map((p) => [p.cnes, p.estabelecimento.nome || "", p.estabelecimento.municipio || "", p.quantidade, p.valor_centavos / 100, p.meses]) },
         { nome: "SIH", colunas: ["CNES", "Estabelecimento", "Município (código)", "AIH", "Valor (R$)", "Meses"], linhas: sih.lista.map((p) => [p.cnes, p.estabelecimento.nome || "", p.estabelecimento.municipio || "", p.quantidade, p.valor_centavos / 100, p.meses]) }]]));
    };
    let montado = false;
    const botao = el("button", { class: "link pequeno prod-mais", type: "button", "aria-expanded": "false", onclick: () => {
      detalhe.hidden = !detalhe.hidden;
      if (!detalhe.hidden && !montado) { montar(); montado = true; }
      botao.setAttribute("aria-expanded", String(!detalhe.hidden));
      botao.textContent = detalhe.hidden ? "Quem produziu" : "Ocultar";
    } }, "Quem produziu");
    sec.append(botao, detalhe);
  }).catch((e) => limpar(sec).append(erro(e)));
  return sec;
}

// ---------- Minha unidade: aba Produção ----------
async function abaProducao(corpo, u) {
  corpo.append(carregando("Somando a produção…"));
  let r;
  try { r = await invoke("producao_unidade", { competencia: E.comp, uf: u.uf, cnes: u.cnes }); }
  catch (e) { limpar(corpo).append(erro(e)); return; }
  limpar(corpo);
  if (!r.disponivel) {
    corpo.append(el("section", { class: "bloco convite" },
      el("h2", { text: `A produção de ${u.uf} ainda não foi baixada` }),
      el("p", { class: "quieto", text: r.mensagem }),
      el("div", { class: "acoes" }, el("button", { class: "botao primario", type: "button", onclick: () => ir({ tipo: "modulos", aba: "Baixar e importar" }) }, "Baixar em Módulos e dados"))));
    return;
  }
  const comps = [...new Set([...r.competencias_sia, ...r.competencias_sih])].sort();
  corpo.append(el("dl", { class: "chave" },
    el("div", {}, el("dt", { text: "Período" }), el("dd", { text: comps.length ? periodo(comps[0], comps.at(-1)) : "—" })),
    el("div", {}, el("dt", { text: "SIA aprovados" }), el("dd", { text: F.inteiro(r.total_ambulatorial) })),
    el("div", {}, el("dt", { text: "SIA valor" }), el("dd", { text: reais(r.valor_ambulatorial_centavos) })),
    el("div", {}, el("dt", { text: "SIH AIH aprovadas" }), el("dd", { text: F.inteiro(r.total_hospitalar) })),
    el("div", {}, el("dt", { text: "SIH valor" }), el("dd", { text: reais(r.valor_hospitalar_centavos) })),
    el("div", {}, el("dt", { text: "SIH AIH rejeitadas" }), el("dd", { text: F.inteiro(r.total_rejeitadas) }))));
  await blocosFaturamentoUnidade(corpo, u);
  if (!comps.length && !r.rejeicoes.length) {
    corpo.append(el("p", { class: "quieto", text: `Esta unidade não aparece na produção de ${u.uf} carregada.` }));
  }
  const linhasProc = (v) => v.map((p) => linhaT(`${p.procedimento} ${p.nome || ""}`, () => [
    el("td", { class: "cod" }, el("button", { class: "link mono", type: "button", onclick: () => ir({ tipo: "ficha", codigo: p.procedimento }) }, F.mascara(p.procedimento))),
    el("td", {}, p.nome || el("span", { class: "falta", text: `fora do SIGTAP de ${F.competencia(E.comp)}` })),
    el("td", { class: "num", text: F.inteiro(p.quantidade) }), el("td", { class: "num", text: reais(p.valor_centavos) }), el("td", { class: "num", text: String(p.meses) })]));
  const COL = (q) => [["Código"], ["Procedimento"], [q, "num"], ["Valor", "num"], ["Meses", "num"]];
  if (r.ambulatorial.length) corpo.append(el("h2", { text: "Produção ambulatorial (SIA)" }),
    ...tabelaFiltravel(COL("Aprovados"), linhasProc(r.ambulatorial), { dica: "Filtrar por código ou nome", limite: 100 }));
  if (r.hospitalar.length) corpo.append(el("h2", { text: "Produção hospitalar (SIH)" }),
    ...tabelaFiltravel(COL("AIH"), linhasProc(r.hospitalar), { dica: "Filtrar por código ou nome", limite: 100 }));
  corpo.append(el("h2", { text: "Rejeições do SIH" }));
  if (!r.tem_rejeicoes) corpo.append(el("p", { class: "quieto", text: "Os arquivos de AIH rejeitada (ER) não foram carregados para esta UF." }));
  else if (!r.rejeicoes.length) corpo.append(el("p", { class: "quieto", text: "Nenhuma AIH rejeitada para esta unidade nas competências carregadas." }));
  else corpo.append(el("table", { class: "tabela compacta" },
    el("thead", {}, el("tr", {}, ["Motivo", "Descrição oficial", "AIH", "Meses"].map((h, i) => el("th", { class: i >= 2 ? "num" : null, text: h })))),
    el("tbody", {}, r.rejeicoes.map((x) => el("tr", {},
      el("td", { class: "cod", text: x.motivo }),
      el("td", {}, x.descricao || el("span", { class: "falta", text: "descrição oficial (tabela MOTERRO) ainda não carregada" })),
      el("td", { class: "num", text: F.inteiro(x.quantidade) }), el("td", { class: "num", text: String(x.meses) }))))));
  corpo.append(el("p", { class: "quieto pequeno", text: r.aviso }));
  if (!r.campos_confirmados) corpo.append(el("p", { class: "aviso pequeno", text: AVISO_CAMPOS }));
  corpo.append(el("div", { class: "acoes" }, botaoExportar("Exportar produção", async () => [`Produção CNES ${u.cnes}`, `Produção de ${u.nome || `CNES ${u.cnes}`}, CNES ${u.cnes}, ${periodo(comps[0] || "", comps.at(-1) || "")}`,
    [{ nome: "SIA", colunas: ["Código", "Procedimento", "Aprovados", "Valor (R$)", "Meses"], linhas: r.ambulatorial.map((p) => [p.procedimento, p.nome || "", p.quantidade, p.valor_centavos / 100, p.meses]) },
     { nome: "SIH", colunas: ["Código", "Procedimento", "AIH", "Valor (R$)", "Meses"], linhas: r.hospitalar.map((p) => [p.procedimento, p.nome || "", p.quantidade, p.valor_centavos / 100, p.meses]) },
     { nome: "Rejeições", colunas: ["Motivo", "Descrição", "AIH", "Meses"], linhas: r.rejeicoes.map((x) => [x.motivo, x.descricao || "", x.quantidade, x.meses]) }]])));
}

// ---------- Módulos e dados ----------
function linhaModuloProducao() {
  const ufs = ((E.producao && E.producao.ufs) || []).filter((x) => !x.erro);
  if (!ufs.length) return ["Produção do SUS (SIA, SIH)", "não baixada", "—", "por UF, do FTP do DATASUS; só totais por estabelecimento"];
  return ["Produção do SUS (SIA, SIH)", `${ufs.length} UF(s)`,
    ufs.map((x) => { const c = competenciasDe(x); return `${x.uf} ${c.length ? periodo(c[0], c.at(-1)) : "—"}`; }).join("; "),
    `${F.inteiro(ufs.reduce((s, x) => s + x.arquivos.length, 0))} arquivo(s) somados; ${E.producao.manter_brutos ? "os arquivos baixados ficam guardados (chave ligada)" : "os arquivos oficiais não ficam guardados"}`];
}

/** Até quando a produção da UF está completa, por sistema. */
function completaAte(x) {
  const d = x.defasagem;
  if (!d) return "—";
  return [d.sia_ate && `SIA ${F.competencia(d.sia_ate)}`, d.sih_ate && `SIH ${F.competencia(d.sih_ate)}`].filter(Boolean).join("; ") || "—";
}

/** Arquivos baixados que ficaram guardados para a UF, com refazer o banco sem rede e apagar. */
function celulaGuardados(x) {
  const g = x.guardados || { arquivos: 0, bytes: 0 };
  if (!g.arquivos) return el("td", { class: "quieto pequeno", text: "—" });
  return el("td", { class: "pequeno" },
    el("div", { class: "quieto", text: `${F.inteiro(g.arquivos)} arquivo(s), ${F.mb(g.bytes)}` }),
    el("button", { class: "link", type: "button", disabled: E.tarefa.ativa, title: "Soma de novo os arquivos guardados, sem baixar nada",
      onclick: () => comecar("producao_reconstruir", { uf: x.uf }, `Refazendo a produção de ${x.uf} dos arquivos guardados`) }, "refazer sem baixar"),
    " ",
    el("button", { class: "link perigo", type: "button", onclick: async (ev) => {
      const b = ev.currentTarget;
      if (b.dataset.certeza !== "1") { b.dataset.certeza = "1"; b.textContent = "apagar os guardados?"; return; }
      try { const msg = await invoke("producao_apagar_guardados", { uf: x.uf }); await atualizarProducao(); desenhar(); setTimeout(() => avisoTopo(msg), 0); } catch (e) { avisoTopo(String(e)); }
    } }, "apagar guardados"));
}

/** A chave "guardar os arquivos baixados": desligada por padrão, porque os arquivos têm dado de paciente. */
function chaveGuardarArquivos() {
  const ligada = !!(E.producao && E.producao.manter_brutos);
  const caixa = el("input", { type: "checkbox", checked: ligada, "aria-label": "Guardar os arquivos baixados" });
  caixa.addEventListener("change", async () => {
    try { await invoke("manter_brutos_definir", { ligada: caixa.checked }); await atualizarProducao(); desenhar(); } catch (e) { caixa.checked = !caixa.checked; avisoTopo(String(e)); }
  });
  return el("div", { class: "chave-guardar" },
    el("label", { class: "apagar-zips" }, caixa, " Guardar os arquivos baixados (para refazer o banco sem baixar de novo)"),
    el("p", { class: "quieto pequeno", text: "Desligado (padrão), o programa apaga cada arquivo logo depois de somar. Ligado, os arquivos ficam na pasta do programa (dados\\producao\\arquivos) e servem para refazer a produção quando o banco mudar. Atenção: os arquivos oficiais de produção têm dado de paciente (CNS do profissional, número da AIH, nascimento). Ficam só neste computador, mas ocupam espaço (centenas de MB por mês em UF grande) e devem ser tratados como dado sensível. Os arquivos de profissionais e do cadastro com CPF do CNES nunca são guardados." }));
}

function secaoProducao() {
  const ufs = (E.producao && E.producao.ufs) || [];
  const todas = (E.cnes && E.cnes.ufs_disponiveis) || [];
  const sec = el("section", { class: "bloco", id: "sec-producao" },
    el("div", { class: "cab-linha" }, el("h2", { text: "Produção do SUS por UF" }),
      el("small", { text: "SIA e SIH; só totais, sem dados de paciente" })));
  if (ufs.length) {
    sec.append(el("table", { class: "tabela" },
      el("thead", {}, el("tr", {}, ["UF", "Competências", "Completa até", "Arquivos somados", "Tamanho", "Arquivos guardados", ""].map((h) => el("th", { text: h })))),
      el("tbody", {}, ufs.map((x) => x.erro
        ? el("tr", {}, el("td", {}, el("b", { text: x.uf })), el("td", { colspan: "6" }, erro(x.erro)))
        : el("tr", {},
          el("td", {}, el("b", { text: x.uf })),
          el("td", { class: "mono", text: (() => { const c = competenciasDe(x); return c.length ? periodo(c[0], c.at(-1)) : "—"; })() }),
          el("td", { class: "quieto pequeno", text: completaAte(x) }),
          el("td", { class: "quieto", text: [...new Set(x.arquivos.map((a) => NOME_PROD[a.tipo] || a.tipo))].join(", ") }),
          el("td", { class: "num", text: F.mb(x.bytes_banco) }),
          celulaGuardados(x),
          el("td", { class: "acao" }, el("button", { class: "link pequeno perigo", type: "button", onclick: async (ev) => {
            const b = ev.currentTarget;
            if (b.dataset.certeza !== "1") { b.dataset.certeza = "1"; b.textContent = `apagar a produção de ${x.uf}?`; return; }
            try { const msg = await invoke("producao_apagar", { uf: x.uf }); await atualizarProducao(); desenhar(); setTimeout(() => avisoTopo(msg), 0); } catch (e) { avisoTopo(String(e)); }
          } }, "apagar")))))));
    sec.append(chaveGuardarArquivos());
    if (ufs.some((x) => !x.erro && x.arquivos.some((a) => !a.confirmado))) sec.append(el("p", { class: "aviso pequeno", text: AVISO_CAMPOS }));
    const velhas = ufs.filter((x) => x.defasagem && x.defasagem.sem_campos_novos && x.defasagem.sem_campos_novos.length);
    if (velhas.length) sec.append(el("p", { class: "aviso pequeno", text: `${velhas.map((x) => `${x.uf} (${x.defasagem.sem_campos_novos.length} mês(es))`).join(", ")}: baixados antes dos campos novos (apresentado × aprovado, financiamento, dias de internação). Baixe de novo, mais abaixo, para ver esses números.` }));
    const incompletas = ufs.filter((x) => x.defasagem && (x.defasagem.sia_incompleto || x.defasagem.sih_incompleto));
    if (incompletas.length) sec.append(el("p", { class: "quieto pequeno", text: incompletas.map((x) => `${x.uf}: ${[x.defasagem.sia_incompleto && `SIA de ${F.competencia(x.defasagem.sia_incompleto)}`, x.defasagem.sih_incompleto && `SIH de ${F.competencia(x.defasagem.sih_incompleto)}`].filter(Boolean).join(" e ")} incompleto (o DATASUS ainda está recebendo); as análises usam os meses completos`).join("; ") + "." }));
  } else {
    sec.append(el("p", { class: "quieto", text: "Nenhuma UF baixada. Escolha a UF e quantos meses; o programa mostra o tamanho antes de baixar." }));
  }
  const uf = seletorUf((minhaUnidade() || {}).uf || null, todas);
  const meses = el("select", { class: "campo", "aria-label": "Quantos meses" },
    [1, 3, 6, 12, 24, 36, 60].map((n) => el("option", { value: String(n) }, n === 1 ? "o mês mais recente" : `os ${n} meses mais recentes`)));
  meses.value = "3";
  const info = el("div", { class: "prod-plano", role: "status" });
  const confirma = el("input", { type: "checkbox" });
  const confirmaTxt = el("label", { class: "apagar-zips", hidden: true }, confirma, " Estou ciente do tamanho e quero baixar");
  const baixarAgora = () => comecar("producao_baixar", { pedido: { uf: uf.value, meses: Number(meses.value), confirmado: confirma.checked } }, `Baixando a produção de ${uf.value}`);
  const ver = el("button", { class: "botao", type: "button", onclick: async () => {
    ver.disabled = true; limpar(info).append(carregando("Consultando o DATASUS…"));
    try {
      const p = await invoke("producao_plano", { uf: uf.value, meses: Number(meses.value) });
      limpar(info).append(el("p", {}, `${p.itens.length} arquivo(s), ${F.mb(p.total_bytes)} de ${p.uf}.`),
        el("p", { class: "quieto pequeno", text: [...new Set(p.itens.map((i) => `${NOME_PROD[i.tipo] || i.tipo} ${F.competencia(i.competencia)}`))].join("; ") }));
      confirmaTxt.hidden = !p.precisa_confirmar;
      if (p.precisa_confirmar) info.append(el("p", { class: "aviso pequeno", text: "O download passa de 500 MB. Confirme abaixo para baixar." }));
    } catch (e) { limpar(info).append(erro(e)); }
    ver.disabled = false;
  } }, "Ver tamanho");
  sec.append(el("div", { class: "acoes baixar-cnes" }, el("label", { class: "rotulo-campo" }, "UF", uf), el("label", { class: "rotulo-campo" }, "Período", meses), ver,
    el("button", { class: "botao primario", type: "button", disabled: !todas.length || E.tarefa.ativa, onclick: baixarAgora }, ufs.length ? "Baixar outra UF ou período" : "Baixar a produção")),
    confirmaTxt, info);
  if (!todas.length) sec.append(el("p", { class: "quieto pequeno", text: "Baixe antes o CNES de uma UF: é dele que vem a lista de UFs e os nomes dos estabelecimentos." }));
  // Importar de uma pasta.
  const ufI = seletorUf(null, todas);
  const caminho = el("input", { type: "text", class: "campo", placeholder: "Pasta com PAUFAAMMa.dbc, RDUFAAMM.dbc e ERUFAAMM.dbc", "aria-label": "Pasta com os arquivos de produção" });
  sec.append(el("details", { class: "manual" }, el("summary", { text: "Sem acesso ao FTP? Importar arquivos baixados por outro caminho" }),
    el("p", { class: "quieto pequeno", text: "Em ftp.datasus.gov.br/dissemin/publicos, baixe da pasta SIASUS/200801_/Dados os arquivos PA da UF e do mês (por exemplo PAMS2607a.dbc) e da pasta SIHSUS/200801_/Dados os RD e ER. Junte numa pasta e indique aqui. O programa soma por estabelecimento e não guarda os arquivos." }),
    el("div", { class: "acoes" }, el("label", { class: "rotulo-campo" }, "UF", ufI), caminho,
      el("button", { class: "botao", type: "button", onclick: async () => { try { const p = await invoke("escolher_pasta"); if (p) caminho.value = p; } catch (e) { avisoTopo(String(e)); } } }, "Procurar pasta…"),
      el("button", { class: "botao", type: "button", onclick: () => caminho.value.trim() ? comecar("producao_importar", { pasta: caminho.value.trim(), uf: ufI.value }, `Importando a produção de ${ufI.value}`) : caminho.focus() }, "Importar"))));
  sec.append(painelProgresso());
  return sec;
}
