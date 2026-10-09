import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Pendencias } from "./Pendencias";
import { queda, semAptidao, semValor } from "./exemplos";

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
