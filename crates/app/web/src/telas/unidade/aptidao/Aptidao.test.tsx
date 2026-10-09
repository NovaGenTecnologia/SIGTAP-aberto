import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { GrupoDeAptidao } from "../../../api/tipos";
import { aptidaoExemplo, itensDeOportunidade, itensDeRisco, itensEmOrdem, pagina, resumoCompleto } from "../exemplos";
import { abrir, m, preparar } from "../apoioDeTeste";

vi.mock("../../../api/comandos");

const ITENS: Record<GrupoDeAptidao, typeof itensDeRisco> = { risco: itensDeRisco, oportunidade: itensDeOportunidade, ordem: itensEmOrdem };

beforeEach(() => {
  preparar();
  m.aptidaoUnidade.mockImplementation(async (o) =>
    aptidaoExemplo({ grupo: o?.grupo ? pagina(o.grupo, ITENS[o.grupo], o.grupo === "oportunidade" ? { ninguem_produziu: o.soProduzidosNaUf ? 3 : null } : {}) : null }));
});

const linhasDe = (tabela: HTMLElement) => within(tabela).getAllByRole("row").slice(1);
const tabela = () => screen.findByRole("table", { name: /Procedimentos/ });

describe("grupo inicial e faixa de prioridade", () => {
  test("sem grupo na rota abre no primeiro grupo não vazio e atualiza a rota", async () => {
    abrir("#/painel/aptidao");
    await tabela();
    await waitFor(() => expect(window.location.hash).toBe("#/painel/aptidao/risco"));
    expect(m.aptidaoUnidade).toHaveBeenCalledWith(expect.objectContaining({ grupo: "risco" }));
  });

  test("Risco vazio: abre na Oportunidade", async () => {
    m.aptidaoUnidade.mockImplementation(async (o) =>
      aptidaoExemplo({ resumo: { ...resumoCompleto, risco: { procedimentos: 0, valor_da_unidade_centavos: 0 } }, grupo: o?.grupo ? pagina(o.grupo, ITENS[o.grupo]) : null }));
    abrir("#/painel/aptidao");
    await tabela();
    await waitFor(() => expect(window.location.hash).toBe("#/painel/aptidao/oportunidade"));
  });

  test("a faixa mostra os três números, é navegação e marca o grupo ativo", async () => {
    abrir("#/painel/aptidao/risco");
    const faixa = await screen.findByRole("navigation", { name: "Prioridade" });
    const risco = within(faixa).getByRole("link", { name: /Risco/ });
    expect(risco).toHaveAttribute("aria-current", "page");
    expect(risco).toHaveTextContent("4");
    expect(within(faixa).getByRole("link", { name: /Oportunidade/ })).toHaveTextContent("2.076");
    expect(within(faixa).getByRole("link", { name: /Oportunidade/ })).toHaveTextContent("1.280 com produção na UF");
    expect(within(faixa).getByRole("link", { name: /Em ordem/ })).toHaveTextContent("1.952");
    expect(within(faixa).getByRole("link", { name: /Em ordem/ })).toHaveAttribute("href", "#/painel/aptidao/ordem");
  });

  test("trocar de grupo pela faixa muda a rota e a lista, mantendo o filtro de habilitação", async () => {
    const u = userEvent.setup();
    abrir("#/painel/aptidao/risco?hab=0203");
    const faixa = await screen.findByRole("navigation", { name: "Prioridade" });
    expect(within(faixa).getByRole("link", { name: /Em ordem/ })).toHaveAttribute("href", "#/painel/aptidao/ordem?hab=0203");
    await u.click(within(faixa).getByRole("link", { name: /Em ordem/ }));
    expect(window.location.hash).toBe("#/painel/aptidao/ordem?hab=0203");
    await waitFor(() => expect(m.aptidaoUnidade).toHaveBeenCalledWith(expect.objectContaining({ grupo: "ordem", hab: "0203" })));
  });
});

describe("colunas, situação e o que falta", () => {
  test("Risco: situação em texto, o que falta em chips e o produzido pela unidade", async () => {
    abrir("#/painel/aptidao/risco");
    const t = await tabela();
    const cab = within(t).getAllByRole("columnheader").map((c) => c.textContent);
    expect(cab).toEqual(["Procedimento", "Situação", "O que falta", "Produzido pela unidade"]);
    const l = linhasDe(t);
    expect(within(l[0]!).getByText("Não apta")).toBeInTheDocument();
    expect(within(l[1]!).getByText("Serviço a confirmar")).toBeInTheDocument();
    expect(within(l[3]!).getByText("Fora da tabela")).toBeInTheDocument();
    expect(within(l[0]!).getByText(/R\$\s8\.550,36/)).toBeInTheDocument();
  });

  test("Oportunidade: unidades da UF e valor na UF; Em ordem: sem O que falta", async () => {
    abrir("#/painel/aptidao/oportunidade");
    const t = await tabela();
    expect(within(t).getAllByRole("columnheader").map((c) => c.textContent)).toEqual(["Procedimento", "Situação", "Unidades da UF", "Valor na UF"]);
    expect(within(linhasDe(t)[0]!).getByText("Apta")).toBeInTheDocument();
    expect(within(linhasDe(t)[1]!).getByText("Apta com ressalva de serviço")).toBeInTheDocument();
    expect(within(linhasDe(t)[0]!).getByText("26")).toBeInTheDocument();
  });

  test("Em ordem mostra Apta e Sem exigência, sem a coluna O que falta", async () => {
    abrir("#/painel/aptidao/ordem");
    const t = await tabela();
    expect(within(t).getAllByRole("columnheader").map((c) => c.textContent)).toEqual(["Procedimento", "Situação", "Produzido pela unidade"]);
    expect(within(linhasDe(t)[1]!).getByText("Sem exigência")).toBeInTheDocument();
  });

  test("nenhuma coluna só de zeros: sem produtores na UF a coluna some", async () => {
    m.aptidaoUnidade.mockImplementation(async (o) =>
      aptidaoExemplo({ grupo: o?.grupo ? pagina(o.grupo, itensDeOportunidade.map((i) => ({ ...i, uf: { produtores_sia: 0, produtores_sih: 0, valor_centavos: 0 } }))) : null }));
    abrir("#/painel/aptidao/oportunidade");
    const t = await tabela();
    expect(within(t).getAllByRole("columnheader").map((c) => c.textContent)).toEqual(["Procedimento", "Situação"]);
  });

  test("o código do procedimento leva à Ficha", async () => {
    abrir("#/painel/aptidao/risco");
    const t = await tabela();
    expect(within(linhasDe(t)[0]!).getByRole("link", { name: "0205010032" })).toHaveAttribute("href", "#/consultar/0205010032");
  });

  test("os chips levam ao Cadastro, na aba e com o filtro certos", async () => {
    abrir("#/painel/aptidao/risco");
    const t = await tabela();
    const l = linhasDe(t);
    expect(within(l[0]!).getByRole("link", { name: "habilitação 0203" })).toHaveAttribute("href", "#/painel/cadastro?q=0203");
    expect(within(l[0]!).getByRole("link", { name: "serviço 153/003" })).toHaveAttribute("href", "#/painel/cadastro/servicos?q=153");
    expect(within(l[2]!).getByRole("link", { name: "leito 03" })).toHaveAttribute("href", "#/painel/cadastro/leitos?q=03");
  });

  test("habilitação 38.xx aparece como programa e não como falta confirmada", async () => {
    m.aptidaoUnidade.mockImplementation(async (o) =>
      aptidaoExemplo({ grupo: o?.grupo ? pagina(o.grupo, [{ ...itensDeRisco[0]!, falta: [
      { tipo: "habilitacao", codigo: "3801", nome: "Mais Acesso" }, { tipo: "habilitacao", codigo: "3802", nome: "Mais Acesso" },
    ] }]) : null }));
    abrir("#/painel/aptidao/risco");
    const t = await tabela();
    // Cada código tem o seu rótulo: dois chips iguais pareceriam repetição.
    expect(within(linhasDe(t)[0]!).getByRole("link", { name: "programa 3801" })).toBeInTheDocument();
    expect(within(linhasDe(t)[0]!).getByRole("link", { name: "programa 3802" })).toBeInTheDocument();
  });
});

describe("busca, paginação e filtros", () => {
  test("a busca vai ao servidor (com pausa) e fica na rota", async () => {
    const u = userEvent.setup();
    abrir("#/painel/aptidao/risco");
    await tabela();
    await u.type(screen.getByRole("searchbox", { name: /Buscar por código ou nome/ }), "eco");
    await waitFor(() => expect(m.aptidaoUnidade).toHaveBeenCalledWith(expect.objectContaining({ grupo: "risco", q: "eco" })));
    await waitFor(() => expect(window.location.hash).toBe("#/painel/aptidao/risco?q=eco"));
  });

  test("Ver mais pede a próxima página e junta sem repetir", async () => {
    const u = userEvent.setup();
    m.aptidaoUnidade.mockImplementation(async (o) => {
      if (!o?.grupo) return aptidaoExemplo();
      const desde = o.desde ?? 0;
      return aptidaoExemplo({ grupo: desde === 0 ? pagina("risco", itensDeRisco.slice(0, 2), { total: 4, itens_omitidos: 2 }) : pagina("risco", itensDeRisco.slice(2), { total: 4, desde: 2 }) });
    });
    abrir("#/painel/aptidao/risco");
    const t = await tabela();
    expect(linhasDe(t)).toHaveLength(2);
    await u.click(screen.getByRole("button", { name: /Ver mais/ }));
    await waitFor(() => expect(linhasDe(t)).toHaveLength(4));
    expect(m.aptidaoUnidade).toHaveBeenCalledWith(expect.objectContaining({ grupo: "risco", desde: 2 }));
    expect(screen.queryByRole("button", { name: /Ver mais/ })).toBeNull();
  });

  test("?hab mostra o filtro removível e remover tira da rota", async () => {
    const u = userEvent.setup();
    abrir("#/painel/aptidao/oportunidade?hab=0203");
    await tabela();
    expect(m.aptidaoUnidade).toHaveBeenCalledWith(expect.objectContaining({ grupo: "oportunidade", hab: "0203" }));
    await u.click(screen.getByRole("button", { name: "Remover filtro da habilitação 0203" }));
    expect(window.location.hash).toBe("#/painel/aptidao/oportunidade");
  });

  test("Oportunidade abre só com os que a UF produziu e mostra os demais sob pedido", async () => {
    const u = userEvent.setup();
    abrir("#/painel/aptidao/oportunidade");
    await tabela();
    expect(m.aptidaoUnidade).toHaveBeenLastCalledWith(expect.objectContaining({ grupo: "oportunidade", soProduzidosNaUf: true }));
    await u.click(await screen.findByRole("button", { name: "Mostrar também os 3 que ninguém produziu" }));
    await waitFor(() => expect(m.aptidaoUnidade).toHaveBeenLastCalledWith(expect.objectContaining({ grupo: "oportunidade", soProduzidosNaUf: false })));
  });

  test("grupo vazio é estado, não erro", async () => {
    m.aptidaoUnidade.mockImplementation(async (o) => aptidaoExemplo({ grupo: o?.grupo ? pagina(o.grupo, []) : null }));
    abrir("#/painel/aptidao/risco");
    expect(await screen.findByText("Nenhum procedimento em risco")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  test("busca sem resultado diz o que foi procurado", async () => {
    m.aptidaoUnidade.mockImplementation(async (o) => aptidaoExemplo({ grupo: o?.grupo ? pagina(o.grupo, []) : null }));
    abrir("#/painel/aptidao/risco?q=zzz");
    expect(await screen.findByText("Nenhum resultado para «zzz»")).toBeInTheDocument();
  });

  test("erro do Rust aparece com Tentar de novo", async () => {
    m.aptidaoUnidade.mockRejectedValue("falhou ao ler a aptidão");
    abrir("#/painel/aptidao/risco");
    expect(await screen.findByRole("alert")).toHaveTextContent("falhou ao ler a aptidão");
    expect(screen.getByRole("button", { name: "Tentar de novo" })).toBeInTheDocument();
  });
});

describe("sem produção carregada", () => {
  beforeEach(() => {
    m.aptidaoUnidade.mockImplementation(async (o) =>
      aptidaoExemplo({ sem_producao: true, resumo: { risco: null, oportunidade: { procedimentos: 2076, com_producao_na_uf: 0, valor_da_uf_centavos: 0 }, ordem: null },
        grupo: o?.grupo === "oportunidade" ? pagina("oportunidade", itensDeOportunidade.map((i) => ({ ...i, uf: { produtores_sia: 0, produtores_sih: 0, valor_centavos: 0 } }))) : null }));
  });

  test("só a Oportunidade fica ativa, com a linha de aviso e o caminho para baixar", async () => {
    const u = userEvent.setup();
    abrir("#/painel/aptidao");
    await tabela();
    await waitFor(() => expect(window.location.hash).toBe("#/painel/aptidao/oportunidade"));
    expect(screen.getByText("Sem produção carregada para SP: mostrando só o cadastro")).toBeInTheDocument();
    await u.click(screen.getByRole("button", { name: "Baixar produção" }));
    expect(window.location.hash).toBe("#/dados");
  });

  test("Risco e Em ordem ficam desabilitados com o motivo", async () => {
    abrir("#/painel/aptidao/oportunidade");
    const faixa = await screen.findByRole("navigation", { name: "Prioridade" });
    expect(within(faixa).queryByRole("link", { name: /Risco/ })).toBeNull();
    expect(within(faixa).getByText(/Risco/).closest("[aria-disabled=true]")).not.toBeNull();
    expect(within(faixa).getAllByText("Precisa da produção")).toHaveLength(2);
  });
});

describe("avisos e linguagem", () => {
  test("a regra não confirmada e o limite dos terceirizados ficam à vista; De onde vem abre a origem", async () => {
    const u = userEvent.setup();
    abrir("#/painel/aptidao/risco");
    await tabela();
    expect(screen.getByText("Regra não confirmada")).toBeInTheDocument();
    expect(screen.getByText("O cadastro público não lista serviço terceirizado.")).toBeInTheDocument();
    await u.click(screen.getByRole("button", { name: /De onde vem/ }));
    expect(await screen.findByText(/produzido por todos na UF/)).toBeVisible();
  });

  test("a Oportunidade nunca fala em previsão nem em ganho", async () => {
    abrir("#/painel/aptidao/oportunidade");
    await tabela();
    expect(document.body.textContent).not.toMatch(/previs|ganho/i);
  });
});

describe("revisão final", () => {
  test("com filtro de habilitação, os que ninguém produziu seguem acessíveis", async () => {
    abrir("#/painel/aptidao/oportunidade?hab=0203");
    await tabela();
    expect(await screen.findByRole("button", { name: "Mostrar também os 3 que ninguém produziu" })).toBeInTheDocument();
  });

  test("Voltar na rota devolve o campo de busca e a lista ao estado anterior", async () => {
    abrir("#/painel/aptidao/risco?q=abc");
    await tabela();
    const campo = screen.getByRole("searchbox", { name: /Buscar por código ou nome/ });
    expect(campo).toHaveValue("abc");
    act(() => { window.location.hash = "#/painel/aptidao/risco"; });
    await waitFor(() => expect(campo).toHaveValue(""));
  });

  test("trocar de grupo não mostra as linhas do grupo anterior enquanto carrega", async () => {
    const u = userEvent.setup();
    m.aptidaoUnidade.mockImplementation((o) =>
      o?.grupo === "ordem" ? new Promise(() => {}) : Promise.resolve(aptidaoExemplo({ grupo: o?.grupo ? pagina(o.grupo, ITENS[o.grupo]) : null })));
    abrir("#/painel/aptidao/risco");
    await tabela();
    await u.click(within(screen.getByRole("navigation", { name: "Prioridade" })).getByRole("link", { name: /Em ordem/ }));
    await waitFor(() => expect(window.location.hash).toBe("#/painel/aptidao/ordem"));
    expect(screen.queryByRole("table", { name: /Procedimentos/ })).toBeNull();
    expect(screen.getByRole("status", { name: "Lendo os procedimentos" })).toBeInTheDocument();
  });
});
