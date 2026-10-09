import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import * as comandos from "../../../api/comandos";
import { aptidaoExemplo, unidadeComProfissionais, unidadeExemplo } from "../exemplos";
import { abrir, m, minha, preparar } from "../apoioDeTeste";

vi.mock("../../../api/comandos");

beforeEach(() => preparar());

const linhasDe = (tabela: HTMLElement) => within(tabela).getAllByRole("row").slice(1);

describe("abas", () => {
  test("rótulos com contagem; Profissionais só existe com o arquivo de pessoas", async () => {
    abrir("#/painel/cadastro");
    const abas = await screen.findByRole("tablist", { name: /Cadastro/ });
    const nomes = within(abas).getAllByRole("tab").map((t) => t.textContent);
    expect(nomes).toEqual(["Habilitações 4", "Serviços 3", "Leitos 2", "Equipamentos 2", "Terceiros 0"]);
  });

  test("com o arquivo de pessoas, a aba Profissionais aparece com a contagem", async () => {
    m.unidadeVer.mockResolvedValue(unidadeComProfissionais);
    abrir("#/painel/cadastro");
    expect(await screen.findByRole("tab", { name: "Profissionais 2" })).toBeInTheDocument();
  });

  test("setas trocam de aba e a rota acompanha", async () => {
    const u = userEvent.setup();
    abrir("#/painel/cadastro");
    const primeira = await screen.findByRole("tab", { name: /Habilitações/ });
    primeira.focus();
    await u.keyboard("{ArrowRight}");
    expect(await screen.findByRole("tab", { name: /Serviços/, selected: true })).toBeInTheDocument();
    expect(window.location.hash).toBe("#/painel/cadastro/servicos");
  });

  test("a rota escolhe a aba ao abrir", async () => {
    abrir("#/painel/cadastro/leitos");
    expect(await screen.findByRole("tab", { name: /Leitos/, selected: true })).toBeInTheDocument();
  });
});

describe("Habilitações", () => {
  test("vigentes primeiro, com a produção dos procedimentos que citam", async () => {
    abrir("#/painel/cadastro");
    const tabela = await screen.findByRole("table", { name: "Habilitações" });
    await within(tabela).findByText("15");
    const linhas = linhasDe(tabela);
    expect(linhas.map((l) => within(l).getAllByRole("cell")[0]!.textContent)).toEqual([
      expect.stringContaining("0203"), expect.stringContaining("0602"), expect.stringContaining("3801"), expect.stringContaining("2601"),
    ]);
    expect(within(linhas[0]!).getByText("15")).toBeInTheDocument();
    expect(within(linhas[0]!).getByText("10")).toBeInTheDocument();
    expect(within(linhas[2]!).getByText(/programa 38\.xx/)).toBeInTheDocument();
    expect(within(linhas[3]!).getByText(/Encerrada/)).toBeInTheDocument();
    expect(screen.getByText("4 habilitações · 3 vigentes")).toBeInTheDocument();
  });

  test("clicar na linha leva à Aptidão filtrada pela habilitação", async () => {
    const u = userEvent.setup();
    abrir("#/painel/cadastro");
    const tabela = await screen.findByRole("table", { name: "Habilitações" });
    await u.click(within(linhasDe(tabela)[0]!).getByText("PT GM 2133"));
    expect(window.location.hash).toBe("#/painel/aptidao/oportunidade?hab=0203");
  });

  test("o link Ver da linha também leva à Aptidão (teclado)", async () => {
    abrir("#/painel/cadastro");
    const tabela = await screen.findByRole("table", { name: "Habilitações" });
    const ver = within(linhasDe(tabela)[1]!).getByRole("link", { name: /Ver procedimentos da habilitação 0602/ });
    expect(ver).toHaveAttribute("href", "#/painel/aptidao/oportunidade?hab=0602");
  });

  test("sem produção carregada as colunas de produção somem", async () => {
    m.aptidaoUnidade.mockResolvedValue(aptidaoExemplo({ sem_producao: true }));
    abrir("#/painel/cadastro");
    const tabela = await screen.findByRole("table", { name: "Habilitações" });
    await waitFor(() => expect(within(tabela).queryByRole("columnheader", { name: "Produzidos" })).toBeNull());
    expect(within(tabela).getByRole("columnheader", { name: "Portaria" })).toBeInTheDocument();
  });

  test("a rota com ?q= pré-preenche o filtro e restringe as linhas", async () => {
    abrir("#/painel/cadastro?q=INTENSIVA");
    expect(await screen.findByRole("searchbox", { name: /Filtrar/ })).toHaveValue("INTENSIVA");
    const tabela = await screen.findByRole("table", { name: "Habilitações" });
    expect(linhasDe(tabela)).toHaveLength(1);
    expect(screen.getByText("1 habilitação · 1 vigente")).toBeInTheDocument();
  });

  test("digitar no filtro restringe as linhas e guarda o texto na rota", async () => {
    const u = userEvent.setup();
    abrir("#/painel/cadastro");
    const campo = await screen.findByRole("searchbox", { name: /Filtrar/ });
    await u.type(campo, "ONCOLOGIA");
    const tabela = await screen.findByRole("table", { name: "Habilitações" });
    await waitFor(() => expect(linhasDe(tabela)).toHaveLength(1));
    expect(window.location.hash).toBe("#/painel/cadastro?q=ONCOLOGIA");
  });

  test("filtro sem resultado diz o que foi procurado", async () => {
    abrir("#/painel/cadastro?q=zzz");
    expect(await screen.findByText("Nenhum resultado para «zzz»")).toBeInTheDocument();
  });
});

describe("Serviços, Leitos e Equipamentos", () => {
  test("Serviços: terceiro mostra o CNES e o filtro restringe", async () => {
    const u = userEvent.setup();
    abrir("#/painel/cadastro/servicos");
    const tabela = await screen.findByRole("table", { name: "Serviços" });
    expect(linhasDe(tabela)).toHaveLength(3);
    expect(within(tabela).getByText("0000999")).toBeInTheDocument();
    await u.type(screen.getByRole("searchbox", { name: /Filtrar/ }), "densitometria");
    await waitFor(() => expect(linhasDe(tabela)).toHaveLength(1));
  });

  test("Leitos: nome ausente mostra só o código, sem null nem undefined", async () => {
    abrir("#/painel/cadastro/leitos");
    const tabela = await screen.findByRole("table", { name: "Leitos" });
    expect(tabela.textContent).not.toMatch(/null|undefined/);
    expect(within(linhasDe(tabela)[0]!).getByText("Clínico")).toBeInTheDocument();
    expect(within(linhasDe(tabela)[1]!).getByText("81")).toBeInTheDocument();
  });

  test("Equipamentos: nome ausente mostra só o código e a disponibilidade em texto", async () => {
    abrir("#/painel/cadastro/equipamentos");
    const tabela = await screen.findByRole("table", { name: "Equipamentos" });
    expect(tabela.textContent).not.toMatch(/null|undefined/);
    expect(within(linhasDe(tabela)[0]!).getByText("0101")).toBeInTheDocument();
    expect(within(linhasDe(tabela)[0]!).getByText("Sim")).toBeInTheDocument();
    expect(within(linhasDe(tabela)[1]!).getByText("Não")).toBeInTheDocument();
  });
});

describe("Profissionais", () => {
  test("mostra nome, CBO, vínculo e horas, e nunca CPF", async () => {
    m.unidadeVer.mockResolvedValue(unidadeComProfissionais);
    abrir("#/painel/cadastro/profissionais");
    const tabela = await screen.findByRole("table", { name: "Profissionais" });
    expect(within(tabela).getByText("FULANA DE TAL EXEMPLO")).toBeInTheDocument();
    expect(tabela.textContent).not.toMatch(/cpf/i);
    expect(within(linhasDe(tabela)[0]!).getByText("20 h ambulatório")).toBeInTheDocument();
  });

  test("sem o arquivo de pessoas a rota da aba cai em Habilitações", async () => {
    abrir("#/painel/cadastro/profissionais");
    expect(await screen.findByRole("tab", { name: /Habilitações/, selected: true })).toBeInTheDocument();
  });
});

describe("Terceiros", () => {
  const t1 = { uf: "SP", cnes: "0000999", nome: "CLINICA DE EXEMPLO LTDA" };
  const achado = { uf: "SP", cnes: "0000888", nome: "LABORATORIO DE EXEMPLO", municipio: "000000", municipio_nome: "Cidade de Exemplo", tipo: "39", tipo_nome: "Apoio diagnóstico" };

  test("lista os declarados por você, com o efeito na Aptidão dito uma vez", async () => {
    preparar([t1]);
    abrir("#/painel/cadastro/terceiros");
    expect(await screen.findByText("CLINICA DE EXEMPLO LTDA")).toBeInTheDocument();
    expect(screen.getByText(/Declarados por você/)).toBeInTheDocument();
    expect(screen.getByText(/Serviços que estes estabelecimentos prestam contam na Aptidão/)).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Terceiros 1" })).toBeInTheDocument();
  });

  test("adicionar: busca, escolhe e o terceiro entra pelo comando", async () => {
    const u = userEvent.setup();
    m.unidadesBuscar.mockResolvedValue([achado]);
    m.terceiroAdicionar.mockResolvedValue({});
    abrir("#/painel/cadastro/terceiros");
    await u.type(await screen.findByRole("searchbox", { name: /Buscar estabelecimento/ }), "laboratorio");
    await u.click(await screen.findByRole("button", { name: /Adicionar LABORATORIO DE EXEMPLO/ }));
    expect(m.terceiroAdicionar).toHaveBeenCalledWith("SP", "0000000", "SP", "0000888");
  });

  test("remover mostra o aviso com Desfazer, e Desfazer readiciona", async () => {
    preparar([t1]);
    const u = userEvent.setup();
    m.terceiroRemover.mockResolvedValue(undefined);
    m.terceiroAdicionar.mockResolvedValue({});
    abrir("#/painel/cadastro/terceiros");
    await u.click(await screen.findByRole("button", { name: /Remover CLINICA DE EXEMPLO LTDA/ }));
    expect(m.terceiroRemover).toHaveBeenCalledWith("SP", "0000000", "SP", "0000999");
    const aviso = (await screen.findByText(/CLINICA DE EXEMPLO LTDA removido/)).parentElement!;
    await u.click(within(aviso).getByRole("button", { name: "Desfazer" }));
    expect(m.terceiroAdicionar).toHaveBeenCalledWith("SP", "0000000", "SP", "0000999");
  });

  test("erro do Rust (própria unidade, duplicado) aparece como alerta, sem reescrever", async () => {
    const u = userEvent.setup();
    m.unidadesBuscar.mockResolvedValue([achado]);
    m.terceiroAdicionar.mockRejectedValue("a unidade não pode ser terceira de si mesma");
    abrir("#/painel/cadastro/terceiros");
    await u.type(await screen.findByRole("searchbox", { name: /Buscar estabelecimento/ }), "laboratorio");
    await u.click(await screen.findByRole("button", { name: /Adicionar LABORATORIO/ }));
    expect(await screen.findByRole("alert")).toHaveTextContent("a unidade não pode ser terceira de si mesma");
  });

  test("terceiro de UF sem CNES carregado aparece sem nome, só com o CNES", async () => {
    preparar([{ uf: "MS", cnes: "0000777", nome: "" }]);
    abrir("#/painel/cadastro/terceiros");
    expect(await screen.findByText("CNES 0000777")).toBeInTheDocument();
    expect(screen.getByText(/MS/)).toBeInTheDocument();
  });

  test("sem terceiros diz isso e deixa adicionar", async () => {
    abrir("#/painel/cadastro/terceiros");
    expect(await screen.findByText("Nenhum terceiro declarado")).toBeInTheDocument();
  });
});

// Garante que os testes usam as fixtures e o mock certos.
test("a unidade de exemplo não traz CPF", () => {
  expect(JSON.stringify(unidadeExemplo)).not.toMatch(/cpf/i);
  expect(minha.cnes).toBe("0000000");
  expect(comandos.unidadeVer).toBeDefined();
});

describe("revisão final", () => {
  test("estabelecimento sem nome e sem tipo na busca de terceiros mostra o CNES, sem sobra", async () => {
    const u = userEvent.setup();
    m.unidadesBuscar.mockResolvedValue([{ uf: "SP", cnes: "0000888", nome: "", municipio: "000000", municipio_nome: "Cidade de Exemplo", tipo: "", tipo_nome: null } as never]);
    abrir("#/painel/cadastro/terceiros");
    await u.type(await screen.findByRole("searchbox", { name: /Buscar estabelecimento/ }), "0000888");
    const botao = await screen.findByRole("button", { name: "Adicionar CNES 0000888" });
    const item = botao.closest("li")!;
    expect(item.textContent).not.toMatch(/·\s*(Adicionar)?$/);
    expect(item.textContent).not.toMatch(/null|undefined/);
  });

  test("município sem nome no território mostra o código no cabeçalho", async () => {
    m.unidadeVer.mockResolvedValue({ ...unidadeExemplo, municipio: "354980", municipio_nome: "" });
    abrir("#/painel/cadastro");
    expect(await screen.findByText(/354980 \(SP\)/)).toBeInTheDocument();
  });
});
