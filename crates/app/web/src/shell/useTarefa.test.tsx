import { act, renderHook, waitFor } from "@testing-library/react";
import { useTarefa } from "./useTarefa";
import * as eventos from "../api/eventos";

vi.mock("../api/eventos");
const m = vi.mocked(eventos);

test("acompanha o progresso e termina com o evento de fim", async () => {
  let aoProgresso: (p: any) => void = () => {};
  let aoFim: (f: any) => void = () => {};
  m.ouvirProgresso.mockImplementation(async (cb) => { aoProgresso = cb; return () => {}; });
  m.ouvirFimTarefa.mockImplementation(async (cb) => { aoFim = cb; return () => {}; });
  const fim = vi.fn();
  const { result } = renderHook(() => useTarefa(fim));
  await waitFor(() => expect(m.ouvirFimTarefa).toHaveBeenCalled());
  expect(result.current.emAndamento).toBe(false);
  act(() => aoProgresso({ resumo: "Baixando 1 de 2", mensagem: "", fracao: 0.5, indeterminado: false }));
  expect(result.current).toMatchObject({ emAndamento: true, progresso: { fracao: 0.5 } });
  act(() => aoFim({ ok: true, cancelada: false, mensagem: "Concluído" }));
  expect(result.current.emAndamento).toBe(false);
  expect(fim).toHaveBeenCalledWith({ ok: true, cancelada: false, mensagem: "Concluído" });
});
