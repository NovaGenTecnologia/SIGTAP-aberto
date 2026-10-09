import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ProvedorDeAvisos } from "../componentes/base/Avisos";
import { ProvedorDaSessao } from "../shell/sessao";
import * as comandos from "../api/comandos";
import type { BuscaPaginada, Facetas, ItemMarcado, ItemProcedimento, NoDeArvore, Situacao } from "../api/tipos";
import { Consultar } from "./Consultar";
import { fichaDeExemplo } from "./consultar/exemplos";

vi.mock("../api/comandos");
const m = vi.mocked(comandos);

const item = (codigo: string, nome: string, extra: Partial<ItemProcedimento> = {}): ItemProcedimento => ({
  na_descricao: false,
  codigo, codigo_mascarado: `${codigo.slice(0, 2)}.${codigo.slice(2, 4)}.${codigo.slice(4, 6)}.${codigo.slice(6, 9)}-${codigo.slice(9)}`,
  nome, tp_complexidade: "2", complexidade: "Média Complexidade", valor_total_centavos: 1000, instrumentos: ["BPA (Consolidado)", "BPA (Individualizado)"],
  forma: "030101", forma_nome: "Consultas médicas", ...extra,
});

const FACETAS: Facetas = {
  tipo: [{ valor: "procedimento", rotulo: "Procedimentos", n: 237 }],
  complexidade: [
    { valor: "1", rotulo: "Atenção Básica Complexidade", n: 21 }, { valor: "2", rotulo: "Média Complexidade", n: 207 }, { valor: "3", rotulo: "Alta Complexidade", n: 9 },
  ],
  instrumento: [{ valor: "BPA (Individualizado)", rotulo: null, n: 200 }],
  grupo: [{ valor: "03", rotulo: "Procedimentos clínicos", n: 237 }],
  forma: [{ valor: "030101", rotulo: "Consultas médicas", n: 237 }],
};

const pagina = (extra: Partial<BuscaPaginada> = {}): BuscaPaginada => ({
  consulta: "consulta", competencia: "202609", modo: "texto", total: 237, total_filtrado: 237, pagina: 1, paginas: 3,
  procedimentos: [
    item("0301010072", "Consulta médica em atenção especializada"),
    item("0301010048", "Consulta de profissionais de nível superior", { valor_total_centavos: 630 }),
    item("0301010056", "Consulta com descrição", { na_descricao: true }),
  ],
  apoio: [], facetas: FACETAS, ...extra,
});

const P = (codigo: string, nivel: NoDeArvore["nivel"], nome: string | null, procedimentos = 1): NoDeArvore => ({ nivel, codigo, codigo_mascarado: codigo, nome, procedimentos });
const favorito = (codigo: string, nome: string): ItemMarcado =>
  ({ tipo: "procedimento", codigo, favorito: true, favorito_desde: null, anotacao: null, anotacao_de: null, existe: true, nome });

function montar(rota = "#/consultar") {
  window.location.hash = rota;
  const cliente = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={cliente}><ProvedorDaSessao><ProvedorDeAvisos><Consultar /></ProvedorDeAvisos></ProvedorDaSessao></QueryClientProvider>);
}
const campo = () => screen.getByRole("combobox", { name: "Buscar" });

beforeEach(() => {
  window.localStorage.clear();
  vi.resetAllMocks();
  m.situacao.mockResolvedValue({ competencias: [{ competencia: "202609", rotulo: "09/2026", arquivo: "a" }] } as unknown as Situacao);
  m.buscarPagina.mockResolvedValue(pagina());
  m.marcados.mockResolvedValue([]);
  m.arvore.mockImplementation(async (pai) => (pai ? [] : [P("01", "grupo", "Ações de promoção", 144), P("03", "grupo", "Procedimentos clínicos", 864)]));
  m.arvoreCid.mockResolvedValue([]);
});

test("vazio: campo único focado e a árvore; sem abas nem exemplos", async () => {
  montar();
  expect(await screen.findByRole("tree", { name: "Procedimentos" })).toBeInTheDocument();
  expect(campo()).toHaveFocus();
  expect(screen.queryByText("Exemplos")).toBeNull();
  expect(screen.queryByRole("tab", { name: "Buscar" })).toBeNull();
  expect(screen.queryByRole("tab", { name: "Explorar" })).toBeNull();
  expect(screen.queryByRole("searchbox", { name: "Filtrar a árvore" })).toBeNull();
  expect(m.buscarPagina).not.toHaveBeenCalled();
});

test("o endereço antigo explorar/cid abre a árvore de CID", async () => {
  montar("#/consultar/explorar/cid");
  expect(await screen.findByRole("tree", { name: "CID" })).toBeInTheDocument();
});

test("digitar troca a rota (sem empilhar histórico) e mostra Procedimentos com o total", async () => {
  const u = userEvent.setup();
  montar();
  await screen.findByRole("tree", { name: "Procedimentos" });
  const antes = window.history.length;
  await u.type(campo(), "consulta");
  await waitFor(() => expect(window.location.hash).toBe("#/consultar/q/consulta"));
  expect(window.history.length).toBe(antes);
  expect(await screen.findByRole("heading", { name: "Procedimentos" })).toBeInTheDocument();
  expect(screen.getByText("237 procedimentos")).toBeInTheDocument();
  expect(m.buscarPagina).toHaveBeenCalledWith("consulta", expect.objectContaining({ complexidade: [], codigos: null }), 1, undefined);
  expect(screen.queryByRole("tree")).toBeNull();
});

test("com 1 caractere ainda não busca", async () => {
  const u = userEvent.setup();
  montar();
  await screen.findByRole("tree", { name: "Procedimentos" });
  await u.type(campo(), "c");
  await new Promise((r) => setTimeout(r, 450));
  expect(m.buscarPagina).not.toHaveBeenCalled();
  expect(window.location.hash).toBe("#/consultar");
});

test("apagar o texto volta à árvore", async () => {
  const u = userEvent.setup();
  montar("#/consultar/q/consulta");
  await screen.findByRole("heading", { name: "Procedimentos" });
  await u.clear(campo());
  await waitFor(() => expect(window.location.hash).toBe("#/consultar"));
  expect(await screen.findByRole("tree", { name: "Procedimentos" })).toBeInTheDocument();
});

test("a rota com texto, filtros e página busca exatamente isso", async () => {
  montar("#/consultar/q/consulta?cx=2&ins=BPA%20(Individualizado)&pg=2");
  await screen.findByRole("heading", { name: "Procedimentos" });
  expect(campo()).toHaveValue("consulta");
  expect(m.buscarPagina).toHaveBeenCalledWith(
    "consulta", { tipo: [], complexidade: ["2"], instrumento: ["BPA (Individualizado)"], grupo: [], forma: [], codigos: null }, 2, undefined);
  expect(screen.getByText("Média", { selector: ".chips-filtro__chip" })).toBeInTheDocument();
});

test("marcar um filtro muda a rota e volta à página 1", async () => {
  const u = userEvent.setup();
  montar("#/consultar/q/consulta?pg=2");
  await screen.findByRole("heading", { name: "Procedimentos" });
  await u.click(screen.getAllByRole("checkbox", { name: /^Média/ })[0]!);
  await waitFor(() => expect(window.location.hash).toBe("#/consultar/q/consulta?cx=2"));
  await waitFor(() => expect(m.buscarPagina).toHaveBeenLastCalledWith("consulta", expect.objectContaining({ complexidade: ["2"] }), 1, undefined));
});

test("ir à página 2 busca a página 2 e põe pg=2 na rota", async () => {
  const u = userEvent.setup();
  montar("#/consultar/q/consulta");
  await screen.findByRole("heading", { name: "Procedimentos" });
  expect(screen.getByText("1–100 de 237 procedimentos")).toBeInTheDocument();
  await u.click(screen.getByRole("button", { name: "Página 2" }));
  await waitFor(() => expect(m.buscarPagina).toHaveBeenLastCalledWith("consulta", expect.anything(), 2, undefined));
  expect(window.location.hash).toBe("#/consultar/q/consulta?pg=2");
});

test("Só favoritos manda os códigos dos favoritos", async () => {
  const u = userEvent.setup();
  m.marcados.mockResolvedValue([favorito("0301010072", "Consulta médica"), favorito("0301010048", "Consulta de profissionais")]);
  montar("#/consultar/q/consulta");
  await screen.findByRole("heading", { name: "Procedimentos" });
  await u.click((await screen.findAllByRole("switch", { name: "Só favoritos" }))[0]!);
  await waitFor(() => expect(m.buscarPagina).toHaveBeenLastCalledWith(
    "consulta", expect.objectContaining({ codigos: ["0301010072", "0301010048"] }), 1, undefined));
  expect(window.location.hash).toBe("#/consultar/q/consulta?fav=1");
});

test("o procedimento achado só pela descrição leva o marcador", async () => {
  montar("#/consultar/q/consulta");
  const tabela = await screen.findByRole("grid", { name: "Procedimentos" });
  const linha = within(tabela).getByRole("row", { name: /03\.01\.01\.005-6/ });
  expect(within(linha).getByText("na descrição")).toBeInTheDocument();
  expect(within(tabela).getAllByText("na descrição")).toHaveLength(1);
});

test("Exportar leva todos os que passam nos filtros", async () => {
  const u = userEvent.setup();
  m.buscarExportar.mockResolvedValue({
    consulta: "consulta", competencia: "202609", modo: "texto", total_procedimentos: 237,
    procedimentos: Array.from({ length: 237 }, (_, i) => item(`03010100${String(i % 100).padStart(2, "0")}`, `Consulta ${i}`)), apoio: [],
  });
  m.exportar.mockResolvedValue("C:/x/lista.xlsx");
  montar("#/consultar/q/consulta?cx=2");
  await u.click(await screen.findByRole("button", { name: "Exportar" }));
  expect(await screen.findByText("Planilha salva com 237 procedimentos.")).toBeInTheDocument();
  expect(m.buscarExportar).toHaveBeenCalledWith("consulta", expect.objectContaining({ complexidade: ["2"] }), "202609");
  expect(m.exportar.mock.calls[0]![1]).toBe("Procedimentos consulta");
});

test("Exportar com uma página só usa os itens que já estão na tela", async () => {
  const u = userEvent.setup();
  m.buscarPagina.mockResolvedValue(pagina({ total: 3, total_filtrado: 3, paginas: 1 }));
  m.exportar.mockResolvedValue("C:/x/lista.xlsx");
  montar("#/consultar/q/consulta");
  await u.click(await screen.findByRole("button", { name: "Exportar" }));
  expect(await screen.findByText("Planilha salva com 3 procedimentos.")).toBeInTheDocument();
  expect(m.buscarExportar).not.toHaveBeenCalled();
});

test("clicar no campo vazio mostra as pesquisas recentes; escolher uma pesquisa", async () => {
  const u = userEvent.setup();
  window.localStorage.setItem("sa.pesquisas.v1", JSON.stringify(["hospital", "consulta"]));
  montar();
  await screen.findByRole("tree", { name: "Procedimentos" });
  await u.click(campo());
  expect(screen.getByText("Pesquisas recentes")).toBeInTheDocument();
  await u.click(screen.getByRole("option", { name: "hospital" }));
  expect(campo()).toHaveValue("hospital");
  await waitFor(() => expect(window.location.hash).toBe("#/consultar/q/hospital"));
});

test("Enter grava a pesquisa nas recentes e já busca, sem esperar a pausa", async () => {
  const u = userEvent.setup();
  montar();
  await screen.findByRole("tree", { name: "Procedimentos" });
  await u.type(campo(), "hospital{Enter}");
  expect(window.location.hash).toBe("#/consultar/q/hospital");
  expect(JSON.parse(window.localStorage.getItem("sa.pesquisas.v1") ?? "[]")).toEqual(["hospital"]);
});

test("favorito na lista de sugestões abre a ficha", async () => {
  const u = userEvent.setup();
  m.marcados.mockResolvedValue([favorito("0301010048", "Consulta de profissionais")]);
  montar();
  await screen.findByRole("tree", { name: "Procedimentos" });
  await u.click(campo());
  await u.click(await screen.findByRole("option", { name: /Consulta de profissionais/ }));
  expect(window.location.hash).toBe("#/consultar/0301010048");
});

test("seta para baixo no campo, com texto, entra na tabela; Enter abre a ficha", async () => {
  const u = userEvent.setup();
  m.ficha.mockResolvedValue(fichaDeExemplo());
  montar("#/consultar/q/consulta");
  const tabela = await screen.findByRole("grid", { name: "Procedimentos" });
  const linha = within(tabela).getByRole("row", { name: /03\.01\.01\.007-2/ });
  campo().focus();
  await u.keyboard("{ArrowDown}");
  expect(linha).toHaveFocus();
  await u.keyboard("{Enter}");
  expect(window.location.hash).toBe("#/consultar/0301010072");
});

test("voltar da ficha restaura o texto, a página e o foco na linha aberta", async () => {
  const u = userEvent.setup();
  m.ficha.mockResolvedValue(fichaDeExemplo());
  montar("#/consultar/q/consulta?pg=2");
  const tabela = await screen.findByRole("grid", { name: "Procedimentos" });
  const linha = within(tabela).getByRole("row", { name: /03\.01\.01\.007-2/ });
  linha.focus();
  await u.keyboard("{Enter}");
  expect(window.location.hash).toBe("#/consultar/0301010072");
  window.location.hash = "#/consultar/q/consulta?pg=2";
  const volta = await screen.findByRole("grid", { name: "Procedimentos" });
  await waitFor(() => expect(within(volta).getByRole("row", { name: /03\.01\.01\.007-2/ })).toHaveFocus());
  expect(campo()).toHaveValue("consulta");
  expect(m.buscarPagina).toHaveBeenLastCalledWith("consulta", expect.anything(), 2, undefined);
});

test("apoio fica recolhido numa barra e abre; escolher um item lista os procedimentos ligados", async () => {
  const u = userEvent.setup();
  m.buscarPagina.mockResolvedValue(pagina({
    apoio: [{ tabela: "tb_cid", colunas: ["co_cid"], codigo: ["I10"], nome: "Hipertensão essencial (primária)", procedimentos: 184 }],
  }));
  m.ligados.mockResolvedValue([item("0301010072", "Consulta médica em atenção especializada")]);
  montar("#/consultar/q/hipertensao");
  const barra = await screen.findByRole("button", { name: /Apoio/ });
  expect(barra).toHaveAttribute("aria-expanded", "false");
  expect(screen.queryByRole("grid", { name: "Apoio" })).toBeNull();
  await u.click(barra);
  const linha = within(await screen.findByRole("grid", { name: "Apoio" })).getByRole("row", { name: "CID" });
  await u.click(linha);
  await waitFor(() => expect(m.ligados).toHaveBeenCalledWith("tb_cid", ["I10"], undefined));
  expect(await screen.findByRole("heading", { name: /Procedimentos com CID I10/ })).toBeInTheDocument();
  await u.click(screen.getByRole("button", { name: "Voltar à busca" }));
  expect(await screen.findByRole("heading", { name: "Procedimentos" })).toBeInTheDocument();
});

test("sem procedimentos e só com apoio, a barra de apoio já vem aberta", async () => {
  m.buscarPagina.mockResolvedValue(pagina({
    total: 0, total_filtrado: 0, paginas: 1, procedimentos: [],
    apoio: [{ tabela: "tb_cid", colunas: ["co_cid"], codigo: ["I10"], nome: "Hipertensão", procedimentos: 184 }],
  }));
  montar("#/consultar/q/i10");
  expect(await screen.findByRole("grid", { name: "Apoio" })).toBeInTheDocument();
});

test("nada encontrado não mostra a coluna de filtros", async () => {
  m.buscarPagina.mockResolvedValue(pagina({ total: 0, total_filtrado: 0, paginas: 1, procedimentos: [], apoio: [], facetas: { ...FACETAS, tipo: [{ valor: "procedimento", rotulo: "Procedimentos", n: 0 }], complexidade: [], instrumento: [], grupo: [], forma: [] } }));
  montar("#/consultar/q/xyzabcqq");
  await screen.findByText(/Nada encontrado para/);
  expect(screen.queryByRole("group", { name: "Tipo" })).toBeNull();
  expect(screen.queryByRole("button", { name: /^Filtros/ })).toBeNull();
});

test("nada encontrado diz o que foi buscado e o que tentar", async () => {
  m.buscarPagina.mockResolvedValue(pagina({ total: 0, total_filtrado: 0, paginas: 1, procedimentos: [] }));
  montar("#/consultar/q/zzzz");
  expect(await screen.findByRole("heading", { name: /Nada encontrado para “consulta”/ })).toBeInTheDocument();
  expect(screen.getByText("Tente o código, parte do nome ou um CID.")).toBeInTheDocument();
});

test("filtros que zeram os resultados oferecem limpar", async () => {
  const u = userEvent.setup();
  m.buscarPagina.mockResolvedValue(pagina({ total: 237, total_filtrado: 0, paginas: 1, procedimentos: [] }));
  montar("#/consultar/q/consulta?cx=3");
  expect(await screen.findByText("Nenhum procedimento com estes filtros.")).toBeInTheDocument();
  await u.click(screen.getAllByRole("button", { name: "Limpar filtros" })[0]!);
  await waitFor(() => expect(window.location.hash).toBe("#/consultar/q/consulta"));
});

test("erro da busca mostra a mensagem e tenta de novo", async () => {
  const u = userEvent.setup();
  m.buscarPagina.mockRejectedValueOnce(new Error("banco indisponível"));
  montar("#/consultar/q/consulta");
  expect(await screen.findByRole("alert")).toHaveTextContent("banco indisponível");
  await u.click(screen.getByRole("button", { name: "Tentar de novo" }));
  expect(await screen.findByRole("grid", { name: "Procedimentos" })).toBeInTheDocument();
});

test("sem nenhuma competência carregada leva a Dados", async () => {
  const u = userEvent.setup();
  m.situacao.mockResolvedValue({ competencias: [] } as unknown as Situacao);
  montar();
  expect(await screen.findByRole("heading", { name: "Carregue a Tabela SIGTAP" })).toBeInTheDocument();
  await u.click(screen.getByRole("button", { name: "Abrir Dados" }));
  expect(window.location.hash).toBe("#/dados");
});

test("as visões Lista, Por forma e Por grupo trocam a organização da página", async () => {
  const u = userEvent.setup();
  montar("#/consultar/q/consulta");
  await screen.findByRole("grid", { name: "Procedimentos" });
  await u.click(screen.getByRole("radio", { name: "Por forma" }));
  expect(await screen.findByRole("grid", { name: "Procedimentos: Consultas médicas" })).toBeInTheDocument();
  await u.click(screen.getByRole("radio", { name: "Por grupo" }));
  expect(await screen.findByRole("grid", { name: "Procedimentos: Procedimentos clínicos" })).toBeInTheDocument();
  await u.click(screen.getByRole("radio", { name: "Lista" }));
  expect(await screen.findByRole("grid", { name: "Procedimentos" })).toBeInTheDocument();
});

test("a ficha continua em tela cheia, sem o campo de consulta", async () => {
  m.ficha.mockResolvedValue(fichaDeExemplo());
  montar("#/consultar/0301010072");
  await waitFor(() => expect(m.ficha).toHaveBeenCalled());
  expect(screen.queryByRole("combobox", { name: "Buscar" })).toBeNull();
});

test("Esc com texto limpa o campo e o foco fica nele", async () => {
  const u = userEvent.setup();
  montar("#/consultar/q/xyz");
  const c = await screen.findByRole("combobox", { name: "Buscar" });
  c.focus();
  await u.keyboard("{Escape}");
  expect(c).toHaveValue("");
  expect(c).toHaveFocus();
});

test("clicar no cabeçalho ordena a página; de novo inverte", async () => {
  const u = userEvent.setup();
  montar("#/consultar/q/consulta");
  const tabela = await screen.findByRole("grid", { name: "Procedimentos" });
  const codigos = () => within(tabela).getAllByRole("row").slice(1).map((r) => r.textContent?.match(/\d\d\.\d\d\.\d\d\.\d{3}-\d/)?.[0]);
  expect(codigos()).toEqual(["03.01.01.007-2", "03.01.01.004-8", "03.01.01.005-6"]);
  await u.click(within(tabela).getByRole("columnheader", { name: /Valor total/ }));
  expect(codigos()[0]).toBe("03.01.01.004-8");
  await u.click(within(tabela).getByRole("columnheader", { name: /Valor total/ }));
  expect(codigos()[0]).not.toBe("03.01.01.004-8");
});

test("a linha mostra estrela e lápis só no que foi favoritado ou anotado", async () => {
  m.marcados.mockResolvedValue([
    { tipo: "procedimento", codigo: "0301010072", favorito: true, favorito_desde: "2026-10-01", anotacao: "conferir", anotacao_de: "2026-10-02", existe: true, nome: "x" },
  ]);
  montar("#/consultar/q/consulta");
  const tabela = await screen.findByRole("grid", { name: "Procedimentos" });
  const marcada = within(tabela).getByRole("row", { name: /03\.01\.01\.007-2/ });
  expect(await within(marcada).findByRole("img", { name: "Favorito" })).toBeInTheDocument();
  expect(within(marcada).getByRole("img", { name: "Com anotação" })).toBeInTheDocument();
  expect(within(within(tabela).getByRole("row", { name: /03\.01\.01\.004-8/ })).queryByRole("img")).not.toBeInTheDocument();
});

test("no apoio, quem tem procedimentos ligados vem antes de quem não tem", async () => {
  const u = userEvent.setup();
  m.buscarPagina.mockResolvedValue(pagina({
    apoio: [
      { tabela: "tb_cid", colunas: ["co_cid"], codigo: ["R467"], nome: "Verborragia", procedimentos: 0 },
      { tabela: "tb_cid", colunas: ["co_cid"], codigo: ["I10"], nome: "Hipertensão essencial (primária)", procedimentos: 184 },
    ],
  }));
  montar("#/consultar/q/consulta");
  await u.click(await screen.findByRole("button", { name: /Apoio/ }));
  const linhas = within(await screen.findByRole("grid", { name: "Apoio" })).getAllByRole("row").slice(1);
  expect(linhas[0]).toHaveTextContent("I10");
  expect(linhas[1]).toHaveTextContent("R467");
});

test("desistir do 'Salvar como' não mostra erro nem aviso de sucesso", async () => {
  const u = userEvent.setup();
  m.buscarPagina.mockResolvedValue(pagina({ total: 3, total_filtrado: 3, paginas: 1 }));
  m.exportar.mockResolvedValue(null);
  montar("#/consultar/q/consulta");
  await u.click(await screen.findByRole("button", { name: "Exportar" }));
  await waitFor(() => expect(m.exportar).toHaveBeenCalled());
  await waitFor(() => expect(screen.getByRole("button", { name: "Exportar" })).toBeEnabled());
  expect(screen.queryByText(/Planilha salva/)).toBeNull();
  expect(screen.queryByText(/Não foi possível exportar/)).toBeNull();
});

test("erro do comando de exportar mostra aviso", async () => {
  const u = userEvent.setup();
  m.buscarPagina.mockResolvedValue(pagina({ total: 3, total_filtrado: 3, paginas: 1 }));
  m.exportar.mockRejectedValue(new Error("o arquivo está aberto em outro programa"));
  montar("#/consultar/q/consulta");
  await u.click(await screen.findByRole("button", { name: "Exportar" }));
  expect(await screen.findByText(/Não foi possível exportar\. o arquivo está aberto em outro programa/)).toBeInTheDocument();
});

test("digitar, Enter e apagar logo em seguida (antes da pausa) também volta à árvore", async () => {
  const u = userEvent.setup();
  montar();
  await u.type(campo(), "consulta{Enter}");
  await screen.findByRole("heading", { name: "Procedimentos" });
  await u.clear(campo());
  await waitFor(() => expect(window.location.hash).toBe("#/consultar"));
  expect(await screen.findByRole("tree", { name: "Procedimentos" })).toBeInTheDocument();
});

test("trocar o texto da busca sai da lista de procedimentos ligados a um item de apoio", async () => {
  const u = userEvent.setup();
  m.buscarPagina.mockImplementation(async (texto) => (texto === "hipertensao"
    ? pagina({ consulta: "hipertensao", apoio: [{ tabela: "tb_cid", colunas: ["co_cid"], codigo: ["I10"], nome: "Hipertensão essencial (primária)", procedimentos: 184 }] })
    : pagina({ consulta: "consulta" })));
  m.ligados.mockResolvedValue([item("0301010072", "Consulta médica em atenção especializada")]);
  montar("#/consultar/q/hipertensao");
  await u.click(await screen.findByRole("button", { name: /Apoio/ }));
  await u.click(within(await screen.findByRole("grid", { name: "Apoio" })).getByRole("row", { name: "CID" }));
  expect(await screen.findByRole("heading", { name: /Procedimentos com CID I10/ })).toBeInTheDocument();
  await u.click(campo());
  await u.keyboard("{Control>}a{/Control}consulta");
  expect(await screen.findByRole("heading", { name: "Procedimentos" })).toBeInTheDocument();
  expect(screen.queryByRole("heading", { name: /Procedimentos com CID/ })).toBeNull();
});
