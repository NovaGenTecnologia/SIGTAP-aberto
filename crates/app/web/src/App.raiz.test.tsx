import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { App } from "./App";
import { clienteDeConsultas } from "./dados/consultas";
import * as comandos from "./api/comandos";
import * as eventos from "./api/eventos";
import type { Situacao } from "./api/tipos";

vi.mock("./api/comandos");
vi.mock("./api/eventos");
const m = vi.mocked(comandos);
const ev = vi.mocked(eventos);

const COMP = { competencia: "202609", rotulo: "09/2026", arquivo: "x.zip", versao: null, publicado_em: null, sha256: "" };
const BASE: Situacao = { primeira_execucao: false, bloqueio: null, competencias: [COMP], territorio: { ok: true }, pasta_dados: "", ocupado: false, recuperacao: null };
const ARQ = { tipo: "ST", uf: "SP", competencia: "202608", arquivo: "a", bytes: 1, registros_gravados: 1, carregado_em: "" };
let aoFim: (f: any) => void;

beforeEach(() => {
  vi.resetAllMocks();
  clienteDeConsultas.clear();
  window.location.hash = "";
  m.cnesSituacao.mockResolvedValue({ minha: null, unidades: [], ufs_disponiveis: [], ufs: [] });
  m.baixar.mockResolvedValue(undefined);
  ev.ouvirProgresso.mockImplementation(async () => () => {});
  ev.ouvirFimTarefa.mockImplementation(async (cb) => { aoFim = cb; return () => {}; });
  ev.ouvirPedidoDeFechar.mockResolvedValue(() => {});
});

test("na primeira execução entra o assistente, sem a navegação principal", async () => {
  m.situacao.mockResolvedValue({ ...BASE, primeira_execucao: true, competencias: [], territorio: null });
  render(<App />);
  expect(await screen.findByRole("list", { name: "Etapas" })).toBeInTheDocument();
  expect(screen.queryByRole("navigation", { name: "Principal" })).toBeNull();
});

test("o assistente continua na tela quando o SIGTAP carrega e a situação deixa de ser de primeira execução", async () => {
  const u = userEvent.setup();
  m.situacao.mockResolvedValue({ ...BASE, primeira_execucao: true, competencias: [], territorio: null });
  render(<App />);
  await u.click(await screen.findByRole("button", { name: "Baixar" }));
  m.situacao.mockResolvedValue(BASE);
  act(() => aoFim({ ok: true, cancelada: false, mensagem: "Concluído" }));
  expect(await screen.findByRole("heading", { level: 1, name: "Seu estado" })).toBeInTheDocument();
  expect(screen.queryByRole("navigation", { name: "Principal" })).toBeNull();
});

test("Abrir o Painel encerra o assistente e mostra o programa", async () => {
  const u = userEvent.setup();
  m.situacao.mockResolvedValue({ ...BASE, primeira_execucao: true });
  m.cnesSituacao.mockResolvedValue({ minha: { uf: "SP", cnes: "2077396", nome: "UNIDADE" }, unidades: [], ufs_disponiveis: ["SP"], ufs: [{ uf: "SP", resumo: { arquivos: [ARQ, { ...ARQ, tipo: "HB" }] } }] });
  render(<App />);
  await u.click(await screen.findByRole("button", { name: "Abrir o Painel" }));
  expect(await screen.findByRole("navigation", { name: "Principal" })).toBeInTheDocument();
  expect(screen.queryByRole("list", { name: "Etapas" })).toBeNull();
});

test("dados de versão mais nova mostram o aviso no programa, não o assistente", async () => {
  m.situacao.mockResolvedValue({ ...BASE, primeira_execucao: true, bloqueio: { versao: "9" } });
  render(<App />);
  expect(await screen.findByRole("alert")).toHaveTextContent(/versão mais nova/);
  expect(screen.queryByRole("list", { name: "Etapas" })).toBeNull();
});

test("banco em recuperação mostra o aviso no programa, não o assistente", async () => {
  m.situacao.mockResolvedValue({ ...BASE, primeira_execucao: true, recuperacao: { bancos: ["tabela de procedimentos"], motivos: ["danificado"] } });
  render(<App />);
  expect(await screen.findByRole("alert")).toHaveTextContent(/refeit|recri/i);
  expect(screen.queryByRole("list", { name: "Etapas" })).toBeNull();
  await waitFor(() => expect(screen.getByRole("navigation", { name: "Principal" })).toBeInTheDocument());
});
