import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Ausente, FaturamentoUnidade } from "../../../api/tipos";
import { faturamentoExemplo } from "../exemplosDeProducao";
import { abrir, m, preparar } from "../apoioDeTeste";

vi.mock("../../../api/comandos");

const ROTA = "#/painel/producao/fora-do-padrao";
const MESES = ["202508", "202509", "202510", "202511", "202512", "202601", "202602", "202603", "202604", "202605", "202606"];
const ausente = (motivo: Ausente["motivo"], campo = "PA_SRV_C", meses: string[] = MESES): Ausente => ({ ausente: true, motivo, campo, meses });
const com = (parte: Partial<FaturamentoUnidade>) => m.faturamentoUnidade.mockResolvedValue(faturamentoExemplo(parte));
const bloco = async (nome: string) => within(await screen.findByRole("region", { name: nome }));

beforeEach(() => {
  preparar();
  Element.prototype.scrollIntoView = vi.fn();
});

test("mostra os quatro blocos na ordem da spec, cada um com a frase do que indica e não prova", async () => {
  abrir(ROTA);
  await screen.findByRole("region", { name: "Quantidade atípica" });
  const titulos = screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent);
  expect(titulos).toEqual(["Quantidade atípica", "Permanência", "Serviços executados × cadastrados", "Instrumento divergente na UF"]);
  for (const nome of titulos) {
    expect(within(await screen.findByRole("region", { name: nome! })).getByRole("note")).toHaveTextContent(/não prova/i);
  }
});

test("quantidade atípica traz procedimento, mês, apresentado, mediana própria, mediana da UF e o múltiplo", async () => {
  abrir(ROTA);
  const q = await bloco("Quantidade atípica");
  const linha = q.getByRole("row", { name: /MAPEAMENTO DE RETINA/ });
  expect(within(linha).getByRole("link", { name: "0211060020" })).toHaveAttribute("href", "#/consultar/0211060020");
  const celulas = within(linha).getAllByRole("cell").map((c) => c.textContent);
  expect(celulas).toEqual(expect.arrayContaining(["06/2026", "900", "400", "300", "×2,3"]));
  expect(q.getByRole("columnheader", { name: "Mediana da UF" })).toBeInTheDocument();
});

test("quantidade atípica sem mediana da UF não mostra coluna de traços", async () => {
  const f = faturamentoExemplo();
  com({ apresentado: { ...f.apresentado!, atipicas: f.apresentado!.atipicas.map((a) => ({ ...a, mediana_uf: null })) } });
  abrir(ROTA);
  const q = await bloco("Quantidade atípica");
  expect(q.queryByRole("columnheader", { name: "Mediana da UF" })).toBeNull();
});

test("permanência diz quantos procedimentos foram analisados e traz média real, previsto, média da UF e razão", async () => {
  abrir(ROTA);
  const p = await bloco("Permanência");
  expect(p.getByText("106 de 409 analisados")).toBeInTheDocument();
  const linha = p.getByRole("row", { name: /COLECISTECTOMIA/ });
  expect(within(linha).getAllByRole("cell").map((c) => c.textContent)).toEqual(expect.arrayContaining(["40", "12,0", "3,0", "4,0", "×4,0"]));
});

test("serviços: fora do cadastro e sem marca SUS com valor, e cada linha leva a Cadastro › Serviços", async () => {
  abrir(ROTA);
  const s = await bloco("Serviços executados × cadastrados");
  const linha = s.getByRole("row", { name: /125\/001/ });
  expect(within(linha).getByText("Fora do cadastro")).toBeInTheDocument();
  expect(within(linha).getByText("R$ 12.000,00")).toBeInTheDocument();
  expect(within(linha).getByRole("link", { name: /Cadastro/ })).toHaveAttribute("href", "#/painel/cadastro/servicos?q=125");
});

test("serviço cadastrado sem a marca ambulatorial SUS aparece com o texto próprio, e o que está em ordem não vira linha", async () => {
  const f = faturamentoExemplo();
  com({ servicos: { ...f.servicos!, itens: [
    { codigo: "130/001", nome: "FISIOTERAPIA", quantidade: 5, situacao: "cadastrado_sem_ambulatorial_sus", valor_centavos: 50_000 },
    { codigo: "145/002", nome: "COLETA", quantidade: 9, situacao: "cadastrado_sus", valor_centavos: 90_000 },
  ] } as never });
  abrir(ROTA);
  const s = await bloco("Serviços executados × cadastrados");
  expect(s.getByText("Cadastrado sem a marca ambulatorial SUS")).toBeInTheDocument();
  expect(s.queryByRole("row", { name: /145\/002/ })).toBeNull();
});

test("instrumento divergente começa recolhido e abre pelo teclado", async () => {
  const u = userEvent.setup();
  abrir(ROTA);
  const secao = await screen.findByRole("region", { name: "Instrumento divergente na UF" });
  const botao = within(secao).getByRole("button", { name: "Instrumento divergente na UF" });
  expect(botao).toHaveAttribute("aria-expanded", "false");
  expect(within(secao).queryByRole("table")).toBeNull();
  botao.focus();
  await u.keyboard("{Enter}");
  expect(botao).toHaveAttribute("aria-expanded", "true");
  expect(within(secao).getByRole("row", { name: /0301010072/ })).toBeInTheDocument();
  await u.keyboard(" ");
  expect(botao).toHaveAttribute("aria-expanded", "false");
});

test.each([
  ["sem_campo", "Sem o campo PA_SRV_C nos meses carregados. Baixe de novo para ver."],
  ["sem_dado", "Nada a mostrar para esta unidade no período"],
  ["sem_cadastro", "Sem o cadastro de serviços do CNES desta unidade"],
] as const)("serviços ausente por %s usa o aviso certo", async (motivo, frase) => {
  com({ servicos: ausente(motivo) });
  abrir(ROTA);
  const s = await bloco("Serviços executados × cadastrados");
  expect(s.getByText(frase)).toBeInTheDocument();
  expect(s.queryByRole("table")).toBeNull();
});

test("sem o campo, o aviso diz os meses e leva a Dados", async () => {
  const u = userEvent.setup();
  com({ instrumentos: ausente("sem_campo", "PA_DOCORIG") });
  abrir(ROTA);
  const i = await bloco("Instrumento divergente na UF");
  expect(i.getByText("Sem o campo PA_DOCORIG nos meses carregados. Baixe de novo para ver.")).toBeInTheDocument();
  expect(i.getByText("08/2025–06/2026")).toBeInTheDocument();
  await u.click(i.getByRole("button", { name: "Abrir em Dados" }));
  expect(window.location.hash).toBe("#/dados");
});

test("sem cadastro de serviços também leva a Dados", async () => {
  const u = userEvent.setup();
  com({ servicos: ausente("sem_cadastro", "SR", []) });
  abrir(ROTA);
  const s = await bloco("Serviços executados × cadastrados");
  await u.click(s.getByRole("button", { name: "Abrir em Dados" }));
  expect(window.location.hash).toBe("#/dados");
});

test("sem o apresentado do SIA, a quantidade atípica diz que falta o campo e usa os meses antigos do fechamento", async () => {
  com({ apresentado: null, sem_campos_novos: ["202508", "202509"] });
  abrir(ROTA);
  const q = await bloco("Quantidade atípica");
  expect(q.getByText("Sem o campo PA_QTDPRO nos meses carregados. Baixe de novo para ver.")).toBeInTheDocument();
  expect(q.getByText("08–09/2025")).toBeInTheDocument();
});

test("nenhum bloco sem achado aparece como lista vazia sem explicação", async () => {
  const f = faturamentoExemplo();
  com({
    apresentado: { ...f.apresentado!, atipicas: [] },
    permanencia: { ...f.permanencia!, itens: [], fora_do_previsto: 0 } as never,
    servicos: { ...f.servicos!, itens: [], fora_do_cadastro_centavos: 0 },
    instrumentos: { ...f.instrumentos!, divergencias_da_uf: { procedimentos: 0, valor_centavos: 0, itens: [] } },
  });
  abrir(ROTA);
  await screen.findByRole("region", { name: "Quantidade atípica" });
  expect(screen.getByText("Nenhuma quantidade atípica nos meses completos")).toBeInTheDocument();
  expect(screen.getByText("Nenhum procedimento fora do previsto")).toBeInTheDocument();
  expect(screen.getByText("Todos os serviços executados estão no cadastro com a marca ambulatorial SUS")).toBeInTheDocument();
  expect(screen.queryAllByRole("table").filter((t) => within(t).queryAllByRole("row").length <= 1)).toEqual([]);
});

test("unidade sem internações (SIH) explica que a permanência não se aplica", async () => {
  const f = faturamentoExemplo();
  com({ permanencia: null, meses: f.meses.map((x) => ({ ...x, sih_aih: 0, sih_valor_centavos: 0 })) });
  abrir(ROTA);
  expect(await screen.findByText("Esta unidade não tem internações (SIH) nos meses carregados")).toBeInTheDocument();
});

test("unidade sem produção ambulatorial (SIA) explica por que três blocos não se aplicam", async () => {
  const f = faturamentoExemplo();
  com({ apresentado: null, servicos: null, instrumentos: null, sem_campos_novos: [], meses: f.meses.map((x) => ({ ...x, sia_quantidade: 0, sia_valor_centavos: 0 })) });
  abrir(ROTA);
  await screen.findByRole("region", { name: "Quantidade atípica" });
  expect(screen.getAllByText("Esta unidade não tem produção ambulatorial (SIA) nos meses carregados")).toHaveLength(3);
});

test("?bloco= rola até o bloco e abre o recolhido", async () => {
  abrir(`${ROTA}?bloco=permanencia`);
  const p = await screen.findByRole("region", { name: "Permanência" });
  await waitFor(() => expect((Element.prototype.scrollIntoView as ReturnType<typeof vi.fn>).mock.contexts).toContain(p));
});

test("?bloco=instrumentos abre o bloco recolhido", async () => {
  abrir(`${ROTA}?bloco=instrumentos`);
  const secao = await screen.findByRole("region", { name: "Instrumento divergente na UF" });
  await waitFor(() => expect(within(secao).getByRole("button", { name: "Instrumento divergente na UF" })).toHaveAttribute("aria-expanded", "true"));
});

test("Exportar sai com uma aba por bloco que tem dado", async () => {
  m.exportar.mockResolvedValue("Arquivo gravado: C:/x/f.xlsx (9 KB)");
  const u = userEvent.setup();
  abrir(ROTA);
  await screen.findByRole("region", { name: "Quantidade atípica" });
  await u.click(screen.getByRole("button", { name: "Exportar" }));
  await screen.findByText(/exportad/);
  const [planilha, nome] = m.exportar.mock.calls[0]!;
  expect(nome).toBe("producao-fora-do-padrao");
  expect(planilha.abas.map((a) => a.nome)).toEqual(["Quantidade atípica", "Permanência", "Serviços", "Instrumentos"]);
});
