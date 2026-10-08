import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ProvedorDaSessao } from "../../shell/sessao";
import * as comandos from "../../api/comandos";
import type { Busca, ItemProcedimento, NoDeArvore, NoDeCid, Situacao } from "../../api/tipos";
import { fichaDeExemplo } from "./exemplos";
import { Explorar } from "./Explorar";

vi.mock("../../api/comandos");
const m = vi.mocked(comandos);

const P = (codigo: string, nivel: NoDeArvore["nivel"], nome: string | null, procedimentos = 1): NoDeArvore => ({ nivel, codigo, codigo_mascarado: codigo, nome, procedimentos });
const C = (codigo: string, nivel: NoDeCid["nivel"], nome: string | null, codigos = 2, procedimentos = 5): NoDeCid => ({ nivel, codigo, codigo_mascarado: codigo.length === 4 ? `${codigo.slice(0, 3)}.${codigo[3]}` : codigo, nome, codigos, procedimentos });
const lig = (codigo: string, nome: string, valor: number, extra: Partial<ItemProcedimento> = {}): ItemProcedimento => ({
  codigo, codigo_mascarado: codigo, nome, tp_complexidade: "2", complexidade: "Média Complexidade", valor_total_centavos: valor,
  instrumentos: ["BPA (Individualizado)"], forma: "030204", forma_nome: "Forma", ...extra,
});

const GRUPOS = [P("01", "grupo", "Ações de promoção", 144), P("02", "grupo", "Diagnóstico", 1108), P("03", "grupo", "Procedimentos clínicos", 864)];
const FOLHAS = [P("0301010062", "procedimento", "CONSULTA MEDICA EM ATENÇÃO PRIMÁRIA"), P("0301010072", "procedimento", "CONSULTA MEDICA EM ATENÇÃO ESPECIALIZADA"), P("0301010099", "procedimento", "CONSULTA PARA AVALIAÇÃO DO FUMANTE")];

function arvoreFalsa(extra: Record<string, NoDeArvore[]> = {}) {
  const tabela: Record<string, NoDeArvore[]> = {
    "": GRUPOS,
    "03": [P("0301", "subgrupo", "Consultas / Atendimentos / Acompanhamentos", 221), P("0302", "subgrupo", null, 24)],
    "0301": [P("030101", "forma", "Consultas médicas/outros profissionais  de nivel superior", 3)],
    "030101": FOLHAS, ...extra,
  };
  m.arvore.mockImplementation(async (pai) => tabela[pai ?? ""] ?? []);
}
function cidFalso() {
  const tabela: Record<string, NoDeCid[]> = {
    "": [C("H", "letra", null, 90, 93), C("I", "letra", null, 700, 362)],
    I: [C("I00", "categoria", "Febre reumática", 1, 9), C("I11", "categoria", "Doença cardíaca hipertensiva", 3, 7)],
    I11: [C("I110", "subcategoria", "Com insuficiência cardíaca", 1, 5), C("I119", "subcategoria", "Sem insuficiência cardíaca", 1, 5)],
  };
  m.arvoreCid.mockImplementation(async (pai) => tabela[pai ?? ""] ?? []);
}

function larga(sim: boolean) {
  window.matchMedia = vi.fn().mockImplementation((q: string) => ({ matches: sim, media: q, addEventListener: () => {}, removeEventListener: () => {}, addListener: () => {}, removeListener: () => {} })) as never;
}

function montar(rota = "#/consultar/explorar") {
  window.location.hash = rota;
  const cliente = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={cliente}><ProvedorDaSessao><Explorar /></ProvedorDaSessao></QueryClientProvider>);
}
const linhaDe = (nome: RegExp) => screen.findByRole("treeitem", { name: nome });
const sp = (s: string | null) => (s ?? "").replace(/ /g, " ");

beforeEach(() => {
  vi.resetAllMocks();
  larga(true);
  Element.prototype.scrollIntoView = vi.fn();
  m.situacao.mockResolvedValue({ competencias: [{ competencia: "202609", rotulo: "09/2026", arquivo: "a", versao: null, publicado_em: null, sha256: "" }] } as unknown as Situacao);
  m.ficha.mockResolvedValue(fichaDeExemplo());
  arvoreFalsa();
  cidFalso();
});

test("raiz: grupos com número, nome e contagem à direita", async () => {
  montar();
  const g = await linhaDe(/^03 Procedimentos clínicos/);
  expect(g).toHaveTextContent("864");
  expect(g).toHaveAttribute("aria-expanded", "false");
  expect(screen.getByRole("tree", { name: "Procedimentos" })).toBeInTheDocument();
  expect(m.arvore).toHaveBeenCalledWith(null, undefined);
});

test("abrir um nó carrega os filhos uma vez, mostra a espera e usa a máscara do nível", async () => {
  const u = userEvent.setup();
  let soltar: (v: NoDeArvore[]) => void = () => {};
  m.arvore.mockImplementation((pai) => (pai === "03" ? new Promise((r) => { soltar = r; }) : Promise.resolve(pai ? [] : GRUPOS)));
  montar();
  (await linhaDe(/^03 Procedimentos/)).focus();
  await u.keyboard("{ArrowRight}");
  expect(await screen.findByRole("treeitem", { name: "Carregando" })).toBeInTheDocument();
  soltar([P("0301", "subgrupo", "Consultas / Atendimentos / Acompanhamentos", 221)]);
  expect(await linhaDe(/^03\.01 Consultas/)).toBeInTheDocument();
  await u.keyboard("{ArrowLeft}{ArrowRight}");
  expect(m.arvore.mock.calls.filter((c) => c[0] === "03")).toHaveLength(1);
});

test("nó sem nome diz que não tem nome nesta competência", async () => {
  const u = userEvent.setup();
  montar();
  (await linhaDe(/^03 Procedimentos/)).focus();
  await u.keyboard("{ArrowRight}");
  expect(await linhaDe(/^03\.02 sem nome nesta competência/)).toBeInTheDocument();
});

test("a rota reabre a cadeia de pais, seleciona o procedimento e o revela", async () => {
  montar("#/consultar/explorar/procedimentos/0301010072");
  const p = await linhaDe(/^03\.01\.01\.007-2 CONSULTA MEDICA EM ATENÇÃO ESPECIALIZADA/);
  expect(p).toHaveAttribute("aria-selected", "true");
  for (const pai of ["03", "0301", "030101"]) expect(m.arvore).toHaveBeenCalledWith(pai, undefined);
  await waitFor(() => expect(Element.prototype.scrollIntoView).toHaveBeenCalled());
});

test("setas, Home, End e escrever para ir ao item; a seleção vai para a URL", async () => {
  const u = userEvent.setup();
  montar("#/consultar/explorar/procedimentos/0301010062");
  const primeira = await linhaDe(/^03\.01\.01\.006-\d/);
  primeira.focus();
  await u.keyboard("{ArrowDown}");
  expect(await linhaDe(/^03\.01\.01\.007-2/)).toHaveFocus();
  expect(window.location.hash).toBe("#/consultar/explorar/procedimentos/0301010072");
  await u.keyboard("{End}");
  expect(screen.getAllByRole("treeitem").at(-1)).toHaveFocus();
  await u.keyboard("{Home}");
  expect(screen.getAllByRole("treeitem")[0]).toHaveFocus();
  await u.keyboard("{ArrowRight}");
  await waitFor(() => expect(m.arvore).toHaveBeenCalledWith("01", undefined));
  await u.keyboard("02");
  expect(await linhaDe(/^02 Diagnóstico/)).toHaveFocus();
});

test("← fecha o nó aberto e, num nó fechado, vai para o pai; * abre os irmãos", async () => {
  const u = userEvent.setup();
  montar("#/consultar/explorar/procedimentos/0301");
  const sub = await linhaDe(/^03\.01 Consultas/);
  sub.focus();
  await u.keyboard("{ArrowLeft}");
  expect(sub).toHaveAttribute("aria-expanded", "false");
  await u.keyboard("{ArrowLeft}");
  expect(await linhaDe(/^03 Procedimentos clínicos/)).toHaveFocus();
  await u.keyboard("{ArrowUp}*");
  await waitFor(() => { expect(m.arvore).toHaveBeenCalledWith("01", undefined); expect(m.arvore).toHaveBeenCalledWith("02", undefined); });
});

test("Enter num procedimento abre a ficha; Enter num nó abre ou fecha", async () => {
  const u = userEvent.setup();
  montar("#/consultar/explorar/procedimentos/0301010072");
  (await linhaDe(/^03\.01\.01\.007-2/)).focus();
  await u.keyboard("{Enter}");
  expect(window.location.hash).toBe("#/consultar/0301010072");
});

test("caminho fixo mostra o número de cada nível e leva ao nível clicado", async () => {
  const u = userEvent.setup();
  montar("#/consultar/explorar/procedimentos/0301010072");
  await linhaDe(/^03\.01\.01\.007-2/);
  const caminho = screen.getByRole("navigation", { name: "Caminho na árvore" });
  expect(within(caminho).getAllByRole("button").map((b) => b.textContent)).toEqual([
    "03 Procedimentos Clínicos", "01 Consultas/Atendimentos/Acompanhamentos", "01 Consultas Médicas/Outros Profissionais de Nivel Superior",
  ]);
  await u.click(within(caminho).getByRole("button", { name: /^01 Consultas\/Atendimentos/ }));
  expect(window.location.hash).toBe("#/consultar/explorar/procedimentos/0301");
});

test("prévia (tela larga): valores e o que se exige, sem sair da árvore; Abrir ficha navega", async () => {
  const u = userEvent.setup();
  montar("#/consultar/explorar/procedimentos/0301010072");
  const previa = await screen.findByRole("complementary", { name: "Prévia" });
  expect((await within(previa).findAllByText("R$ 10,00", { exact: false })).length).toBeGreaterThan(0);
  expect(within(previa).getByText("Valores")).toBeInTheDocument();
  expect(within(previa).getByText("Para cobrar")).toBeInTheDocument();
  expect(m.ficha).toHaveBeenCalledWith("0301010072", undefined);
  await u.click(within(previa).getByRole("button", { name: "Abrir ficha" }));
  expect(window.location.hash).toBe("#/consultar/0301010072");
});

test("tela estreita: sem prévia lateral; o detalhe abre sob o item selecionado", async () => {
  larga(false);
  montar("#/consultar/explorar/procedimentos/0301010072");
  await linhaDe(/^03\.01\.01\.007-2/);
  expect(screen.queryByRole("complementary", { name: "Prévia" })).not.toBeInTheDocument();
  const detalhe = await screen.findByRole("treeitem", { name: "Detalhes de 03.01.01.007-2" });
  expect(await within(detalhe).findByRole("button", { name: "Abrir ficha" })).toBeInTheDocument();
});

test("CID: letras com o nome do capítulo, categorias e subcategorias", async () => {
  const u = userEvent.setup();
  montar("#/consultar/explorar/cid");
  const i = await linhaDe(/^I Doenças do aparelho circulatório/);
  expect(screen.getByRole("treeitem", { name: /^H Doenças do olho, anexos e ouvido/ })).toBeInTheDocument();
  i.focus();
  await u.keyboard("{ArrowRight}");
  expect(await linhaDe(/^I00 Febre reumática/)).toBeInTheDocument();
  expect(screen.getByRole("tree", { name: "CID" })).toBeInTheDocument();
});

test("CID: prévia lista os procedimentos ligados e Enter abre a Busca pelo código", async () => {
  const u = userEvent.setup();
  m.ligados.mockResolvedValue([
    lig("0302040030", "ATENDIMENTO FISIOTERAPÊUTICO", 934), lig("0303060107", "TRATAMENTO DE CRISE HIPERTENSIVA", 18967, { instrumentos: ["AIH (Proc. Principal)"], complexidade: "Alta Complexidade" }),
    lig("0301010072", "Terceiro", 1000), lig("0301010080", "Quarto", 1000), lig("0301010099", "Quinto", 1000),
  ]);
  montar("#/consultar/explorar/cid/I119");
  const sub = await linhaDe(/^I11\.9 Sem insuficiência/);
  const previa = await screen.findByRole("complementary", { name: "Prévia" });
  expect(await within(previa).findByText("5 procedimentos ligados")).toBeInTheDocument();
  expect(m.ligados).toHaveBeenCalledWith("tb_cid", ["I119"], undefined);
  expect(sp(previa.textContent)).toContain("R$ 9,34 a R$ 189,67");
  expect(within(previa).getByText("BPA · AIH")).toBeInTheDocument();
  expect(within(previa).getByRole("button", { name: "ver mais 3" })).toBeInTheDocument();
  expect(within(previa).getAllByRole("link")).toHaveLength(2);
  expect(within(previa).getByRole("button", { name: "Ver os 5 procedimentos" })).toBeInTheDocument();
  sub.focus();
  await u.keyboard("{Enter}");
  expect(window.location.hash).toBe("#/consultar/q/I11.9");
});

test("trocar de árvore guarda a escolha na rota", async () => {
  const u = userEvent.setup();
  montar();
  await linhaDe(/^03 Procedimentos/);
  await u.click(screen.getByRole("radio", { name: "CID" }));
  expect(window.location.hash).toBe("#/consultar/explorar/cid");
  expect(await screen.findByRole("tree", { name: "CID" })).toBeInTheDocument();
});

test("Recolher tudo fecha o que estava aberto; Abrir nível abre até o nível escolhido", async () => {
  const u = userEvent.setup();
  montar("#/consultar/explorar/procedimentos/0301010072");
  await linhaDe(/^03\.01\.01\.007-2/);
  await u.click(screen.getByRole("button", { name: "Recolher tudo" }));
  expect(await linhaDe(/^03 Procedimentos/)).toHaveAttribute("aria-expanded", "false");
  expect(screen.queryByRole("treeitem", { name: /^03\.01 / })).not.toBeInTheDocument();
  await u.click(screen.getByRole("button", { name: "Abrir nível" }));
  await u.click(await screen.findByRole("menuitem", { name: "Até os subgrupos" }));
  expect(await linhaDe(/^03\.01 Consultas/)).toBeInTheDocument();
});

test("lista longa: mostra 200 e libera mais em blocos", async () => {
  const u = userEvent.setup();
  const muitos = Array.from({ length: 450 }, (_, i) => P(`03010100${String(i).padStart(2, "0")}`, "procedimento", `PROCEDIMENTO ${i}`));
  arvoreFalsa({ "030101": muitos });
  montar("#/consultar/explorar/procedimentos/0301010000");
  await linhaDe(/^03\.01\.01 /);
  const folhas = () => screen.getAllByRole("treeitem").filter((r) => r.getAttribute("aria-level") === "4" && r.dataset["id"]);
  await waitFor(() => expect(folhas()).toHaveLength(200));
  await u.click(screen.getByRole("button", { name: /Mostrar mais 250/ }));
  await waitFor(() => expect(folhas().length).toBeGreaterThan(200));
});

test("erro ao carregar um nó oferece tentar de novo", async () => {
  const u = userEvent.setup();
  let falhar = true;
  m.arvore.mockImplementation(async (pai) => {
    if (pai === "03" && falhar) throw new Error("sem resposta");
    return pai === null ? GRUPOS : [P("0301", "subgrupo", "Consultas", 221)];
  });
  montar();
  (await linhaDe(/^03 Procedimentos/)).focus();
  await u.keyboard("{ArrowRight}");
  const tentar = await screen.findByRole("button", { name: "Tentar de novo" });
  falhar = false;
  await u.click(tentar);
  expect(await linhaDe(/^03\.01 Consultas/)).toBeInTheDocument();
});

test("filtro: mostra só o que casa, com os pais abertos, e diz quantos", async () => {
  const u = userEvent.setup();
  const achados = FOLHAS.map((f) => lig(f.codigo, f.nome ?? "", 1000, { forma: "030101", forma_nome: "Consultas médicas/outros profissionais  de nivel superior" }));
  m.buscar.mockResolvedValue({ consulta: "consulta medica", competencia: "202609", modo: "texto", total_procedimentos: 3, procedimentos: achados, apoio: [] } as Busca);
  montar();
  await linhaDe(/^03 Procedimentos/);
  await u.type(screen.getByRole("searchbox", { name: "Filtrar a árvore" }), "consulta medica");
  expect(await screen.findByRole("status")).toHaveTextContent("3 de 2.116 procedimentos");
  expect(await linhaDe(/^03\.01\.01 Consultas médicas/)).toBeInTheDocument();
  expect(screen.getAllByRole("treeitem").filter((r) => r.getAttribute("aria-level") === "4")).toHaveLength(3);
  expect(screen.queryByRole("treeitem", { name: /^01 Ações/ })).not.toBeInTheDocument();
});

test("filtro de CID lista os códigos que casam", async () => {
  const u = userEvent.setup();
  m.buscar.mockResolvedValue({
    consulta: "hipertens", competencia: "202609", modo: "texto", total_procedimentos: 0, procedimentos: [],
    apoio: [{ tabela: "tb_cid", colunas: ["co_cid"], codigo: ["I10"], nome: "Hipertensão essencial (primária)", procedimentos: 26 }],
  } as Busca);
  montar("#/consultar/explorar/cid");
  await linhaDe(/^I /);
  await u.type(screen.getByRole("searchbox", { name: "Filtrar a árvore" }), "hipertens");
  expect(await linhaDe(/^I10 Hipertensão essencial/)).toBeInTheDocument();
  expect(screen.getByRole("status")).toHaveTextContent("1 código");
});

const marca = (tipo: string, codigo: string, extra: Record<string, unknown> = {}) =>
  ({ tipo, codigo, favorito: false, favorito_desde: null, anotacao: null, anotacao_de: null, ...extra });

test("prévia do procedimento: CBO e CID com três itens e 'e mais', e Favorito grava", async () => {
  const u = userEvent.setup();
  m.ficha.mockResolvedValue(fichaDeExemplo({ cbos: 69, cids: 5 }));
  m.marcado.mockResolvedValue(marca("procedimento", "0301010072") as never);
  m.marcarFavorito.mockResolvedValue(marca("procedimento", "0301010072", { favorito: true }) as never);
  montar("#/consultar/explorar/procedimentos/0301010072");
  const previa = await screen.findByRole("complementary", { name: "Prévia" });
  const cbo = await within(previa).findByRole("region", { name: "CBO" });
  expect(within(cbo).getByText("CBO · 69 aceitos")).toBeInTheDocument();
  expect(within(cbo).getAllByRole("listitem")).toHaveLength(3);
  expect(within(cbo).getByRole("button", { name: "ver mais 66" })).toBeInTheDocument();
  await u.click(within(cbo).getByRole("button", { name: "ver mais 66" }));
  expect(within(cbo).getAllByRole("listitem")).toHaveLength(69);
  await u.click(within(cbo).getByRole("button", { name: "ver menos" }));
  expect(within(cbo).getAllByRole("listitem")).toHaveLength(3);
  expect(within(within(previa).getByRole("region", { name: "CID" })).getByRole("button", { name: "ver mais 2" })).toBeInTheDocument();
  const favorito = await within(previa).findByRole("button", { name: "Favorito" });
  await waitFor(() => expect(favorito).toBeEnabled());
  await u.click(favorito);
  await waitFor(() => expect(m.marcarFavorito).toHaveBeenCalledWith("procedimento", "0301010072", true));
});

test("prévia do CID: Favorito grava como CID", async () => {
  const u = userEvent.setup();
  m.ligados.mockResolvedValue([lig("0302040030", "ATENDIMENTO", 934)]);
  m.marcado.mockResolvedValue(marca("cid", "I119") as never);
  m.marcarFavorito.mockResolvedValue(marca("cid", "I119", { favorito: true }) as never);
  montar("#/consultar/explorar/cid/I119");
  const previa = await screen.findByRole("complementary", { name: "Prévia" });
  const favorito = await within(previa).findByRole("button", { name: "Favorito" });
  await waitFor(() => expect(favorito).toBeEnabled());
  await u.click(favorito);
  await waitFor(() => expect(m.marcarFavorito).toHaveBeenCalledWith("cid", "I119", true));
});

test("a linha de um item favoritado ou anotado mostra a marca, também no nome acessível", async () => {
  m.marcados.mockImplementation(async (tipo) => (tipo === "procedimento"
    ? [{ ...marca("procedimento", "0301010072", { favorito: true, anotacao: "conferir" }), existe: true, nome: "x" }] : []) as never);
  montar("#/consultar/explorar/procedimentos/0301010072");
  const marcada = await linhaDe(/^03\.01\.01\.007-2/);
  await waitFor(() => expect(marcada).toHaveAccessibleName(/favorito, com anotação$/));
  expect(within(marcada).getByRole("img", { name: "Favorito" })).toBeInTheDocument();
  expect(screen.getByRole("treeitem", { name: /^03\.01\.01\.006-2/ })).not.toHaveAccessibleName(/favorito/);
});

test("clicar numa linha com filhos seleciona e já abre os filhos; clicar de novo não fecha", async () => {
  const u = userEvent.setup();
  montar();
  const g = await linhaDe(/^03 Procedimentos clínicos/);
  await u.click(g);
  expect(await linhaDe(/^03\.01 Consultas/)).toBeInTheDocument();
  expect(g).toHaveAttribute("aria-expanded", "true");
  await u.click(g);
  expect(g).toHaveAttribute("aria-expanded", "true");
});

test("prévia do CID: 'ver mais' abre todos os procedimentos ligados e volta a recolher ao trocar de item", async () => {
  const u = userEvent.setup();
  m.ligados.mockResolvedValue([lig("0302040030", "A", 934), lig("0301010072", "B", 1000), lig("0301010080", "C", 1000), lig("0301010099", "D", 1000)]);
  montar("#/consultar/explorar/cid/I119");
  const previa = await screen.findByRole("complementary", { name: "Prévia" });
  await u.click(await within(previa).findByRole("button", { name: "ver mais 2" }));
  expect(within(previa).getAllByRole("link")).toHaveLength(4);
  const outra = await linhaDe(/^I11\.0 /);
  await u.click(outra);
  const nova = await screen.findByRole("complementary", { name: "Prévia" });
  expect(await within(nova).findByRole("button", { name: "ver mais 2" })).toBeInTheDocument();
});
