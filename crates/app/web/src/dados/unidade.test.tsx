import { vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";

vi.mock("../api/tauri", () => ({ chamar: vi.fn() }));
import { chamar } from "../api/tauri";
import { useAptidao, useAptidaoResumo, useTerceiros } from "./unidade";

const item = (i: number) => ({ codigo: String(i).padStart(10, "0"), nome: `Procedimento ${i}`, situacao: "apta", falta: [] });
const pagina = (desde: number, quantos: number, total: number) => ({
  disponivel: true, uf: "SP", cnes: "0000000", sem_producao: false,
  resumo: {}, habilitacoes: [], avisos: {},
  grupo: { id: "oportunidade", itens: Array.from({ length: quantos }, (_, i) => item(desde + i)), desde, itens_omitidos: Math.max(0, total - desde - quantos), total, ninguem_produziu: null },
});

const envoltorio = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{children}</QueryClientProvider>
);

beforeEach(() => vi.mocked(chamar).mockReset());

test("sem grupo, a lista não consulta nada", () => {
  renderHook(() => useAptidao(null), { wrapper: envoltorio });
  expect(chamar).not.toHaveBeenCalled();
});

test("a próxima página pede desde = itens já lidos e para quando não há mais", async () => {
  vi.mocked(chamar).mockImplementation(async (_comando, args) => {
    const desde = (args as { desde: number | null } | undefined)?.desde ?? 0;
    return desde === 0 ? pagina(0, 50, 70) : pagina(50, 20, 70);
  });
  const { result } = renderHook(() => useAptidao("oportunidade", { q: "biopsia", hab: "0203" }), { wrapper: envoltorio });
  await waitFor(() => expect(result.current.data?.pages).toHaveLength(1));
  expect(chamar).toHaveBeenLastCalledWith("aptidao_unidade", expect.objectContaining({ grupo: "oportunidade", q: "biopsia", hab: "0203", desde: 0 }));
  expect(result.current.hasNextPage).toBe(true);
  await act(async () => { await result.current.fetchNextPage(); });
  expect(chamar).toHaveBeenLastCalledWith("aptidao_unidade", expect.objectContaining({ desde: 50 }));
  await waitFor(() => expect(result.current.data?.pages).toHaveLength(2));
  expect(result.current.hasNextPage).toBe(false);
});

test("o resumo é guardado por unidade: outra unidade não herda o cache da anterior", async () => {
  vi.mocked(chamar).mockResolvedValue(pagina(0, 1, 1));
  const { rerender } = renderHook(({ u }: { u: string }) => useAptidaoResumo("202609", u), { wrapper: envoltorio, initialProps: { u: "SP:0000001" } });
  await waitFor(() => expect(chamar).toHaveBeenCalledTimes(1));
  rerender({ u: "SP:0000002" });
  await waitFor(() => expect(chamar).toHaveBeenCalledTimes(2));
});

test("trocar de grupo não devolve as páginas do grupo anterior", async () => {
  vi.mocked(chamar).mockImplementation(async (_c, args) =>
    (args as { grupo?: string } | undefined)?.grupo === "ordem" ? new Promise(() => {}) : pagina(0, 2, 2));
  const { result, rerender } = renderHook(({ g }: { g: "risco" | "ordem" }) => useAptidao(g, {}), { wrapper: envoltorio, initialProps: { g: "risco" as "risco" | "ordem" } });
  await waitFor(() => expect(result.current.data?.pages).toHaveLength(1));
  rerender({ g: "ordem" });
  expect(result.current.data).toBeUndefined();
});

test("adicionar um terceiro também recarrega o cadastro e o painel", async () => {
  vi.mocked(chamar).mockResolvedValue({});
  const cliente = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const espia = vi.spyOn(cliente, "invalidateQueries");
  const { result } = renderHook(() => useTerceiros("SP", "0000000"), {
    wrapper: ({ children }: { children: ReactNode }) => <QueryClientProvider client={cliente}>{children}</QueryClientProvider>,
  });
  await act(async () => { await result.current.adicionar.mutateAsync({ uf: "SP", cnes: "0000999" }); });
  const chaves = espia.mock.calls.map((c) => JSON.stringify((c[0] as { queryKey: unknown[] }).queryKey));
  expect(chaves).toEqual(expect.arrayContaining(['["unidade"]', '["painel"]']));
});
