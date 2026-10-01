// SIGTAP Aberto: extras da interface v2.3 (avisos, atualizações, Sobre, feedback, CIDs em
// árvore, saúde do banco). Carregado antes de app.js; usa E, el, $, F e invoke de app.js só
// depois que a página abriu. Todo texto vindo de dados entra por textContent.
"use strict";

const SITE_SIGTAP_PADRAO = "http://sigtap.datasus.gov.br/tabela-unificada/app/sec/inicio.jsp";
const SEIS_HORAS = 6 * 60 * 60 * 1000;

// ---------- navegador ----------
async function abrirSite(url) {
  try { await invoke("abrir_site", { url }); }
  catch (e) { avisoTopo(String(e)); }
}
const abrirSigtap = () => abrirSite((E.info && E.info.site_sigtap) || SITE_SIGTAP_PADRAO);
const urlRepo = () => `https://github.com/${(E.info && E.info.repositorio) || ""}`;

// ---------- janela (modal) ----------
const Modal = { retorno: null };
function abrirModal(titulo, corpo, opc) {
  const j = limpar($("modal-janela"));
  j.className = "janela" + (opc && opc.larga ? " larga" : "");
  j.append(
    el("div", { class: "cab-janela" },
      el("h1", { id: "modal-titulo", text: titulo }),
      el("button", { class: "icone fechar", type: "button", "aria-label": "Fechar", title: "Fechar (Esc)", onclick: fecharModal }, "×")),
    ...[].concat(corpo));
  Modal.retorno = document.activeElement;
  $("modal").hidden = false;
  j.focus();
}
function fecharModal() {
  if ($("modal").hidden) return;
  $("modal").hidden = true;
  limpar($("modal-janela"));
  if (Modal.retorno && Modal.retorno.focus) Modal.retorno.focus();
  Modal.retorno = null;
}
function iniciarModal() {
  $("modal").addEventListener("pointerdown", (ev) => { if (ev.target === $("modal")) fecharModal(); });
  document.addEventListener("keydown", (ev) => {
    if ($("modal").hidden) return;
    if (ev.key === "Escape") { ev.preventDefault(); fecharModal(); return; }
    if (ev.key !== "Tab") return;
    const alvos = [...$("modal-janela").querySelectorAll("button, input, textarea, select, a[href]")].filter((x) => !x.disabled && x.offsetParent !== null);
    if (!alvos.length) return;
    const i = alvos.indexOf(document.activeElement);
    if (ev.shiftKey && i <= 0) { ev.preventDefault(); alvos[alvos.length - 1].focus(); }
    else if (!ev.shiftKey && i === alvos.length - 1) { ev.preventDefault(); alvos[0].focus(); }
  });
}

// ---------- avisos no alto da tela ----------
const Avisos = new Map();
function mostrarAviso(id, a) { Avisos.set(id, a); desenharAvisos(); }
function tirarAviso(id) { if (Avisos.delete(id)) desenharAvisos(); }
function desenharAvisos() {
  const c = limpar($("avisos"));
  for (const [id, a] of Avisos) {
    c.append(el("div", { class: `faixa-aviso ${a.nivel || "info"}`, role: a.nivel === "erro" ? "alert" : "status" },
      el("span", { class: "texto-aviso", text: a.texto }),
      (a.acoes || []).map((x) => el("button", { class: "botao pequeno" + (x.primaria ? " primario" : ""), type: "button", onclick: x.fn }, x.rotulo)),
      el("button", { class: "icone fechar", type: "button", "aria-label": "Dispensar o aviso", title: "Dispensar", onclick: () => tirarAviso(id) }, "×")));
  }
}

// ---------- vigia: dados novos e versão nova ----------
const Vigia = { dados: null, quandoDados: null, erroDados: null, ocupadoDados: false,
  versao: null, quandoVersao: null, erroVersao: null, ocupadoVersao: false };
const hora = (d) => d ? d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }) : "";

async function conferirDados(manual) {
  if (Vigia.ocupadoDados) return;
  // Cortesia com o servidor: uma conexão por vez. Não confere no meio de um download.
  if (E.tarefa.ativa) { if (manual) avisoTopo("Há um download em andamento. Verifique de novo quando ele terminar."); return; }
  if (E.situacao && E.situacao.primeira_execucao) return;
  Vigia.ocupadoDados = true; atualizarSecaoAtualizacoes();
  try {
    Vigia.dados = await invoke("verificar_dados"); Vigia.erroDados = null;
  } catch (e) { Vigia.erroDados = String(e); }
  Vigia.quandoDados = new Date(); Vigia.ocupadoDados = false;
  aplicarAvisoDados(); atualizarSecaoAtualizacoes();
}
function aplicarAvisoDados() {
  const r = Vigia.dados;
  if (!r || !r.novos.length) { tirarAviso("dados"); return; }
  const partes = r.novos.map((n) => `${F.competencia(n.competencia)} (${n.motivo === "nova" ? "nova" : "republicada"})`);
  mostrarAviso("dados", {
    nivel: "info",
    texto: `Há dados novos no DATASUS: ${partes.join(", ")}. Para baixar, são cerca de ${F.mb(r.bytes)}.`,
    acoes: [{ rotulo: "Baixar agora", primaria: true, fn: baixarNovidades }, { rotulo: "Ver em Módulos e dados", fn: () => ir({ tipo: "modulos" }) }],
  });
}
function baixarNovidades() {
  const r = Vigia.dados;
  if (!r || !r.escopo) return;
  tirarAviso("dados");
  baixar({ sigtap: r.escopo, territorio: false, apagar_zips: false });
}

async function conferirVersao(manual) {
  if (Vigia.ocupadoVersao) return;
  Vigia.ocupadoVersao = true; atualizarSecaoAtualizacoes();
  try { Vigia.versao = await invoke("consultar_atualizacao"); Vigia.erroVersao = null; }
  catch (e) { Vigia.erroVersao = String(e); }
  Vigia.quandoVersao = new Date(); Vigia.ocupadoVersao = false;
  const n = Vigia.versao && Vigia.versao.nova;
  if (n) {
    mostrarAviso("versao", {
      nivel: "info",
      texto: `Nova versão do programa: ${n.versao} (você usa a ${Vigia.versao.atual}).`,
      acoes: [{ rotulo: "Atualizar agora", primaria: true, fn: () => confirmarAtualizacao(n) }, { rotulo: "Ver novidades", fn: () => abrirSite(n.pagina) }],
    });
  } else tirarAviso("versao");
  atualizarSecaoAtualizacoes();
}

function confirmarAtualizacao(n) {
  if (E.tarefa.ativa) { avisoTopo("Há uma tarefa em andamento. Espere terminar ou cancele, e atualize depois."); return; }
  abrirModal(`Atualizar para a versão ${n.versao}`, [
    el("p", { text: `O programa vai baixar a versão ${n.versao}${n.zip_tamanho ? ` (${F.mb(n.zip_tamanho)})` : ""} do GitHub, conferir se o arquivo chegou inteiro (SHA-256), trocar o executável e abrir de novo sozinho.` }),
    el("p", { class: "quieto", text: "A pasta dados, com seus bancos e ZIPs, não é tocada. A versão atual fica guardada como sigtap-aberto.antigo.exe até a próxima abertura. O executável não tem assinatura digital: o SHA-256 prova que o arquivo chegou inteiro, não quem o publicou." }),
    n.notas ? el("details", {}, el("summary", { text: "Novidades desta versão" }), el("pre", { class: "notas", text: n.notas })) : null,
    el("div", { class: "acoes" }, el("div", { class: "espaco" }),
      el("button", { class: "botao", type: "button", onclick: fecharModal }, "Agora não"),
      el("button", { class: "botao primario", type: "button", onclick: () => { fecharModal(); tirarAviso("versao"); comecar("atualizar_programa", {}, "Atualizando o programa"); } }, "Atualizar e reabrir")),
  ]);
}

/** Depois de cada tarefa: um download concluído muda o que há de novo. */
function aposTarefa(f) {
  if (!f.ok && !f.cancelada) mostrarAviso("falha", { nivel: "erro", texto: f.mensagem });
  if (f.ok) { Vigia.dados = null; tirarAviso("dados"); setTimeout(() => conferirDados(false), 3000); }
}

function iniciarVigia() {
  // Confere pouco depois de abrir e a cada 6 horas enquanto o programa estiver aberto.
  setTimeout(() => { conferirDados(false); conferirVersao(false); }, 20000);
  setInterval(() => { conferirDados(false); conferirVersao(false); }, SEIS_HORAS);
}

// Seção "Atualizações" de Módulos e dados.
function textoStatusDados() {
  if (Vigia.ocupadoDados) return "Consultando o servidor do DATASUS…";
  if (Vigia.erroDados) return `Não foi possível consultar o servidor agora (${Vigia.erroDados}). Tente mais tarde.`;
  if (!Vigia.quandoDados) return "Ainda não conferido nesta abertura do programa.";
  const r = Vigia.dados;
  if (r && r.novos.length) return `${r.novos.length} novidade(s): ${r.novos.map((n) => `${F.competencia(n.competencia)} ${n.motivo === "nova" ? "nova" : "republicada"}`).join(", ")}. Conferido às ${hora(Vigia.quandoDados)}.`;
  return `Tudo em dia: nenhuma competência nova nem republicada. Conferido às ${hora(Vigia.quandoDados)}.`;
}
function textoStatusVersao() {
  if (Vigia.ocupadoVersao) return "Consultando o GitHub…";
  if (Vigia.erroVersao) return `Não foi possível consultar o GitHub agora (${Vigia.erroVersao}).`;
  if (!Vigia.quandoVersao) return "Ainda não conferida nesta abertura do programa.";
  const n = Vigia.versao && Vigia.versao.nova;
  return n ? `Há uma versão nova: ${n.versao}. Conferido às ${hora(Vigia.quandoVersao)}.` : `Nenhuma versão mais nova publicada. Conferido às ${hora(Vigia.quandoVersao)}.`;
}
function conteudoAtualizacoes() {
  const novoDados = Vigia.dados && Vigia.dados.novos.length && Vigia.dados.escopo;
  const nova = Vigia.versao && Vigia.versao.nova;
  return [
    el("div", { class: "cab-linha" }, el("h2", { text: "Atualizações" }), el("small", { text: "o programa confere sozinho a cada 6 horas enquanto está aberto" })),
    el("div", { class: "linha-atu" },
      el("div", {}, el("b", { text: "Dados do SIGTAP" }), el("br"), el("span", { class: "quieto", text: textoStatusDados() })),
      el("div", { class: "acoes" },
        novoDados ? el("button", { class: "botao primario", type: "button", disabled: E.tarefa.ativa, onclick: baixarNovidades }, "Baixar novidades") : null,
        el("button", { class: "botao", type: "button", disabled: Vigia.ocupadoDados, onclick: () => conferirDados(true) }, "Verificar agora"))),
    el("div", { class: "linha-atu" },
      el("div", {}, el("b", { text: `Programa, versão ${(E.info && E.info.versao) || ""}` }), el("br"), el("span", { class: "quieto", text: textoStatusVersao() })),
      el("div", { class: "acoes" },
        nova ? el("button", { class: "botao primario", type: "button", onclick: () => confirmarAtualizacao(nova) }, `Atualizar para ${nova.versao}`) : null,
        el("button", { class: "botao", type: "button", disabled: Vigia.ocupadoVersao, onclick: () => conferirVersao(true) }, "Procurar nova versão"))),
  ];
}
function secaoAtualizacoes() { return el("section", { class: "bloco", id: "sec-atualizacoes" }, conteudoAtualizacoes()); }
function atualizarSecaoAtualizacoes() {
  const s = $("sec-atualizacoes");
  if (s) { limpar(s); s.append(...conteudoAtualizacoes()); }
}

// ---------- saúde do banco ----------
function secaoSaude() {
  const z = (E.situacao && E.situacao.zips) || {};
  const res = el("div", { class: "saude-res", "aria-live": "polite" });
  const botoes = [];
  const botao = (rotulo, fn, extra) => { const b = el("button", { class: "botao" + (extra ? ` ${extra}` : ""), type: "button", onclick: fn }, rotulo); botoes.push(b); return b; };
  const ocupar = (v) => botoes.forEach((b) => { b.disabled = v || E.tarefa.ativa; });
  const confirma = el("div", { class: "aviso", hidden: true },
    el("p", { text: `O banco atual será guardado numa pasta de segurança (banco_com_problema_1, _2…) dentro de dados e refeito a partir dos ${z.arquivos || 0} ZIP(s) guardados em dados\\zips. Competências que não tiverem ZIP guardado precisam ser baixadas de novo em Baixar do DATASUS.` }),
    el("div", { class: "acoes" },
      el("button", { class: "botao primario", type: "button", onclick: () => { confirma.hidden = true; res.textContent = ""; comecar("recriar_banco", { forcar: true }, "Refazendo o banco"); } }, "Recriar o banco"),
      el("button", { class: "botao", type: "button", onclick: () => { confirma.hidden = true; } }, "Não recriar")));
  async function verificar(completo) {
    ocupar(true);
    limpar(res).append(el("p", { class: "quieto", text: completo ? "Verificação completa em andamento; pode levar alguns minutos." : "Verificando…" }));
    try {
      const r = await invoke("verificar_bancos", { completo });
      limpar(res);
      let algumRuim = false;
      for (const i of r.itens) {
        if (!i.existe) { res.append(el("p", { class: "quieto", text: `${i.nome} (${i.arquivo}): ainda não existe.` })); continue; }
        if (i.ok) res.append(el("p", { class: "ok", text: `${i.nome} (${i.arquivo}, ${F.mb(i.bytes)}): íntegro${completo ? " na verificação completa" : " na verificação rápida"}.` }));
        else {
          algumRuim = true;
          res.append(el("p", { class: "erro", text: `${i.nome} (${i.arquivo}): ${i.danificado ? "danificado" : "não foi possível verificar"}. ${i.mensagens.join(" ")}` }));
        }
      }
      if (algumRuim) { res.append(el("p", { text: "Use Recriar o banco para refazê-lo a partir dos ZIPs guardados." })); }
      else if (!completo) res.append(el("p", { class: "quieto", text: "A verificação rápida confere a estrutura. A completa também confere índices e conteúdo." }));
    } catch (e) { limpar(res).append(erro(e)); }
    ocupar(false);
  }
  const sec = el("section", { class: "bloco", id: "sec-saude" },
    el("div", { class: "cab-linha" }, el("h2", { text: "Saúde dos dados" }), el("small", { text: "use se o programa mostrar erro ao consultar ou fechar de repente" })),
    el("p", { class: "quieto", text: "Os bancos ficam na pasta dados. Se algum arquivo ficar danificado (queda de energia, disco cheio, cópia interrompida), o programa percebe ao abrir, guarda o arquivo ruim numa pasta de segurança e refaz o banco sozinho a partir dos ZIPs guardados." }),
    el("div", { class: "acoes" },
      botao("Verificar o banco", () => verificar(false)),
      botao("Verificação completa", () => verificar(true)),
      botao("Recriar o banco…", () => { confirma.hidden = false; })),
    confirma, res, painelProgresso());
  return sec;
}

/** Se a consulta falhou por banco danificado, a mensagem ganha o caminho para o reparo. */
function pareceBancoDanificado(msg) { return /malformed|corrupt|not a database|disk image|danificad/i.test(String(msg)); }

/** Abertura: se o programa guardou um banco danificado, avisa e refaz sozinho. */
function tratarRecuperacao() {
  const r = E.situacao && E.situacao.recuperacao;
  if (!r) { tirarAviso("recuperacao"); return; }
  const pode = (r.zips > 0 && r.bancos.includes("tabela de procedimentos")) || r.territorio_local;
  const onde = r.pastas.join(" e ");
  mostrarAviso("recuperacao", {
    nivel: "erro",
    texto: `O banco de dados (${r.bancos.join(" e ")}) estava danificado. O arquivo foi guardado em ${onde}. ` +
      (pode ? `O programa está refazendo o banco a partir de ${r.zips} ZIP(s) guardados; competências sem ZIP precisam ser baixadas de novo.` : "Não há ZIPs guardados: baixe os dados de novo na janela que se abre."),
    acoes: [{ rotulo: "Ver em Módulos e dados", fn: () => ir({ tipo: "modulos" }) }],
  });
  if (pode && !E.tarefa.ativa) { E.recuperando = true; comecar("recriar_banco", { forcar: false }, "Refazendo o banco"); }
}

// ---------- árvore: abas, expandir/recolher tudo, CIDs ----------
const D_EXPANDIR = "M4 6l4-3.5L12 6M4 10l4 3.5 4-3.5";
const D_RECOLHER = "M4 2.5l4 3.5 4-3.5M4 13.5L8 10l4 3.5";
function svgIcone(d) {
  const NS = "http://www.w3.org/2000/svg";
  const s = document.createElementNS(NS, "svg");
  for (const [k, v] of Object.entries({ width: "16", height: "16", viewBox: "0 0 16 16", "aria-hidden": "true" })) s.setAttribute(k, v);
  const p = document.createElementNS(NS, "path");
  for (const [k, v] of Object.entries({ d, fill: "none", stroke: "currentColor", "stroke-width": "1.7", "stroke-linecap": "round", "stroke-linejoin": "round" })) p.setAttribute(k, v);
  s.append(p);
  return s;
}

const abertosDaArvore = () => (E.arvore === "cid" ? E.abertosCid : E.abertos);
function atualizarBotaoTudo() {
  const b = $("arvore-tudo");
  const algum = abertosDaArvore().size > 0;
  limpar(b).append(svgIcone(algum ? D_RECOLHER : D_EXPANDIR));
  const t = algum ? "Recolher tudo" : (E.arvore === "cid" ? "Expandir todas as letras" : "Expandir grupos e subgrupos");
  b.title = t; b.setAttribute("aria-label", t);
}
async function alternarTudo() {
  const ab = abertosDaArvore();
  const recolher = ab.size > 0;
  if (recolher) ab.clear(); else E.expandir = true;
  $("arvore-total").textContent = recolher ? "" : "expandindo…";
  try { await desenharArvore(); } finally { E.expandir = false; }
  $("arvore-total").textContent = "";
  atualizarBotaoTudo();
}
function escolherArvore(qual, tocar) {
  E.arvore = qual;
  try { localStorage.setItem("arvore-aba", qual); } catch { /* sem armazenamento: vale só nesta abertura */ }
  $("aba-proc").setAttribute("aria-selected", String(qual === "proc"));
  $("aba-cid").setAttribute("aria-selected", String(qual === "cid"));
  $("arvore").setAttribute("aria-label", qual === "cid" ? "CIDs em árvore" : "Tabela de procedimentos");
  atualizarBotaoTudo();
  if (tocar !== false) desenharArvore();
}
function iniciarAbasArvore() {
  let salva = "proc";
  try { salva = localStorage.getItem("arvore-aba") === "cid" ? "cid" : "proc"; } catch { /* usa o padrão */ }
  $("aba-proc").addEventListener("click", () => E.arvore !== "proc" && escolherArvore("proc"));
  $("aba-cid").addEventListener("click", () => E.arvore !== "cid" && escolherArvore("cid"));
  $("arvore-tudo").addEventListener("click", alternarTudo);
  for (const aba of [$("aba-proc"), $("aba-cid")]) aba.addEventListener("keydown", (ev) => {
    if (ev.key === "ArrowRight" || ev.key === "ArrowLeft") { const o = aba === $("aba-proc") ? $("aba-cid") : $("aba-proc"); o.focus(); o.click(); }
  });
  escolherArvore(salva, false);
}

async function abrirNoCid(li, no) {
  const filhos = li.querySelector("ul");
  if (filhos) { filhos.remove(); li.classList.remove("aberto"); E.abertosCid.delete(no.codigo); li.querySelector(".seta").textContent = "▸"; atualizarBotaoTudo(); return; }
  E.abertosCid.add(no.codigo);
  li.classList.add("aberto");
  li.querySelector(".seta").textContent = "▾";
  const ul = el("ul", { role: "group" });
  li.append(ul);
  await preencherArvoreCid(ul, no.codigo);
  atualizarBotaoTudo();
}

async function preencherArvoreCid(ul, pai) {
  let nos;
  try { nos = await invoke("arvore_cid", { competencia: E.comp, pai: pai || null }); }
  catch (e) { ul.append(el("li", {}, erro(e))); return; }
  const nivel = pai ? (pai.length === 1 ? 1 : 2) : 0;
  for (const no of nos) {
    const folha = no.nivel === "subcategoria";
    const completo = no.codigo_mascarado;
    const corte = no.nivel === "letra" ? 0 : no.nivel === "categoria" ? 1 : 4;
    const rotuloNome = no.nivel === "letra" ? `CIDs que começam com ${no.codigo}` : no.nome;
    const btn = el("button", {
      class: "no" + (folha ? " folha" : "") + (folha && no.codigo === E.selecionadoCid ? " selecionado" : ""),
      type: "button", role: "treeitem", "data-cid": no.codigo, "aria-level": String(nivel + 1),
      title: `${completo} ${rotuloNome || ""}${no.procedimentos ? `: ${F.inteiro(no.procedimentos)} procedimento(s) ligados` : ""}`.trim(),
    },
      el("span", { class: "seta", text: folha ? "" : "▸" }),
      el("span", { class: "texto-no" },
        el("span", { class: "cod" }, el("span", { class: "pai", text: completo.slice(0, corte) }), el("span", { class: "seg", text: completo.slice(corte) })),
        " ",
        rotuloNome ? el("span", { class: "nome", text: rotuloNome }) : el("span", { class: "nome sem-nome", text: "sem nome na tabela de CIDs desta competência" })),
      no.procedimentos ? el("span", { class: "cnt", text: F.inteiro(no.procedimentos) }) : null);
    btn.style.setProperty("--nivel", String(nivel));
    const li = el("li", {}, btn);
    btn.addEventListener("click", () => {
      if (!folha) { abrirNoCid(li, no); return; }
      E.selecionadoCid = no.codigo;
      document.querySelectorAll("#arvore-raiz .no.selecionado").forEach((x) => x.classList.remove("selecionado"));
      btn.classList.add("selecionado");
      $("busca").value = no.codigo_mascarado;
      ir({ tipo: "busca", texto: no.codigo, ligar: { tabela: "tb_cid", codigo: [no.codigo] } });
    });
    ul.append(li);
    const abrir = E.abertosCid.has(no.codigo) || (E.expandir && no.nivel === "letra");
    if (!folha && abrir) { E.abertosCid.delete(no.codigo); await abrirNoCid(li, no); }
  }
}

async function desenharArvoreCid() {
  const raiz = limpar($("arvore-raiz"));
  if (!E.comp) return;
  raiz.append(el("li", {}, carregando("Carregando os CIDs…")));
  const tmp = el("ul");
  await preencherArvoreCid(tmp, null);
  limpar(raiz).append(...tmp.children);
  atualizarBotaoTudo();
}

// ---------- Sobre ----------
function abrirSobre() {
  const i = E.info || {};
  const pix = APOIO.pix ? el("div", { class: "apoio-pix" },
    el("span", { class: "quieto", text: `Chave Pix${APOIO.pixNome ? ` (${APOIO.pixNome})` : ""}` }),
    el("div", { class: "url" }, el("code", { text: APOIO.pix }),
      el("button", { class: "botao pequeno", type: "button", onclick: (ev) => copiar(APOIO.pix, ev.currentTarget.parentNode, "chave Pix copiada") }, "Copiar chave Pix"),
      el("span", { class: "copiado", role: "status" }))) : null;
  const sponsors = APOIO.sponsors ? el("button", { class: "botao", type: "button", onclick: () => abrirSite(`https://github.com/sponsors/${APOIO.sponsors}`) }, "Apoiar pelo GitHub Sponsors") : null;
  abrirModal("Sobre o SIGTAP Aberto", [
    el("p", { class: "agradece", text: "Obrigado por usar o SIGTAP Aberto." }),
    el("p", { text: "Este programa existe para ajudar quem fatura no SUS: consultar a Tabela de Procedimentos com o histórico de cada competência, conferir as regras de cobrança e evitar glosas. Tudo roda neste computador; nenhum dado seu ou de paciente sai dele." }),
    el("p", { text: "O SIGTAP Aberto é gratuito e pode ser copiado e distribuído livremente: o código é aberto (licença AGPL-3.0) e o que é público continua público. Os dados vêm das fontes oficiais (DATASUS e IBGE); nenhum dado oficial é redistribuído pelo programa." }),
    el("p", { text: "Se ele ajuda no seu trabalho e você quiser contribuir para que continue sendo desenvolvido e atualizado, pode apoiar o projeto com uma contribuição voluntária. É opcional: o programa continua completo sem ela, e a contribuição não dá direito a recibo nem a nenhum recurso extra." }),
    (pix || sponsors) ? el("div", { class: "apoio" }, pix, sponsors) : el("p", { class: "quieto", text: "As formas de apoiar o projeto serão publicadas aqui em breve." }),
    el("p", { class: "quieto pequeno", text: "Ferramenta não oficial. Não substitui o SIGTAP, o SIA ou o SIH do Ministério da Saúde: confira no site oficial antes de faturar." }),
    el("div", { class: "info-versao" },
      el("span", { class: "quieto", text: `Versão ${i.versao || ""}${i.repositorio ? ` · ${i.repositorio}` : ""}` }),
      el("button", { class: "link", type: "button", onclick: () => abrirSite(urlRepo()) }, "Código-fonte no GitHub"),
      el("button", { class: "link", type: "button", onclick: () => { fecharModal(); ir({ tipo: "modulos" }); } }, "Procurar atualizações")),
    el("div", { class: "acoes" }, el("div", { class: "espaco" }),
      el("button", { class: "botao", type: "button", onclick: () => { fecharModal(); abrirFeedback(); } }, "Sugerir ou relatar"),
      el("button", { class: "botao primario", type: "button", onclick: fecharModal }, "Fechar")),
  ], { larga: false });
}

// ---------- feedback ----------
const TIPOS_FEEDBACK = [
  ["sugestao", "Sugestão", "Sugestão"], ["problema", "Problema no programa", "Problema"],
  ["dado", "Dado errado ou faltando", "Dado"], ["outro", "Outro assunto", "Outro"],
];
function infoParaRelato() {
  const i = E.info || {};
  const linhas = [`SIGTAP Aberto ${i.versao || "?"}`];
  if (i.windows) linhas.push(`Windows: ${i.windows}`); else if (i.so) linhas.push(`Sistema: ${i.so} ${i.arquitetura || ""}`.trim());
  if (i.webview2) linhas.push(`WebView2: ${i.webview2}`);
  linhas.push(`Competência em uso: ${E.comp ? F.competencia(E.comp) : "nenhuma"}; competências carregadas: ${E.comps.length}`);
  linhas.push(`Tela: ${E.rota.tipo}`);
  return linhas.join("\n");
}
function abrirFeedback() {
  const escolha = { tipo: "sugestao" };
  const texto = el("textarea", { class: "campo area", rows: "4", maxlength: "2500", placeholder: "Conte o que aconteceu ou o que você gostaria que o programa fizesse. Se for um problema, diga o que estava fazendo e o que esperava ver.", "aria-label": "Descrição" });
  const contato = el("input", { type: "text", class: "campo", maxlength: "120", placeholder: "Seu e-mail ou telefone, se quiser resposta (opcional)", "aria-label": "Contato (opcional)" });
  const incluir = el("input", { type: "checkbox", checked: true });
  const previa = el("pre", { class: "notas", text: infoParaRelato() });
  incluir.addEventListener("change", () => { previa.hidden = !incluir.checked; });
  const montar = () => {
    const t = TIPOS_FEEDBACK.find((x) => x[0] === escolha.tipo);
    const descr = texto.value.trim();
    const titulo = `[${t[2]}] ${descr.split("\n")[0].slice(0, 70) || "sem título"}`;
    const corpo = [`**Tipo:** ${t[1]}`, "", descr || "(sem descrição)",
      contato.value.trim() ? `\n**Contato:** ${contato.value.trim()}` : "",
      incluir.checked ? `\n---\nInformações do programa (sem dados de paciente):\n${infoParaRelato()}` : ""].join("\n");
    return { titulo, corpo };
  };
  const exigir = () => { if (!texto.value.trim()) { texto.focus(); aviso.textContent = "Escreva uma descrição antes de enviar."; aviso.hidden = false; return false; } aviso.hidden = true; return true; };
  const aviso = el("p", { class: "aviso", hidden: true, role: "alert" });
  const rotuloCopia = el("span", { class: "copiado", role: "status" });
  abrirModal("Sugerir ou relatar um problema", [
    el("p", { class: "aviso", text: "Não escreva nem cole dados de pacientes (nome, CPF, CNS, prontuário) nem trechos de arquivos de faturamento. Se precisar mostrar um caso, descreva sem identificar a pessoa." }),
    el("fieldset", { class: "escopo tipos" }, el("legend", {}, el("b", { text: "Assunto" })),
      TIPOS_FEEDBACK.map(([v, r]) => el("label", { class: "opcao" }, el("input", { type: "radio", name: "tipo-feedback", value: v, checked: v === escolha.tipo, onchange: () => { escolha.tipo = v; } }), el("span", { text: r })))),
    texto, contato,
    el("label", { class: "opcao" }, incluir, el("span", {}, "Incluir informações do programa para ajudar a entender o caso")),
    previa, aviso,
    el("div", { class: "acoes" },
      el("div", { class: "espaco" }),
      el("button", { class: "botao", type: "button", onclick: fecharModal }, "Cancelar"),
      el("button", { class: "botao", type: "button", onclick: async (ev) => {
        if (!exigir()) return;
        const { titulo, corpo } = montar();
        try { await navigator.clipboard.writeText(`${titulo}\n\n${corpo}`); rotuloCopia.textContent = "texto copiado"; }
        catch { rotuloCopia.textContent = "não foi possível copiar"; }
        setTimeout(() => { rotuloCopia.textContent = ""; }, 2500);
      } }, "Copiar texto"),
      APOIO.email ? el("button", { class: "botao", type: "button", onclick: () => {
        if (!exigir()) return;
        const { titulo, corpo } = montar();
        abrirSite(`mailto:${APOIO.email}?subject=${encodeURIComponent(`SIGTAP Aberto: ${titulo}`)}&body=${encodeURIComponent(corpo.slice(0, 1700))}`);
      } }, "Enviar por e-mail") : null,
      el("button", { class: "botao primario", type: "button", title: "Abre o GitHub no navegador com o texto pronto; é preciso ter uma conta gratuita no GitHub", onclick: () => {
        if (!exigir()) return;
        const { titulo, corpo } = montar();
        abrirSite(`${urlRepo()}/issues/new?title=${encodeURIComponent(titulo)}&body=${encodeURIComponent(corpo.slice(0, 5000))}`);
      } }, "Enviar pelo GitHub")),
    el("p", { class: "quieto pequeno" }, "O envio pelo GitHub abre o navegador com o texto pronto; você confere e confirma lá (é preciso ter uma conta gratuita no GitHub). Nada é enviado sem o seu clique. ", rotuloCopia),
  ], { larga: true });
  texto.focus();
}

// ---------- inicialização dos extras ----------
async function iniciarExtras() {
  E.arvore = "proc"; E.abertosCid = new Set(); E.selecionadoCid = null; E.expandir = false; E.info = null; E.recuperando = false;
  iniciarModal();
  iniciarAbasArvore();
  $("ir-sobre").addEventListener("click", abrirSobre);
  $("ir-feedback").addEventListener("click", abrirFeedback);
  try { E.info = await invoke("info_programa"); } catch { E.info = null; }
}
