import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { unidadeComProfissionais } from "../exemplos";
import { faturamentoExemplo } from "../exemplosDeProducao";
import { abrir, m, preparar } from "../apoioDeTeste";

vi.mock("../../../api/comandos");

beforeEach(() => preparar());

const linhas = () => within(screen.getByRole("table", { name: /Motivos de rejeição/ })).getAllByRole("row").slice(1);
const abrirAba = async (rota = "#/painel/producao/rejeicoes") => {
  abrir(rota);
  return screen.findByRole("table", { name: /Motivos de rejeição/ });
};

test("a taxa por 100 AIH vem com a mediana dos pares e as contas", async () => {
  await abrirAba();
  const cartao = screen.getByRole("region", { name: "Rejeições por 100 AIH" });
  expect(within(cartao).getByText("1,66", { selector: ".pr__valor" })).toBeInTheDocument();
  expect(within(cartao).getByText(/▲ acima da mediana dos pares \(1,32\)/)).toBeInTheDocument();
  expect(within(cartao).getByText("1.017 rejeições em 61.100 AIH aprovadas")).toBeInTheDocument();
});

test("o mês incompleto da taxa aparece hachurado", async () => {
  const f = faturamentoExemplo();
  m.faturamentoUnidade.mockResolvedValue({ ...f, rejeicoes: { ...f.rejeicoes, por_mes: f.rejeicoes.por_mes.map((x, i, v) => ({ ...x, completo: i < v.length - 1 })) } });
  await abrirAba();
  expect(document.querySelector('rect[fill="url(#serie-hachura)"]')).not.toBeNull();
});

test("mostra os motivos com descrição oficial, total e parte; os demais aparecem em Ver mais", async () => {
  const u = userEvent.setup();
  await abrirAba();
  expect(linhas()).toHaveLength(6);
  const primeira = linhas()[0]!;
  expect(within(primeira).getByText("020069")).toBeInTheDocument();
  expect(within(primeira).getByText("AIH BLOQUEADA PARA AUDITORIA NO PRONTUÁRIO")).toBeInTheDocument();
  expect(within(primeira).getByText("391")).toBeInTheDocument();
  expect(within(primeira).getByText("47%")).toBeInTheDocument();
  await u.click(screen.getByRole("button", { name: "Ver mais 1 motivo" }));
  expect(linhas()).toHaveLength(7);
  expect(screen.queryByRole("button", { name: /Ver mais/ })).toBeNull();
});

test("motivo sem descrição oficial diz isso, sem inventar texto", async () => {
  await abrirAba();
  const linha = linhas().find((l) => within(l).queryByText("060225"))!;
  expect(within(linha).getByText("Sem descrição na tabela oficial")).toBeInTheDocument();
});

test("bloqueio e encerrado vêm em texto, não só em cor", async () => {
  const u = userEvent.setup();
  await abrirAba();
  await u.click(screen.getByRole("button", { name: /Ver mais/ }));
  expect(within(linhas()[0]!).getByText("Bloqueio")).toBeInTheDocument();
  const antigo = linhas().find((l) => within(l).queryByText("030001"))!;
  expect(within(antigo).getByText("Encerrado")).toBeInTheDocument();
  expect(within(antigo).queryByText("Bloqueio")).toBeNull();
});

test("filtrar por texto reduz as linhas e a rota guarda ?motivo=", async () => {
  const u = userEvent.setup();
  await abrirAba();
  await u.type(screen.getByRole("searchbox", { name: "Filtrar motivos por código ou texto" }), "bloqueada");
  await waitFor(() => expect(linhas()).toHaveLength(3));
  await waitFor(() => expect(window.location.hash).toBe("#/painel/producao/rejeicoes?motivo=bloqueada"));
  expect(screen.getByText("3 de 7 motivos")).toBeInTheDocument();
});

test("a rota com ?motivo= abre o filtro já aplicado", async () => {
  await abrirAba("#/painel/producao/rejeicoes?motivo=020069");
  expect(linhas()).toHaveLength(1);
  expect(screen.getByRole("searchbox", { name: "Filtrar motivos por código ou texto" })).toHaveValue("020069");
});

test("filtro sem resultado é estado, não erro", async () => {
  const u = userEvent.setup();
  await abrirAba();
  await u.type(screen.getByRole("searchbox", { name: "Filtrar motivos por código ou texto" }), "zzzz");
  expect(await screen.findByText("Nenhum motivo para «zzzz»")).toBeInTheDocument();
});

test("Ver no Cadastro só nos motivos curados, e Profissionais só com o arquivo de pessoas", async () => {
  const u = userEvent.setup();
  await abrirAba();
  await u.click(screen.getByRole("button", { name: /Ver mais/ }));
  const servico = linhas().find((l) => within(l).queryByText("060072"))!;
  expect(within(servico).getByRole("link", { name: /Ver no Cadastro/ })).toHaveAttribute("href", "#/painel/cadastro/servicos");
  const pessoa = linhas().find((l) => within(l).queryByText("060110"))!;
  expect(within(pessoa).queryByRole("link", { name: /Ver no Cadastro/ })).toBeNull();
  expect(within(linhas()[0]!).queryByRole("link", { name: /Ver no Cadastro/ })).toBeNull();
});

test("com o arquivo de pessoas, o motivo de profissional leva à aba Profissionais", async () => {
  const u = userEvent.setup();
  m.unidadeVer.mockResolvedValue(unidadeComProfissionais);
  await abrirAba();
  await u.click(screen.getByRole("button", { name: /Ver mais/ }));
  const pessoa = linhas().find((l) => within(l).queryByText("060110"))!;
  expect(within(pessoa).getByRole("link", { name: /Ver no Cadastro/ })).toHaveAttribute("href", "#/painel/cadastro/profissionais");
});

test("sem rejeições no período é um estado, não um erro", async () => {
  const f = faturamentoExemplo();
  m.faturamentoUnidade.mockResolvedValue({ ...f, tem_rejeicoes: false, rejeicoes: { ...f.rejeicoes, motivos: [], motivos_total: 0, janela_rejeicoes: 0, por_100_aih: 0 } });
  abrir("#/painel/producao/rejeicoes");
  expect(await screen.findByText("Sem rejeições no período")).toBeInTheDocument();
  expect(screen.queryByRole("alert")).toBeNull();
});

test("unidade sem AIH: some o bloco do SIH e uma linha diz por quê", async () => {
  const f = faturamentoExemplo();
  m.faturamentoUnidade.mockResolvedValue({
    ...f, meses: f.meses.map((x) => ({ ...x, sih_aih: 0, sih_dias: null, sih_valor_centavos: 0, rejeicoes: 0 })),
    rejeicoes: { ...f.rejeicoes, por_100_aih: null, janela_aih: 0, janela_rejeicoes: 0, motivos: [], motivos_total: 0 }, pares: null,
  });
  abrir("#/painel/producao/rejeicoes");
  expect(await screen.findByText("Esta unidade não tem internações (SIH): não há rejeições de AIH para mostrar.")).toBeInTheDocument();
  expect(screen.queryByRole("table", { name: /Motivos de rejeição/ })).toBeNull();
  expect(document.body.textContent).not.toMatch(/NaN/);
});

describe("SIA: apresentado × aprovado", () => {
  test("sem o motivo oficial, a tela diz isso e não conclui que não há diferença", async () => {
    await abrirAba();
    const bloco = screen.getByRole("region", { name: "SIA: apresentado × aprovado" });
    expect(within(bloco).getByText(/Apresentado R\$ 106,88 mi/)).toBeInTheDocument();
    expect(within(bloco).getByText(/Aprovado R\$ 106,93 mi/)).toBeInTheDocument();
    expect(within(bloco).getByText(/O motivo oficial da diferença não veio nos meses carregados/)).toBeInTheDocument();
    expect(within(bloco).queryByText(/sem diferença/i)).toBeNull();
  });

  test("com o motivo, separa o limite do gestor do que vale conferir", async () => {
    const f = faturamentoExemplo();
    m.faturamentoUnidade.mockResolvedValue({
      ...f, apresentado: f.apresentado && {
        ...f.apresentado, valor_apresentado_centavos: 1_000_000, valor_aprovado_centavos: 900_000,
        motivos: [
          { codigo: "M", descricao: "TETO FINANCEIRO", quantidade_apresentada: 10, quantidade_aprovada: 5, valor_apresentado_centavos: 600_000, valor_aprovado_centavos: 500_000 },
          { codigo: "K", descricao: "APROVADO", quantidade_apresentada: 5, quantidade_aprovada: 5, valor_apresentado_centavos: 400_000, valor_aprovado_centavos: 400_000 },
        ],
      },
    });
    await abrirAba();
    const bloco = screen.getByRole("region", { name: "SIA: apresentado × aprovado" });
    expect(within(bloco).getByText(/Limite do gestor/).closest("li")).toHaveTextContent("+R$ 1.000,00");
    expect(within(bloco).getByText(/A conferir/).closest("li")).toHaveTextContent("R$ 0,00");
  });

  test("sem o apresentado nos meses carregados o bloco pede para baixar de novo", async () => {
    m.faturamentoUnidade.mockResolvedValue({ ...faturamentoExemplo(), apresentado: null });
    await abrirAba();
    expect(screen.getByText(/O apresentado do SIA não veio nos meses carregados/)).toBeInTheDocument();
  });
});

test("Exportar grava os motivos mostrados", async () => {
  m.exportar.mockResolvedValue("Arquivo gravado: C:/x/rejeicoes.xlsx (3 KB)");
  const u = userEvent.setup();
  await abrirAba();
  await u.click(screen.getByRole("button", { name: "Exportar" }));
  const [planilha, nome] = m.exportar.mock.calls[0]!;
  expect(nome).toBe("producao-rejeicoes");
  expect(planilha.abas[0]!.colunas).toEqual(["Código", "Motivo", "Total", "Parte", "Situação"]);
  expect(planilha.abas[0]!.linhas).toHaveLength(7);
  expect(planilha.abas[0]!.linhas[5]![1]).toBe("Sem descrição na tabela oficial");
});
