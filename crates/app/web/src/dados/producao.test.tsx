import { vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";

vi.mock("../api/tauri", () => ({ chamar: vi.fn() }));
import { chamar } from "../api/tauri";
import { useFaturamentoUnidade, useProducaoProcedimentos } from "./producao";

const item = (i: number) => ({ procedimento: String(i).padStart(10, "0"), nome: `Procedimento ${i}`, classe: "A", quantidade: 1, valor_centavos: 100 - i, percentual: 1, acumulado: 1 });
const pagina = (desde: number, quantos: number, total: number, origem = "sia") => ({
  disponivel: true, uf: "SP", cnes: "0000000", origem, unidade_quantidade: "AIH", janela: [], total_geral: total, total,
  resumo: {}, valor_total_centavos: 0, desde, itens_omitidos: Math.max(0, total - desde - quantos),
  itens: Array.from({ length: quantos }, (_, i) => item(desde + i)),
});

const envoltorio = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{children}</QueryClientProvider>
);

beforeEach(() => vi.mocked(chamar).mockReset());

test("o fechamento é guardado por unidade e competência: outra unidade chama de novo", async () => {
  vi.mocked(chamar).mockResolvedValue({ disponivel: true });
  const { rerender } = renderHook(({ u }: { u: string }) => useFaturamentoUnidade("202609", u), { wrapper: envoltorio, initialProps: { u: "SP:0000001" } });
  await waitFor(() => expect(chamar).toHaveBeenCalledTimes(1));
  expect(chamar).toHaveBeenLastCalledWith("faturamento_unidade", { competencia: "202609", uf: null, cnes: null });
  rerender({ u: "SP:0000002" });
  await waitFor(() => expect(chamar).toHaveBeenCalledTimes(2));
});

test("a próxima página pede desde = itens já lidos e para quando não há mais", async () => {
  vi.mocked(chamar).mockImplementation(async (_c, args) => {
    const desde = (args as { desde: number | null } | undefined)?.desde ?? 0;
    return desde === 0 ? pagina(0, 50, 70) : pagina(50, 20, 70);
  });
  const { result } = renderHook(() => useProducaoProcedimentos("sia", { q: "consulta", classe: "A" }), { wrapper: envoltorio });
  await waitFor(() => expect(result.current.data?.pages).toHaveLength(1));
  expect(chamar).toHaveBeenLastCalledWith("producao_procedimentos", expect.objectContaining({ origem: "sia", q: "consulta", classe: "A", desde: null }));
  expect(result.current.hasNextPage).toBe(true);
  await act(async () => { await result.current.fetchNextPage(); });
  expect(chamar).toHaveBeenLastCalledWith("producao_procedimentos", expect.objectContaining({ desde: 50 }));
  await waitFor(() => expect(result.current.data?.pages).toHaveLength(2));
  expect(result.current.hasNextPage).toBe(false);
});

test("sem produção baixada a lista não pede mais páginas", async () => {
  vi.mocked(chamar).mockResolvedValue({ disponivel: false, uf: "SP", mensagem: "sem produção" });
  const { result } = renderHook(() => useProducaoProcedimentos("sia", {}), { wrapper: envoltorio });
  await waitFor(() => expect(result.current.data?.pages).toHaveLength(1));
  expect(result.current.hasNextPage).toBe(false);
});

test("trocar de origem não devolve as páginas da outra origem", async () => {
  vi.mocked(chamar).mockImplementation(async (_c, args) =>
    (args as { origem?: string } | undefined)?.origem === "sih" ? new Promise(() => {}) : pagina(0, 2, 2));
  const { result, rerender } = renderHook(({ o }: { o: "sia" | "sih" }) => useProducaoProcedimentos(o, {}), { wrapper: envoltorio, initialProps: { o: "sia" as "sia" | "sih" } });
  await waitFor(() => expect(result.current.data?.pages).toHaveLength(1));
  rerender({ o: "sih" });
  expect(result.current.data).toBeUndefined();
});

test("digitar na busca mantém a lista anterior enquanto a nova chega", async () => {
  vi.mocked(chamar).mockImplementation(async (_c, args) =>
    (args as { q?: string | null } | undefined)?.q === "cons" ? new Promise(() => {}) : pagina(0, 2, 2));
  const { result, rerender } = renderHook(({ q }: { q: string }) => useProducaoProcedimentos("sia", { q }), { wrapper: envoltorio, initialProps: { q: "" } });
  await waitFor(() => expect(result.current.data?.pages).toHaveLength(1));
  rerender({ q: "cons" });
  expect(result.current.data?.pages).toHaveLength(1);
  expect(result.current.isPlaceholderData).toBe(true);
});

test("trocar de unidade nunca mostra linhas da unidade anterior, nem como placeholder", async () => {
  vi.mocked(chamar).mockImplementation(async (_c, args) =>
    (args as { desde?: number | null; q?: string | null } | undefined)?.q === "x" ? new Promise(() => {}) : pagina(0, 2, 2));
  const { result, rerender } = renderHook(({ u, q }: { u: string; q: string }) => useProducaoProcedimentos("sia", { q, unidade: u }), { wrapper: envoltorio, initialProps: { u: "SP:1", q: "" } });
  await waitFor(() => expect(result.current.data?.pages).toHaveLength(1));
  rerender({ u: "SP:2", q: "x" });
  expect(result.current.data).toBeUndefined();
});
