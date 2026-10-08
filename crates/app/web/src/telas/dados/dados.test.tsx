import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { TarefasProvider } from "../../dados/TarefasProvider";
import { Dados } from "./Dados";
import * as comandos from "../../api/comandos";
import * as eventos from "../../api/eventos";
import type { Ofertas, Situacao } from "../../api/tipos";

vi.mock("../../api/comandos");
vi.mock("../../api/eventos");
const m = vi.mocked(comandos);
const ev = vi.mocked(eventos);

const COMP = (competencia: string, rotulo: string) => ({ competencia, rotulo, arquivo: `${competencia}.zip`, versao: null, publicado_em: "05/10/2026 09:50", sha256: "" });
const MB640 = 640 * 1024 * 1024;
const SITUACAO: Situacao = {
  primeira_execucao: false, bloqueio: null, competencias: [COMP("202609", "09/2026"), COMP("202608", "08/2026")],
  territorio: { ok: true }, pasta_dados: "", ocupado: false, recuperacao: null,
  zips: { arquivos: 3, bytes: 1.4 * 1024 ** 3, apagaveis: 2, bytes_apagaveis: MB640, mantida: null },
};
const OFERTAS: Ofertas = {
  servidor: "ftp.datasus.gov.br",
  competencias: [
    { competencia: "202609", tamanho: 9.8e6, guardado: true, carregado: true },
    { competencia: "202608", tamanho: 9.7e6, guardado: true, carregado: true },
    { competencia: "202607", tamanho: 9.6e6, guardado: true, carregado: false },
    { competencia: "202606", tamanho: 9.5e6, guardado: false, carregado: false },
  ],
};
let aoProgresso: (p: any) => void;
let aoFim: (f: any) => void;

function montar() {
  const cliente = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={cliente}><TarefasProvider><Dados /></TarefasProvider></QueryClientProvider>);
}

beforeEach(() => {
  vi.resetAllMocks();
  m.situacao.mockResolvedValue(SITUACAO);
  m.ofertas.mockResolvedValue(OFERTAS);
  m.cnesSituacao.mockResolvedValue({ minha: null, unidades: [], ufs_disponiveis: [], ufs: [] });
  m.producaoSituacao.mockResolvedValue({ ufs: [], manter_brutos: false });
  m.baixar.mockResolvedValue(undefined);
  m.importar.mockResolvedValue(undefined);
  m.apagarZips.mockResolvedValue("ok");
  m.cancelar.mockResolvedValue(undefined);
  ev.ouvirProgresso.mockImplementation(async (cb) => { aoProgresso = cb; return () => {}; });
  ev.ouvirFimTarefa.mockImplementation(async (cb) => { aoFim = cb; return () => {}; });
});

test("o cabeçalho mostra o armazenamento e as três abas", async () => {
  montar();
  expect(await screen.findByRole("heading", { level: 1, name: "Dados" })).toBeInTheDocument();
  expect(await screen.findByText(/podem ser liberados 640 MB/)).toBeInTheDocument();
  expect(screen.getAllByRole("tab").map((t) => t.textContent)).toEqual(["SIGTAP", "CNES", "Produção"]);
});

test("Procurar atualizações consulta o servidor de novo, uma vez por clique", async () => {
  const u = userEvent.setup();
  montar();
  await screen.findByRole("grid", { name: /competências/i });
  await u.click(screen.getByRole("button", { name: "Procurar atualizações" }));
  await waitFor(() => expect(m.ofertas).toHaveBeenCalledWith(true));
  expect(m.ofertas.mock.calls.filter(([deNovo]) => deNovo === true)).toHaveLength(1);
});

test("a tabela diz se cada competência está carregada, guardada ou só no servidor", async () => {
  montar();
  const tabela = await screen.findByRole("grid", { name: /competências/i });
  const linha = (rotulo: string) => within(tabela).getByRole("row", { name: new RegExp(rotulo) });
  expect(linha("09/2026")).toHaveTextContent("Carregada");
  expect(linha("07/2026")).toHaveTextContent("Guardada");
  expect(linha("06/2026")).toHaveTextContent("Só no servidor");
});

test("Baixar pede as últimas 12 competências sem apagar os ZIPs", async () => {
  const u = userEvent.setup();
  montar();
  await u.click(await screen.findByRole("button", { name: "Baixar" }));
  await waitFor(() => expect(m.baixar).toHaveBeenCalledTimes(1));
  expect(m.baixar).toHaveBeenCalledWith(expect.objectContaining({ sigtap: "12" }));
});

test("um só interruptor 'Manter arquivos baixados' no topo, desligado por padrão; as abas não têm o seu", async () => {
  montar();
  expect(await screen.findByRole("switch", { name: "Manter arquivos baixados" })).not.toBeChecked();
  expect(screen.getAllByRole("switch")).toHaveLength(1);
});

test("Importar de pasta escolhe a pasta e importa; cancelar a escolha não importa", async () => {
  const u = userEvent.setup();
  m.escolherPasta.mockResolvedValueOnce("D:/zips").mockResolvedValueOnce(null);
  montar();
  await u.click(await screen.findByRole("button", { name: "Importar de pasta" }));
  await waitFor(() => expect(m.importar).toHaveBeenCalledWith("D:/zips"));
  act(() => aoFim({ fonte: "sigtap", tarefa: 1, ok: true, cancelada: false, mensagem: "Concluído" })); // a importação é uma tarefa: só termina o clique seguinte depois
  await u.click(await screen.findByRole("button", { name: "Importar de pasta" }));
  await waitFor(() => expect(m.escolherPasta).toHaveBeenCalledTimes(2));
  expect(m.importar).toHaveBeenCalledTimes(1);
});

test("com tarefa em andamento as ações ficam desativadas e uma linha explica o motivo", async () => {
  m.situacao.mockResolvedValue({ ...SITUACAO, ocupado: true, tarefas: [{ fonte: "sigtap", tarefa: 1, rotulo: "SIGTAP", na_fila: false }] });
  montar();
  await screen.findByRole("grid", { name: /competências/i });
  for (const nome of ["Baixar", "Importar de pasta", "Apagar ZIPs já carregados", "Procurar atualizações"]) {
    expect(screen.getByRole("button", { name: nome })).toBeDisabled();
  }
  expect(screen.getAllByText("Já há um download de SIGTAP em andamento.")).toHaveLength(1);
});

test("com o CNES baixando, os botões do SIGTAP continuam habilitados", async () => {
  m.situacao.mockResolvedValue({ ...SITUACAO, ocupado: true, tarefas: [{ fonte: "cnes", tarefa: 1, rotulo: "CNES de MS", na_fila: false }] });
  montar();
  await screen.findByRole("grid", { name: /competências/i });
  for (const nome of ["Baixar", "Importar de pasta", "Procurar atualizações"]) {
    expect(screen.getByRole("button", { name: nome })).toBeEnabled();
  }
  expect(screen.queryByText(/Já há um download/)).toBeNull();
});

test("durante o download aparece o progresso com Cancelar", async () => {
  const u = userEvent.setup();
  montar();
  await u.click(await screen.findByRole("button", { name: "Baixar" }));
  act(() => aoProgresso({ fonte: "sigtap", tarefa: 1, rotulo: "SIGTAP", fase: "baixando", resumo: "Fazendo download 3 de 12", mensagem: "TabelaUnificada_202607.zip", fracao: 0.3, indeterminado: false }));
  expect(await screen.findByText("Fazendo download 3 de 12")).toBeInTheDocument();
  await u.click(screen.getByRole("button", { name: "Cancelar" }));
  expect(m.cancelar).toHaveBeenCalledTimes(1);
  act(() => aoFim({ fonte: "sigtap", tarefa: 1, ok: true, cancelada: true, mensagem: "Cancelada" }));
});

describe("apagar ZIPs já carregados", () => {
  test("pede confirmação com o tamanho e só apaga ao confirmar", async () => {
    const u = userEvent.setup();
    montar();
    await u.click(await screen.findByRole("button", { name: "Apagar ZIPs já carregados" }));
    const dialogo = await screen.findByRole("alertdialog");
    expect(dialogo).toHaveTextContent("640 MB");
    expect(m.apagarZips).not.toHaveBeenCalled();
    await u.click(within(dialogo).getByRole("button", { name: "Apagar" }));
    await waitFor(() => expect(m.apagarZips).toHaveBeenCalledTimes(1));
  });

  test("Esc fecha sem apagar", async () => {
    const u = userEvent.setup();
    montar();
    await u.click(await screen.findByRole("button", { name: "Apagar ZIPs já carregados" }));
    await screen.findByRole("alertdialog");
    await u.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    expect(m.apagarZips).not.toHaveBeenCalled();
  });
});

test("falha ao consultar o servidor mostra a causa e deixa importar de pasta", async () => {
  const u = userEvent.setup();
  m.ofertas.mockRejectedValue(new Error("Não foi possível consultar o servidor do DATASUS: sem conexão."));
  m.escolherPasta.mockResolvedValue("D:/zips");
  montar();
  const alerta = await screen.findByRole("alert");
  expect(alerta).toHaveTextContent("sem conexão");
  expect(within(alerta).getByRole("button", { name: "Tentar de novo" })).toBeInTheDocument();
  await u.click(screen.getByRole("button", { name: "Importar de pasta" }));
  await waitFor(() => expect(m.importar).toHaveBeenCalledWith("D:/zips"));
});
