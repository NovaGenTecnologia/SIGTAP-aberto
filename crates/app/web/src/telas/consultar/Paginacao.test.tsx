import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ApoioRecolhido } from "./ApoioRecolhido";
import { Paginacao } from "./Paginacao";

describe("Paginacao", () => {
  test("237 itens: 3 páginas, faixa da 1ª e da última", () => {
    const { rerender } = render(<Paginacao pagina={1} paginas={3} total={237} aoIr={() => {}} />);
    expect(screen.getByText("1–100 de 237 procedimentos")).toBeInTheDocument();
    expect(screen.getByRole("navigation", { name: "Paginação" })).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /^Página \d$/ })).toHaveLength(3);
    rerender(<Paginacao pagina={3} paginas={3} total={237} aoIr={() => {}} />);
    expect(screen.getByText("201–237 de 237 procedimentos")).toBeInTheDocument();
  });

  test("a página atual é marcada e a anterior fica desativada na primeira", () => {
    render(<Paginacao pagina={1} paginas={3} total={237} aoIr={() => {}} />);
    expect(screen.getByRole("button", { name: "Página 1" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("button", { name: "Página 2" })).not.toHaveAttribute("aria-current");
    expect(screen.getByRole("button", { name: "Página anterior" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Próxima página" })).toBeEnabled();
  });

  test("a próxima fica desativada na última", () => {
    render(<Paginacao pagina={3} paginas={3} total={237} aoIr={() => {}} />);
    expect(screen.getByRole("button", { name: "Próxima página" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Página anterior" })).toBeEnabled();
  });

  test("clicar num número, na anterior e na próxima chama aoIr", async () => {
    const u = userEvent.setup();
    const aoIr = vi.fn();
    render(<Paginacao pagina={2} paginas={3} total={237} aoIr={aoIr} />);
    await u.click(screen.getByRole("button", { name: "Página 3" }));
    expect(aoIr).toHaveBeenLastCalledWith(3);
    await u.click(screen.getByRole("button", { name: "Página anterior" }));
    expect(aoIr).toHaveBeenLastCalledWith(1);
    await u.click(screen.getByRole("button", { name: "Próxima página" }));
    expect(aoIr).toHaveBeenLastCalledWith(3);
  });

  test("a página atual não é um botão que navega para si mesma", async () => {
    const u = userEvent.setup();
    const aoIr = vi.fn();
    render(<Paginacao pagina={2} paginas={3} total={237} aoIr={aoIr} />);
    await u.click(screen.getByRole("button", { name: "Página 2" }));
    expect(aoIr).not.toHaveBeenCalled();
  });

  test("uma página só: não aparece", () => {
    const { container } = render(<Paginacao pagina={1} paginas={1} total={79} aoIr={() => {}} />);
    expect(container).toBeEmptyDOMElement();
  });

  test("muitas páginas mostram a primeira, a vizinhança e a última", () => {
    render(<Paginacao pagina={12} paginas={25} total={2455} aoIr={() => {}} />);
    const numeros = screen.getAllByRole("button", { name: /^Página \d+$/ }).map((b) => b.textContent);
    expect(numeros).toEqual(["1", "11", "12", "13", "25"]);
    expect(screen.getAllByText("…")).toHaveLength(2);
    expect(screen.getByText("1.101–1.200 de 2.455 procedimentos")).toBeInTheDocument();
  });

  test("perto das pontas não deixa buraco de uma página", () => {
    const { rerender } = render(<Paginacao pagina={2} paginas={25} total={2455} aoIr={() => {}} />);
    expect(screen.getAllByRole("button", { name: /^Página \d+$/ }).map((b) => b.textContent)).toEqual(["1", "2", "3", "4", "25"]);
    rerender(<Paginacao pagina={24} paginas={25} total={2455} aoIr={() => {}} />);
    expect(screen.getAllByRole("button", { name: /^Página \d+$/ }).map((b) => b.textContent)).toEqual(["1", "22", "23", "24", "25"]);
  });

  test("até 7 páginas aparecem todas", () => {
    render(<Paginacao pagina={4} paginas={7} total={650} aoIr={() => {}} />);
    expect(screen.getAllByRole("button", { name: /^Página \d+$/ })).toHaveLength(7);
    expect(screen.queryByText("…")).toBeNull();
  });
});

describe("ApoioRecolhido", () => {
  const itens = [
    { tabela: "tb_cid", colunas: ["co_cid"], codigo: ["I10"], nome: "Hipertensão", procedimentos: 4 },
    { tabela: "tb_cid", colunas: ["co_cid"], codigo: ["I11"], nome: "Doença cardíaca", procedimentos: 2 },
    { tabela: "tb_ocupacao", colunas: ["co_ocupacao"], codigo: ["225125"], nome: "Médico", procedimentos: 9 },
  ];

  test("começa recolhido, com a contagem e as tabelas na barra", () => {
    render(<ApoioRecolhido itens={itens}><p>tabela de apoio</p></ApoioRecolhido>);
    const barra = screen.getByRole("button", { name: /Apoio/ });
    expect(barra).toHaveAttribute("aria-expanded", "false");
    expect(barra).toHaveTextContent("Apoio · 3 resultados em CID e CBO");
    expect(screen.queryByText("tabela de apoio")).toBeNull();
  });

  test("Enter abre e de novo recolhe", async () => {
    const u = userEvent.setup();
    render(<ApoioRecolhido itens={itens}><p>tabela de apoio</p></ApoioRecolhido>);
    const barra = screen.getByRole("button", { name: /Apoio/ });
    barra.focus();
    await u.keyboard("{Enter}");
    expect(barra).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("tabela de apoio")).toBeInTheDocument();
    await u.keyboard("{Enter}");
    expect(screen.queryByText("tabela de apoio")).toBeNull();
  });

  test("um resultado só usa o singular; sem itens não aparece", () => {
    const { container, rerender } = render(<ApoioRecolhido itens={[itens[0]!]}><p>x</p></ApoioRecolhido>);
    expect(screen.getByRole("button", { name: /Apoio/ })).toHaveTextContent("Apoio · 1 resultado em CID");
    rerender(<ApoioRecolhido itens={[]}><p>x</p></ApoioRecolhido>);
    expect(container).toBeEmptyDOMElement();
  });

  test("pode começar aberto (só havia apoio)", () => {
    render(<ApoioRecolhido itens={itens} inicialmenteAberto><p>tabela de apoio</p></ApoioRecolhido>);
    expect(screen.getByRole("button", { name: /Apoio/ })).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("tabela de apoio")).toBeInTheDocument();
  });
});
