import { act, renderHook } from "@testing-library/react";
import { guardarPesquisa, lerPesquisas, limparPesquisas, usePesquisasRecentes } from "./pesquisasRecentes";

beforeEach(() => {
  window.localStorage.clear();
  vi.restoreAllMocks();
});

test("guarda e lê a mais recente primeiro", () => {
  guardarPesquisa("consulta");
  guardarPesquisa("hospital");
  expect(lerPesquisas()).toEqual(["hospital", "consulta"]);
});

test("a repetida (sem caixa nem acento) sobe sem duplicar e fica com a grafia mais nova", () => {
  guardarPesquisa("Consulta");
  guardarPesquisa("urgência");
  guardarPesquisa("consulta ");
  expect(lerPesquisas()).toEqual(["consulta", "urgência"]);
  guardarPesquisa("URGENCIA");
  expect(lerPesquisas()).toEqual(["URGENCIA", "consulta"]);
});

test("guarda no máximo 8", () => {
  for (let i = 1; i <= 10; i += 1) guardarPesquisa(`busca ${i}`);
  const itens = lerPesquisas();
  expect(itens).toHaveLength(8);
  expect(itens[0]).toBe("busca 10");
  expect(itens[7]).toBe("busca 3");
});

test("texto com menos de 2 caracteres, ou só espaços, não entra", () => {
  guardarPesquisa("a");
  guardarPesquisa("   ");
  guardarPesquisa(" b ");
  expect(lerPesquisas()).toEqual([]);
});

test("armazenamento que falha não quebra: lê [] e guarda sem erro", () => {
  vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("bloqueado"); });
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("bloqueado"); });
  expect(lerPesquisas()).toEqual([]);
  expect(() => guardarPesquisa("consulta")).not.toThrow();
  expect(() => limparPesquisas()).not.toThrow();
});

test("JSON inválido ou de outro formato vira []", () => {
  window.localStorage.setItem("sa.pesquisas.v1", "{nao e json");
  expect(lerPesquisas()).toEqual([]);
  window.localStorage.setItem("sa.pesquisas.v1", JSON.stringify({ a: 1 }));
  expect(lerPesquisas()).toEqual([]);
  window.localStorage.setItem("sa.pesquisas.v1", JSON.stringify(["ok bom", 3, null, "x"]));
  expect(lerPesquisas()).toEqual(["ok bom"]);
});

test("o hook acompanha o que é guardado e limpa notificando quem assina", () => {
  const { result } = renderHook(() => usePesquisasRecentes());
  expect(result.current.itens).toEqual([]);
  act(() => result.current.guardar("consulta"));
  expect(result.current.itens).toEqual(["consulta"]);
  act(() => result.current.guardar("hospital"));
  expect(result.current.itens).toEqual(["hospital", "consulta"]);
  act(() => result.current.limpar());
  expect(result.current.itens).toEqual([]);
  expect(lerPesquisas()).toEqual([]);
});

test("dois assinantes veem a mesma lista", () => {
  const a = renderHook(() => usePesquisasRecentes());
  const b = renderHook(() => usePesquisasRecentes());
  act(() => a.result.current.guardar("consulta"));
  expect(b.result.current.itens).toEqual(["consulta"]);
});
