import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Painel } from "../Painel";
import { ProvedorDaSessao } from "../../shell/sessao";
import * as comandos from "../../api/comandos";
import type { Impacto, Painel as DadosDoPainel } from "../../api/tipos";
import { queda, semAptidao, semValor } from "./exemplos";
import { aptidaoExemplo, unidadeExemplo } from "../unidade/exemplos";

vi.mock("../../api/comandos");
const m = vi.mocked(comandos);

function abrir() {
  window.location.hash = "#/painel";
  const cliente = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={cliente}><ProvedorDaSessao><Painel /></ProvedorDaSessao></QueryClientProvider>);
}

const unidade = { uf: "MS", cnes: "2077396", nome: "UNIDADE DE EXEMPLO" };
const painel: DadosDoPainel = {
  disponivel: true, uf: "MS", cnes: "2077396", aviso: "",
  sia: { competencia: "202606", valor_centavos: 148_230_000, quantidade: 1000, variacao_mes_anterior: -3, variacao_media_3_meses: -12 },
  sih: { competencia: "202606", valor_centavos: 290_648_000, quantidade: 400, variacao_mes_anterior: 1, variacao_media_3_meses: 3 },
  rejeicoes: { por_100_aih: 4.2, janela_rejeicoes: 10, janela_aih: 240 },
  pares: { taxa_mediana_dos_pares: 2.7 },
  oportunidades: { total: 38, itens: [{ codigo: "0301010072", nome: "Consulta", estado: "apta", uf: { valor_centavos: 310_000_000 } }] },
  pendencias: [queda, semAptidao, semValor],
  fontes: { producao_sia_ate: "202606", producao_sih_ate: "202606", sigtap: "202609" },
};

const impacto: Impacto = { disponivel: true, uf: "MS", cnes: "2077396", de: "202608", para: "202609", mudancas_de_valor: 3, mudancas_com_producao: 1, impacto_uf_anual_centavos: 2_334_342, impacto_unidade_anual_centavos: 0, valores: [], aviso: "", excluidos_com_producao: [], exigencias_novas_com_producao: [] };

beforeEach(() => {
  vi.resetAllMocks();
  m.cnesSituacao.mockResolvedValue({ minha: unidade, unidades: [], ufs: [], ufs_disponiveis: [] });
  m.situacao.mockResolvedValue({ primeira_execucao: false, bloqueio: null, competencias: [{ competencia: "202609" }], territorio: null, pasta_dados: "", ocupado: false, recuperacao: null } as never);
  m.faturamentoImpacto.mockResolvedValue(impacto);
  m.unidadeVer.mockRejectedValue("sem cadastro");
  m.aptidaoUnidade.mockRejectedValue("sem aptidão");
});

test("sem unidade escolhida diz o que fazer e leva a Dados", async () => {
  m.cnesSituacao.mockResolvedValue({ minha: null, unidades: [], ufs: [], ufs_disponiveis: [] });
  const u = userEvent.setup();
  abrir();
  expect(await screen.findByRole("heading", { name: "Nenhuma unidade escolhida" })).toBeInTheDocument();
  await u.click(screen.getByRole("button", { name: "Escolher unidade" }));
  expect(window.location.hash).toBe("#/dados");
});

test("mostra o resumo, as pendências por valor e a coluna lateral", async () => {
  m.faturamentoPainel.mockResolvedValue(painel);
  abrir();
  expect(await screen.findByRole("list", { name: "Pendências" })).toBeInTheDocument();
  expect(screen.getByText(/SIA aprovado em 06\/2026/)).toBeInTheDocument();
  expect(screen.getByText(/−12% contra a média de 3 meses/)).toBeInTheDocument();
  expect(screen.getByText(/\+3% contra a média de 3 meses/)).toBeInTheDocument();
  expect(screen.getByText("4,2")).toBeInTheDocument();
  expect(screen.getByText(/Unidades parecidas: 2,7/)).toBeInTheDocument();
});

test("Produção, Cadastro e Aptidão são links para as subtelas e nada diz Em breve", async () => {
  m.faturamentoPainel.mockResolvedValue(painel);
  abrir();
  await screen.findByRole("list", { name: "Pendências" });
  expect(screen.getByRole("link", { name: /^Cadastro/ })).toHaveAttribute("href", "#/painel/cadastro");
  expect(screen.getByRole("link", { name: /^Aptidão/ })).toHaveAttribute("href", "#/painel/aptidao");
  expect(screen.getByRole("link", { name: /^Produção/ })).toHaveAttribute("href", "#/painel/producao");
  expect(screen.queryByText("Em breve")).toBeNull();
});

test("os números ausentes viram travessão, sem quebrar", async () => {
  m.faturamentoPainel.mockResolvedValue({ ...painel, sia: null, sih: null, pares: undefined, oportunidades: null, rejeicoes: { por_100_aih: null, janela_rejeicoes: 0, janela_aih: 0 } });
  abrir();
  expect(await screen.findByRole("list", { name: "Pendências" })).toBeInTheDocument();
  expect(screen.getAllByText("—").length).toBeGreaterThanOrEqual(3);
});

test("sem produção baixada explica e leva a Dados", async () => {
  m.faturamentoPainel.mockResolvedValue({ disponivel: false, mensagem: "A produção de MS ainda não foi baixada." });
  const u = userEvent.setup();
  abrir();
  expect(await screen.findByRole("heading", { name: "Sem produção, não há valores nem pendências" })).toBeInTheDocument();
  expect(screen.getByText("A produção de MS ainda não foi baixada.")).toBeInTheDocument();
  await u.click(screen.getByRole("button", { name: "Baixar produção" }));
  expect(window.location.hash).toBe("#/dados");
});

test("sem pendências diz que nada pede atenção", async () => {
  m.faturamentoPainel.mockResolvedValue({ ...painel, pendencias: [] });
  abrir();
  expect(await screen.findByText("Nada pede atenção nesta competência")).toBeInTheDocument();
});

test("erro do comando mostra a mensagem e tenta de novo", async () => {
  m.faturamentoPainel.mockRejectedValueOnce("falha ao ler a produção").mockResolvedValue(painel);
  const u = userEvent.setup();
  abrir();
  expect(await screen.findByRole("alert")).toHaveTextContent("falha ao ler a produção");
  await u.click(screen.getByRole("button", { name: "Tentar de novo" }));
  expect(await screen.findByRole("list", { name: "Pendências" })).toBeInTheDocument();
});

test("o fechamento tem três números e as mudanças da tabela viram uma linha de aviso", async () => {
  m.faturamentoPainel.mockResolvedValue(painel);
  abrir();
  await screen.findByRole("list", { name: "Pendências" });
  expect(screen.getByRole("region", { name: "Resumo da unidade" }).querySelectorAll(".resumo__coluna")).toHaveLength(3);
  const aviso = await screen.findByRole("note", { name: "Mudanças da tabela" });
  expect(aviso).toHaveTextContent(/08\/2026 → 09\/2026/);
  expect(aviso).toHaveTextContent(/sem impacto nesta unidade/);
  expect(aviso).toHaveTextContent(/UF R\$\s23\.343,42 por ano/);
  expect(within(aviso).getByRole("link", { name: "Ver mudanças" })).toHaveAttribute("href", "#/mudancas");
});

test("com impacto na unidade o aviso diz o valor", async () => {
  m.faturamentoPainel.mockResolvedValue(painel);
  m.faturamentoImpacto.mockResolvedValue({ ...impacto, impacto_unidade_anual_centavos: 150_000 });
  abrir();
  expect(await screen.findByRole("note", { name: "Mudanças da tabela" })).toHaveTextContent(/R\$\s1\.500,00 por ano nesta unidade/);
});

test("cada cartão de área leva à sua área e traz o selo de pendências", async () => {
  m.faturamentoPainel.mockResolvedValue(painel);
  abrir();
  await screen.findByRole("list", { name: "Pendências" });
  expect(screen.getByRole("link", { name: /^Cadastro/ })).toHaveAttribute("href", "#/painel/cadastro");
  expect(within(screen.getByRole("link", { name: /^Aptidão/ })).getByText("1 pendência")).toBeInTheDocument();
  expect(within(screen.getByRole("link", { name: /^Cadastro/ })).getByText("Sem pendências")).toBeInTheDocument();
});

test("o cartão do Cadastro conta as habilitações e as que citam e não produzem, depois que a aptidão chega", async () => {
  const sp = { uf: "MS", resumo: { arquivos: [] } };
  m.cnesSituacao.mockResolvedValue({ minha: unidade, unidades: [], ufs: [sp], ufs_disponiveis: ["MS"] } as never);
  m.faturamentoPainel.mockResolvedValue(painel);
  m.unidadeVer.mockResolvedValue(unidadeExemplo);
  m.aptidaoUnidade.mockResolvedValue(aptidaoExemplo());
  abrir();
  const cartao = await screen.findByRole("link", { name: /^Cadastro/ });
  expect(await within(cartao).findByText(/1 citam e não produzem|1 cita e não produz/)).toBeInTheDocument();
  expect(within(cartao).getByText(new RegExp(`^${unidadeExemplo.habilitacoes.length} habilitaç`))).toBeInTheDocument();
});

test("o cartão da Aptidão diz risco e oportunidades; o da Produção compara com os pares", async () => {
  const sp = { uf: "MS", resumo: { arquivos: [] } };
  m.cnesSituacao.mockResolvedValue({ minha: unidade, unidades: [], ufs: [sp], ufs_disponiveis: ["MS"] } as never);
  m.faturamentoPainel.mockResolvedValue(painel);
  m.unidadeVer.mockResolvedValue(unidadeExemplo);
  m.aptidaoUnidade.mockResolvedValue(aptidaoExemplo());
  abrir();
  const apt = await screen.findByRole("link", { name: /^Aptidão/ });
  expect(await within(apt).findByText(/em risco · .* oportunidades/)).toBeInTheDocument();
  expect(within(screen.getByRole("link", { name: /^Produção/ })).getByText(/Rejeições 4,2 por 100 AIH, acima dos pares/)).toBeInTheDocument();
});

test("sem cadastro nem aptidão o cartão mantém a descrição fixa, sem zero", async () => {
  m.faturamentoPainel.mockResolvedValue(painel);
  abrir();
  await screen.findByRole("list", { name: "Pendências" });
  expect(screen.getByText("Habilitações, serviços, leitos e profissionais")).toBeInTheDocument();
  expect(screen.getByText("Risco, oportunidade e o que está em ordem")).toBeInTheDocument();
});

test("na primeira abertura a espera diz o que está acontecendo e que a próxima é imediata", async () => {
  m.faturamentoPainel.mockReturnValue(new Promise(() => {}));
  abrir();
  expect(await screen.findByRole("status", { name: /Calculando o painel da unidade.*primeira abertura demora.*imediatas/ })).toBeInTheDocument();
});
