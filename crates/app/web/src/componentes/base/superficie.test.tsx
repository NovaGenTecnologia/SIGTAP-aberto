import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Abas } from "./Abas";
import { Dialogo } from "./Dialogo";
import { Menu } from "./Menu";
import { ProvedorDeAvisos, useAvisos } from "./Avisos";

test("Abas troca de painel com as setas", async () => {
  const u = userEvent.setup();
  render(<Abas rotulo="Ficha" abas={[{ id: "a", rotulo: "Resumo", conteudo: "Texto A" }, { id: "b", rotulo: "Histórico", conteudo: "Texto B" }]} />);
  expect(screen.getByRole("tabpanel")).toHaveTextContent("Texto A");
  await u.tab();
  await u.keyboard("{ArrowRight}");
  expect(screen.getByRole("tab", { name: "Histórico" })).toHaveAttribute("aria-selected", "true");
  expect(screen.getByRole("tabpanel")).toHaveTextContent("Texto B");
});

test("Dialogo é modal, tem título acessível e fecha com Esc", async () => {
  const u = userEvent.setup();
  const aoFechar = vi.fn();
  render(<Dialogo titulo="Sobre" aberto aoFechar={aoFechar}>Conteúdo</Dialogo>);
  expect(screen.getByRole("dialog", { name: "Sobre" })).toBeInTheDocument();
  await u.keyboard("{Escape}");
  expect(aoFechar).toHaveBeenCalled();
});

test("Menu abre por teclado e devolve o item escolhido", async () => {
  const u = userEvent.setup();
  const aoEscolher = vi.fn();
  render(<Menu rotulo="Unidades" itens={[{ id: "1", rotulo: "Hospital A" }, { id: "2", rotulo: "Hospital B" }]} aoEscolher={aoEscolher}>Unidade</Menu>);
  await u.tab();
  await u.keyboard("{Enter}");
  await u.click(await screen.findByRole("menuitem", { name: "Hospital B" }));
  expect(aoEscolher).toHaveBeenCalledWith("2");
});

function Disparador() {
  const { avisar } = useAvisos();
  return <button onClick={() => avisar("Concluído", "ok")}>Avisar</button>;
}

test("Avisos usa região de status e some depois de 6 s", async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  const u = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
  render(<ProvedorDeAvisos><Disparador /></ProvedorDeAvisos>);
  await u.click(screen.getByRole("button", { name: "Avisar" }));
  expect(screen.getByRole("status")).toHaveTextContent("Concluído");
  act(() => { vi.advanceTimersByTime(6100); });
  expect(screen.getByRole("status")).not.toHaveTextContent("Concluído");
  vi.useRealTimers();
});
