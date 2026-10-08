import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import * as comandos from "../../api/comandos";
import type { CompetenciaInfo, EventoDeHistorico, Historico, Situacao } from "../../api/tipos";
import { campo, linha, nome } from "./exemplos";
import { FichaHistorico } from "./FichaHistorico";

vi.mock("../../api/comandos");
const m = vi.mocked(comandos);

const proc = (sa: number) => linha([campo("co_procedimento", "0301010072"), campo("vl_sa", sa, { unidade: "centavos" })]);
const cbo = (cod: string, texto: string) => linha([campo("co_procedimento", "0301010072"), campo("co_ocupacao", cod)], [nome("tb_ocupacao", "co_ocupacao", { no_ocupacao: texto })]);
const rot = (c: string) => `${c.slice(4)}/${c.slice(0, 4)}`;

const alterado = (competencia: string, de = 900, para = 1000): EventoDeHistorico => ({
  competencia, rotulo: rot(competencia), tabela: "tb_procedimento", coluna: "co_procedimento", tipo: "alterado",
  chave: { co_procedimento: "0301010072" }, antes: proc(de), depois: proc(para), campos_alterados: ["vl_sa"],
});
const incluido = (competencia: string, cod = "225125"): EventoDeHistorico => ({
  competencia, rotulo: rot(competencia), tabela: "rl_procedimento_ocupacao", coluna: "co_procedimento", tipo: "incluido",
  chave: { co_procedimento: "0301010072", co_ocupacao: cod }, antes: null, depois: cbo(cod, `Ocupação ${cod}`), campos_alterados: [],
});

function meses(de: number, n: number): string[] {
  return Array.from({ length: n }, (_, i) => { const t = de * 12 + i; return `${Math.floor(t / 12)}${String((t % 12) + 1).padStart(2, "0")}`; });
}
const situacao = (comps: string[]): Situacao => ({
  primeira_execucao: false, bloqueio: null, territorio: null, pasta_dados: "x", ocupado: false, recuperacao: null,
  competencias: comps.map((c): CompetenciaInfo => ({ competencia: c, rotulo: rot(c), arquivo: "x.zip", versao: null, publicado_em: null, sha256: "" })),
});
const historico = (comps: string[], eventos: EventoDeHistorico[]): Historico => ({
  codigo: "0301010072", codigo_mascarado: "03.01.01.007-2", primeira_carregada: comps[0]!, ultima_carregada: comps[comps.length - 1]!,
  competencias_carregadas: comps.length, competencias_com_mudanca: [...new Set(eventos.map((e) => e.competencia))].sort(), eventos,
});

function montar(comps: string[], eventos: EventoDeHistorico[]) {
  m.historico.mockResolvedValue(historico(comps, eventos));
  m.situacao.mockResolvedValue(situacao(comps));
  const cliente = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={cliente}><FichaHistorico codigo="0301010072" /></QueryClientProvider>);
}

const seis = ["202604", "202605", "202606", "202607", "202608", "202609"];

beforeEach(() => {
  vi.resetAllMocks();
  Element.prototype.scrollIntoView = vi.fn();
});

test("cabeçalho e marcadores: só as competências com mudança são botões", async () => {
  montar(seis, [alterado("202609"), incluido("202609"), incluido("202607")]);
  expect(await screen.findByText(/Carregado em 6 competências, de 04\/2026 a 09\/2026/)).toBeInTheDocument();
  expect(screen.getByText("2 competências com mudança")).toBeInTheDocument();
  const tira = screen.getByRole("list", { name: "Competências carregadas" });
  expect(within(tira).getAllByRole("listitem")).toHaveLength(6);
  expect(within(tira).getAllByRole("button").map((b) => b.textContent)).toEqual(["07/20261 mudança", "09/20262 mudanças"]);
  expect(within(tira).getAllByText("—")).toHaveLength(4);
});

test("clicar num marcador leva à competência", async () => {
  const u = userEvent.setup();
  montar(seis, [alterado("202609"), incluido("202607")]);
  await u.click(await screen.findByRole("button", { name: /^07\/2026/ }));
  await waitFor(() => expect(Element.prototype.scrollIntoView).toHaveBeenCalled());
  expect(document.getElementById("ev-202607")).not.toBeNull();
});

test("setas percorrem só os marcadores com mudança", async () => {
  const u = userEvent.setup();
  montar(seis, [alterado("202609"), incluido("202607")]);
  const primeiro = await screen.findByRole("button", { name: /^07\/2026/ });
  primeiro.focus();
  await u.keyboard("{ArrowRight}");
  expect(screen.getByRole("button", { name: /^09\/2026/ })).toHaveFocus();
  await u.keyboard("{ArrowLeft}");
  expect(primeiro).toHaveFocus();
});

test("eventos por competência, mais recente primeiro: alterado mostra antes e depois", async () => {
  montar(seis, [incluido("202607"), alterado("202609")]);
  const titulos = (await screen.findAllByRole("heading", { level: 3 })).map((h) => h.textContent);
  expect(titulos).toEqual(["09/2026", "07/2026"]);
  const cartao = screen.getByText("Valor do serviço ambulatorial").closest(".hist__item")!;
  expect(cartao).toHaveTextContent("Alterado");
  expect(cartao.textContent!.replace(/ /g, " ")).toMatch(/R\$ 9,00.*R\$ 10,00/);
  expect(screen.getByText("225125 Ocupação 225125")).toBeInTheDocument();
});

test("filtro Valores esconde o que não é valor; Tabela filtra por tabela", async () => {
  const u = userEvent.setup();
  montar(seis, [incluido("202607"), alterado("202609")]);
  await u.click(await screen.findByRole("radio", { name: "Valores" }));
  expect(screen.queryByText("225125 Ocupação 225125")).not.toBeInTheDocument();
  expect(screen.getByText("Valor do serviço ambulatorial")).toBeInTheDocument();
  await u.click(screen.getByRole("radio", { name: "Exigências" }));
  expect(screen.queryByText("Valor do serviço ambulatorial")).not.toBeInTheDocument();
  expect(screen.getByText("225125 Ocupação 225125")).toBeInTheDocument();
});

test("sem mudanças, com histórico: diz que não houve", async () => {
  montar(seis, []);
  expect(await screen.findByText("Nenhuma competência com mudança")).toBeInTheDocument();
  expect(screen.getByText("Sem mudanças nas competências carregadas.")).toBeInTheDocument();
});

test("uma competência só: avisa e leva a Dados", async () => {
  montar(["202609"], []);
  const aviso = await screen.findByText(/^Só uma competência carregada\./);
  expect(aviso).toHaveTextContent("Só uma competência carregada. Baixe o histórico em Dados para ver as mudanças.");
  expect(screen.getByRole("link", { name: "Dados" })).toHaveAttribute("href", "#/dados");
});

test("mais de 12 competências: tira de barras e anos recolhidos, só o mais recente aberto", async () => {
  const u = userEvent.setup();
  const comps = meses(2024, 24); // 01/2024 a 12/2025
  montar(comps, [alterado("202512"), alterado("202512", 1, 2), incluido("202506"), incluido("202403")]);
  expect(await screen.findByText(/Carregado em 24 competências/)).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "12/2025: 2 mudanças" })).toBeInTheDocument();
  expect(screen.getAllByRole("button", { name: /^\d\d\/\d{4}: / })).toHaveLength(3);
  const a2025 = screen.getByRole("button", { name: /^2025/ });
  const a2024 = screen.getByRole("button", { name: /^2024/ });
  expect(a2025).toHaveAttribute("aria-expanded", "true");
  expect(a2025).toHaveTextContent("3 mudanças em 2 competências");
  expect(a2024).toHaveAttribute("aria-expanded", "false");
  await u.click(a2024);
  expect(a2024).toHaveAttribute("aria-expanded", "true");
  expect(await screen.findByRole("heading", { level: 4, name: "03/2024" })).toBeInTheDocument();
});

test("clicar numa barra de ano recolhido abre o ano", async () => {
  const u = userEvent.setup();
  montar(meses(2024, 24), [alterado("202512"), incluido("202403")]);
  await u.click(await screen.findByRole("button", { name: "03/2024: 1 mudança" }));
  expect(screen.getByRole("button", { name: /^2024/ })).toHaveAttribute("aria-expanded", "true");
});

test("300 eventos: lista em blocos de 50 com Mostrar mais", async () => {
  const u = userEvent.setup();
  const eventos = Array.from({ length: 300 }, (_, i) => alterado("202609", i, i + 1));
  montar(seis, eventos);
  await screen.findByText(/Carregado em 6 competências/);
  const itens = () => document.querySelectorAll(".hist__item").length;
  expect(itens()).toBeLessThanOrEqual(50);
  await u.click(screen.getByRole("button", { name: /Mostrar mais/ }));
  await waitFor(() => expect(itens()).toBeGreaterThan(50));
});

test("erro ao carregar oferece tentar de novo", async () => {
  m.historico.mockRejectedValue(new Error("falhou"));
  m.situacao.mockResolvedValue(situacao(seis));
  const cliente = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={cliente}><FichaHistorico codigo="0301010072" /></QueryClientProvider>);
  expect(await screen.findByRole("button", { name: /tentar/i })).toBeInTheDocument();
});
