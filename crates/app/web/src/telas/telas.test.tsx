import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Telas } from "./Telas";
import { TarefasProvider } from "../dados/TarefasProvider";
import { Sobre } from "./Sobre";
import { ProvedorDaSessao } from "../shell/sessao";
import * as comandos from "../api/comandos";
import { fichaDeExemplo } from "./consultar/exemplos";

vi.mock("../api/comandos");
const m = vi.mocked(comandos);

function com(rota: string, filho = <Telas />) {
  window.location.hash = rota;
  const cliente = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={cliente}><TarefasProvider><ProvedorDaSessao>{filho}</ProvedorDaSessao></TarefasProvider></QueryClientProvider>);
}

beforeEach(() => {
  vi.resetAllMocks();
  m.cnesSituacao.mockResolvedValue({ minha: null, unidades: [], ufs: [], ufs_disponiveis: [] });
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
  m.ficha.mockResolvedValue(fichaDeExemplo());
  com("#/consultar/0301010072");
  expect(await screen.findByRole("heading", { level: 1, name: "CONSULTA MEDICA EM ATENÇÃO ESPECIALIZADA" })).toBeInTheDocument();
});

test("Conferir arquivo marca a conferência como não confirmada", async () => {
  com("#/conferir");
  expect(await screen.findByText("Não confirmada")).toBeInTheDocument();
});

test("Sobre traz o que a interface anterior dizia: agradecimento, quem faz, para quê, promessas e versão", async () => {
  m.infoPrograma.mockResolvedValue({ versao: "0.3.0", repositorio: "NovaGenTecnologia/SIGTAP-aberto" });
  com("#/painel", <Sobre aberto aoFechar={() => {}} />);
  const dialogo = await screen.findByRole("dialog", { name: "Sobre" });
  expect(dialogo).toHaveTextContent(/Obrigado por usar/);
  expect(dialogo).toHaveTextContent(/NovaGen Tecnologia e seus contribuidores/);
  expect(dialogo).toHaveTextContent(/evitar glosas/);
  for (const t of ["Gratuito e aberto", "Fica no seu computador", "Dados oficiais", "Não oficial"]) expect(dialogo).toHaveTextContent(t);
  expect(dialogo).toHaveTextContent(/Confira no SIGTAP oficial antes de faturar/);
  expect(await screen.findByText(/0\.3\.0/)).toBeInTheDocument();
});

test("Sobre abre o código-fonte e o relato de problema no navegador do sistema", async () => {
  const u = userEvent.setup();
  m.infoPrograma.mockResolvedValue({ versao: "0.3.0", repositorio: "NovaGenTecnologia/SIGTAP-aberto" });
  m.abrirSite.mockResolvedValue(undefined);
  com("#/painel", <Sobre aberto aoFechar={() => {}} />);
  await u.click(await screen.findByRole("button", { name: "Código-fonte no GitHub" }));
  expect(m.abrirSite).toHaveBeenCalledWith("https://github.com/NovaGenTecnologia/SIGTAP-aberto");
  await u.click(screen.getByRole("button", { name: "Sugerir ou relatar" }));
  expect(m.abrirSite).toHaveBeenLastCalledWith("https://github.com/NovaGenTecnologia/SIGTAP-aberto/issues/new");
});

test("Sobre procura versão nova e diz o resultado", async () => {
  const u = userEvent.setup();
  m.infoPrograma.mockResolvedValue({ versao: "0.3.0", repositorio: "x/y" });
  m.consultarAtualizacao.mockResolvedValue({ atual: "0.3.0", nova: null, automatica: false });
  com("#/painel", <Sobre aberto aoFechar={() => {}} />);
  await u.click(await screen.findByRole("button", { name: "Procurar atualizações" }));
  expect(await screen.findByRole("status")).toHaveTextContent("Você já está na versão mais recente.");
  m.consultarAtualizacao.mockResolvedValue({ atual: "0.3.0", nova: { versao: "0.4.0", pagina: "https://x" }, automatica: false });
  await u.click(screen.getByRole("button", { name: "Procurar atualizações" }));
  expect(await screen.findByRole("status")).toHaveTextContent("Há uma versão nova: 0.4.0.");
});

test("Sobre mostra a chave Pix e copia para a área de transferência", async () => {
  const u = userEvent.setup();
  const escrever = vi.spyOn(navigator.clipboard, "writeText").mockResolvedValue();
  m.infoPrograma.mockResolvedValue({ versao: "0.3.0", repositorio: "x/y" });
  com("#/painel", <Sobre aberto aoFechar={() => {}} />);
  expect(await screen.findByText("Apoie o projeto")).toBeInTheDocument();
  expect(screen.getByRole("img", { name: /QR Code do Pix/ })).toBeInTheDocument();
  await u.click(screen.getByRole("button", { name: "Copiar chave" }));
  expect(escrever).toHaveBeenCalledWith(expect.stringMatching(/^[0-9a-f-]{36}$/));
});

test("as telas não repetem o aviso de ferramenta não oficial", async () => {
  com("#/painel");
  await screen.findByRole("heading", { level: 1 });
  expect(screen.queryByText(/não oficial/i)).not.toBeInTheDocument();
});
