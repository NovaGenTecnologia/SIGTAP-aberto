import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Telas } from "./Telas";
import { Sobre } from "./Sobre";
import { ProvedorDaSessao } from "../shell/sessao";
import * as comandos from "../api/comandos";

vi.mock("../api/comandos");
const m = vi.mocked(comandos);

function com(rota: string, filho = <Telas />) {
  window.location.hash = rota;
  const cliente = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={cliente}><ProvedorDaSessao>{filho}</ProvedorDaSessao></QueryClientProvider>);
}

beforeEach(() => {
  vi.resetAllMocks();
  m.cnesSituacao.mockResolvedValue({ minha: null, unidades: [], ufs_disponiveis: [] });
  m.infoPrograma.mockResolvedValue({ versao: "0.2.1" });
});

test.each([
  ["#/painel", "Painel"], ["#/consultar", "Consultar"], ["#/mudancas", "Mudanças"],
  ["#/conferir", "Conferir arquivo"], ["#/dados", "Dados"],
])("a rota %s mostra o título %s", async (rota, titulo) => {
  com(rota);
  expect(await screen.findByRole("heading", { level: 1, name: titulo })).toBeInTheDocument();
});

test("Painel sem unidade escolhida mostra o que fazer e leva a Dados", async () => {
  const u = userEvent.setup();
  com("#/painel");
  expect(await screen.findByRole("heading", { name: "Nenhuma unidade escolhida" })).toBeInTheDocument();
  await u.click(screen.getByRole("button", { name: "Escolher unidade" }));
  expect(window.location.hash).toBe("#/dados");
});

test("Consultar com código na rota mostra o código", async () => {
  com("#/consultar/0301010072");
  expect(await screen.findByText("0301010072")).toBeInTheDocument();
});

test("Conferir arquivo marca a conferência como não confirmada", async () => {
  com("#/conferir");
  expect(await screen.findByText("Não confirmada")).toBeInTheDocument();
});

test("Sobre mostra o aviso de ferramenta não oficial e a versão", async () => {
  com("#/painel", <Sobre aberto aoFechar={() => {}} />);
  const dialogo = await screen.findByRole("dialog", { name: "Sobre" });
  expect(dialogo).toHaveTextContent(/Ferramenta não oficial/);
  expect(dialogo).toHaveTextContent(/Confira no SIGTAP oficial antes de faturar/);
  expect(await screen.findByText(/0\.2\.1/)).toBeInTheDocument();
});

test("as telas não repetem o aviso de ferramenta não oficial", async () => {
  com("#/painel");
  await screen.findByRole("heading", { level: 1 });
  expect(screen.queryByText(/não oficial/i)).not.toBeInTheDocument();
});
