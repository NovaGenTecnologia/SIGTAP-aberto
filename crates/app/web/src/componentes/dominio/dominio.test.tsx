import { act, render, renderHook, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SeloDeConfianca } from "./SeloDeConfianca";
import { LinhaGuia } from "./LinhaGuia";
import { NumeroComOrigem } from "./NumeroComOrigem";
import { CartaoDePendencia } from "./CartaoDePendencia";
import { EstadoErro, EstadoVazio, CarregandoComEspera } from "./Estados";
import { useEspera } from "./useEspera";
import { FaixaDeCompetencia } from "./FaixaDeCompetencia";
import { SerieMensal } from "./SerieMensal";

test("Selo mostra texto e forma, não só cor", () => {
  const { container } = render(<SeloDeConfianca estado="nao-confirmada" />);
  expect(screen.getByText("Não confirmada")).toBeInTheDocument();
  expect(container.querySelector("svg")).toHaveAttribute("aria-hidden", "true");
});

test("LinhaGuia lista os passos em ordem e marca o último como atual", () => {
  render(<LinhaGuia passos={[{ rotulo: "Alerta" }, { rotulo: "Procedimento" }, { rotulo: "Regra" }, { rotulo: "Fonte e competência", detalhe: "SIA 07/2026" }]} />);
  const itens = screen.getAllByRole("listitem");
  expect(itens.map((i) => i.textContent)).toEqual(["Alerta", "Procedimento", "Regra", "Fonte e competênciaSIA 07/2026"]);
  expect(itens[3]).toHaveAttribute("aria-current", "step");
});

test("NumeroComOrigem abre 'De onde vem' com fonte e limites", async () => {
  const u = userEvent.setup();
  render(<NumeroComOrigem rotulo="Taxa de rejeição" valor="5,5 por 100 AIH" origem={{ fonte: "SIH (ER × RD)", competencia: "07/2026", limites: ["Só meses completos"] }} />);
  expect(screen.getByText("5,5 por 100 AIH")).toBeInTheDocument();
  await u.click(screen.getByRole("button", { name: /De onde vem: Taxa de rejeição/ }));
  const dialogo = await screen.findByRole("dialog");
  expect(dialogo).toHaveTextContent("SIH (ER × RD)");
  expect(dialogo).toHaveTextContent("07/2026");
  expect(dialogo).toHaveTextContent("Só meses completos");
});

test("CartaoDePendencia mostra valor em reais, caminho e aciona a ação", async () => {
  const u = userEvent.setup();
  const aoAcionar = vi.fn();
  render(<CartaoDePendencia titulo="Apresentado acima do aprovado" valorCentavos={137292663} gravidade="media"
    passos={[{ rotulo: "Alerta" }, { rotulo: "Procedimento" }]} acao={{ rotulo: "Ver procedimentos", aoAcionar }} />);
  expect(screen.getByText(/R\$\s*1\.372\.926,63/)).toBeInTheDocument();
  await u.click(screen.getByRole("button", { name: "Ver procedimentos" }));
  expect(aoAcionar).toHaveBeenCalled();
});

test("EstadoErro oferece tentar de novo", async () => {
  const u = userEvent.setup();
  const aoTentar = vi.fn();
  render(<EstadoErro mensagem="Não foi possível ler os dados." aoTentar={aoTentar} />);
  expect(screen.getByRole("alert")).toHaveTextContent("Não foi possível ler os dados.");
  await u.click(screen.getByRole("button", { name: "Tentar de novo" }));
  expect(aoTentar).toHaveBeenCalled();
});

test("EstadoVazio mostra título, descrição e ação", () => {
  render(<EstadoVazio titulo="Nenhuma unidade escolhida" descricao="Escolha a unidade." acao={{ rotulo: "Escolher", aoAcionar: () => {} }} />);
  expect(screen.getByRole("heading", { name: "Nenhuma unidade escolhida" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Escolher" })).toBeInTheDocument();
});

test("useEspera: contador a partir de 2 s e aviso a partir de 8 s; reinicia ao desativar", () => {
  vi.useFakeTimers();
  const { result, rerender } = renderHook(({ ativo }) => useEspera(ativo), { initialProps: { ativo: true } });
  expect(result.current).toMatchObject({ contador: false, aviso: false });
  act(() => { vi.advanceTimersByTime(2000); });
  expect(result.current).toMatchObject({ contador: true, aviso: false, segundos: 2 });
  act(() => { vi.advanceTimersByTime(6000); });
  expect(result.current).toMatchObject({ contador: true, aviso: true, segundos: 8 });
  rerender({ ativo: false });
  expect(result.current).toMatchObject({ contador: false, aviso: false, segundos: 0 });
  vi.useRealTimers();
});

test("CarregandoComEspera usa região ocupada e mostra 'Ainda em andamento' depois de 8 s", () => {
  vi.useFakeTimers();
  render(<CarregandoComEspera rotulo="Carregando a ficha" />);
  expect(screen.getByRole("status")).toHaveAttribute("aria-busy", "true");
  expect(screen.queryByText("Ainda em andamento")).not.toBeInTheDocument();
  act(() => { vi.advanceTimersByTime(8100); });
  expect(screen.getByText("Ainda em andamento")).toBeInTheDocument();
  vi.useRealTimers();
});

test("FaixaDeCompetencia seleciona por teclado", async () => {
  const u = userEvent.setup();
  const aoSelecionar = vi.fn();
  render(<FaixaDeCompetencia competencias={[{ competencia: "202608", rotulo: "08/2026" }, { competencia: "202609", rotulo: "09/2026" }]} selecionada="202608" aoSelecionar={aoSelecionar} />);
  await u.tab();
  await u.keyboard("{ArrowRight}");
  expect(aoSelecionar).toHaveBeenCalledWith("202609");
});

test("SerieMensal descreve os pontos e marca o mês incompleto", () => {
  render(<SerieMensal rotulo="Valor aprovado por mês" formatar={(v) => `R$ ${v}`} pontos={[{ competencia: "202606", valor: 100, completo: true }, { competencia: "202607", valor: 40, completo: false }]} />);
  expect(screen.getByRole("img", { name: /Valor aprovado por mês/ })).toBeInTheDocument();
  expect(screen.getByText(/07\/2026.*mês incompleto/i)).toBeInTheDocument();
});

test("SerieMensal dá a cada barra o mês e o valor para quem passa o mouse", () => {
  const { container } = render(<SerieMensal rotulo="Valor aprovado por mês" formatar={(v) => `R$ ${v}`} pontos={[{ competencia: "202606", valor: 100, completo: true }, { competencia: "202607", valor: 40, completo: false }]} />);
  expect([...container.querySelectorAll("rect > title")].map((t) => t.textContent)).toEqual(["06/2026: R$ 100", "07/2026: R$ 40 (incompleto)"]);
});

test("CarregandoComEspera mostra o símbolo animado e continua anunciando o rótulo", () => {
  const { container } = render(<CarregandoComEspera rotulo="Carregando dados" />);
  expect(screen.getByRole("status", { name: "Carregando dados" })).toBeInTheDocument();
  expect(container.querySelector("svg.marca--carregando")).toHaveAttribute("aria-hidden", "true");
});

test("CarregandoComEspera sem indicador não repete a marca", () => {
  const { container } = render(<CarregandoComEspera rotulo="Abrindo o programa" semIndicador />);
  expect(container.querySelector("svg")).toBeNull();
});
