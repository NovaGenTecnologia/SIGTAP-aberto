import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { ProvedorDeAvisos } from "../componentes/base/Avisos";
import { ContextoDeTarefas, type TarefaDeFonte, type ValorDasTarefas } from "../dados/tarefas";
import type { Fonte, FimDeTarefa, ProgressoDeTarefa } from "../api/tipos";
import { RodapeDeTarefas } from "./RodapeDeTarefas";

const parada = (): TarefaDeFonte => ({ ativa: false, progresso: null, fim: null, naFila: 0 });
const prog = (fonte: Fonte, fracao: number, extra: Partial<ProgressoDeTarefa> = {}): ProgressoDeTarefa => ({
  fonte, tarefa: 1, rotulo: fonte, fase: "baixando", resumo: `Resumo ${fonte}`, mensagem: `Mensagem ${fonte}`, fracao, indeterminado: false, ...extra,
});
const ativa = (fonte: Fonte, fracao: number, extra: Partial<TarefaDeFonte> = {}, p: Partial<ProgressoDeTarefa> = {}): TarefaDeFonte =>
  ({ ativa: true, progresso: prog(fonte, fracao, p), fim: null, naFila: 0, ...extra });
const falha = (fonte: Fonte): FimDeTarefa => ({ fonte, tarefa: 1, ok: false, cancelada: false, mensagem: "o servidor não respondeu" });

const cancelar = vi.fn();
const repetir = vi.fn().mockResolvedValue(undefined);
const limparFim = vi.fn();

function montar(t: Partial<Record<Fonte, TarefaDeFonte>>, algumaCarregando = false) {
  const valor: ValorDasTarefas = {
    tarefas: { sigtap: parada(), cnes: parada(), producao: parada(), ...t },
    algumaCarregando, iniciar: vi.fn(), cancelar, repetir, limparFim,
  };
  const Envolver = ({ children }: { children: ReactNode }) => (
    <ProvedorDeAvisos><ContextoDeTarefas.Provider value={valor}>{children}</ContextoDeTarefas.Provider></ProvedorDeAvisos>
  );
  return render(<RodapeDeTarefas />, { wrapper: Envolver });
}

beforeEach(() => vi.clearAllMocks());

test("sem tarefas não mostra nada", () => {
  const { container } = montar({});
  expect(container.querySelector(".rodape-tarefas")).toBeNull();
});

test("uma barra por fonte ativa, com o nome e o andamento", () => {
  montar({ cnes: ativa("cnes", 0.42), sigtap: ativa("sigtap", 0.1) });
  expect(screen.getByRole("progressbar", { name: "SIGTAP" })).toHaveAttribute("aria-valuenow", "10");
  expect(screen.getByRole("progressbar", { name: "CNES" })).toHaveAttribute("aria-valuenow", "42");
  expect(screen.queryByRole("progressbar", { name: "Produção" })).not.toBeInTheDocument();
});

test("mostra quantos estão na fila, somando as fontes", () => {
  montar({ sigtap: ativa("sigtap", 0.1, { naFila: 2 }), cnes: ativa("cnes", 0.5, { naFila: 1 }) });
  expect(screen.getByText("+3 na fila")).toBeInTheDocument();
});

test("aviso de lentidão só aparece durante a carga", () => {
  const { unmount } = montar({ sigtap: ativa("sigtap", 0.9, {}, { fase: "carregando" }) }, true);
  expect(screen.getByText("Carregando dados: a navegação pode ficar mais lenta.")).toHaveAttribute("role", "status");
  unmount();
  montar({ sigtap: ativa("sigtap", 0.9) }, false);
  expect(screen.queryByText(/a navegação pode ficar mais lenta/)).not.toBeInTheDocument();
});

test("clicar abre o detalhe e Cancelar cancela só aquela fonte", async () => {
  const u = userEvent.setup();
  montar({ cnes: ativa("cnes", 0.42), sigtap: ativa("sigtap", 0.1) });
  await u.click(screen.getByRole("button", { name: /Downloads em andamento/ }));
  const detalhe = await screen.findByRole("dialog", { name: "Downloads" });
  expect(within(detalhe).getByText("Resumo cnes")).toBeInTheDocument();
  expect(within(detalhe).getByText("Mensagem cnes")).toBeInTheDocument();
  await u.click(within(detalhe).getByRole("button", { name: "Cancelar CNES" }));
  expect(cancelar).toHaveBeenCalledWith("cnes");
});

test("falha fica com a mensagem, Tentar de novo repete e Dispensar limpa", async () => {
  const u = userEvent.setup();
  montar({ cnes: { ...parada(), fim: falha("cnes") } });
  await u.click(screen.getByRole("button", { name: /CNES: falhou/ }));
  const detalhe = await screen.findByRole("dialog", { name: "Downloads" });
  expect(within(detalhe).getByText("o servidor não respondeu")).toBeInTheDocument();
  await u.click(within(detalhe).getByRole("button", { name: "Tentar de novo" }));
  expect(repetir).toHaveBeenCalledWith("cnes");
  await u.click(within(detalhe).getByRole("button", { name: "Dispensar" }));
  expect(limparFim).toHaveBeenCalledWith("cnes");
});

test("fim com sucesso vira aviso e não deixa item no rodapé", () => {
  const fim: FimDeTarefa = { fonte: "sigtap", tarefa: 1, ok: true, cancelada: false, mensagem: "SIGTAP: 11 competências carregadas." };
  montar({ sigtap: { ...parada(), fim } });
  expect(screen.getByText("SIGTAP: 11 competências carregadas.")).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: /SIGTAP/ })).not.toBeInTheDocument();
});
