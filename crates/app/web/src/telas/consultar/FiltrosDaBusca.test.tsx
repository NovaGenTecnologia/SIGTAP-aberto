import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Facetas } from "../../api/tipos";
import { FILTROS_NA_ROTA_VAZIOS, type FiltrosNaRota } from "../../shell/rotas";
import { ChipsDeFiltro, FiltrosDaBusca } from "./FiltrosDaBusca";

const facetas: Facetas = {
  tipo: [{ valor: "procedimento", rotulo: "Procedimentos", n: 237 }, { valor: "tb_cid", rotulo: null, n: 3 }, { valor: "tb_ocupacao", rotulo: null, n: 2 }],
  complexidade: [
    { valor: "1", rotulo: "Atenção Básica Complexidade", n: 21 },
    { valor: "2", rotulo: "Média Complexidade", n: 79 },
    { valor: "3", rotulo: "Alta Complexidade", n: 9 },
  ],
  instrumento: [{ valor: "BPA (Individualizado)", rotulo: null, n: 60 }, { valor: "BPA (Consolidado)", rotulo: null, n: 40 }],
  grupo: [{ valor: "03", rotulo: "Procedimentos clínicos", n: 100 }, { valor: "02", rotulo: "Procedimentos com finalidade diagnóstica", n: 50 }],
  forma: [{ valor: "030101", rotulo: "Consultas médicas e de outros profissionais", n: 30 }],
};

function montar(filtros: FiltrosNaRota = FILTROS_NA_ROTA_VAZIOS, extra: { favoritosDisponiveis?: boolean; total?: number } = {}) {
  const aoMudar = vi.fn();
  render(<FiltrosDaBusca facetas={facetas} filtros={filtros} aoMudar={aoMudar} favoritosDisponiveis={extra.favoritosDisponiveis ?? true} total={extra.total ?? 237} />);
  return { aoMudar };
}

test("mostra Tipo, Complexidade e Instrumento com a contagem de cada opção", () => {
  montar();
  const tipo = screen.getAllByRole("group", { name: "Tipo" })[0]!;
  expect(within(tipo).getByRole("checkbox", { name: "Procedimentos 237" })).toBeInTheDocument();
  expect(within(tipo).getByRole("checkbox", { name: "CID 3" })).toBeInTheDocument();
  expect(within(tipo).getByRole("checkbox", { name: "CBO 2" })).toBeInTheDocument();
  const cx = screen.getAllByRole("group", { name: "Complexidade" })[0]!;
  expect(within(cx).getByRole("checkbox", { name: "Atenção Básica 21" })).toBeInTheDocument();
  expect(within(cx).getByRole("checkbox", { name: "Média 79" })).toBeInTheDocument();
  expect(within(cx).getByRole("checkbox", { name: "Alta 9" })).toBeInTheDocument();
  const ins = screen.getAllByRole("group", { name: "Instrumento" })[0]!;
  expect(within(ins).getByRole("checkbox", { name: "BPA (Individualizado) 60" })).toBeInTheDocument();
});

test("marcar Média avisa a complexidade 2; desmarcar tira", async () => {
  const u = userEvent.setup();
  const { aoMudar } = montar();
  await u.click(screen.getAllByRole("checkbox", { name: "Média 79" })[0]!);
  expect(aoMudar).toHaveBeenCalledWith({ ...FILTROS_NA_ROTA_VAZIOS, complexidade: ["2"] });
});

test("desmarcar uma opção marcada a tira da lista", async () => {
  const u = userEvent.setup();
  const { aoMudar } = montar({ ...FILTROS_NA_ROTA_VAZIOS, complexidade: ["2", "3"] });
  expect(screen.getAllByRole("checkbox", { name: "Média 79" })[0]).toBeChecked();
  await u.click(screen.getAllByRole("checkbox", { name: "Média 79" })[0]!);
  expect(aoMudar).toHaveBeenCalledWith({ ...FILTROS_NA_ROTA_VAZIOS, complexidade: ["3"] });
});

test("Grupo e Forma começam recolhidos e abrem pelo botão", async () => {
  const u = userEvent.setup();
  const { aoMudar } = montar();
  const grupo = screen.getAllByRole("button", { name: "Grupo" })[0]!;
  expect(grupo).toHaveAttribute("aria-expanded", "false");
  expect(screen.queryByRole("checkbox", { name: /Procedimentos clínicos/ })).toBeNull();
  await u.click(grupo);
  expect(grupo).toHaveAttribute("aria-expanded", "true");
  await u.click(screen.getByRole("checkbox", { name: "03 Procedimentos clínicos 100" }));
  expect(aoMudar).toHaveBeenCalledWith({ ...FILTROS_NA_ROTA_VAZIOS, grupo: ["03"] });
  const forma = screen.getAllByRole("button", { name: "Forma de organização" })[0]!;
  expect(forma).toHaveAttribute("aria-expanded", "false");
});

test("um grupo com seleção começa aberto", () => {
  montar({ ...FILTROS_NA_ROTA_VAZIOS, forma: ["030101"] });
  expect(screen.getAllByRole("button", { name: /^Forma de organização/ })[0]).toHaveAttribute("aria-expanded", "true");
  expect(screen.getByRole("checkbox", { name: "03.01.01 Consultas médicas e de outros profissionais 30" })).toBeChecked();
});

test("sem filtro não há Limpar (N)", () => {
  const sem = montar();
  expect(screen.queryByRole("button", { name: /^Limpar/ })).toBeNull();
  expect(sem.aoMudar).not.toHaveBeenCalled();
});

test("Limpar (2) conta as opções marcadas e zera todos os filtros", async () => {
  const u = userEvent.setup();
  const { aoMudar } = montar({ ...FILTROS_NA_ROTA_VAZIOS, complexidade: ["2"], instrumento: ["BPA (Consolidado)"] });
  await u.click(screen.getAllByRole("button", { name: "Limpar (2)" })[0]!);
  expect(aoMudar).toHaveBeenCalledWith(FILTROS_NA_ROTA_VAZIOS);
});

test("Só favoritos aparece quando há favoritos e liga o filtro", async () => {
  const u = userEvent.setup();
  const { aoMudar } = montar();
  await u.click(screen.getAllByRole("switch", { name: "Só favoritos" })[0]!);
  expect(aoMudar).toHaveBeenCalledWith({ ...FILTROS_NA_ROTA_VAZIOS, fav: true });
});

test("sem favoritos a chave Só favoritos não aparece", () => {
  montar(FILTROS_NA_ROTA_VAZIOS, { favoritosDisponiveis: false });
  expect(screen.queryByRole("switch", { name: "Só favoritos" })).toBeNull();
});

test("o botão Filtros N abre o painel; Esc fecha e o foco volta ao botão", async () => {
  const u = userEvent.setup();
  montar({ ...FILTROS_NA_ROTA_VAZIOS, complexidade: ["2"], instrumento: ["BPA (Consolidado)"] });
  const botao = screen.getByRole("button", { name: "Filtros 2" });
  await u.click(botao);
  const painel = screen.getByRole("dialog", { name: "Filtros" });
  expect(within(painel).getByRole("button", { name: "Ver 237 resultados" })).toBeInTheDocument();
  expect(within(painel).getByRole("button", { name: "Limpar" })).toBeInTheDocument();
  await u.keyboard("{Escape}");
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(botao).toHaveFocus();
});

test("no painel, marcar uma opção avisa na hora e Ver N resultados fecha", async () => {
  const u = userEvent.setup();
  const { aoMudar } = montar();
  await u.click(screen.getByRole("button", { name: "Filtros" }));
  const painel = screen.getByRole("dialog", { name: "Filtros" });
  await u.click(within(painel).getByRole("checkbox", { name: "Alta 9" }));
  expect(aoMudar).toHaveBeenCalledWith({ ...FILTROS_NA_ROTA_VAZIOS, complexidade: ["3"] });
  await u.click(within(painel).getByRole("button", { name: "Ver 237 resultados" }));
  expect(screen.queryByRole("dialog")).toBeNull();
});

test("no painel, Limpar zera os filtros", async () => {
  const u = userEvent.setup();
  const { aoMudar } = montar({ ...FILTROS_NA_ROTA_VAZIOS, complexidade: ["2"] });
  await u.click(screen.getByRole("button", { name: "Filtros 1" }));
  await u.click(within(screen.getByRole("dialog", { name: "Filtros" })).getByRole("button", { name: "Limpar" }));
  expect(aoMudar).toHaveBeenCalledWith(FILTROS_NA_ROTA_VAZIOS);
});

describe("ChipsDeFiltro", () => {
  test("sem filtro não mostra nada", () => {
    const { container } = render(<ChipsDeFiltro facetas={facetas} filtros={FILTROS_NA_ROTA_VAZIOS} aoRemover={() => {}} aoLimparTudo={() => {}} />);
    expect(container).toBeEmptyDOMElement();
  });

  test("um chip por opção marcada; clicar remove só aquela", async () => {
    const u = userEvent.setup();
    const aoRemover = vi.fn();
    render(<ChipsDeFiltro facetas={facetas} filtros={{ ...FILTROS_NA_ROTA_VAZIOS, complexidade: ["2"], tipo: ["tb_cid"], fav: true }} aoRemover={aoRemover} aoLimparTudo={() => {}} />);
    expect(screen.getByRole("button", { name: "Remover filtro Média" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Remover filtro CID" })).toBeInTheDocument();
    await u.click(screen.getByRole("button", { name: "Remover filtro Média" }));
    expect(aoRemover).toHaveBeenCalledWith("complexidade", "2");
    await u.click(screen.getByRole("button", { name: "Remover filtro Só favoritos" }));
    expect(aoRemover).toHaveBeenLastCalledWith("fav", "");
  });

  test("Limpar filtros limpa tudo", async () => {
    const u = userEvent.setup();
    const aoLimparTudo = vi.fn();
    render(<ChipsDeFiltro facetas={facetas} filtros={{ ...FILTROS_NA_ROTA_VAZIOS, grupo: ["03"] }} aoRemover={() => {}} aoLimparTudo={aoLimparTudo} />);
    expect(screen.getByRole("button", { name: "Remover filtro Procedimentos clínicos" })).toBeInTheDocument();
    await u.click(screen.getByRole("button", { name: "Limpar filtros" }));
    expect(aoLimparTudo).toHaveBeenCalled();
  });

  test("valor que não está mais nas opções ainda aparece, com o próprio valor", () => {
    render(<ChipsDeFiltro facetas={facetas} filtros={{ ...FILTROS_NA_ROTA_VAZIOS, instrumento: ["SIA antigo"] }} aoRemover={() => {}} aoLimparTudo={() => {}} />);
    expect(screen.getByRole("button", { name: "Remover filtro SIA antigo" })).toBeInTheDocument();
  });
});
