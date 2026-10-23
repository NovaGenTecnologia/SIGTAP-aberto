import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClientProvider, QueryClient } from "@tanstack/react-query";
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

const COMP = (c: string) => ({ competencia: c, rotulo: `${c.slice(4)}/${c.slice(0, 4)}`, arquivo: "", versao: null, publicado_em: "05/10/2026 09:50", sha256: "" });
const situacaoOk = { primeira_execucao: false, bloqueio: null, competencias: [COMP("202608"), COMP("202609")], territorio: {}, pasta_dados: "", ocupado: false, recuperacao: null };
const cnesOk = { minha: { uf: "MS", cnes: "2654504", nome: "Hospital Regional" }, unidades: [{ uf: "MS", cnes: "2654504", nome: "Hospital Regional" }], ufs: [], ufs_disponiveis: ["MS"] };

function montar() {
  const cliente = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={cliente}>
      <ProvedorDeAvisos><TarefasProvider><ProvedorDaSessao><Shell><p>conteúdo</p></Shell></ProvedorDaSessao></TarefasProvider></ProvedorDeAvisos>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.resetAllMocks();
  window.location.hash = "#/painel";
  ev.ouvirProgresso.mockResolvedValue(() => {});
  ev.ouvirFimTarefa.mockResolvedValue(() => {});
  ev.ouvirPedidoDeFechar.mockResolvedValue(() => {});
  m.situacao.mockResolvedValue(situacaoOk);
  m.cnesSituacao.mockResolvedValue(cnesOk);
  m.buscar.mockResolvedValue({ consulta: "consulta", competencia: "202609", modo: "texto", total_procedimentos: 1, apoio: [],
    procedimentos: [{ na_descricao: false, codigo: "0301010072", codigo_mascarado: "03.01.01.007-2", nome: "CONSULTA MEDICA EM ATENCAO ESPECIALIZADA", tp_complexidade: "2", complexidade: "Média", valor_total_centavos: 1000, instrumentos: [], forma: "030101", forma_nome: null }] });
});

test("moldura: navegação principal com os cinco destinos e o atual marcado", async () => {
  montar();
  const nav = await screen.findByRole("navigation", { name: "Principal" });
  const links = nav.querySelectorAll("a");
  expect([...links].map((a) => a.textContent)).toEqual(["Painel", "Consultar", "Mudanças", "Conferir arquivo", "Dados"]);
  expect(screen.getByRole("link", { name: "Painel" })).toHaveAttribute("aria-current", "page");
  expect(screen.getByRole("main")).toHaveTextContent("conteúdo");
});

test("topo mostra a unidade ativa e a competência mais recente; rodapé mostra a fonte", async () => {
  montar();
  expect(await screen.findByRole("button", { name: /Trocar unidade/ })).toHaveTextContent("Hospital Regional");
  await waitFor(() => expect(screen.getByRole("button", { name: /Competência/ })).toHaveTextContent("09/2026"));
  expect(screen.getByRole("contentinfo")).toHaveTextContent("05/10/2026");
  expect(screen.getByRole("contentinfo")).not.toHaveTextContent(/não oficial/i);
});

test("a competência mais recente vale mesmo se o backend devolver fora de ordem", async () => {
  m.situacao.mockResolvedValue({ ...situacaoOk, competencias: [COMP("202609"), COMP("202608")] });
  montar();
  await waitFor(() => expect(screen.getByRole("button", { name: /Competência/ })).toHaveTextContent("09/2026"));
});

test("Ctrl+K abre a paleta, busca procedimento e Enter vai para Consultar", async () => {
  const u = userEvent.setup();
  montar();
  await screen.findByRole("navigation", { name: "Principal" });
  await u.keyboard("{Control>}k{/Control}");
  const campo = await screen.findByRole("combobox", { name: "Buscar" });
  await u.type(campo, "consulta");
  const opcao = await screen.findByRole("option", { name: /03\.01\.01\.007-2/ }, { timeout: 2000 });
  expect(opcao).toBeInTheDocument();
  await u.keyboard("{Enter}");
  expect(window.location.hash).toBe("#/consultar/0301010072");
});

test("Esc fecha a paleta", async () => {
  const u = userEvent.setup();
  montar();
  const botao = await screen.findByRole("button", { name: /Buscar/ });
  await u.click(botao);
  await screen.findByRole("combobox", { name: "Buscar" });
  await u.keyboard("{Escape}");
  await waitFor(() => expect(screen.queryByRole("combobox", { name: "Buscar" })).not.toBeInTheDocument());
});

// Foco da revisão 1: dados de versão mais nova
test("com bloqueio, o shell mostra o aviso e desativa busca e competência", async () => {
  m.situacao.mockResolvedValue({ ...situacaoOk, bloqueio: "dados de uma versão mais nova", competencias: [] });
  montar();
  expect(await screen.findByRole("alert")).toHaveTextContent(/versão mais nova/i);
  expect(screen.getByRole("button", { name: /Buscar/ })).toBeDisabled();
});

// Foco da revisão 2: unidade sem nome e nome muito longo
test("unidade sem nome mostra o CNES; nome longo fica truncado com o texto completo acessível", async () => {
  m.cnesSituacao.mockResolvedValue({ ...cnesOk, minha: { uf: "MS", cnes: "2654504", nome: "" } });
  const { unmount } = montar();
  expect(await screen.findByRole("button", { name: /Trocar unidade/ })).toHaveTextContent("CNES 2654504");
  unmount();
  const longo = "HOSPITAL UNIVERSITARIO DE UMA CIDADE MUITO GRANDE COM UM NOME EXTREMAMENTE LONGO PARA TESTAR O TOPO";
  m.cnesSituacao.mockResolvedValue({ ...cnesOk, minha: { uf: "MS", cnes: "1", nome: longo } });
  montar();
  const botao = await screen.findByRole("button", { name: /Trocar unidade/ });
  expect(botao).toHaveAccessibleName(expect.stringContaining(longo));
});

test("unidade ativa fora da lista de troca rápida continua aparecendo no topo", async () => {
  m.cnesSituacao.mockResolvedValue({ ...cnesOk, unidades: [] });
  montar();
  expect(await screen.findByRole("button", { name: /Trocar unidade/ })).toHaveTextContent("Hospital Regional");
});

test("sem unidade nenhuma o topo oferece escolher em Dados", async () => {
  m.cnesSituacao.mockResolvedValue({ minha: null, unidades: [], ufs: [], ufs_disponiveis: [] });
  montar();
  expect(await screen.findByRole("link", { name: "Escolher unidade" })).toHaveAttribute("href", "#/dados");
});

// Foco da revisão 3: falha do backend
test("falha ao ler a situação mostra erro com 'Tentar de novo', nunca tela em branco", async () => {
  const u = userEvent.setup();
  m.situacao.mockRejectedValueOnce(new Error("Não foi possível ler os dados."));
  montar();
  expect(await screen.findByRole("alert")).toHaveTextContent("Não foi possível ler os dados.");
  await u.click(screen.getByRole("button", { name: "Tentar de novo" }));
  expect(await screen.findByRole("navigation", { name: "Principal" })).toBeInTheDocument();
});

// Foco da revisão 4: sem competência carregada
test("sem competências o seletor fica desativado e o rodapé não mostra data", async () => {
  m.situacao.mockResolvedValue({ ...situacaoOk, primeira_execucao: true, competencias: [] });
  montar();
  const seletor = await screen.findByRole("button", { name: /Competência/ });
  expect(seletor).toBeDisabled();
  expect(screen.getByRole("contentinfo")).not.toHaveTextContent(/publicad/i);
});

test("trocar a unidade chama o backend e atualiza a lista", async () => {
  const u = userEvent.setup();
  m.cnesSituacao.mockResolvedValue({ ...cnesOk, unidades: [...cnesOk.unidades, { uf: "MS", cnes: "7", nome: "UPA Centro" }] });
  m.unidadeDefinir.mockResolvedValue({});
  montar();
  await u.click(await screen.findByRole("button", { name: /Trocar unidade/ }));
  await u.click(await screen.findByRole("menuitem", { name: /UPA Centro/ }));
  expect(m.unidadeDefinir).toHaveBeenCalledWith("MS", "7");
});

test("a lista de unidades termina com o atalho para adicionar outra, que abre Dados", async () => {
  const u = userEvent.setup();
  montar();
  await u.click(await screen.findByRole("button", { name: /Trocar unidade/ }));
  const itens = await screen.findAllByRole("menuitem");
  expect(itens.at(-1)).toHaveTextContent("Adicionar unidade");
  await u.click(itens.at(-1)!);
  expect(window.location.hash).toBe("#/dados");
});
