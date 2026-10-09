import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Painel } from "../Painel";
import { ProvedorDaSessao } from "../../shell/sessao";
import { ProvedorDeAvisos } from "../../componentes/base/Avisos";
import * as comandos from "../../api/comandos";
import { aptidaoExemplo, unidadeExemplo } from "./exemplos";

vi.mock("../../api/comandos");
const m = vi.mocked(comandos);

function abrir(rota: string) {
  window.location.hash = rota;
  const cliente = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={cliente}><ProvedorDeAvisos><ProvedorDaSessao><Painel /></ProvedorDaSessao></ProvedorDeAvisos></QueryClientProvider>,
  );
}

const minha = { uf: "SP", cnes: "0000000", nome: "UNIDADE DE EXEMPLO DE SAUDE" };

beforeEach(() => {
  vi.resetAllMocks();
  m.cnesSituacao.mockResolvedValue({ minha, unidades: [minha], ufs: [{ uf: "SP", resumo: { arquivos: [] } }], ufs_disponiveis: ["SP"], terceiros: [] });
  m.situacao.mockResolvedValue({ primeira_execucao: false, bloqueio: null, competencias: [{ competencia: "202609" }], territorio: null, pasta_dados: "", ocupado: false, recuperacao: null } as never);
  m.unidadeVer.mockResolvedValue(unidadeExemplo);
  m.aptidaoUnidade.mockImplementation(async (o) => aptidaoExemplo({ grupo: o?.grupo ? { id: o.grupo, itens: [], desde: 0, itens_omitidos: 0, total: 0, ninguem_produziu: null } : null }));
});

test("o cabeçalho mostra o caminho, a unidade e o seletor irmão com a tela atual marcada", async () => {
  abrir("#/painel/cadastro");
  expect(await screen.findByRole("heading", { level: 1, name: "Cadastro" })).toBeInTheDocument();
  const caminho = screen.getByRole("navigation", { name: "Caminho" });
  expect(within(caminho).getByRole("link", { name: "Painel" })).toHaveAttribute("href", "#/painel");
  expect(await screen.findByText(/UNIDADE DE EXEMPLO DE SAUDE/)).toBeInTheDocument();
  expect(screen.getByText(/CNES 0000000/)).toBeInTheDocument();
  expect(screen.getByText(/Cidade de Exemplo \(SP\)/)).toBeInTheDocument();
  expect(screen.getByText(/CNES de 08\/2026/)).toBeInTheDocument();
  const irmaos = screen.getByRole("navigation", { name: "Telas da unidade" });
  expect(within(irmaos).getByRole("link", { name: "Cadastro" })).toHaveAttribute("aria-current", "page");
  expect(within(irmaos).getByRole("link", { name: "Aptidão" })).toHaveAttribute("href", "#/painel/aptidao");
  expect(within(irmaos).getByText(/Em breve/)).toBeInTheDocument();
  expect(within(irmaos).queryByRole("link", { name: /Produção/ })).toBeNull();
});

test("na Aptidão o seletor marca Aptidão", async () => {
  abrir("#/painel/aptidao/risco");
  expect(await screen.findByRole("heading", { level: 1, name: "Aptidão" })).toBeInTheDocument();
  const irmaos = screen.getByRole("navigation", { name: "Telas da unidade" });
  expect(within(irmaos).getByRole("link", { name: "Aptidão" })).toHaveAttribute("aria-current", "page");
  expect(within(irmaos).getByRole("link", { name: "Cadastro" })).not.toHaveAttribute("aria-current");
});

test("Produção é só um aviso de que vem depois", async () => {
  abrir("#/painel/producao");
  expect(await screen.findByRole("heading", { level: 1, name: "Produção" })).toBeInTheDocument();
  expect(screen.getAllByText(/Em breve/).length).toBeGreaterThan(0);
});

test("sem unidade escolhida mostra o que falta e leva a Dados", async () => {
  m.cnesSituacao.mockResolvedValue({ minha: null, unidades: [], ufs: [], ufs_disponiveis: [], terceiros: [] });
  const u = userEvent.setup();
  abrir("#/painel/cadastro");
  expect(await screen.findByText("Nenhuma unidade escolhida")).toBeInTheDocument();
  expect(m.unidadeVer).not.toHaveBeenCalled();
  await u.click(screen.getByRole("button", { name: "Escolher unidade" }));
  expect(window.location.hash).toBe("#/dados");
});

test("sem o CNES da UF da unidade diz isso e leva a Dados", async () => {
  m.cnesSituacao.mockResolvedValue({ minha, unidades: [minha], ufs: [], ufs_disponiveis: ["SP"], terceiros: [] });
  const u = userEvent.setup();
  abrir("#/painel/aptidao");
  expect(await screen.findByText(/cadastro do CNES de SP não está carregado/i)).toBeInTheDocument();
  expect(m.unidadeVer).not.toHaveBeenCalled();
  await u.click(screen.getByRole("button", { name: "Abrir em Dados" }));
  expect(window.location.hash).toBe("#/dados");
});

test("CNES que saiu do cadastro mostra a mensagem do Rust e deixa tentar de novo", async () => {
  m.unidadeVer.mockRejectedValue("o CNES 0000000 não está mais no cadastro de SP carregado. Escolha a unidade de novo");
  abrir("#/painel/cadastro");
  expect(await screen.findByRole("alert")).toHaveTextContent("não está mais no cadastro de SP");
  expect(screen.getByRole("button", { name: "Tentar de novo" })).toBeInTheDocument();
});
