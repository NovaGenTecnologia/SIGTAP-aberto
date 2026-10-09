import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { FaturamentoUnidade } from "../../../api/tipos";
import { faturamentoExemplo } from "../exemplosDeProducao";
import { abrir, m, preparar } from "../apoioDeTeste";

vi.mock("../../../api/comandos");

beforeEach(() => preparar());

const so_sih = (): Partial<FaturamentoUnidade> => {
  const f = faturamentoExemplo();
  return {
    meses: f.meses.map((x) => ({ ...x, sia_valor_centavos: 0, sia_quantidade: 0, sia_apresentado_centavos: null as never })),
    apresentado: null,
    sem_campos_novos: ["202601", "202602"],
    abc: { ...f.abc, sia: { ...f.abc.sia, total_procedimentos: 0, itens: [] } },
  };
};

test("o cartão da taxa nomeia o grupo da mediana: o do mesmo tipo, não o primeiro recorte", async () => {
  abrir("#/painel/producao/rejeicoes");
  const cartao = await screen.findByRole("region", { name: "Rejeições por 100 AIH" });
  const grupo = faturamentoExemplo().pares!.grupos[0]!.rotulo;
  expect(within(cartao).queryByText(`Pares: ${grupo}`)).toBeNull();
  expect(within(cartao).getByText(/^Pares: tipo /)).toBeInTheDocument();
});

test("o intervalo ao lado da taxa é o da janela da conta, não o de todos os meses baixados", async () => {
  const f = faturamentoExemplo();
  const janela = f.janela.sih;
  abrir("#/painel/producao/rejeicoes");
  const cartao = await screen.findByRole("region", { name: "Rejeições por 100 AIH" });
  const [a, z] = [janela[0]!, janela.at(-1)!];
  const rot = (c: string) => `${c.slice(4)}/${c.slice(0, 4)}`;
  expect(within(cartao).getByText(`${rot(a)} a ${rot(z)}`)).toBeInTheDocument();
});

test("unidade só de internação não manda baixar de novo o apresentado do SIA", async () => {
  m.faturamentoUnidade.mockResolvedValue(faturamentoExemplo(so_sih()));
  abrir("#/painel/producao/rejeicoes");
  await screen.findByRole("region", { name: "Rejeições por 100 AIH" });
  expect(screen.queryByText(/Baixe de novo/)).toBeNull();
});

test("quantidade atípica de unidade sem SIA diz que não há SIA, em vez de pedir nova baixa", async () => {
  m.faturamentoUnidade.mockResolvedValue(faturamentoExemplo(so_sih()));
  abrir("#/painel/producao/fora-do-padrao");
  const b = await screen.findByRole("region", { name: "Quantidade atípica" });
  expect(within(b).getByText("Esta unidade não tem produção ambulatorial (SIA) nos meses carregados")).toBeInTheDocument();
  expect(within(b).queryByText(/Baixe de novo/)).toBeNull();
});

test("a contagem de Procedimentos soma SIA e SIH: hospital só com SIH não mostra 0", async () => {
  const f = faturamentoExemplo(so_sih());
  m.faturamentoUnidade.mockResolvedValue(f);
  abrir("#/painel/producao");
  const esperado = String(f.abc.sih.total_procedimentos);
  expect(await screen.findByRole("tab", { name: new RegExp(`^Procedimentos ${esperado}$`) })).toBeInTheDocument();
});

test("Exportar não vira zero o SIA apresentado que não veio", async () => {
  m.faturamentoUnidade.mockResolvedValue(faturamentoExemplo(so_sih()));
  m.exportar.mockResolvedValue("Arquivo gravado: C:/x/a.xlsx (4 KB)");
  const u = userEvent.setup();
  abrir("#/painel/producao");
  await u.click(await screen.findByRole("button", { name: "Exportar" }));
  const linhas = m.exportar.mock.calls[0]![0].abas[0]!.linhas;
  expect(linhas.every((l) => l[2] === null)).toBe(true);
});

test("quantidade atípica avisa quando a lista foi cortada em 10", async () => {
  const f = faturamentoExemplo();
  const base = f.apresentado!.atipicas[0]!;
  const dez = Array.from({ length: 10 }, (_, i) => ({ ...base, procedimento: `02010${String(i).padStart(5, "0")}` }));
  m.faturamentoUnidade.mockResolvedValue(faturamentoExemplo({ apresentado: { ...f.apresentado!, atipicas: dez } }));
  abrir("#/painel/producao/fora-do-padrao");
  const b = await screen.findByRole("region", { name: "Quantidade atípica" });
  expect(within(b).getByText(/Mostra os 10 mais atípicos/)).toBeInTheDocument();
});

test("Ver mais dos motivos deixa o foco dentro da lista, no botão que recolhe", async () => {
  const u = userEvent.setup();
  abrir("#/painel/producao/rejeicoes");
  await screen.findByRole("table", { name: /Motivos de rejeição/ });
  await u.click(screen.getByRole("button", { name: /^Ver mais/ }));
  expect(screen.getByRole("button", { name: /^Mostrar só os/ })).toHaveFocus();
});
