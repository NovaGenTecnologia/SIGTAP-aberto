import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ProvedorDaSessao, useSessao } from "../../shell/sessao";
import * as comandos from "../../api/comandos";
import type { Historico } from "../../api/tipos";
import { fichaDeExemplo } from "./exemplos";
import { Ficha } from "./Ficha";

vi.mock("../../api/comandos");
const m = vi.mocked(comandos);

const historicoVazio = (extra: Partial<Historico> = {}): Historico => ({
  codigo: "0301010072", codigo_mascarado: "03.01.01.007-2", primeira_carregada: "202604", ultima_carregada: "202609",
  competencias_carregadas: 6, competencias_com_mudanca: [], eventos: [], ...extra,
});

function TrocaCompetencia() {
  const { definirCompetencia } = useSessao();
  return <button onClick={() => definirCompetencia("202608")}>trocar</button>;
}

function montar(rota = "#/consultar/0301010072") {
  window.location.hash = rota;
  const cliente = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={cliente}><ProvedorDaSessao><TrocaCompetencia /><Ficha /></ProvedorDaSessao></QueryClientProvider>);
}

beforeEach(() => {
  vi.resetAllMocks();
  m.ficha.mockResolvedValue(fichaDeExemplo());
  m.historico.mockResolvedValue(historicoVazio());
  m.situacao.mockResolvedValue({ primeira_execucao: false, bloqueio: null, competencias: [], territorio: null, pasta_dados: "x", ocupado: false, recuperacao: null });
});

test("faixa: nome, código em caixas, trilha e dados principais", async () => {
  const u = userEvent.setup();
  montar();
  expect(await screen.findByRole("heading", { level: 1, name: "CONSULTA MEDICA EM ATENÇÃO ESPECIALIZADA" })).toBeInTheDocument();
  for (const n of ["grupo 03", "subgrupo 01", "forma 01", "procedimento 007", "dígito 2"]) expect(screen.getByRole("img", { name: n })).toBeInTheDocument();
  const principais = screen.getByRole("group", { name: "Dados principais" });
  expect(within(principais).getByText("Valor total").nextElementSibling!.textContent!.replace(/ /g, " ")).toBe("R$ 10,00");
  expect(within(principais).getByText("Instrumento").nextElementSibling).toHaveTextContent("BPA · APAC");
  expect(within(principais).getByText("Complexidade").nextElementSibling).toHaveTextContent("Média");
  expect(within(principais).getByText("Modalidade").nextElementSibling).toHaveTextContent("Ambulatorial");
  expect(within(principais).getByText("Financiamento").nextElementSibling).toHaveTextContent("MAC · 06");
  const trilha = screen.getByRole("navigation", { name: "Onde está" });
  await u.click(within(trilha).getByRole("button", { name: /^0301 / }));
  expect(window.location.hash).toBe("#/consultar/explorar/procedimentos/0301");
});

test("copiar o código: sem pontos; com Ctrl, com pontos; avisa e some", async () => {
  const u = userEvent.setup();
  montar();
  const botao = await screen.findByRole("button", { name: /^Copiar o código 0301010072/ });
  const escrever = vi.spyOn(navigator.clipboard, "writeText");
  await u.click(botao);
  expect(escrever).toHaveBeenLastCalledWith("0301010072");
  expect(await screen.findByRole("status")).toHaveTextContent("Código copiado");
  await u.keyboard("{Control>}");
  await u.click(botao);
  await u.keyboard("{/Control}");
  expect(escrever).toHaveBeenLastCalledWith("03.01.01.007-2");
  await waitFor(() => expect(screen.getByRole("status")).toBeEmptyDOMElement(), { timeout: 3000 });
});

test("copiar o nome", async () => {
  const u = userEvent.setup();
  montar();
  const botao = await screen.findByRole("button", { name: "CONSULTA MEDICA EM ATENÇÃO ESPECIALIZADA" });
  const escrever = vi.spyOn(navigator.clipboard, "writeText");
  await u.click(botao);
  expect(escrever).toHaveBeenCalledWith("CONSULTA MEDICA EM ATENÇÃO ESPECIALIZADA");
  expect(await screen.findByRole("status")).toHaveTextContent("Nome copiado");
});

test("mais de uma linha para o código no arquivo oficial gera aviso", async () => {
  const f = fichaDeExemplo();
  m.ficha.mockResolvedValue({ ...f, procedimento: [f.procedimento[0]!, f.procedimento[0]!] });
  montar();
  expect(await screen.findByRole("note")).toHaveTextContent("2 linhas para este código no arquivo oficial.");
});

test("código que não existe na competência explica e mostra o histórico", async () => {
  m.ficha.mockResolvedValue(null);
  m.historico.mockResolvedValue(historicoVazio({
    competencias_com_mudanca: ["202609"],
    eventos: [{ competencia: "202609", rotulo: "09/2026", tabela: "tb_procedimento", coluna: "co_procedimento", tipo: "alterado", chave: {}, antes: null, depois: null, campos_alterados: ["vl_sa"] }],
  }));
  const erro = vi.spyOn(console, "error");
  montar();
  expect(await screen.findByRole("heading", { level: 1, name: /03\.01\.01\.007-2 não existe em/ })).toBeInTheDocument();
  expect(await screen.findByRole("heading", { name: "Histórico" })).toBeInTheDocument();
  expect(m.historico).toHaveBeenCalledWith("0301010072");
  expect((await screen.findAllByText("09/2026")).length).toBeGreaterThan(0);
  expect(erro).not.toHaveBeenCalled();
});

test("abas: Resumo por padrão; escolher uma aba muda a rota; a rota abre a aba certa; aba desconhecida cai em Resumo", async () => {
  const u = userEvent.setup();
  const { unmount } = montar();
  const resumo = await screen.findByRole("tab", { name: "Resumo" });
  expect(resumo).toHaveAttribute("aria-selected", "true");
  await u.click(screen.getByRole("tab", { name: "Histórico" }));
  expect(window.location.hash).toBe("#/consultar/0301010072/historico");
  await u.click(screen.getByRole("tab", { name: "Resumo" }));
  expect(window.location.hash).toBe("#/consultar/0301010072");
  unmount();
  montar("#/consultar/0301010072/exigencias");
  expect(await screen.findByRole("tab", { name: "Exigências" })).toHaveAttribute("aria-selected", "true");
  unmount();
  montar("#/consultar/0301010072/qualquer");
  expect(await screen.findByRole("tab", { name: "Resumo" })).toHaveAttribute("aria-selected", "true");
});

test("setas trocam de aba", async () => {
  const u = userEvent.setup();
  montar();
  (await screen.findByRole("tab", { name: "Resumo" })).focus();
  await u.keyboard("{ArrowRight}");
  expect(window.location.hash).toBe("#/consultar/0301010072/exigencias");
});

test("trocar a competência recarrega a mesma ficha", async () => {
  const u = userEvent.setup();
  montar();
  await screen.findByRole("heading", { level: 1 });
  expect(m.ficha).toHaveBeenLastCalledWith("0301010072", undefined);
  await act(async () => { await u.click(screen.getByRole("button", { name: "trocar" })); });
  await waitFor(() => expect(m.ficha).toHaveBeenLastCalledWith("0301010072", "202608"));
});

test("ao abrir, o foco vai para o título", async () => {
  montar();
  const titulo = await screen.findByRole("heading", { level: 1 });
  await waitFor(() => expect(titulo).toHaveFocus());
});

test("erro ao carregar oferece tentar de novo", async () => {
  const u = userEvent.setup();
  m.ficha.mockRejectedValueOnce(new Error("banco indisponível"));
  montar();
  expect(await screen.findByRole("alert")).toHaveTextContent("banco indisponível");
  await u.click(screen.getByRole("button", { name: "Tentar de novo" }));
  expect(await screen.findByRole("heading", { level: 1, name: /CONSULTA MEDICA/ })).toBeInTheDocument();
});

test("trocar de aba pelo clique leva o foco ao painel; pelas setas, o foco fica na aba", async () => {
  const u = userEvent.setup();
  montar();
  await screen.findByRole("heading", { level: 1 });
  await u.click(screen.getByRole("tab", { name: "Exigências" }));
  const painel = await screen.findByRole("tabpanel");
  await waitFor(() => expect(painel).toHaveFocus());
  screen.getByRole("tab", { name: "Exigências" }).focus();
  await u.keyboard("{ArrowRight}");
  await waitFor(() => expect(screen.getByRole("tab", { name: "Histórico" })).toHaveAttribute("aria-selected", "true"));
  expect(screen.getByRole("tab", { name: "Histórico" })).toHaveFocus();
});

test("Voltar na faixa da ficha volta uma página do histórico", async () => {
  const u = userEvent.setup();
  window.history.pushState({}, "", "#/consultar/q/consulta");
  const voltar = vi.spyOn(window.history, "back").mockImplementation(() => {});
  montar();
  await u.click(await screen.findByRole("button", { name: "Voltar" }));
  expect(voltar).toHaveBeenCalledTimes(1);
  voltar.mockRestore();
});
