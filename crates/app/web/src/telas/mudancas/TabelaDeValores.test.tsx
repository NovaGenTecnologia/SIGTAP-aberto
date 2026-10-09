import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TabelaDeValores } from "./TabelaDeValores";
import { valor } from "./exemplos";

test("mostra antes, depois, variação e impacto com sinal e texto", () => {
  render(<TabelaDeValores valores={[valor("0301010072", 1100, { impacto_unidade_anual_centavos: -250_000, unidade_produz: true, afeta: true })]} soAfeta={false} />);
  const linha = screen.getByRole("row", { name: /0301010072/ });
  expect(within(linha).getByText("+10%")).toBeInTheDocument();
  expect(within(linha).getByText(/^−R\$\s2\.500,00$/)).toBeInTheDocument();
  expect(within(linha).getByText(/^\+R\$\s5\.000,00$/)).toBeInTheDocument();
  expect(within(linha).getByText("produz")).toBeInTheDocument();
});

test("queda de valor mostra o sinal de menos na variação", () => {
  render(<TabelaDeValores valores={[valor("0301010072", 900)]} soAfeta={false} />);
  expect(screen.getByText("−10%")).toBeInTheDocument();
});

test("apta e produz aparecem juntos; quem não afeta fica sem selo", () => {
  render(<TabelaDeValores valores={[valor("1", 1100, { unidade_produz: true, unidade_apta: true, afeta: true }), valor("2", 1100)]} soAfeta={false} />);
  const a = screen.getByRole("row", { name: /PROC 1/ });
  expect(within(a).getByText("produz")).toBeInTheDocument();
  expect(within(a).getByText("apta")).toBeInTheDocument();
  const b = screen.getByRole("row", { name: /PROC 2/ });
  expect(within(b).queryByText("produz")).toBeNull();
  expect(within(b).queryByText("apta")).toBeNull();
});

test("com o filtro ligado e nenhum resultado, diz o que aconteceu", () => {
  render(<TabelaDeValores valores={[]} soAfeta />);
  expect(screen.getByText("Nada nesta mudança afeta a sua unidade")).toBeInTheDocument();
});

test("mostra dez e deixa o resto atrás de Ver mais", async () => {
  const u = userEvent.setup();
  const todos = Array.from({ length: 13 }, (_, i) => valor(String(i).padStart(10, "0"), 1100));
  render(<TabelaDeValores valores={todos} soAfeta={false} />);
  expect(screen.getAllByRole("row")).toHaveLength(11); // cabeçalho + 10
  await u.click(screen.getByRole("button", { name: "Ver mais 3 valores" }));
  expect(screen.getAllByRole("row")).toHaveLength(14);
  expect(screen.queryByRole("button", { name: /Ver mais/ })).toBeNull();
});

test("sem valor antes não inventa variação", () => {
  render(<TabelaDeValores valores={[valor("0301010072", 1100, { antes: { sa: 0, sh: 0, sp: 0 } })]} soAfeta={false} />);
  expect(screen.getByRole("row", { name: /0301010072/ })).toHaveTextContent("—");
});
