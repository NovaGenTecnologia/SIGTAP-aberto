import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ProvedorDeAvisos } from "../../componentes/base/Avisos";
import { ProvedorDaSessao } from "../../shell/sessao";
import * as comandos from "../../api/comandos";
import type { Busca, ItemMarcado, ItemProcedimento, Situacao } from "../../api/tipos";
import { Buscar } from "./Buscar";

vi.mock("../../api/comandos");
const m = vi.mocked(comandos);

const item = (i: number): ItemProcedimento => ({
  codigo: `03010100${String(i).padStart(2, "0")}`, codigo_mascarado: `03.01.01.0${String(i).padStart(2, "0")}-0`, nome: `Consulta ${i}`,
  tp_complexidade: "2", complexidade: "Média", valor_total_centavos: 1000 + i, instrumentos: ["BPA-I"], forma: "030101", forma_nome: "Consultas médicas",
});
const busca = (n: number, total = n): Busca => ({ consulta: "consulta", competencia: "202609", modo: "texto", total_procedimentos: total, procedimentos: Array.from({ length: n }, (_, i) => item(i)), apoio: [] });
const marcado = (i: number, extra: Partial<ItemMarcado> = {}): ItemMarcado => ({
  tipo: "procedimento", codigo: `03010100${String(i).padStart(2, "0")}`, favorito: true, favorito_desde: "2026-10-01", anotacao: null, anotacao_de: null, existe: true, nome: `Favorito ${i}`, ...extra,
});

function montar(rota = "#/consultar") {
  window.location.hash = rota;
  const cliente = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={cliente}><ProvedorDaSessao><ProvedorDeAvisos><Buscar /></ProvedorDeAvisos></ProvedorDaSessao></QueryClientProvider>);
}

beforeEach(() => {
  vi.resetAllMocks();
  m.situacao.mockResolvedValue({ competencias: [{ competencia: "202609", rotulo: "09/2026", arquivo: "a" }] } as unknown as Situacao);
  m.buscar.mockResolvedValue(busca(3));
  m.marcados.mockResolvedValue([]);
});

test("Buscar vazia: favoritos e anotações aparecem; mais de 8 mostram 8 e 'Ver todos'", async () => {
  const u = userEvent.setup();
  m.marcados.mockResolvedValue([
    ...Array.from({ length: 10 }, (_, i) => marcado(i)),
    marcado(20, { favorito: false, anotacao: "Conferir CBO antes de lançar", nome: "Com nota" }),
    marcado(21, { existe: false, nome: "" }),
  ]);
  montar();
  const favoritos = await screen.findByRole("region", { name: "Favoritos" });
  await waitFor(() => expect(within(favoritos).getAllByRole("listitem")).toHaveLength(8));
  expect(within(favoritos).getByText("03.01.01.000-0")).toBeInTheDocument();
  await u.click(within(favoritos).getByRole("button", { name: "Ver todos (11)" }));
  expect(within(favoritos).getAllByRole("listitem")).toHaveLength(11);
  expect(within(favoritos).getByText("não existe nesta competência")).toBeInTheDocument();
  await u.click(within(favoritos).getByRole("button", { name: "Ver menos" }));
  expect(within(favoritos).getAllByRole("listitem")).toHaveLength(8);
  const notas = screen.getByRole("region", { name: "Anotações" });
  expect(within(notas).getByText("Conferir CBO antes de lançar")).toBeInTheDocument();
  expect(within(notas).queryByRole("button", { name: /Ver todos/ })).toBeNull();
  expect(within(favoritos).getByRole("link", { name: "03.01.01.000-0" })).toHaveAttribute("href", "#/consultar/0301010000");
});

test("sem favoritos nem anotações, a Buscar vazia só mostra os exemplos", async () => {
  montar();
  await screen.findByRole("region", { name: "Exemplos" });
  await waitFor(() => expect(m.marcados).toHaveBeenCalled());
  expect(screen.queryByRole("region", { name: "Favoritos" })).toBeNull();
  expect(screen.queryByRole("region", { name: "Anotações" })).toBeNull();
});

test("Exportar monta a planilha com todas as linhas e avisa onde foi salva", async () => {
  const u = userEvent.setup();
  m.exportar.mockResolvedValue("Arquivo gravado: C:" + String.fromCharCode(92) + "Docs" + String.fromCharCode(92) + "Procedimentos consulta.xlsx (12 KB)");
  montar("#/consultar/q/consulta");
  await u.click(await screen.findByRole("button", { name: "Exportar" }));
  await waitFor(() => expect(m.exportar).toHaveBeenCalledTimes(1));
  const [planilha, nome] = m.exportar.mock.calls[0]!;
  expect(nome).toBe("Procedimentos consulta");
  expect(planilha.abas[0]!.colunas[0]).toBe("Código");
  expect(planilha.abas[0]!.linhas).toHaveLength(3);
  expect(await screen.findByText("Planilha salva com 3 procedimentos.")).toBeInTheDocument();
  expect(screen.getByText("Procedimentos consulta.xlsx")).toBeInTheDocument();
});

test("lista cortada pelo limite: exporta todos os encontrados, buscando o que a tela não mostra", async () => {
  const u = userEvent.setup();
  m.buscar.mockResolvedValue(busca(3, 450));
  m.buscarTodos.mockResolvedValue(busca(450, 450));
  m.exportar.mockResolvedValue("C:/x/lista.xlsx");
  montar("#/consultar/q/consulta");
  await u.click(await screen.findByRole("button", { name: "Exportar" }));
  expect(await screen.findByText("Planilha salva com 450 procedimentos.")).toBeInTheDocument();
  expect(m.buscarTodos).toHaveBeenCalledWith("consulta", "202609");
  expect(m.exportar.mock.calls[0]![0].abas[0]!.linhas).toHaveLength(450);
});

test("lista que cabe inteira não busca de novo", async () => {
  const u = userEvent.setup();
  m.exportar.mockResolvedValue("C:/x/lista.xlsx");
  montar("#/consultar/q/consulta");
  await u.click(await screen.findByRole("button", { name: "Exportar" }));
  expect(await screen.findByText("Planilha salva com 3 procedimentos.")).toBeInTheDocument();
  expect(m.buscarTodos).not.toHaveBeenCalled();
});

test("desistir do 'Salvar como' (null) não mostra erro nem aviso de sucesso", async () => {
  const u = userEvent.setup();
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
  m.exportar.mockRejectedValue(new Error("o arquivo está aberto em outro programa"));
  montar("#/consultar/q/consulta");
  await u.click(await screen.findByRole("button", { name: "Exportar" }));
  expect(await screen.findByText(/Não foi possível exportar\. o arquivo está aberto em outro programa/)).toBeInTheDocument();
});
