import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Botao } from "./Botao";
import { CampoTexto } from "./CampoTexto";
import { CampoBusca } from "./CampoBusca";
import { Selecao } from "./Selecao";
import { Interruptor } from "./Interruptor";
import { Progresso } from "./Progresso";

test("Botao dispara onPress por teclado e fica inerte quando carregando", async () => {
  const u = userEvent.setup();
  const aoApertar = vi.fn();
  const { rerender } = render(<Botao onPress={aoApertar}>Salvar</Botao>);
  await u.tab();
  await u.keyboard("{Enter}");
  expect(aoApertar).toHaveBeenCalledTimes(1);
  rerender(<Botao onPress={aoApertar} carregando>Salvar</Botao>);
  const ocupado = screen.getByRole("button", { name: "Salvar" });
  expect(ocupado).toHaveAttribute("aria-disabled", "true");
  expect(ocupado).toHaveAttribute("data-pending");
  await u.click(ocupado);
  expect(aoApertar).toHaveBeenCalledTimes(1);
});

test("CampoTexto liga rótulo, descrição e erro ao campo", () => {
  render(<CampoTexto rotulo="CNES" descricao="7 dígitos" erro="Informe 7 dígitos" isInvalid />);
  const campo = screen.getByRole("textbox", { name: "CNES" });
  expect(campo).toHaveAccessibleDescription(/7 dígitos/);
  expect(campo).toBeInvalid();
});

test("CampoBusca limpa com o botão e anuncia o rótulo", async () => {
  const u = userEvent.setup();
  render(<CampoBusca rotulo="Buscar procedimento" defaultValue="consulta" />);
  expect(screen.getByRole("searchbox", { name: "Buscar procedimento" })).toHaveValue("consulta");
  await u.click(screen.getByRole("button", { name: /limpar/i }));
  expect(screen.getByRole("searchbox")).toHaveValue("");
});

test("Selecao abre a lista e escolhe por teclado", async () => {
  const u = userEvent.setup();
  const aoMudar = vi.fn();
  render(<Selecao rotulo="UF" itens={[{ id: "MS", rotulo: "Mato Grosso do Sul" }, { id: "SP", rotulo: "São Paulo" }]} onSelectionChange={aoMudar} />);
  await u.click(screen.getByRole("button", { name: /UF/ }));
  await u.click(await screen.findByRole("option", { name: "São Paulo" }));
  expect(aoMudar).toHaveBeenCalledWith("SP");
});

test("Interruptor alterna por Espaço e tem papel switch", async () => {
  const u = userEvent.setup();
  render(<Interruptor>Só o que me afeta</Interruptor>);
  const sw = screen.getByRole("switch", { name: "Só o que me afeta" });
  await u.tab();
  await u.keyboard(" ");
  expect(sw).toBeChecked();
});

test("Progresso determinado expõe o valor e indeterminado não", () => {
  const { rerender } = render(<Progresso rotulo="Download" valor={40} />);
  expect(screen.getByRole("progressbar", { name: "Download" })).toHaveAttribute("aria-valuenow", "40");
  rerender(<Progresso rotulo="Download" />);
  expect(screen.getByRole("progressbar", { name: "Download" })).not.toHaveAttribute("aria-valuenow");
});
