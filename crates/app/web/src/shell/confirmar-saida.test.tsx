import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ContextoDeTarefas, type TarefaDeFonte, type ValorDasTarefas } from "../dados/tarefas";
import * as comandos from "../api/comandos";
import * as eventos from "../api/eventos";
import { ConfirmarSaida } from "./ConfirmarSaida";

vi.mock("../api/comandos");
vi.mock("../api/eventos");
const m = vi.mocked(comandos);
const ev = vi.mocked(eventos);

const parada = (): TarefaDeFonte => ({ ativa: false, progresso: null, fim: null, naFila: 0 });
let pedir: () => void;

function montar(ativas: Array<"sigtap" | "cnes" | "producao">) {
  const tarefas = { sigtap: parada(), cnes: parada(), producao: parada() };
  for (const f of ativas) tarefas[f] = { ...parada(), ativa: true };
  const valor: ValorDasTarefas = { tarefas, algumaCarregando: false, iniciar: vi.fn(), cancelar: vi.fn(), limparFim: vi.fn(), repetir: vi.fn() };
  return render(<ContextoDeTarefas.Provider value={valor}><ConfirmarSaida /></ContextoDeTarefas.Provider>);
}

beforeEach(() => {
  vi.resetAllMocks();
  m.fecharPrograma.mockResolvedValue(undefined);
  ev.ouvirPedidoDeFechar.mockImplementation(async (cb) => { pedir = cb; return () => {}; });
});

test("sem pedido do programa, nada aparece", async () => {
  montar(["cnes"]);
  await vi.waitFor(() => expect(ev.ouvirPedidoDeFechar).toHaveBeenCalled());
  expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
});

test("o pedido abre o diálogo dizendo quais fontes ainda baixam", async () => {
  montar(["sigtap", "cnes"]);
  await vi.waitFor(() => expect(ev.ouvirPedidoDeFechar).toHaveBeenCalled());
  act(() => pedir());
  const d = await screen.findByRole("alertdialog", { name: "Fechar o programa agora?" });
  expect(d).toHaveTextContent("SIGTAP e CNES ainda estão baixando. Se fechar, eles param.");
});

test("Continuar baixando fecha o diálogo e não fecha o programa", async () => {
  const u = userEvent.setup();
  montar(["cnes"]);
  await vi.waitFor(() => expect(ev.ouvirPedidoDeFechar).toHaveBeenCalled());
  act(() => pedir());
  await u.click(await screen.findByRole("button", { name: "Continuar baixando" }));
  expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
  expect(m.fecharPrograma).not.toHaveBeenCalled();
});

test("Fechar mesmo assim chama o programa uma vez só", async () => {
  const u = userEvent.setup();
  montar(["producao"]);
  await vi.waitFor(() => expect(ev.ouvirPedidoDeFechar).toHaveBeenCalled());
  act(() => pedir());
  const b = await screen.findByRole("button", { name: "Fechar mesmo assim" });
  await u.dblClick(b);
  expect(m.fecharPrograma).toHaveBeenCalledTimes(1);
});
