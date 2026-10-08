import { act, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Shell } from "./Shell";
import { ProvedorDaSessao } from "./sessao";
import { ProvedorDeAvisos } from "../componentes/base/Avisos";
import { TarefasProvider } from "../dados/TarefasProvider";
import * as comandos from "../api/comandos";
import * as eventos from "../api/eventos";

vi.mock("../api/comandos");
vi.mock("../api/eventos");
const m = vi.mocked(comandos);
const ev = vi.mocked(eventos);
const situacaoOk = { primeira_execucao: false, bloqueio: null, competencias: [], territorio: {}, pasta_dados: "", ocupado: false, recuperacao: null };

function movimentoReduzido(reduzido: boolean) {
  window.matchMedia = ((consulta: string) => ({
    matches: reduzido && consulta.includes("reduce"), media: consulta, onchange: null,
    addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
}

function montar() {
  const cliente = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={cliente}>
      <ProvedorDeAvisos><TarefasProvider><ProvedorDaSessao><Shell><p>conteúdo</p></Shell></ProvedorDaSessao></TarefasProvider></ProvedorDeAvisos>
    </QueryClientProvider>,
  );
}

async function avancar(ms: number) {
  await act(async () => { await vi.advanceTimersByTimeAsync(ms); });
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.resetAllMocks();
  window.location.hash = "#/painel";
  ev.ouvirProgresso.mockResolvedValue(() => {});
  ev.ouvirFimTarefa.mockResolvedValue(() => {});
  ev.ouvirPedidoDeFechar.mockResolvedValue(() => {});
  m.situacao.mockResolvedValue(situacaoOk);
  m.cnesSituacao.mockResolvedValue({ minha: null, unidades: [], ufs: [], ufs_disponiveis: [] } as never);
});
afterEach(() => vi.useRealTimers());

test("o programa abre em 2 s: a animação de inicialização toca inteira, mesmo com os dados prontos antes", async () => {
  movimentoReduzido(false);
  const { container } = montar();
  await avancar(100); // a situação já chegou
  expect(screen.getByRole("img", { name: "SIGTAP Aberto" })).toHaveClass("marca--inicial");
  expect(screen.queryByRole("navigation", { name: "Principal" })).toBeNull();
  await avancar(1700); // 1,8 s: ainda dentro do movimento (1,84 s)
  expect(screen.queryByRole("navigation", { name: "Principal" })).toBeNull();
  await avancar(60); // 1,86 s: a interface entra
  expect(screen.getByRole("navigation", { name: "Principal" })).toBeInTheDocument();
  expect(container.querySelector(".abertura--saindo")).not.toBeNull(); // a abertura ainda sai (0,16 s)
  await avancar(170); // 2,03 s
  expect(container.querySelector(".abertura")).toBeNull();
});

test("com os dados atrasados, a abertura espera por eles (não corta a interface)", async () => {
  movimentoReduzido(false);
  m.situacao.mockImplementation(() => new Promise((r) => setTimeout(() => r(situacaoOk), 3000)));
  montar();
  await avancar(2500);
  expect(screen.queryByRole("navigation", { name: "Principal" })).toBeNull();
  expect(screen.getByRole("img", { name: "SIGTAP Aberto" })).toHaveClass("marca--sutil"); // passou da abertura: a marca segue no brilho sutil
  expect(screen.getByRole("img", { name: "SIGTAP Aberto" })).not.toHaveClass("marca--inicial");
  await avancar(600);
  expect(screen.getByRole("navigation", { name: "Principal" })).toBeInTheDocument();
});

test("com redução de movimento a interface entra assim que os dados chegam", async () => {
  movimentoReduzido(true);
  montar();
  await avancar(50);
  expect(screen.getByRole("navigation", { name: "Principal" })).toBeInTheDocument();
});

test("erro ao carregar aparece na hora, sem esperar a animação", async () => {
  movimentoReduzido(false);
  m.situacao.mockRejectedValue(new Error("sem servidor"));
  montar();
  await avancar(100);
  expect(screen.getByRole("alert")).toHaveTextContent("sem servidor");
});
