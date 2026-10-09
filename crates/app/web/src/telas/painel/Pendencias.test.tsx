import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Pendencias } from "./Pendencias";
import type { Pendencia } from "../../api/tipos";
import { queda, semAptidao, semValor } from "./exemplos";
import { definirOrigem, lerOrigem } from "./origemDaPendencia";

const n = (s: string) => s.replace(/ /g, " ");

test("mostra as valoradas com o valor envolvido e as sem valor numa faixa à parte", () => {
  render(<Pendencias itens={[queda, semAptidao, semValor]} />);
  const lista = screen.getByRole("list", { name: "Pendências" });
  expect(within(lista).getAllByRole("listitem")).toHaveLength(2);
  expect(n(screen.getByText(/R\$\s41\.200,00/).textContent!)).toBe("R$ 41.200,00");
  expect(screen.getByRole("button", { name: /Sem valor calculável/ })).toBeInTheDocument();
  expect(screen.getByText("Mês incompleto na fonte")).toBeInTheDocument();
});

test("só a queda de valor mostra a perda estimada, com a premissa", () => {
  render(<Pendencias itens={[queda, semAptidao]} />);
  expect(screen.getAllByText(/Perda estimada/)).toHaveLength(1);
  expect(screen.getByText(/se a queda se mantiver/)).toBeInTheDocument();
  expect(screen.getByText(/R\$\s164\.800,00/)).toBeInTheDocument();
});

test("De onde vem abre a conta e o que ela não prova, e Esc devolve o foco", async () => {
  const u = userEvent.setup();
  render(<Pendencias itens={[queda]} />);
  const botao = screen.getByRole("button", { name: /De onde vem/ });
  await u.click(botao);
  expect(screen.getByText(/média anterior/)).toBeVisible();
  expect(screen.getByText(/Não prova a causa/)).toBeVisible();
  expect(within(screen.getByRole("dialog")).getByText(/04–06\/2026/)).toBeVisible();
  await u.keyboard("{Escape}");
  await waitFor(() => expect(botao).toHaveFocus());
});

test("Ver itens lista os procedimentos com o valor de cada um e leva à Ficha", async () => {
  const u = userEvent.setup();
  render(<Pendencias itens={[semAptidao]} />);
  const botao = screen.getByRole("button", { name: "Ver itens" });
  expect(botao).toHaveAttribute("aria-expanded", "false");
  await u.click(botao);
  expect(screen.getByRole("button", { name: "Ocultar itens" })).toHaveAttribute("aria-expanded", "true");
  expect(screen.getByText("CONSULTA")).toBeVisible();
  expect(n(screen.getByText(/R\$\s5\.000,00/).textContent!)).toBe("R$ 5.000,00");
  await u.click(screen.getByRole("link", { name: "0301010072" }));
  expect(window.location.hash).toBe("#/consultar/0301010072");
});

test("pendência sem itens não oferece Ver itens", () => {
  render(<Pendencias itens={[queda]} />);
  expect(screen.queryByRole("button", { name: "Ver itens" })).toBeNull();
});

test("nunca chama de perda um cartão sem perda estimada", () => {
  render(<Pendencias itens={[semAptidao]} />);
  expect(screen.queryByText(/Perda/)).toBeNull();
});

test("o selo diz Atenção ou Info em texto", () => {
  render(<Pendencias itens={[semAptidao, semValor]} />);
  expect(screen.getAllByText("Atenção").length).toBeGreaterThan(0);
  expect(screen.getAllByText("Info").length).toBeGreaterThan(0);
});

test("sem nenhuma pendência diz que nada pede atenção", () => {
  render(<Pendencias itens={[]} />);
  expect(screen.getByText("Nada pede atenção nesta competência")).toBeInTheDocument();
});

describe("ação principal: abrir a área da unidade", () => {
  const com = (tipo: string): Pendencia => ({ ...semAptidao, id: tipo, tipo, titulo: `Pendência ${tipo}` });
  const destinos: [string, string, string][] = [
    ["produz_sem_aptidao", "Abrir em Aptidão", "#/painel/aptidao/risco"],
    ["produz_com_ressalva", "Abrir em Aptidão", "#/painel/aptidao/risco"],
    ["servico_fora_do_cadastro", "Abrir em Cadastro", "#/painel/cadastro/servicos"],
    ["habilitacao_sem_producao", "Abrir em Cadastro", "#/painel/cadastro/habilitacoes"],
    ["rejeicao_acima_dos_pares", "Abrir em Produção", "#/painel/producao/rejeicoes"],
    ["quantidade_atipica", "Abrir em Produção", "#/painel/producao/fora-do-padrao?bloco=quantidade"],
    ["permanencia_fora_do_previsto", "Abrir em Produção", "#/painel/producao/fora-do-padrao?bloco=permanencia"],
    ["mes_incompleto", "Abrir em Produção", "#/painel/producao"],
  ];
  test.each(destinos)("%s leva a %s", (tipo, rotulo, href) => {
    render(<Pendencias itens={[com(tipo)]} />);
    expect(screen.getByRole("link", { name: rotulo })).toHaveAttribute("href", href);
  });
  test("tipos sem destino nas subtelas não ganham o link", () => {
    render(<Pendencias itens={[queda]} />);
    expect(screen.queryByRole("link", { name: /^Abrir em / })).toBeNull();
  });
});

test("filtrar por área mostra só as dela e os botões trazem a contagem", async () => {
  const u = userEvent.setup();
  render(<Pendencias itens={[queda, semAptidao, semValor]} />);
  expect(screen.getByRole("button", { name: /^Todas 3$/ })).toHaveAttribute("aria-pressed", "true");
  await u.click(screen.getByRole("button", { name: /^Aptidão 1$/ }));
  expect(within(screen.getByRole("list", { name: "Pendências" })).getAllByRole("listitem")).toHaveLength(1);
  expect(screen.getByRole("button", { name: /^Aptidão 1$/ })).toHaveAttribute("aria-pressed", "true");
  expect(screen.queryByRole("button", { name: /^Cadastro/ })).toBeNull();
});

test("cada pendência tem uma só ação principal, nomeada pela área, e registra de onde veio", async () => {
  const u = userEvent.setup();
  definirOrigem(null);
  render(<Pendencias itens={[semAptidao]} />);
  const abrir = screen.getByRole("link", { name: "Abrir em Aptidão" });
  expect(abrir).toHaveAttribute("href", "#/painel/aptidao/risco");
  await u.click(abrir);
  expect(lerOrigem()?.titulo).toBe(semAptidao.titulo);
  expect(screen.queryByRole("link", { name: /^Ver (na|no|nas|em) / })).toBeNull();
});

test("a faixa sem valor também tem a ação principal da área", () => {
  const semValorDeCadastro: Pendencia = { ...semValor, id: "hab", tipo: "habilitacao_sem_producao", titulo: "Habilitação sem produção" };
  render(<Pendencias itens={[semValorDeCadastro]} />);
  expect(screen.getByRole("link", { name: "Abrir em Cadastro" })).toHaveAttribute("href", "#/painel/cadastro/habilitacoes");
});
