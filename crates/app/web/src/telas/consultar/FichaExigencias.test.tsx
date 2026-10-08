import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Ficha, NomeDeCodigo } from "../../api/tipos";
import { campo, fichaDeExemplo, linha, nome, relacao } from "./exemplos";
import * as comandos from "../../api/comandos";
import { FichaExigencias } from "./FichaExigencias";

vi.mock("../../api/comandos");
const m = vi.mocked(comandos);

function montar(f: Ficha = fichaDeExemplo(), secao?: string) {
  window.location.hash = "#/consultar/0301010072/exigencias";
  return render(<FichaExigencias ficha={f} secao={secao} />);
}

const compativel = (cod: string, nomeProc: string) => linha(
  [campo("co_procedimento_principal", "0301010072"), campo("co_procedimento_compativel", cod), campo("tp_compatibilidade", "1", { descricao: "Compatível", situacao: "oficial" })],
  [nome("tb_procedimento", "co_procedimento_compativel", { no_procedimento: nomeProc })]);

function comCompativeis(n: number): Ficha {
  const f = fichaDeExemplo();
  f.relacoes.push(relacao("rl_procedimento_compativel", "co_procedimento_principal", Array.from({ length: n }, (_, i) => compativel(`0301${String(1000000 + i).slice(1)}`, `Procedimento ${i}`))));
  return f;
}

test("grupos e seções: nome com contagem, recolhidas por padrão; vazias numa linha final", async () => {
  const u = userEvent.setup();
  montar(fichaDeExemplo({ cids: 3 }));
  for (const g of ["Exigências para cobrar", "Valores e regras"]) expect(screen.getByRole("heading", { name: g })).toBeInTheDocument();
  const cbo = screen.getByRole("button", { name: /^CBO/ });
  expect(cbo).toHaveTextContent("69");
  expect(cbo).toHaveAttribute("aria-expanded", "false");
  expect(screen.getByRole("button", { name: /^CID/ })).toHaveTextContent("3");
  const vazias = screen.getByRole("button", { name: /Sem linhas nesta competência \(\d+\)/ });
  expect(vazias).toHaveAttribute("aria-expanded", "false");
  await u.click(vazias);
  expect(screen.getByText("Habilitação")).toBeVisible();
});

test("abrir uma seção mostra a tabela com código e nome; ordenar pelo cabeçalho", async () => {
  const u = userEvent.setup();
  montar();
  await u.click(screen.getByRole("button", { name: /^CBO/ }));
  const tabela = await screen.findByRole("grid", { name: "CBO" });
  expect(within(tabela).getByText("223100")).toBeInTheDocument();
  expect(within(tabela).getByText("Ocupação 0")).toBeInTheDocument();
  const cab = within(tabela).getByRole("columnheader", { name: /CBO/ });
  await u.click(cab);
  await u.click(cab);
  expect(within(tabela).getAllByRole("row")[1]).toHaveTextContent("223168");
});

test("filtro reduz as linhas e a contagem avisa", async () => {
  const u = userEvent.setup();
  montar();
  await u.click(screen.getByRole("button", { name: /^CBO/ }));
  const filtro = await screen.findByRole("searchbox", { name: "Filtrar CBO" });
  await u.type(filtro, "ocupacao 12");
  await waitFor(() => expect(screen.getByText("1 de 69 linhas")).toBeInTheDocument());
  expect(within(screen.getByRole("grid", { name: "CBO" })).getByText("Ocupação 12")).toBeInTheDocument();
});

test("a seção da rota abre sozinha e recebe o foco; a chave pode ser a tabela", async () => {
  montar(fichaDeExemplo(), "rl_procedimento_ocupacao");
  const botao = screen.getByRole("button", { name: /^CBO/ });
  expect(botao).toHaveAttribute("aria-expanded", "true");
  await waitFor(() => expect(botao).toHaveFocus());
  expect(await screen.findByRole("grid", { name: "CBO" })).toBeInTheDocument();
});

test("código de outro procedimento é link para a ficha dele", async () => {
  const u = userEvent.setup();
  montar(comCompativeis(3));
  await u.click(screen.getByRole("button", { name: /^Compatíveis/ }));
  const tabela = await screen.findByRole("grid", { name: "Compatíveis" });
  await u.click(within(tabela).getAllByRole("link")[0]!);
  expect(window.location.hash).toMatch(/^#\/consultar\/\d{10}$/);
});

// jsdom não calcula layout: sem tamanho, o virtualizador não tem janela para recortar. Damos 800 x 400 aos elementos.
function comLayout() {
  const medidas = { clientHeight: 400, clientWidth: 800, offsetHeight: 400, offsetWidth: 800 } as const;
  const originais = Object.entries(medidas).map(([k]) => [k, Object.getOwnPropertyDescriptor(HTMLElement.prototype, k)] as const);
  for (const [k, v] of Object.entries(medidas)) Object.defineProperty(HTMLElement.prototype, k, { configurable: true, get: () => v });
  const rect = vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({ x: 0, y: 0, top: 0, left: 0, right: 800, bottom: 400, width: 800, height: 400, toJSON: () => ({}) });
  return () => { rect.mockRestore(); for (const [k, d] of originais) { if (d) Object.defineProperty(HTMLElement.prototype, k, d); else delete (HTMLElement.prototype as unknown as Record<string, unknown>)[k]; } };
}

test("relação com 5000 linhas monta só o que cabe e a seta para baixo percorre", async () => {
  const restaurar = comLayout();
  const u = userEvent.setup({ delay: null });
  montar(comCompativeis(5000));
  await u.click(screen.getByRole("button", { name: /^Compatíveis/ }));
  const tabela = await screen.findByRole("grid", { name: "Compatíveis" });
  expect(within(tabela).getAllByRole("row").length).toBeLessThan(60);
  within(tabela).getAllByRole("row")[1]!.focus();
  await u.keyboard("{ArrowDown}{ArrowDown}");
  expect(screen.getByText("5.000 linhas")).toBeInTheDocument();
  restaurar();
}, 30000);

test("texto oficial abre sob demanda; nome ausente diz o motivo", async () => {
  const u = userEvent.setup();
  const f = fichaDeExemplo({ cbos: 0 });
  const ds: NomeDeCodigo = nome("tb_descricao_ocupacao", "co_ocupacao", { ds_ocupacao: "Descrição longa da ocupação." });
  const semNome: NomeDeCodigo = { tabela: "tb_ocupacao", colunas: ["co_ocupacao"], tabela_presente: true, encontrados: [] };
  f.relacoes.find((r) => r.tabela === "rl_procedimento_ocupacao")!.linhas = [
    linha([campo("co_procedimento", "0301010072"), campo("co_ocupacao", "225125")], [nome("tb_ocupacao", "co_ocupacao", { no_ocupacao: "Médico clínico" }), ds]),
    linha([campo("co_procedimento", "0301010072"), campo("co_ocupacao", "999999")], [semNome]),
  ];
  montar(f, "rl_procedimento_ocupacao");
  expect(await screen.findByText("sem nome nesta competência")).toBeInTheDocument();
  await u.click(screen.getByRole("button", { name: "Texto oficial" }));
  expect(await screen.findByText("Descrição longa da ocupação.")).toBeInTheDocument();
});

test("Exportar a seção leva todas as linhas, mesmo com o filtro ativo", async () => {
  const u = userEvent.setup();
  m.exportar.mockResolvedValue("C:/x/CBO.xlsx");
  montar();
  await u.click(screen.getByRole("button", { name: /^CBO/ }));
  await u.type(await screen.findByRole("searchbox", { name: "Filtrar CBO" }), "ocupacao 12");
  await waitFor(() => expect(screen.getByText("1 de 69 linhas")).toBeInTheDocument());
  await u.click(screen.getByRole("button", { name: "Exportar" }));
  await waitFor(() => expect(m.exportar).toHaveBeenCalledTimes(1));
  const [planilha] = m.exportar.mock.calls[0]!;
  expect(planilha.abas[0]!.linhas).toHaveLength(69);
  expect(planilha.abas[0]!.colunas.some((c) => c.endsWith("(código)"))).toBe(true);
  expect(await screen.findByText("Planilha salva com 69 linhas.")).toBeInTheDocument();
});
