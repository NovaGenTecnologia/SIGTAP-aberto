import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TabelaDeDados, type Coluna } from "./TabelaDeDados";
import { Arvore } from "./Arvore";

interface Linha { id: string; codigo: string; valor: number }
const colunas: Coluna<Linha>[] = [
  { id: "codigo", rotulo: "Código", ordenavel: true, celula: (l) => l.codigo },
  { id: "valor", rotulo: "Valor", numerica: true, celula: (l) => l.valor },
];
const linhas: Linha[] = [{ id: "1", codigo: "0301010072", valor: 10 }, { id: "2", codigo: "0301010080", valor: 20 }];

test("TabelaDeDados expõe papel grid, cabeçalhos e linhas", () => {
  render(<TabelaDeDados rotulo="Procedimentos" colunas={colunas} linhas={linhas} />);
  const tabela = screen.getByRole("grid", { name: "Procedimentos" });
  expect(within(tabela).getAllByRole("columnheader").map((c) => c.textContent)).toEqual(["Código", "Valor"]);
  expect(within(tabela).getAllByRole("row").length).toBeGreaterThanOrEqual(3);
});

test("ordenar por teclado chama aoOrdenar com a coluna", async () => {
  const u = userEvent.setup();
  const aoOrdenar = vi.fn();
  render(<TabelaDeDados rotulo="Procedimentos" colunas={colunas} linhas={linhas} aoOrdenar={aoOrdenar} />);
  await u.click(screen.getByRole("columnheader", { name: /Código/ }));
  expect(aoOrdenar).toHaveBeenCalledWith(expect.objectContaining({ column: "codigo" }));
});

test("Arvore expande com seta direita e abre com Enter", async () => {
  const u = userEvent.setup();
  const aoAbrir = vi.fn();
  render(<Arvore rotulo="Grupos" aoAbrir={aoAbrir} itens={[{ id: "03", rotulo: "Procedimentos clínicos", filhos: [{ id: "0301", rotulo: "Consultas" }] }]} />);
  expect(screen.getByRole("treegrid", { name: "Grupos" })).toBeInTheDocument();
  const raiz = screen.getByRole("row", { name: /Procedimentos clínicos/ });
  expect(raiz).toHaveAttribute("aria-expanded", "false");
  await u.tab();
  await u.keyboard("{ArrowRight}");
  expect(screen.getByRole("row", { name: /Procedimentos clínicos/ })).toHaveAttribute("aria-expanded", "true");
  expect(screen.getByRole("row", { name: /Consultas/ })).toBeInTheDocument();
  await u.keyboard("{ArrowDown}{Enter}");
  expect(aoAbrir).toHaveBeenCalledWith("0301");
});
