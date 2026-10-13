import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Mudancas } from "../Mudancas";
import { ProvedorDaSessao } from "../../shell/sessao";
import { ProvedorDeAvisos } from "../../componentes/base/Avisos";
import * as comandos from "../../api/comandos";
import type { Impacto, ItemDeMudanca, Mudancas as DadosDeMudancas, TabelaDeMudanca } from "../../api/tipos";
import { valor } from "./exemplos";

vi.mock("../../api/comandos");
const m = vi.mocked(comandos);

function abrir(rota = "#/mudancas") {
  window.location.hash = rota;
  const cliente = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={cliente}><ProvedorDeAvisos><ProvedorDaSessao><Mudancas /></ProvedorDaSessao></ProvedorDeAvisos></QueryClientProvider>);
}

const comp = (c: string) => ({ competencia: c, rotulo: `${c.slice(4)}/${c.slice(0, 4)}`, arquivo: "", versao: null, publicado_em: null, sha256: "" });
const item = (proc: string, hab: string, afeta: boolean, tipo: ItemDeMudanca["tipo"] = "incluido"): ItemDeMudanca => ({
  tipo, chave: { co_procedimento: proc, co_habilitacao: hab }, antes: null, campos_alterados: [], afeta,
  depois: { quantidade: 1, campos: [], nomes: [
    { tabela: "tb_procedimento", colunas: ["co_procedimento"], tabela_presente: true, encontrados: [{ no_procedimento: `NOME ${proc}` }] },
    { tabela: "tb_habilitacao", colunas: ["co_habilitacao"], tabela_presente: true, encontrados: [{ no_habilitacao: `Hab ${hab}` }] },
  ] },
});
const tabela = (itens: ItemDeMudanca[], over: Partial<TabelaDeMudanca> = {}): TabelaDeMudanca => ({
  tabela: "rl_procedimento_habilitacao", presente_antes: true, presente_depois: true,
  incluidos: itens.length, excluidos: 0, alterados: 0, itens, desde: 0, itens_omitidos: 0, afetam: itens.filter((i) => i.afeta).length, ...over,
});
const impacto: Impacto = {
  disponivel: true, uf: "MS", cnes: "2077396", de: "202608", para: "202609", mudancas_de_valor: 3, mudancas_com_producao: 1,
  impacto_uf_anual_centavos: 2_334_342, impacto_unidade_anual_centavos: 0, aviso: "Estimativa: quantidade produzida × diferença de valor.",
  valores: [valor("0301010072", 1100, { afeta: true, unidade_apta: true }), valor("0401010015", 1100), valor("0501010011", 1100)],
  excluidos_com_producao: [], exigencias_novas_com_producao: [],
};
const mudancas = (so = false): DadosDeMudancas => ({
  de: "202608", para: "202609", unidade: true, unidade_com_cadastro: true,
  tabelas: [tabela(so ? [item("0301010072", "1802", true)] : [item("0301010072", "1802", true), item("0401010015", "1803", false)])],
});

beforeEach(() => {
  vi.resetAllMocks();
  m.situacao.mockResolvedValue({ primeira_execucao: false, bloqueio: null, competencias: [comp("202607"), comp("202608"), comp("202609")], territorio: null, pasta_dados: "", ocupado: false, recuperacao: null } as never);
  m.cnesSituacao.mockResolvedValue({ minha: { uf: "MS", cnes: "2077396", nome: "UNIDADE" }, unidades: [], ufs: [], ufs_disponiveis: [] });
  m.faturamentoImpacto.mockResolvedValue(impacto);
  m.mudou.mockImplementation(async (_de, _para, o) => mudancas(!!o?.soAfeta));
});

test("compara a competência mais recente com a anterior e mostra o resumo e os valores", async () => {
  abrir();
  expect(await screen.findByRole("heading", { level: 2, name: /Valores alterados/ })).toBeInTheDocument();
  expect(m.faturamentoImpacto).toHaveBeenCalledWith("202608", "202609");
  expect(screen.getByText(/R\$\s23\.343,42/)).toBeInTheDocument();
  expect(screen.getByText("3 mudanças de valor · 1 afeta a unidade")).toBeInTheDocument();
  expect(screen.getAllByRole("row", { name: /PROC/ })).toHaveLength(3);
});

test("Só o que me afeta filtra os valores e pede as tabelas já filtradas", async () => {
  const u = userEvent.setup();
  abrir();
  await screen.findByRole("heading", { level: 2, name: /Valores alterados/ });
  await u.click(screen.getByRole("switch", { name: "Só o que me afeta" }));
  await waitFor(() => expect(screen.getAllByRole("row", { name: /PROC/ })).toHaveLength(1));
  expect(m.mudou).toHaveBeenCalledWith("202608", "202609", { soAfeta: true });
  expect(window.location.hash).toBe("#/mudancas/202608/202609/afeta");
});

test("sem unidade escolhida o filtro fica desabilitado e diz por quê", async () => {
  m.cnesSituacao.mockResolvedValue({ minha: null, unidades: [], ufs: [], ufs_disponiveis: [] });
  abrir();
  await screen.findByRole("heading", { level: 2, name: /Valores alterados/ });
  expect(screen.getByRole("switch", { name: "Só o que me afeta" })).toBeDisabled();
  expect(screen.getByText("Escolha a sua unidade para filtrar")).toBeInTheDocument();
});

test("só uma competência carregada explica e leva a Dados", async () => {
  m.situacao.mockResolvedValue({ primeira_execucao: false, bloqueio: null, competencias: [comp("202609")], territorio: null, pasta_dados: "", ocupado: false, recuperacao: null } as never);
  const u = userEvent.setup();
  abrir();
  expect(await screen.findByRole("heading", { name: "Só há uma competência carregada" })).toBeInTheDocument();
  expect(m.faturamentoImpacto).not.toHaveBeenCalled();
  await u.click(screen.getByRole("button", { name: "Baixar competências em Dados" }));
  expect(window.location.hash).toBe("#/dados");
});

test("impacto indisponível mostra a mensagem e ainda mostra as tabelas que mudaram", async () => {
  m.faturamentoImpacto.mockResolvedValue({ disponivel: false, mensagem: "Escolha a sua unidade para ver o impacto estimado." });
  abrir();
  expect(await screen.findByRole("heading", { name: "Sem impacto calculado" })).toBeInTheDocument();
  expect(screen.getByText("Escolha a sua unidade para ver o impacto estimado.")).toBeInTheDocument();
  expect(await screen.findByRole("button", { name: /Habilitações exigidas/ })).toBeInTheDocument();
});

test("erro do impacto mostra a mensagem e tenta de novo", async () => {
  m.faturamentoImpacto.mockRejectedValueOnce("falha ao ler a produção").mockResolvedValue(impacto);
  const u = userEvent.setup();
  abrir();
  expect(await screen.findByRole("alert")).toHaveTextContent("falha ao ler a produção");
  await u.click(screen.getByRole("button", { name: "Tentar de novo" }));
  expect(await screen.findByRole("heading", { level: 2, name: /Valores alterados/ })).toBeInTheDocument();
});

test("a seção de habilitações abre com o nome do procedimento e da habilitação", async () => {
  const u = userEvent.setup();
  abrir();
  await u.click(await screen.findByRole("button", { name: /Habilitações exigidas/ }));
  expect(screen.getByText("NOME 0301010072")).toBeVisible();
  expect(screen.getByText("1802 Hab 1802")).toBeVisible();
  expect(screen.getAllByText("Incluída").length).toBeGreaterThan(0);
});

test("Ver mais pede a próxima página daquela tabela e junta os itens", async () => {
  const pagina1 = tabela([item("0301010072", "1802", true)], { incluidos: 3, itens_omitidos: 2 });
  const pagina2 = tabela([item("0401010015", "1803", false), item("0501010011", "1804", false)], { incluidos: 3, desde: 1, itens_omitidos: 0 });
  m.mudou.mockImplementation(async (_d, _p, o) => (o?.tabela ? { de: "202608", para: "202609", tabelas: [pagina2] } : { de: "202608", para: "202609", unidade: true, tabelas: [pagina1] }));
  const u = userEvent.setup();
  abrir();
  await u.click(await screen.findByRole("button", { name: /Habilitações exigidas/ }));
  await u.click(screen.getByRole("button", { name: "Ver mais 2 mudanças" }));
  expect(m.mudou).toHaveBeenCalledWith("202608", "202609", { tabela: "rl_procedimento_habilitacao", desde: 1, soAfeta: false });
  expect(await screen.findByText("NOME 0501010011")).toBeVisible();
  expect(screen.queryByRole("button", { name: /Ver mais/ })).toBeNull();
});

test("a rota com De e Para antigos usa o par pedido", async () => {
  abrir("#/mudancas/202607/202609");
  await screen.findByRole("heading", { level: 2, name: /Valores alterados/ });
  expect(m.faturamentoImpacto).toHaveBeenCalledWith("202607", "202609");
});

test("De igual ou depois de Para na rota é corrigido para a competência anterior", async () => {
  abrir("#/mudancas/202609/202608");
  await screen.findByRole("heading", { level: 2, name: /Valores alterados/ });
  expect(m.faturamentoImpacto).toHaveBeenCalledWith("202607", "202608");
});

test("Exportar leva a tabela de valores e todas as páginas das seções", async () => {
  const pagina1 = tabela([item("0301010072", "1802", true)], { incluidos: 2, itens_omitidos: 1 });
  const pagina2 = tabela([item("0401010015", "1803", false)], { incluidos: 2, desde: 1 });
  m.mudou.mockImplementation(async (_d, _p, o) => (o?.tabela ? { de: "202608", para: "202609", tabelas: [pagina2] } : { de: "202608", para: "202609", unidade: true, tabelas: [pagina1] }));
  m.exportar.mockResolvedValue("Arquivo gravado: D:\\x\\mudancas.xlsx (4 KB)");
  const u = userEvent.setup();
  abrir();
  await screen.findByRole("heading", { level: 2, name: /Valores alterados/ });
  await u.click(screen.getByRole("button", { name: "Exportar" }));
  await waitFor(() => expect(m.exportar).toHaveBeenCalled());
  const planilha = m.exportar.mock.calls[0]![0];
  expect(planilha.abas.map((a) => a.nome)).toEqual(["Valores alterados", "rl_procedimento_habilitacao"]);
  expect(planilha.abas[0]!.linhas).toHaveLength(3);
  expect(planilha.abas[1]!.linhas).toHaveLength(2);
  expect(await screen.findByText(/linhas exportadas/)).toBeInTheDocument();
});

test("sem cadastro do CNES a tela avisa que o filtro usa só a produção", async () => {
  m.mudou.mockImplementation(async () => ({ ...mudancas(false), unidade_com_cadastro: false }));
  abrir();
  expect(await screen.findByText("Sem o cadastro do CNES desta unidade, o filtro considera só o que ela produz.")).toBeInTheDocument();
});
