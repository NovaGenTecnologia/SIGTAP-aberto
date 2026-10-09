import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Ausente, FaturamentoUnidade } from "../../../api/tipos";
import { faturamentoExemplo } from "../exemplosDeProducao";
import { abrir, m, preparar } from "../apoioDeTeste";

vi.mock("../../../api/comandos");

const ROTA = "#/painel/producao/origem-do-valor";
const MESES = ["202508", "202509", "202510"];
const ausente = (motivo: Ausente["motivo"], campo: string, meses: string[] = MESES): Ausente => ({ ausente: true, motivo, campo, meses });
const com = (parte: Partial<FaturamentoUnidade>) => m.faturamentoUnidade.mockResolvedValue(faturamentoExemplo(parte));
const regiao = async (nome: string) => within(await screen.findByRole("region", { name: nome }));
const celulas = (linha: HTMLElement) => within(linha).getAllByRole("cell").map((c) => (c.textContent ?? "").replace(/ /g, " "));

beforeEach(() => preparar());

test("seis blocos na ordem da spec, cada um com o seu De onde vem", async () => {
  abrir(ROTA);
  await screen.findByRole("region", { name: "Financiamento" });
  const titulos = screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent);
  expect(titulos).toEqual(["Financiamento", "Composição das AIH", "Perfil financeiro", "Reapresentação", "Leitos e ocupação", "Pares"]);
  for (const t of titulos) expect(screen.getByRole("button", { name: `De onde vem: ${t}` })).toBeInTheDocument();
});

test("financiamento: SIA e SIH lado a lado, com nome, quantidade, valor, parte e um total que confere", async () => {
  abrir(ROTA);
  const f = await regiao("Financiamento");
  const sia = within(f.getByRole("table", { name: "Financiamento do SIA" }));
  const mac = sia.getByRole("row", { name: /Média e alta complexidade/ });
  expect(celulas(mac)).toEqual(expect.arrayContaining(["800.000", "R$ 77.000.000,00", "80%"]));
  expect(celulas(sia.getByRole("row", { name: /Total/ }))).toEqual(expect.arrayContaining(["820.000", "R$ 96.000.000,00"]));
  const sih = within(f.getByRole("table", { name: "Financiamento do SIH" }));
  expect(celulas(sih.getByRole("row", { name: /Total/ }))).toEqual(expect.arrayContaining(["61.000", "R$ 39.000.000,00"]));
});

test("financiamento de um sistema sem produção diz isso em vez de uma tabela vazia", async () => {
  com({ financiamento: { sia: [], sih: faturamentoExemplo().financiamento.sih } });
  abrir(ROTA);
  const f = await regiao("Financiamento");
  expect(f.queryByRole("table", { name: "Financiamento do SIA" })).toBeNull();
  expect(f.getByText("Sem produção do SIA nos meses carregados")).toBeInTheDocument();
});

test("composição da AIH: barras da unidade e da UF alinhadas, com o mesmo conteúdo em tabela", async () => {
  abrir(ROTA);
  const c = await regiao("Composição das AIH");
  const barras = c.getAllByRole("img");
  expect(barras.map((b) => b.getAttribute("aria-label"))).toEqual([
    "Unidade: Média e alta complexidade (MAC) 95%; Fundo de ações estratégicas (FAEC) 5%",
    "UF: Média e alta complexidade (MAC) 78%; Fundo de ações estratégicas (FAEC) 22%",
  ]);
  const linha = c.getByRole("row", { name: /Média e alta complexidade/ });
  expect(celulas(linha)).toEqual(expect.arrayContaining(["R$ 37.000.000,00", "95%", "R$ 7.000.000.000,00", "78%"]));
  expect(celulas(c.getByRole("row", { name: /OPM/ }))).toEqual(expect.arrayContaining(["R$ 500.000,00", "R$ 100.000.000,00"]));
  expect(celulas(c.getByRole("row", { name: /código de financiamento/ }))).toEqual(expect.arrayContaining(["R$ 1.000.000,00"]));
  expect(celulas(c.getByRole("row", { name: /UTI/ }))).toEqual(expect.arrayContaining(["R$ 3.000.000,00"]));
  expect(c.getByText(/UTI já está dentro do valor hospitalar/)).toBeInTheDocument();
});

test("perfil financeiro: marcas do CNES, regra 'sem regra' explicada, complementos e o aviso de que não geração de crédito não é erro", async () => {
  abrir(ROTA);
  const p = await regiao("Perfil financeiro");
  expect(p.getByText("Gestão plena")).toBeInTheDocument();
  const regra = p.getByRole("row", { name: /Sem regra/ });
  expect(celulas(regra)).toEqual(expect.arrayContaining(["SIH", "100", "R$ 2.000.000,00"]));
  expect(p.getByText(/código vazio ou 0000/)).toBeInTheDocument();
  expect(celulas(p.getByRole("row", { name: /^SH/ }))).toEqual(expect.arrayContaining(["SIH", "R$ 24.000.000,00"]));
  expect(p.getByRole("note")).toHaveTextContent(/não indica erro/);
});

test("reapresentação: parte de meses anteriores por mês, contra a UF, e de onde vêm os atrasos", async () => {
  abrir(ROTA);
  const r = await regiao("Reapresentação");
  expect(r.getByText(/38% do apresentado vem de meses anteriores/)).toBeInTheDocument();
  expect(r.getByText(/UF 10%/)).toBeInTheDocument();
  const mes = r.getByRole("row", { name: /06\/2026/ });
  expect(celulas(mes)).toEqual(expect.arrayContaining(["R$ 90.000,00", "R$ 40.000,00", "31%", "9%"]));
  expect(r.getByRole("row", { name: /03\/2026/ })).toHaveTextContent("R$ 20.000,00");
});

test("leitos: leitos SUS e existentes, AIH por leito e ocupação aproximada, que não é o censo hospitalar", async () => {
  abrir(ROTA);
  const l = await regiao("Leitos e ocupação");
  expect(l.getByText("120 leitos SUS de 150 existentes")).toBeInTheDocument();
  expect(l.getByRole("columnheader", { name: "Ocupação aproximada" })).toBeInTheDocument();
  expect(celulas(l.getAllByRole("row")[1]!)).toEqual(expect.arrayContaining(["41,6", "58%"]));
  expect(l.getByRole("note")).toHaveTextContent(/não é o censo hospitalar/i);
});

test("leitos sem ocupação calculada não mostram a coluna de ocupação", async () => {
  const f = faturamentoExemplo();
  com({ leitos: { ...f.leitos!, por_mes: f.leitos!.por_mes.map((x) => ({ ...x, ocupacao_percentual: null })) } });
  abrir(ROTA);
  const l = await regiao("Leitos e ocupação");
  expect(l.queryByRole("columnheader", { name: "Ocupação aproximada" })).toBeNull();
  expect(l.getByRole("columnheader", { name: "AIH por leito SUS" })).toBeInTheDocument();
});

test("pares: percentil em texto, taxa e mediana, e 'Regra não confirmada' só no grupo de ensino", async () => {
  const f = faturamentoExemplo();
  com({ pares: { ...f.pares!, grupos: [
    ...f.pares!.grupos.map((g) => ({ ...g, criterio: "tipo_e_natureza_juridica" })),
    { ...f.pares!.grupos[0]!, criterio: "tipo_e_ensino", rotulo: "Hospital geral com atividade de ensino" },
  ] } });
  abrir(ROTA);
  const p = await regiao("Pares");
  const tipo = p.getByRole("row", { name: /HOSPITAL GERAL/ });
  expect(tipo).toHaveTextContent("acima de 82% dos pares");
  expect(tipo).toHaveTextContent("acima de 75% dos pares");
  expect(tipo).toHaveTextContent("1,66");
  expect(tipo).toHaveTextContent("mediana 1,32");
  expect(within(p.getByRole("row", { name: /atividade de ensino/ })).getByText("Regra não confirmada")).toBeInTheDocument();
  expect(within(p.getByRole("row", { name: /natureza jurídica 3069/ })).queryByText("Regra não confirmada")).toBeNull();
});

test("pares com menos de 50 AIH não mostram mediana", async () => {
  const f = faturamentoExemplo();
  com({ rejeicoes: { ...f.rejeicoes, janela_aih: 40 } });
  abrir(ROTA);
  const p = await regiao("Pares");
  expect(p.getAllByText("poucas AIH para comparar").length).toBeGreaterThan(0);
  expect(p.queryByText(/mediana 1,32/)).toBeNull();
});

test.each([
  ["composição", { composicao_aih: ausente("sem_campo", "SP_ATOPROF") }, "Composição das AIH", "Sem o campo SP_ATOPROF nos meses carregados. Baixe de novo para ver."],
  ["perfil", { perfil: ausente("sem_campo", "PA_REGCT") }, "Perfil financeiro", "Sem o campo PA_REGCT nos meses carregados. Baixe de novo para ver."],
  ["reapresentação", { reapresentacao: ausente("sem_dado", "PA_CMP", []) }, "Reapresentação", "Nada a mostrar para esta unidade no período"],
] as const)("%s ausente usa o aviso certo e some a tabela", async (_n, parte, nome, frase) => {
  com(parte as Partial<FaturamentoUnidade>);
  abrir(ROTA);
  const b = await regiao(nome);
  expect(b.getByText(frase)).toBeInTheDocument();
  expect(b.queryByRole("table")).toBeNull();
});

test("o aviso de campo ausente leva a Dados", async () => {
  const u = userEvent.setup();
  com({ perfil: ausente("sem_campo", "PA_REGCT") });
  abrir(ROTA);
  const b = await regiao("Perfil financeiro");
  await u.click(b.getByRole("button", { name: "Abrir em Dados" }));
  expect(window.location.hash).toBe("#/dados");
});

test("sem leitos no CNES, sem pares e sem composição (unidade sem SIH) o bloco explica em vez de ficar vazio", async () => {
  const f = faturamentoExemplo();
  com({ leitos: null, pares: null, composicao_aih: null, meses: f.meses.map((x) => ({ ...x, sih_aih: 0, sih_valor_centavos: 0 })) });
  abrir(ROTA);
  expect((await screen.findAllByText("Esta unidade não tem internações (SIH) nos meses carregados")).length).toBeGreaterThanOrEqual(2);
  expect(screen.getByText("Sem pares para comparar nesta unidade")).toBeInTheDocument();
  expect(document.body.textContent).not.toMatch(/NaN|undefined|Infinity/);
});

test("nunca mostra NaN quando o total é zero", async () => {
  const f = faturamentoExemplo();
  com({
    financiamento: { sia: [{ codigo: "04", nome: null, quantidade: 0, valor_centavos: 0 }], sih: [] },
    composicao_aih: { ...f.composicao_aih!, total_centavos: 0, total_uf_centavos: 0, tipos: [{ fin: "04", nome: null, valor_centavos: 0, valor_uf_centavos: 0 }] } as never,
    reapresentacao: { ...f.reapresentacao!, total_centavos: 0, uf_total_centavos: 0, anteriores_centavos: 0, uf_anteriores_centavos: 0, meses: [{ competencia: "202606", do_mes_centavos: 0, anteriores_centavos: 0, uf_do_mes_centavos: 0, uf_anteriores_centavos: 0 }] } as never,
  });
  abrir(ROTA);
  await screen.findByRole("region", { name: "Financiamento" });
  expect(document.body.textContent).not.toMatch(/NaN|undefined|Infinity/);
});
