import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import type { ItemMarcado } from "../../api/tipos";
import { guardarPesquisa } from "../../dados/pesquisasRecentes";
import * as marcadosMod from "../../dados/marcados";
import { CampoDeConsulta } from "./CampoDeConsulta";

vi.mock("../../dados/marcados");

const favorito = (codigo: string, nome: string, extra: Partial<ItemMarcado> = {}): ItemMarcado =>
  ({ tipo: "procedimento", codigo, favorito: true, favorito_desde: null, anotacao: null, anotacao_de: null, existe: true, nome, ...extra });

function usarMarcados(itens: ItemMarcado[]) {
  vi.mocked(marcadosMod.useMarcados).mockReturnValue({ data: itens } as ReturnType<typeof marcadosMod.useMarcados>);
}

function montar(inicial = "") {
  const aoMudar = vi.fn();
  const aoEscolherRecente = vi.fn();
  const aoAbrirFavorito = vi.fn();
  const aoEnviar = vi.fn();
  function Pai() {
    const [valor, setValor] = useState(inicial);
    return (
      <>
        <CampoDeConsulta valor={valor} aoMudar={(t) => { setValor(t); aoMudar(t); }} aoEscolherRecente={aoEscolherRecente}
          aoAbrirFavorito={aoAbrirFavorito} aoEnviar={aoEnviar} />
        <button>Depois do campo</button>
      </>
    );
  }
  render(<Pai />);
  return { aoMudar, aoEscolherRecente, aoAbrirFavorito, aoEnviar, campo: () => screen.getByRole("combobox", { name: "Buscar" }) };
}

beforeEach(() => {
  window.localStorage.clear();
  vi.resetAllMocks();
  usarMarcados([]);
});

test("com recentes e favorito, clicar no campo vazio mostra os dois grupos e nada de exemplos", async () => {
  const u = userEvent.setup();
  guardarPesquisa("hospital");
  guardarPesquisa("0301010072");
  usarMarcados([favorito("0301010048", "Consulta de profissionais de nível superior")]);
  const { campo } = montar();
  await u.click(campo());
  const lista = screen.getByRole("listbox");
  expect(campo()).toHaveAttribute("aria-expanded", "true");
  expect(campo()).toHaveAttribute("aria-controls", lista.id);
  expect(screen.getByText("Pesquisas recentes")).toBeInTheDocument();
  expect(screen.getByText("Favoritos")).toBeInTheDocument();
  const opcoes = within(lista).getAllByRole("option");
  expect(opcoes.map((o) => o.textContent)).toEqual([
    "0301010072", "hospital", "03.01.01.004-8Consulta de profissionais de nível superior",
  ]);
  expect(screen.queryByText(/exemplos/i)).toBeNull();
  expect(screen.getByRole("button", { name: "Limpar histórico" })).toBeInTheDocument();
});

test("a primeira opção fica ativa; as setas movem e o aria-activedescendant acompanha", async () => {
  const u = userEvent.setup();
  guardarPesquisa("hospital");
  guardarPesquisa("consulta");
  const { campo } = montar();
  await u.click(campo());
  const opcoes = screen.getAllByRole("option");
  expect(opcoes[0]).toHaveAttribute("aria-selected", "true");
  expect(campo()).toHaveAttribute("aria-activedescendant", opcoes[0]!.id);
  await u.keyboard("{ArrowDown}");
  expect(opcoes[1]).toHaveAttribute("aria-selected", "true");
  expect(campo()).toHaveAttribute("aria-activedescendant", opcoes[1]!.id);
  await u.keyboard("{ArrowDown}{ArrowDown}");
  expect(opcoes[1]).toHaveAttribute("aria-selected", "true"); // não passa do fim
  await u.keyboard("{ArrowUp}");
  expect(opcoes[0]).toHaveAttribute("aria-selected", "true");
});

test("Enter numa pesquisa recente a escolhe; no favorito abre a ficha", async () => {
  const u = userEvent.setup();
  guardarPesquisa("hospital");
  guardarPesquisa("0301010072");
  usarMarcados([favorito("0301010048", "Consulta de profissionais de nível superior")]);
  const { campo, aoEscolherRecente, aoAbrirFavorito } = montar();
  await u.click(campo());
  await u.keyboard("{ArrowDown}{Enter}");
  expect(aoEscolherRecente).toHaveBeenCalledWith("hospital");
  expect(screen.queryByRole("listbox")).toBeNull();
  await u.click(campo());
  await u.keyboard("{ArrowDown}{ArrowDown}{Enter}");
  expect(aoAbrirFavorito).toHaveBeenCalledWith("0301010048");
});

test("clicar numa opção funciona sem tirar o foco do campo", async () => {
  const u = userEvent.setup();
  guardarPesquisa("hospital");
  const { campo, aoEscolherRecente } = montar();
  await u.click(campo());
  await u.click(screen.getByRole("option", { name: "hospital" }));
  expect(aoEscolherRecente).toHaveBeenCalledWith("hospital");
  expect(campo()).toHaveFocus();
});

test("Limpar histórico zera as recentes; sobrando só favoritos, a lista continua", async () => {
  const u = userEvent.setup();
  guardarPesquisa("hospital");
  usarMarcados([favorito("0301010048", "Consulta de profissionais")]);
  const { campo } = montar();
  await u.click(campo());
  await u.click(screen.getByRole("button", { name: "Limpar histórico" }));
  expect(screen.queryByText("Pesquisas recentes")).toBeNull();
  expect(screen.getByText("Favoritos")).toBeInTheDocument();
  expect(window.localStorage.getItem("sa.pesquisas.v1")).toBeNull();
});

test("Limpar histórico sem favoritos fecha a lista", async () => {
  const u = userEvent.setup();
  guardarPesquisa("hospital");
  const { campo } = montar();
  await u.click(campo());
  await u.click(screen.getByRole("button", { name: "Limpar histórico" }));
  expect(screen.queryByRole("listbox")).toBeNull();
  expect(campo()).toHaveAttribute("aria-expanded", "false");
});

test("digitar fecha a lista e avisa o texto", async () => {
  const u = userEvent.setup();
  guardarPesquisa("hospital");
  const { campo, aoMudar } = montar();
  await u.click(campo());
  expect(screen.getByRole("listbox")).toBeInTheDocument();
  await u.keyboard("co");
  expect(screen.queryByRole("listbox")).toBeNull();
  expect(aoMudar).toHaveBeenLastCalledWith("co");
});

test("Esc fecha a lista e o foco fica no campo", async () => {
  const u = userEvent.setup();
  guardarPesquisa("hospital");
  const { campo } = montar();
  await u.click(campo());
  await u.keyboard("{Escape}");
  expect(screen.queryByRole("listbox")).toBeNull();
  expect(campo()).toHaveFocus();
  expect(campo()).toHaveAttribute("aria-expanded", "false");
});

test("campo vazio sem recentes nem favoritos não abre nada", async () => {
  const u = userEvent.setup();
  const { campo } = montar();
  await u.click(campo());
  expect(screen.queryByRole("listbox")).toBeNull();
  expect(campo()).toHaveAttribute("aria-expanded", "false");
});

test("favoritos que não existem na competência não aparecem; no máximo 3", async () => {
  const u = userEvent.setup();
  usarMarcados([
    favorito("0301010001", "Um"), favorito("0301010002", "Dois"), favorito("0301010003", "Três"),
    favorito("0301010004", "Quatro"), favorito("0301010005", "Sumiu", { existe: false }),
    favorito("0301010006", "Só anotado", { favorito: false, anotacao: "x" }),
  ]);
  const { campo } = montar();
  await u.click(campo());
  expect(screen.getAllByRole("option")).toHaveLength(3);
  expect(screen.queryByText("Sumiu")).toBeNull();
});

test("com texto no campo, focar não abre a lista; apagar o texto e focar de novo, sim", async () => {
  const u = userEvent.setup();
  guardarPesquisa("hospital");
  const { campo } = montar("consulta");
  await u.click(campo());
  expect(screen.queryByRole("listbox")).toBeNull();
  await u.clear(campo());
  expect(screen.queryByRole("listbox")).not.toBeNull();
});

test("Enter sem opção ativa (lista fechada) envia o texto", async () => {
  const u = userEvent.setup();
  const { campo, aoEnviar } = montar();
  await u.click(campo());
  await u.keyboard("consulta{Enter}");
  expect(aoEnviar).toHaveBeenCalledWith("consulta");
});

test("o botão × limpa o texto e devolve o foco ao campo", async () => {
  const u = userEvent.setup();
  const { campo, aoMudar } = montar("consulta");
  await u.click(screen.getByRole("button", { name: "Limpar busca" }));
  expect(aoMudar).toHaveBeenLastCalledWith("");
  expect(campo()).toHaveFocus();
});

test("foca sozinho quando pedido", () => {
  function Pai() { return <CampoDeConsulta valor="" aoMudar={() => {}} aoEscolherRecente={() => {}} aoAbrirFavorito={() => {}} autoFoco />; }
  render(<Pai />);
  expect(screen.getByRole("combobox", { name: "Buscar" })).toHaveFocus();
});
