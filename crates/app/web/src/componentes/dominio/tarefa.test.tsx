import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PainelDeTarefa } from "./PainelDeTarefa";
import { ConfirmarAcao } from "./ConfirmarAcao";

const PROG = { resumo: "Fazendo download 1 de 4", mensagem: "PASP2607a.dbc", fracao: 0.25, indeterminado: false };

test("PainelDeTarefa mostra resumo, barra com nome e cancela", async () => {
  const u = userEvent.setup();
  const aoCancelar = vi.fn();
  render(<PainelDeTarefa tarefa={{ ativa: true, progresso: PROG, fim: null }} aoCancelar={aoCancelar} />);
  expect(screen.getByText("Fazendo download 1 de 4")).toBeInTheDocument();
  expect(screen.getByRole("progressbar", { name: "Fazendo download 1 de 4" })).toBeInTheDocument();
  await u.click(screen.getByRole("button", { name: "Cancelar" }));
  expect(aoCancelar).toHaveBeenCalledTimes(1);
});

test("PainelDeTarefa sem progresso ainda mostra barra indeterminada e Cancelar", () => {
  render(<PainelDeTarefa tarefa={{ ativa: true, progresso: null, fim: null }} aoCancelar={() => {}} />);
  expect(screen.getByRole("progressbar")).toBeInTheDocument();
});

test("PainelDeTarefa com erro no fim mostra a causa e Tentar de novo", async () => {
  const u = userEvent.setup();
  const aoTentarDeNovo = vi.fn();
  render(<PainelDeTarefa tarefa={{ ativa: false, progresso: null, fim: { ok: false, cancelada: false, mensagem: "sem rede" } }}
    aoCancelar={() => {}} aoTentarDeNovo={aoTentarDeNovo} />);
  expect(screen.getByRole("alert")).toHaveTextContent("sem rede");
  await u.click(screen.getByRole("button", { name: "Tentar de novo" }));
  expect(aoTentarDeNovo).toHaveBeenCalledTimes(1);
});

test("PainelDeTarefa não mostra nada sem tarefa e sem erro; cancelada não é erro", () => {
  const { container, rerender } = render(<PainelDeTarefa tarefa={{ ativa: false, progresso: null, fim: null }} aoCancelar={() => {}} />);
  expect(container).toBeEmptyDOMElement();
  rerender(<PainelDeTarefa tarefa={{ ativa: false, progresso: null, fim: { ok: false, cancelada: true, mensagem: "cancelado" } }} aoCancelar={() => {}} />);
  expect(container).toBeEmptyDOMElement();
});

function confirmar(extra = {}) {
  const aoConfirmar = vi.fn(), aoCancelar = vi.fn();
  render(<ConfirmarAcao aberto titulo="Apagar o CNES de SP?" detalhe="O banco e os arquivos guardados somem." tamanhoBytes={135774208}
    rotuloConfirmar="Apagar" perigo aoConfirmar={aoConfirmar} aoCancelar={aoCancelar} {...extra} />);
  return { aoConfirmar, aoCancelar };
}

test("ConfirmarAcao abre com foco em Cancelar, mostra o tamanho e confirma só no botão", async () => {
  const u = userEvent.setup();
  const { aoConfirmar, aoCancelar } = confirmar();
  const dialogo = await screen.findByRole("alertdialog", { name: "Apagar o CNES de SP?" });
  expect(dialogo).toHaveTextContent("O banco e os arquivos guardados somem.");
  expect(dialogo).toHaveTextContent("129,5 MB");
  expect(screen.getByRole("button", { name: "Cancelar" })).toHaveFocus();
  expect(aoConfirmar).not.toHaveBeenCalled();
  await u.click(screen.getByRole("button", { name: "Apagar" }));
  expect(aoConfirmar).toHaveBeenCalledTimes(1);
  expect(aoCancelar).not.toHaveBeenCalled();
});

test("ConfirmarAcao: Esc cancela e não confirma", async () => {
  const u = userEvent.setup();
  const { aoConfirmar, aoCancelar } = confirmar();
  await screen.findByRole("alertdialog");
  await u.keyboard("{Escape}");
  expect(aoCancelar).toHaveBeenCalledTimes(1);
  expect(aoConfirmar).not.toHaveBeenCalled();
});

test("ConfirmarAcao sem tamanho não mostra linha de tamanho", async () => {
  confirmar({ tamanhoBytes: undefined });
  const dialogo = await screen.findByRole("alertdialog");
  expect(dialogo).not.toHaveTextContent(/MB|KB|GB/);
});
