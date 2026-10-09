import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { faturamentoExemplo } from "../exemplosDeProducao";
import { abrir, m, preparar } from "../apoioDeTeste";

vi.mock("../../../api/comandos");

beforeEach(() => preparar());

test("as abas trazem a contagem de cada pergunta e a Visão geral abre primeiro", async () => {
  abrir("#/painel/producao");
  const abas = await screen.findByRole("tablist", { name: /Produção/ });
  await screen.findByRole("tab", { name: "Procedimentos 1.988" });
  const nomes = within(abas).getAllByRole("tab").map((t) => t.textContent);
  expect(nomes).toEqual(["Visão geral", "Rejeições", "Procedimentos 1.988", "Fora do padrão 107", "Origem do valor"]);
  expect(screen.getByRole("tab", { name: "Visão geral" })).toHaveAttribute("aria-selected", "true");
});

test("enquanto o fechamento carrega, as abas aparecem sem contagem", async () => {
  m.faturamentoUnidade.mockReturnValue(new Promise(() => {}));
  abrir("#/painel/producao");
  const abas = await screen.findByRole("tablist", { name: /Produção/ });
  expect(within(abas).getAllByRole("tab").map((t) => t.textContent)).toEqual(["Visão geral", "Rejeições", "Procedimentos", "Fora do padrão", "Origem do valor"]);
});

test("sem rejeições nem AIH a aba Rejeições fica sem número e nunca mostra NaN", async () => {
  m.faturamentoUnidade.mockResolvedValue(faturamentoExemplo({
    rejeicoes: { ...faturamentoExemplo().rejeicoes, por_100_aih: null, motivos: [], motivos_total: 0 },
    permanencia: null, apresentado: null,
  }));
  abrir("#/painel/producao");
  expect(await screen.findByRole("tab", { name: "Rejeições" })).toBeInTheDocument();
  expect(screen.queryByText(/NaN/)).toBeNull();
});

test("setas trocam de aba e a rota acompanha", async () => {
  const u = userEvent.setup();
  abrir("#/painel/producao");
  const primeira = await screen.findByRole("tab", { name: "Visão geral" });
  primeira.focus();
  await u.keyboard("{ArrowRight}");
  expect(await screen.findByRole("tab", { name: /Rejeições/, selected: true })).toBeInTheDocument();
  expect(window.location.hash).toBe("#/painel/producao/rejeicoes");
  await u.keyboard("{ArrowLeft}");
  expect(await screen.findByRole("tab", { name: "Visão geral", selected: true })).toBeInTheDocument();
  expect(window.location.hash).toBe("#/painel/producao");
});

test("a rota escolhe a aba ao abrir e uma aba inválida cai na Visão geral", async () => {
  abrir("#/painel/producao/fora-do-padrao");
  expect(await screen.findByRole("tab", { name: /Fora do padrão/, selected: true })).toBeInTheDocument();
  abrir("#/painel/producao/nada");
  const abas = await screen.findAllByRole("tab", { name: "Visão geral", selected: true });
  expect(abas.length).toBeGreaterThan(0);
});

test("o cabeçalho e o nome da unidade não mudam ao trocar de aba", async () => {
  abrir("#/painel/producao/procedimentos");
  expect(await screen.findByRole("heading", { level: 1, name: "Produção" })).toBeInTheDocument();
  expect(await screen.findByText(/UNIDADE DE EXEMPLO DE SAUDE/)).toBeInTheDocument();
});

test("sem produção baixada a Produção avisa e leva a Dados", async () => {
  m.faturamentoUnidade.mockResolvedValue({ disponivel: false, uf: "SP", mensagem: "A produção de SP não está carregada." });
  const u = userEvent.setup();
  abrir("#/painel/producao");
  expect(await screen.findByText(/Sem produção carregada para SP/)).toBeInTheDocument();
  await u.click(screen.getByRole("button", { name: "Baixar produção" }));
  expect(window.location.hash).toBe("#/dados");
});

test("unidade sem nenhuma produção nos meses carregados diz isso e leva a Dados", async () => {
  const f = faturamentoExemplo();
  m.faturamentoUnidade.mockResolvedValue({
    ...f, meses: f.meses.map((x) => ({ ...x, sia_valor_centavos: 0, sia_quantidade: 0, sih_valor_centavos: 0, sih_aih: 0, rejeicoes: 0 })),
  });
  const u = userEvent.setup();
  abrir("#/painel/producao");
  expect(await screen.findByText("Nenhuma produção desta unidade nos meses carregados")).toBeInTheDocument();
  expect(screen.queryByRole("tablist")).toBeNull();
  await u.click(screen.getByRole("button", { name: "Abrir em Dados" }));
  expect(window.location.hash).toBe("#/dados");
});
