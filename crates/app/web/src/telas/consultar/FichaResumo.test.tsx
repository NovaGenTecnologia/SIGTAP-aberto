import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { fichaDeExemplo, campo, linha, nome } from "./exemplos";
import { FichaResumo } from "./FichaResumo";

const nbsp = (s: string | null) => (s ?? "").replace(/ /g, " ");

function montar(f = fichaDeExemplo()) {
  window.location.hash = "#/consultar/0301010072";
  return render(<FichaResumo ficha={f} />);
}

test("Para cobrar mostra sexo, idade, quantidade, permanência e pontos", () => {
  montar();
  const bloco = screen.getByRole("region", { name: "Para cobrar" });
  for (const [rotulo, valor] of [["Sexo", "Indiferente/Ambos"], ["Idade", "0 a 130 anos e 11 meses"], ["Quantidade máxima", "Não se aplica"], ["Permanência", "Não se aplica"], ["Pontos", "0"]]) {
    const termo = within(bloco).getByText(rotulo!, { selector: "dt" });
    expect(termo.nextElementSibling).toHaveTextContent(valor!);
  }
});

test("CID, CBO e demais exigências mostram a contagem; 'ver' leva à seção em Exigências", async () => {
  const u = userEvent.setup();
  montar(fichaDeExemplo({ cids: 12 }));
  const bloco = screen.getByRole("region", { name: "Para cobrar" });
  expect(within(bloco).getByText("CID", { selector: "dt" }).nextElementSibling).toHaveTextContent("12 aceitos");
  expect(within(bloco).getByText("Habilitação", { selector: "dt" }).nextElementSibling).toHaveTextContent("Sem exigência");
  await u.click(within(bloco).getByRole("button", { name: "Ver CBO em Exigências" }));
  expect(window.location.hash).toBe("#/consultar/0301010072/exigencias/rl_procedimento_ocupacao");
  expect(within(bloco).queryByRole("button", { name: "Ver Habilitação em Exigências" })).not.toBeInTheDocument();
});

test("Valores: cada valor tem 'De onde vem' com fonte e competência", async () => {
  const u = userEvent.setup();
  montar();
  const bloco = screen.getByRole("region", { name: "Valores" });
  expect(nbsp(within(bloco).getByText("Serviço ambulatorial", { selector: "dt" }).nextElementSibling!.textContent)).toContain("R$ 10,00");
  expect(within(bloco).getByText("Financiamento", { selector: "dt" }).nextElementSibling).toHaveTextContent("Média e Alta Complexidade (MAC) · 06");
  expect(within(bloco).getByText("Rubrica", { selector: "dt" }).nextElementSibling).toHaveTextContent("Sem rubrica");
  await u.click(within(bloco).getByRole("button", { name: "De onde vem: Serviço ambulatorial" }));
  expect(await screen.findByText("Tabela SIGTAP")).toBeInTheDocument();
  expect(screen.getByText("09/2026")).toBeInTheDocument();
});

test("Regras e atributos: vazio diz 'Nenhum'; com itens lista código, nome e texto oficial e leva à seção", async () => {
  const u = userEvent.setup();
  const f = fichaDeExemplo();
  f.relacoes.find((r) => r.tabela === "rl_procedimento_regra_cond")!.linhas = [
    linha([campo("co_regra_condicionada", "0012")], [nome("tb_regra_condicionada", "co_regra_condicionada", { no_regra_condicionada: "Autorização prévia" }), nome("tb_descricao_regra", "co_regra_condicionada", { ds_regra_condicionada: "Exige autorização do gestor." })]),
    linha([campo("co_regra_condicionada", "0013")]),
  ];
  montar(f);
  const bloco = screen.getByRole("region", { name: "Regras e atributos" });
  expect(within(bloco).getByText("Incremento", { selector: "dt" }).nextElementSibling).toHaveTextContent("Nenhum");
  expect(within(bloco).getByRole("heading", { name: /Regras condicionadas/ })).toHaveTextContent("2");
  expect(within(bloco).getByRole("heading", { name: /Atributos complementares/ })).toHaveTextContent("4");
  const regras = within(bloco).getByRole("list", { name: "Regras condicionadas" });
  expect(within(regras).getAllByRole("listitem")).toHaveLength(2);
  expect(regras).toHaveTextContent(/0012s*Autorização prévia/);
  await u.click(within(regras).getByText("Texto oficial"));
  expect(within(regras).getByText("Exige autorização do gestor.")).toBeVisible();
  expect(within(bloco).getByRole("list", { name: "Atributos complementares" })).toHaveTextContent("001");
  await u.click(within(bloco).getByRole("button", { name: "Ver Regras condicionadas em Exigências" }));
  expect(window.location.hash).toBe("#/consultar/0301010072/exigencias/rl_procedimento_regra_cond");
});

test("notas e prévias aparecem sob o valor", () => {
  montar();
  const cobrar = screen.getByRole("region", { name: "Para cobrar" });
  expect(within(cobrar).getByText("Idade", { selector: "dt" }).nextElementSibling).toHaveTextContent("0 a 1.571 meses no arquivo oficial");
  expect(within(cobrar).getByText("CBO", { selector: "dt" }).nextElementSibling).toHaveTextContent("223100 Ocupação 0; 223101 Ocupação 1; 223102 Ocupação 2; e mais 66");
  expect(within(screen.getByRole("region", { name: "Valores" })).getByText("Total", { selector: "dt" }).nextElementSibling).toHaveTextContent("SH + SP + SA");
});

test("incremento com habilitação lista o percentual", () => {
  const inc = linha([campo("co_habilitacao", "0101"), campo("vl_percentual_sh", 2500, { unidade: "centesimos_de_percentual" }), campo("vl_percentual_sa", 0, { unidade: "centesimos_de_percentual" }), campo("vl_percentual_sp", 0, { unidade: "centesimos_de_percentual" })],
    [nome("tb_habilitacao", "co_habilitacao", { no_habilitacao: "Hospital geral" })]);
  montar(fichaDeExemplo({ incremento: [inc] }));
  expect(screen.getByText("0101 Hospital geral: +25% no serviço hospitalar")).toBeInTheDocument();
});

test("descrição longa vem recolhida e abre e fecha; curta não tem botão", async () => {
  const u = userEvent.setup();
  const { unmount } = montar();
  const botao = screen.getByRole("button", { name: "Mostrar inteira" });
  expect(botao).toHaveAttribute("aria-expanded", "false");
  await u.click(botao);
  expect(screen.getByRole("button", { name: "Recolher" })).toHaveAttribute("aria-expanded", "true");
  unmount();
  montar(fichaDeExemplo({ descricao: "CONSULTA MEDICA" }));
  expect(screen.queryByRole("button", { name: "Mostrar inteira" })).not.toBeInTheDocument();
  expect(screen.getByText("CONSULTA MEDICA")).toBeInTheDocument();
});
