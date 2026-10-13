import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { aptidaoExemplo } from "../exemplos";
import { itensDeProducao, procedimentosExemplo } from "../exemplosDeProducao";
import { abrir, m, preparar } from "../apoioDeTeste";

vi.mock("../../../api/comandos");

const TOTAL_SIA = 120, TOTAL_SIH = 80;
beforeEach(() => {
  preparar();
  m.producaoProcedimentos.mockImplementation(async (o) => {
    const total = o.origem === "sih" ? TOTAL_SIH : TOTAL_SIA;
    const desde = o.desde ?? 0;
    const quantos = Math.min(50, total - desde);
    return procedimentosExemplo({ origem: o.origem, total_geral: total, total, desde, itens: itensDeProducao(quantos, desde + (o.origem === "sih" ? 1_000 : 0)), itens_omitidos: Math.max(0, total - desde - quantos) });
  });
});

const tabela = () => screen.findByRole("table", { name: /Procedimentos por valor/ });
const linhas = async () => within(await tabela()).getAllByRole("row").slice(1);

test("começa pelo SIA, por valor, com o total e a frase da curva calculada do resumo", async () => {
  abrir("#/painel/producao/procedimentos");
  expect(await linhas()).toHaveLength(50);
  expect(m.producaoProcedimentos).toHaveBeenCalledWith(expect.objectContaining({ origem: "sia" }));
  expect(screen.getByText("50 de 120 procedimentos")).toBeInTheDocument();
  expect(screen.getByText(/110 procedimentos fazem 80,3% do valor aprovado/)).toBeInTheDocument();
  const sistemas = screen.getByRole("navigation", { name: "Sistema" });
  expect(within(sistemas).getByRole("link", { name: "SIA" })).toHaveAttribute("aria-current", "page");
});

test("a tabela mostra classe em texto, parte e acumulado, e o código leva à Ficha", async () => {
  abrir("#/painel/producao/procedimentos");
  const primeira = (await linhas())[0]!;
  expect(within(primeira).getByRole("link", { name: "0301000000" })).toHaveAttribute("href", "#/consultar/0301000000");
  expect(within(primeira).getByText("A")).toBeInTheDocument();
  expect(within(primeira).getByText("20%", { selector: ".pr__parte .num" })).toBeInTheDocument();
  expect(within(primeira).getByText("20%", { selector: ".pr__acumulado" })).toBeInTheDocument();
});

test("alternar SIA | SIH muda a rota e a lista, e não mostra as linhas do outro enquanto carrega", async () => {
  const u = userEvent.setup();
  abrir("#/painel/producao/procedimentos");
  await linhas();
  m.producaoProcedimentos.mockImplementation(() => new Promise(() => {}));
  await u.click(screen.getByRole("link", { name: "SIH" }));
  expect(window.location.hash).toBe("#/painel/producao/procedimentos/sih");
  await waitFor(() => expect(screen.queryByRole("table", { name: /Procedimentos por valor/ })).toBeNull());
  expect(screen.getByRole("link", { name: "SIH" })).toHaveAttribute("aria-current", "page");
});

test("a rota /sih abre o SIH com o total do SIH", async () => {
  abrir("#/painel/producao/procedimentos/sih");
  await linhas();
  expect(screen.getByText("50 de 80 procedimentos")).toBeInTheDocument();
  expect(m.producaoProcedimentos).toHaveBeenCalledWith(expect.objectContaining({ origem: "sih" }));
});

test("ordenar por quantidade pede ao servidor e a classe segue a do valor", async () => {
  const u = userEvent.setup();
  abrir("#/painel/producao/procedimentos");
  await linhas();
  await u.click(screen.getByRole("button", { name: /Ordenar por/ }));
  await u.click(await screen.findByRole("option", { name: "Quantidade" }));
  await waitFor(() => expect(m.producaoProcedimentos).toHaveBeenCalledWith(expect.objectContaining({ ordem: "quantidade" })));
});

test("a busca vai ao servidor depois da pausa e fica na rota", async () => {
  const u = userEvent.setup();
  abrir("#/painel/producao/procedimentos");
  await linhas();
  await u.type(screen.getByRole("searchbox", { name: "Buscar por código ou nome" }), "consulta");
  await waitFor(() => expect(m.producaoProcedimentos).toHaveBeenCalledWith(expect.objectContaining({ q: "consulta" })));
  await waitFor(() => expect(window.location.hash).toBe("#/painel/producao/procedimentos?q=consulta"));
});

test("o filtro de classe vai ao servidor e fica na rota", async () => {
  const u = userEvent.setup();
  abrir("#/painel/producao/procedimentos");
  await linhas();
  await u.click(screen.getByRole("button", { name: "Classe A" }));
  expect(window.location.hash).toBe("#/painel/producao/procedimentos?classe=A");
  await waitFor(() => expect(m.producaoProcedimentos).toHaveBeenCalledWith(expect.objectContaining({ classe: "A" })));
  expect(screen.getByRole("button", { name: "Classe A" })).toHaveAttribute("aria-pressed", "true");
});

test("Ver mais traz a próxima página sem repetir linhas e a contagem acompanha", async () => {
  const u = userEvent.setup();
  abrir("#/painel/producao/procedimentos");
  await linhas();
  await u.click(screen.getByRole("button", { name: "Ver mais (70 restantes)" }));
  await waitFor(() => expect(screen.getByText("100 de 120 procedimentos")).toBeInTheDocument());
  expect(m.producaoProcedimentos).toHaveBeenLastCalledWith(expect.objectContaining({ desde: 50 }));
  const codigos = (await linhas()).map((l) => within(l).getAllByRole("link")[0]!.textContent);
  expect(new Set(codigos).size).toBe(codigos.length);
});

test("marca Em risco com o link para a Aptidão nos procedimentos que estão no grupo Risco", async () => {
  m.aptidaoUnidade.mockImplementation(async (o) => aptidaoExemplo({
    grupo: o?.grupo === "risco"
      ? { id: "risco", itens: [{ codigo: "0301000001", nome: "x", classe: "produz_sem_aptidao", motivo: null, estado: null, situacao: "nao_apta", falta: [], sia: { quantidade: 1, valor_centavos: 1 }, sih: { aih: 0, valor_centavos: 0 }, uf: { produtores_sia: 0, produtores_sih: 0, valor_centavos: 0 } }], desde: 0, itens_omitidos: 0, total: 1, ninguem_produziu: null }
      : null,
  }));
  abrir("#/painel/producao/procedimentos");
  const rs = await linhas();
  const marcada = rs.find((l) => within(l).queryByRole("link", { name: "0301000001" }))!;
  await waitFor(() => expect(within(marcada).getByRole("link", { name: "Em risco" })).toHaveAttribute("href", "#/painel/aptidao/risco?q=0301000001"));
  expect(within(rs[0]!).queryByRole("link", { name: "Em risco" })).toBeNull();
});

test("Exportar diz quantas linhas saíram e como incluir as outras", async () => {
  m.exportar.mockResolvedValue("Arquivo gravado: C:/x/p.xlsx (9 KB)");
  const u = userEvent.setup();
  abrir("#/painel/producao/procedimentos");
  await linhas();
  await u.click(screen.getByRole("button", { name: "Exportar" }));
  expect(await screen.findByText("50 de 120 linhas exportadas; use Ver mais para incluir as outras.")).toBeInTheDocument();
  const [planilha, nome] = m.exportar.mock.calls[0]!;
  expect(nome).toBe("producao-procedimentos-sia");
  expect(planilha.abas[0]!.colunas).toEqual(["Código", "Procedimento", "Classe", "Quantidade", "Valor aprovado", "Parte", "Acumulado"]);
});

test("lista vazia por busca é um estado, e sem nenhuma produção diz isso", async () => {
  m.producaoProcedimentos.mockResolvedValue(procedimentosExemplo({ total: 0, itens: [], itens_omitidos: 0 }));
  abrir("#/painel/producao/procedimentos?q=zzz");
  expect(await screen.findByText("Nenhum procedimento para «zzz»")).toBeInTheDocument();
  expect(document.body.textContent).not.toMatch(/NaN/);
});

test("unidade sem produção ambulatorial: o SIA diz isso em vez de uma tabela vazia", async () => {
  m.producaoProcedimentos.mockResolvedValue(procedimentosExemplo({ total_geral: 0, total: 0, itens: [], itens_omitidos: 0, valor_total_centavos: 0 }));
  abrir("#/painel/producao/procedimentos");
  expect(await screen.findByText("Esta unidade não tem produção do SIA nos meses carregados.")).toBeInTheDocument();
});

test("enquanto a nova busca não chega, a lista anterior fica à vista, esmaecida e marcada como ocupada", async () => {
  const u = userEvent.setup();
  abrir("#/painel/producao/procedimentos");
  await linhas();
  m.producaoProcedimentos.mockImplementation(() => new Promise(() => {}));
  await u.type(screen.getByRole("searchbox", { name: "Buscar por código ou nome" }), "mapa");
  const quadro = (await tabela()).closest(".pr__lista-viva")!;
  await waitFor(() => expect(quadro).toHaveClass("pr__lista-viva--esmaecida"));
  expect(quadro).toHaveAttribute("aria-busy", "true");
});
