import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ProvedorDaSessao } from "../../shell/sessao";
import * as comandos from "../../api/comandos";
import type { Busca, ItemProcedimento, Situacao } from "../../api/tipos";
import { Buscar } from "./Buscar";

vi.mock("../../api/comandos");
const m = vi.mocked(comandos);

const item = (codigo: string, nome: string, extra: Partial<ItemProcedimento> = {}): ItemProcedimento => ({
  codigo, codigo_mascarado: `${codigo.slice(0, 2)}.${codigo.slice(2, 4)}.${codigo.slice(4, 6)}.${codigo.slice(6, 9)}-${codigo.slice(9)}`,
  nome, tp_complexidade: "2", complexidade: "Média", valor_total_centavos: 1000, instrumentos: ["BPA-C", "BPA-I"],
  forma: "030101", forma_nome: "Consultas médicas", ...extra,
});
const busca = (extra: Partial<Busca> = {}): Busca => ({
  consulta: "consulta", competencia: "202609", modo: "texto", total_procedimentos: 2,
  procedimentos: [item("0301010072", "Consulta médica em atenção especializada"), item("0301010048", "Consulta de profissionais de nível superior", { valor_total_centavos: 630, forma: "030102", forma_nome: "Consultas não médicas" })],
  apoio: [], ...extra,
});
const situacaoCom = (n: number) => ({ competencias: Array.from({ length: n }, (_, i) => ({ competencia: "202609", rotulo: "09/2026", arquivo: `a${i}` })) }) as unknown as Situacao;

function montar(rota = "#/consultar") {
  window.location.hash = rota;
  const cliente = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={cliente}><ProvedorDaSessao><Buscar /></ProvedorDaSessao></QueryClientProvider>);
}

beforeEach(() => {
  vi.resetAllMocks();
  m.situacao.mockResolvedValue(situacaoCom(1));
  m.buscar.mockResolvedValue(busca());
});

test("abre com o campo focado e três exemplos; clicar num exemplo busca", async () => {
  const u = userEvent.setup();
  montar();
  expect(await screen.findByRole("searchbox", { name: "Buscar" })).toHaveFocus();
  for (const e of ["0301010072", "consulta médica", "cid I10"]) expect(screen.getByRole("button", { name: e })).toBeInTheDocument();
  await u.click(screen.getByRole("button", { name: "0301010072" }));
  await waitFor(() => expect(m.buscar).toHaveBeenCalledWith("0301010072", undefined));
  expect(screen.getByRole("searchbox", { name: "Buscar" })).toHaveValue("0301010072");
});

test("busca só depois da pausa e só com 2 caracteres ou mais", async () => {
  const u = userEvent.setup();
  montar();
  const campo = await screen.findByRole("searchbox", { name: "Buscar" });
  await u.type(campo, "h");
  await new Promise((r) => setTimeout(r, 400));
  expect(m.buscar).not.toHaveBeenCalled();
  await u.clear(campo);
  await u.type(campo, "consulta");
  await waitFor(() => expect(m.buscar).toHaveBeenCalledWith("consulta", undefined));
  expect(m.buscar).toHaveBeenCalledTimes(1);
});

test("mostra código mascarado, nome, complexidade, valor e instrumentos; seta para baixo entra na lista e Enter abre a ficha", async () => {
  const u = userEvent.setup();
  montar("#/consultar/q/consulta");
  const tabela = await screen.findByRole("grid", { name: "Procedimentos" });
  const linha = within(tabela).getByRole("row", { name: /03\.01\.01\.007-2/ });
  expect(within(linha).getByText("Consulta médica em atenção especializada")).toBeInTheDocument();
  expect(within(linha).getByText("Média")).toBeInTheDocument();
  expect(within(linha).getByText(/R\$\s10,00/)).toBeInTheDocument();
  expect(within(linha).getByText("BPA-C · BPA-I")).toBeInTheDocument();
  screen.getByRole("searchbox", { name: "Buscar" }).focus();
  await u.keyboard("{ArrowDown}");
  expect(linha).toHaveFocus();
  await u.keyboard("{Enter}");
  expect(window.location.hash).toBe("#/consultar/0301010072");
});

test("avisa quando há mais procedimentos do que os mostrados", async () => {
  m.buscar.mockResolvedValue(busca({ total_procedimentos: 450 }));
  montar("#/consultar/q/consulta");
  expect(await screen.findByText("Mostrando 2 de 450. Refine a busca.")).toBeInTheDocument();
});

test("não avisa quando tudo cabe", async () => {
  montar("#/consultar/q/consulta");
  await screen.findByRole("grid", { name: "Procedimentos" });
  expect(screen.queryByText(/Refine a busca/)).not.toBeInTheDocument();
});

test("Por forma agrupa os procedimentos pela forma de organização", async () => {
  const u = userEvent.setup();
  montar("#/consultar/q/consulta");
  await screen.findByRole("grid", { name: "Procedimentos" });
  await u.click(screen.getByRole("radio", { name: "Por forma" }));
  expect(screen.getByRole("heading", { name: /Consultas médicas/ })).toBeInTheDocument();
  expect(screen.getByRole("heading", { name: /Consultas não médicas/ })).toBeInTheDocument();
});

test("filtro por instrumento mostra a contagem e limita a lista; Todos volta", async () => {
  const u = userEvent.setup();
  m.buscar.mockResolvedValue(busca({
    procedimentos: [item("0301010072", "Consulta médica em atenção especializada"), item("0301010064", "Consulta domiciliar", { instrumentos: ["BPA-I"] }), item("0301010030", "Atendimento de urgência", { instrumentos: ["APAC"] })],
    total_procedimentos: 3,
  }));
  montar("#/consultar/q/consulta");
  const grupo = await screen.findByRole("radiogroup", { name: "Instrumento" });
  expect(within(grupo).getByRole("radio", { name: "Todos 3" })).toBeChecked();
  expect(within(grupo).getByRole("radio", { name: "BPA-I 2" })).toBeInTheDocument();
  expect(within(grupo).getByRole("radio", { name: "APAC 1" })).toBeInTheDocument();
  await u.click(within(grupo).getByRole("radio", { name: "APAC 1" }));
  const tabela = screen.getByRole("grid", { name: "Procedimentos" });
  expect(within(tabela).getByText("Atendimento de urgência")).toBeInTheDocument();
  expect(within(tabela).queryByText("Consulta domiciliar")).not.toBeInTheDocument();
  await u.click(within(grupo).getByRole("radio", { name: "Todos 3" }));
  expect(within(screen.getByRole("grid", { name: "Procedimentos" })).getByText("Consulta domiciliar")).toBeInTheDocument();
});

test("sem instrumentos nos resultados não aparece o filtro", async () => {
  m.buscar.mockResolvedValue(busca({ procedimentos: [item("0301010072", "Consulta", { instrumentos: [] })], total_procedimentos: 1 }));
  montar("#/consultar/q/consulta");
  await screen.findByRole("grid", { name: "Procedimentos" });
  expect(screen.queryByRole("radiogroup", { name: "Instrumento" })).not.toBeInTheDocument();
});

test("itens de apoio mostram a contagem; escolher um lista os procedimentos ligados e dá para voltar", async () => {
  const u = userEvent.setup();
  m.buscar.mockResolvedValue(busca({
    procedimentos: [],
    total_procedimentos: 0,
    apoio: [{ tabela: "tb_cid", colunas: ["co_cid"], codigo: ["I10"], nome: "Hipertensão essencial (primária)", procedimentos: 184 }],
  }));
  m.ligados.mockResolvedValue([item("0301010072", "Consulta médica em atenção especializada")]);
  montar("#/consultar/q/hipertensao");
  const apoio = await screen.findByRole("grid", { name: "Apoio" });
  const linha = within(apoio).getByRole("row", { name: "CID" });
  expect(within(linha).getByText("CID")).toBeInTheDocument();
  expect(within(linha).getByText("184 procedimentos")).toBeInTheDocument();
  await u.click(linha);
  await waitFor(() => expect(m.ligados).toHaveBeenCalledWith("tb_cid", ["I10"], undefined));
  expect(await screen.findByRole("heading", { name: /Procedimentos com CID I10/ })).toBeInTheDocument();
  await u.click(screen.getByRole("button", { name: "Voltar à busca" }));
  expect(await screen.findByRole("grid", { name: "Apoio" })).toBeInTheDocument();
});

test("sem resultado diz o que foi buscado e o que tentar", async () => {
  m.buscar.mockResolvedValue(busca({ consulta: "xyzabc", total_procedimentos: 0, procedimentos: [], apoio: [] }));
  montar("#/consultar/q/xyzabc");
  expect(await screen.findByText("Nada encontrado para “xyzabc” em 09/2026.")).toBeInTheDocument();
  expect(screen.getByText("Tente o código, parte do nome ou um CID.")).toBeInTheDocument();
});

test("a rota com texto abre a busca feita; editar o campo troca a rota sem empilhar histórico", async () => {
  const u = userEvent.setup();
  montar("#/consultar/q/xyz");
  const campo = await screen.findByRole("searchbox", { name: "Buscar" });
  expect(campo).toHaveValue("xyz");
  await waitFor(() => expect(m.buscar).toHaveBeenCalledWith("xyz", undefined));
  const antes = window.history.length;
  await u.type(campo, "w");
  await waitFor(() => expect(window.location.hash).toBe("#/consultar/q/xyzw"));
  expect(window.history.length).toBe(antes);
});

test("o texto apagado volta para a rota da busca vazia", async () => {
  const u = userEvent.setup();
  montar("#/consultar/q/xyz");
  const campo = await screen.findByRole("searchbox", { name: "Buscar" });
  await u.clear(campo);
  await waitFor(() => expect(window.location.hash).toBe("#/consultar"));
});

test("Esc limpa o campo e o foco fica nele", async () => {
  const u = userEvent.setup();
  montar("#/consultar/q/xyz");
  const campo = await screen.findByRole("searchbox", { name: "Buscar" });
  campo.focus();
  await u.keyboard("{Escape}");
  expect(campo).toHaveValue("");
  expect(campo).toHaveFocus();
});

test("erro na busca mostra a mensagem e tenta de novo", async () => {
  const u = userEvent.setup();
  m.buscar.mockRejectedValueOnce(new Error("banco indisponível"));
  montar("#/consultar/q/consulta");
  expect(await screen.findByRole("alert")).toHaveTextContent("banco indisponível");
  await u.click(screen.getByRole("button", { name: "Tentar de novo" }));
  expect(await screen.findByRole("grid", { name: "Procedimentos" })).toBeInTheDocument();
});

test("sem nenhuma competência carregada leva a Dados", async () => {
  const u = userEvent.setup();
  m.situacao.mockResolvedValue(situacaoCom(0));
  montar();
  expect(await screen.findByRole("heading", { name: "Carregue a Tabela SIGTAP" })).toBeInTheDocument();
  await u.click(screen.getByRole("button", { name: "Abrir Dados" }));
  expect(window.location.hash).toBe("#/dados");
});

test("no apoio, quem tem procedimentos ligados vem antes de quem não tem", async () => {
  m.buscar.mockResolvedValue(busca({
    procedimentos: [], total_procedimentos: 0,
    apoio: [
      { tabela: "tb_cid", colunas: ["co_cid"], codigo: ["R467"], nome: "Verborragia", procedimentos: 0 },
      { tabela: "tb_cid", colunas: ["co_cid"], codigo: ["I10"], nome: "Hipertensão essencial (primária)", procedimentos: 184 },
    ],
  }));
  montar("#/consultar/q/consulta");
  const apoio = await screen.findByRole("grid", { name: "Apoio" });
  const linhas = within(apoio).getAllByRole("row").slice(1);
  expect(linhas[0]).toHaveTextContent("I10");
  expect(linhas[1]).toHaveTextContent("R467");
});

test("clicar no cabeçalho ordena a lista; de novo inverte", async () => {
  const u = userEvent.setup();
  montar("#/consultar/q/consulta");
  const tabela = await screen.findByRole("grid", { name: "Procedimentos" });
  const codigos = () => within(tabela).getAllByRole("row").slice(1).map((r) => r.textContent?.match(/\d\d\.\d\d\.\d\d\.\d{3}-\d/)?.[0]);
  expect(codigos()).toEqual(["03.01.01.007-2", "03.01.01.004-8"]);
  await u.click(within(tabela).getByRole("columnheader", { name: /Valor total/ }));
  expect(codigos()).toEqual(["03.01.01.004-8", "03.01.01.007-2"]);
  await u.click(within(tabela).getByRole("columnheader", { name: /Valor total/ }));
  expect(codigos()).toEqual(["03.01.01.007-2", "03.01.01.004-8"]);
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
