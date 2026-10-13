import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { faturamentoExemplo, painelDaUnidade } from "../exemplosDeProducao";
import { abrir, m, preparar } from "../apoioDeTeste";

vi.mock("../../../api/comandos");

beforeEach(() => preparar());

const cartao = async (nome: RegExp) => {
  const titulo = await screen.findByText(nome);
  return titulo.closest("section") as HTMLElement;
};

test("quatro cartões: valor do último mês completo, sentido em texto e referência", async () => {
  abrir("#/painel/producao");
  const sia = await cartao(/^SIA aprovado em 06\/2026$/);
  expect(within(sia).getByText("R$ 10,1 mi")).toBeInTheDocument();
  expect(within(sia).getByText(/▲ sobe \+8,0%/)).toBeInTheDocument();
  expect(within(sia).getByText("contra os 3 meses anteriores")).toBeInTheDocument();
  const sih = await cartao(/^SIH aprovado em 07\/2026$/);
  expect(within(sih).getByText("R$ 4,1 mi")).toBeInTheDocument();
  expect(within(sih).getByText(/▲ sobe \+10,9%/)).toBeInTheDocument();
  const rej = await cartao(/^Rejeições por 100 AIH$/);
  expect(within(rej).getByText("1,66")).toBeInTheDocument();
  expect(within(rej).getByText(/▲ acima da mediana dos pares/)).toBeInTheDocument();
  expect(within(rej).getByText(/mediana 1,32 · 1\.017 em 61\.100 AIH/)).toBeInTheDocument();
  const pos = await cartao(/^Posição entre os pares$/);
  expect(within(pos).getByText(/SIA 82%/)).toBeInTheDocument();
  expect(within(pos).getByText(/23 estabelecimentos do mesmo tipo/)).toBeInTheDocument();
});

test("o mês incompleto fica de fora do cartão, é dito uma vez no topo e aparece hachurado na série", async () => {
  abrir("#/painel/producao");
  const faixa = await screen.findByRole("note");
  expect(within(faixa).getByText("SIA de 07/2026 incompleto (7.241 estabelecimentos): fora da conta")).toBeInTheDocument();
  expect(screen.queryByText(/SIA aprovado em 07\/2026/)).toBeNull();
  expect(screen.getByText("07/2026: mês incompleto, fora da conta")).toBeInTheDocument();
  expect(document.querySelector('rect[fill="url(#serie-hachura)"]')).not.toBeNull();
});

test("sem mês incompleto não há faixa e a série diz que todos estão completos", async () => {
  const f = faturamentoExemplo();
  m.faturamentoUnidade.mockResolvedValue({ ...f, cobertura: { sia: f.cobertura.sia.map((c) => ({ ...c, completo: true })), sih: f.cobertura.sih }, meses_completos: { sia: f.janela.sih, sih: f.janela.sih } });
  abrir("#/painel/producao");
  await screen.findByText(/^SIA aprovado em 07\/2026$/);
  expect(screen.queryByRole("note")).toBeNull();
  expect(screen.getAllByText("Todos os meses completos.").length).toBe(2);
});

test("unidade só com SIA: sem cartão de SIH nem de rejeição, e uma linha diz por quê", async () => {
  const f = faturamentoExemplo();
  m.faturamentoUnidade.mockResolvedValue({
    ...f, meses: f.meses.map((x) => ({ ...x, sih_aih: 0, sih_dias: null, sih_valor_centavos: 0, rejeicoes: 0 })),
    rejeicoes: { ...f.rejeicoes, por_100_aih: null, janela_aih: 0, janela_rejeicoes: 0, motivos: [], motivos_total: 0 }, pares: null,
  });
  abrir("#/painel/producao");
  await screen.findByText(/^SIA aprovado em 06\/2026$/);
  expect(screen.queryByText(/^SIH aprovado em/)).toBeNull();
  expect(screen.queryByText("Rejeições por 100 AIH")).toBeNull();
  expect(screen.getByText("Esta unidade não tem internações (SIH): sem cartão de SIH nem de rejeições.")).toBeInTheDocument();
});

test("poucas AIH: o cartão de rejeições diz que não dá para comparar, sem NaN nem mediana", async () => {
  const f = faturamentoExemplo();
  m.faturamentoUnidade.mockResolvedValue({
    ...f, rejeicoes: { ...f.rejeicoes, janela_aih: 30, janela_rejeicoes: 1, por_100_aih: 3.3 },
    pares: f.pares && { ...f.pares, taxa_mediana_dos_pares: null, pares_com_taxa: 0 },
  });
  abrir("#/painel/producao");
  const rej = await cartao(/^Rejeições por 100 AIH$/);
  expect(within(rej).getByText("poucas AIH para comparar")).toBeInTheDocument();
  expect(within(rej).queryByText(/mediana/)).toBeNull();
  expect(document.body.textContent).not.toMatch(/NaN|Infinity/);
});

test("sem pares o cartão de posição some em vez de inventar um número", async () => {
  m.faturamentoUnidade.mockResolvedValue({ ...faturamentoExemplo(), pares: null });
  abrir("#/painel/producao");
  await screen.findByText(/^SIA aprovado em 06\/2026$/);
  expect(screen.queryByText("Posição entre os pares")).toBeNull();
});

test("O que olhar agora lista as pendências de produção, cada uma com o seu destino", async () => {
  abrir("#/painel/producao");
  const lista = await screen.findByRole("list", { name: "O que olhar agora" });
  const itens = within(lista).getAllByRole("listitem");
  expect(itens.map((i) => within(i).getByRole("heading", { level: 3 }).textContent)).toEqual([
    "Rejeições acima dos pares", "Quantidade atípica em 4 procedimentos", "Permanência fora do previsto",
  ]);
  expect(within(itens[0]!).getByRole("link", { name: "Ver nas Rejeições" })).toHaveAttribute("href", "#/painel/producao/rejeicoes");
  expect(within(itens[1]!).getByRole("link", { name: "Ver em Fora do padrão" })).toHaveAttribute("href", "#/painel/producao/fora-do-padrao?bloco=quantidade");
  expect(within(itens[0]!).getByText("Atenção")).toBeInTheDocument();
  expect(within(itens[2]!).getByText("Info")).toBeInTheDocument();
});

test("sem pendência de produção diz que nada pede atenção", async () => {
  m.faturamentoPainel.mockResolvedValue(painelDaUnidade([]));
  abrir("#/painel/producao");
  expect(await screen.findByText("Nada de produção pede atenção nesta competência")).toBeInTheDocument();
});

test("o link da pendência leva à aba", async () => {
  const u = userEvent.setup();
  abrir("#/painel/producao");
  await u.click(await screen.findByRole("link", { name: "Ver nas Rejeições" }));
  expect(window.location.hash).toBe("#/painel/producao/rejeicoes");
});

test("Exportar grava a planilha dos meses, sem arredondar o dinheiro", async () => {
  m.exportar.mockResolvedValue("Arquivo gravado: C:/x/visao-geral.xlsx (4 KB)");
  const u = userEvent.setup();
  abrir("#/painel/producao");
  await u.click(await screen.findByRole("button", { name: "Exportar" }));
  const [planilha, nome] = m.exportar.mock.calls[0]!;
  expect(nome).toBe("producao-visao-geral");
  const aba = planilha.abas[0]!;
  expect(aba.colunas).toEqual(["Competência", "SIA aprovado", "SIA apresentado", "SIA situação", "SIH aprovado", "AIH", "SIH situação", "Rejeições", "Rejeições por 100 AIH"]);
  expect(aba.linhas).toHaveLength(12);
  expect(aba.linhas.at(-1)).toContain("Incompleto");
  expect(await screen.findByText("12 meses exportados.")).toBeInTheDocument();
});
