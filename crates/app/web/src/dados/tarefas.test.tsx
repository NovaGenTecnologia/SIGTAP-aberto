import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { TarefasProvider } from "./TarefasProvider";
import { useTarefaAtiva, useTarefas } from "./tarefas";
import * as comandos from "../api/comandos";
import * as eventos from "../api/eventos";

vi.mock("../api/comandos");
vi.mock("../api/eventos");
const m = vi.mocked(comandos);
const ev = vi.mocked(eventos);

const SITUACAO = { primeira_execucao: false, bloqueio: null, competencias: [], territorio: null, pasta_dados: "", ocupado: false, recuperacao: null, tarefas: [] };
let aoProgresso: (p: any) => void;
let aoFim: (f: any) => void;
let cliente: QueryClient;

const prog = (fonte: string, extra: object = {}) => ({ fonte, tarefa: 1, rotulo: fonte, fase: "baixando", resumo: "Baixando 1 de 2", mensagem: "", fracao: 0.5, indeterminado: false, ...extra });
const fim = (fonte: string, extra: object = {}) => ({ fonte, tarefa: 1, ok: true, cancelada: false, mensagem: "Concluído", ...extra });

function montar() {
  cliente = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const envolver = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={cliente}><TarefasProvider>{children}</TarefasProvider></QueryClientProvider>
  );
  return renderHook(() => ({ sigtap: useTarefaAtiva("sigtap"), cnes: useTarefaAtiva("cnes"), producao: useTarefaAtiva("producao"), todas: useTarefas() }), { wrapper: envolver });
}

beforeEach(() => {
  vi.resetAllMocks();
  m.situacao.mockResolvedValue(SITUACAO);
  m.cancelar.mockResolvedValue(undefined);
  ev.ouvirProgresso.mockImplementation(async (cb) => { aoProgresso = cb; return () => {}; });
  ev.ouvirFimTarefa.mockImplementation(async (cb) => { aoFim = cb; return () => {}; });
});

async function pronto() {
  await waitFor(() => expect(ev.ouvirFimTarefa).toHaveBeenCalled());
  await waitFor(() => expect(ev.ouvirProgresso).toHaveBeenCalled());
}

test("progresso de uma fonte marca só aquela fonte como ativa", async () => {
  const { result } = montar();
  await pronto();
  act(() => aoProgresso(prog("cnes")));
  expect(result.current.cnes.ativa).toBe(true);
  expect(result.current.cnes.progresso).toMatchObject({ fracao: 0.5 });
  expect(result.current.sigtap.ativa).toBe(false);
  expect(result.current.producao.ativa).toBe(false);
});

test("iniciar numa fonte não bloqueia iniciar em outra", async () => {
  const { result } = montar();
  await pronto();
  const a = vi.fn().mockResolvedValue(undefined);
  const b = vi.fn().mockResolvedValue(undefined);
  await act(async () => { await result.current.cnes.iniciar(a); });
  await act(async () => { await result.current.sigtap.iniciar(b); });
  expect(a).toHaveBeenCalledTimes(1);
  expect(b).toHaveBeenCalledTimes(1);
  expect(result.current.cnes.ativa && result.current.sigtap.ativa).toBe(true);
});

test("segunda tarefa na mesma fonte não executa e explica qual fonte", async () => {
  const { result } = montar();
  await pronto();
  const segunda = vi.fn().mockResolvedValue(undefined);
  await act(async () => { await result.current.cnes.iniciar(vi.fn().mockResolvedValue(undefined)); });
  await expect(result.current.cnes.iniciar(segunda)).rejects.toThrow("Já há um download de CNES em andamento.");
  expect(segunda).not.toHaveBeenCalled();
});

test("duplo clique no mesmo instante executa uma vez só", async () => {
  const { result } = montar();
  await pronto();
  const executar = vi.fn().mockResolvedValue(undefined);
  await act(async () => { await Promise.allSettled([result.current.sigtap.iniciar(executar), result.current.sigtap.iniciar(executar)]); });
  expect(executar).toHaveBeenCalledTimes(1);
});

test("o fim limpa só a fonte do evento, guarda o resultado e invalida as consultas", async () => {
  const { result } = montar();
  await pronto();
  const invalidar = vi.spyOn(cliente, "invalidateQueries");
  act(() => { aoProgresso(prog("cnes")); aoProgresso(prog("sigtap")); });
  act(() => aoFim(fim("cnes")));
  expect(result.current.cnes.ativa).toBe(false);
  expect(result.current.cnes.fim).toMatchObject({ ok: true, mensagem: "Concluído" });
  expect(result.current.sigtap.ativa).toBe(true);
  const chaves = invalidar.mock.calls.map((c) => (c[0] as { queryKey: string[] }).queryKey[0]);
  expect(chaves).toEqual(expect.arrayContaining(["situacao", "cnes_situacao", "producao_situacao", "ofertas"]));
});

test("duas tarefas terminando juntas guardam cada fim", async () => {
  const { result } = montar();
  await pronto();
  act(() => { aoProgresso(prog("sigtap")); aoProgresso(prog("producao")); });
  act(() => { aoFim(fim("sigtap", { mensagem: "A" })); aoFim(fim("producao", { mensagem: "B" })); });
  expect(result.current.sigtap.fim?.mensagem).toBe("A");
  expect(result.current.producao.fim?.mensagem).toBe("B");
  expect(result.current.todas.tarefas.sigtap.ativa || result.current.todas.tarefas.producao.ativa).toBe(false);
});

test("app aberto com tarefa no backend já nasce ativo na fonte certa", async () => {
  m.situacao.mockResolvedValue({ ...SITUACAO, ocupado: true, tarefas: [{ fonte: "producao", tarefa: 4, rotulo: "Produção", na_fila: false }] });
  const { result } = montar();
  await waitFor(() => expect(result.current.producao.ativa).toBe(true));
  expect(result.current.cnes.ativa).toBe(false);
  await expect(result.current.producao.iniciar(vi.fn())).rejects.toThrow("Já há um download de Produção em andamento.");
});

test("naFila conta os itens da fila da fonte", async () => {
  m.situacao.mockResolvedValue({ ...SITUACAO, ocupado: true, tarefas: [
    { fonte: "sigtap", tarefa: 1, rotulo: "SIGTAP", na_fila: false },
    { fonte: "sigtap", tarefa: 2, rotulo: "SIGTAP", na_fila: true },
    { fonte: "sigtap", tarefa: 3, rotulo: "SIGTAP", na_fila: true },
  ] });
  const { result } = montar();
  await waitFor(() => expect(result.current.sigtap.naFila).toBe(2));
  expect(result.current.cnes.naFila).toBe(0);
});

test("falha ao iniciar libera a trava e devolve o erro", async () => {
  const { result } = montar();
  await pronto();
  await act(async () => { await expect(result.current.cnes.iniciar(async () => { throw new Error("sem rede"); })).rejects.toThrow("sem rede"); });
  expect(result.current.cnes.ativa).toBe(false);
  const executar = vi.fn().mockResolvedValue(undefined);
  await act(async () => { await result.current.cnes.iniciar(executar); });
  expect(executar).toHaveBeenCalledTimes(1);
});

test("fim com erro fica guardado até limparFim", async () => {
  const { result } = montar();
  await pronto();
  act(() => aoFim(fim("cnes", { ok: false, mensagem: "sem rede" })));
  expect(result.current.cnes.fim).toMatchObject({ ok: false, mensagem: "sem rede" });
  act(() => result.current.cnes.limparFim());
  expect(result.current.cnes.fim).toBeNull();
});

test("cancelar chama o backend com a fonte e só o fim libera", async () => {
  const { result } = montar();
  await pronto();
  act(() => aoProgresso(prog("cnes")));
  await act(async () => { await result.current.cnes.cancelar(); });
  expect(m.cancelar).toHaveBeenCalledWith("cnes");
  expect(result.current.cnes.ativa).toBe(true);
  act(() => aoFim(fim("cnes", { ok: false, cancelada: true, mensagem: "cancelado" })));
  expect(result.current.cnes.ativa).toBe(false);
});

test("algumaCarregando vale só durante a fase de carga", async () => {
  const { result } = montar();
  await pronto();
  act(() => aoProgresso(prog("sigtap", { fase: "baixando" })));
  expect(result.current.todas.algumaCarregando).toBe(false);
  act(() => aoProgresso(prog("sigtap", { fase: "carregando" })));
  expect(result.current.todas.algumaCarregando).toBe(true);
  act(() => aoFim(fim("sigtap")));
  expect(result.current.todas.algumaCarregando).toBe(false);
});
