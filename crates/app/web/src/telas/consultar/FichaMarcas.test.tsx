import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ProvedorDeAvisos } from "../../componentes/base/Avisos";
import { ProvedorDaSessao } from "../../shell/sessao";
import * as comandos from "../../api/comandos";
import type { Marcado } from "../../api/tipos";
import { fichaDeExemplo } from "./exemplos";
import { Ficha } from "./Ficha";

vi.mock("../../api/comandos");
const m = vi.mocked(comandos);

const marca = (extra: Partial<Marcado> = {}): Marcado => ({
  tipo: "procedimento", codigo: "0301010072", favorito: false, favorito_desde: null, anotacao: null, anotacao_de: null, ...extra,
});

function montar() {
  window.location.hash = "#/consultar/0301010072";
  const cliente = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={cliente}><ProvedorDaSessao><ProvedorDeAvisos><Ficha /></ProvedorDeAvisos></ProvedorDaSessao></QueryClientProvider>);
}

beforeEach(() => {
  vi.resetAllMocks();
  m.ficha.mockResolvedValue(fichaDeExemplo());
  m.historico.mockResolvedValue({ codigo: "0301010072", codigo_mascarado: "03.01.01.007-2", primeira_carregada: "202604", ultima_carregada: "202609", competencias_carregadas: 6, competencias_com_mudanca: [], eventos: [] });
  m.situacao.mockResolvedValue({ primeira_execucao: false, bloqueio: null, competencias: [], territorio: null, pasta_dados: "x", ocupado: false, recuperacao: null });
  m.marcado.mockResolvedValue(marca());
});

test("Favorito é um botão alternável; alternar grava e atualiza sem recarregar a ficha", async () => {
  const u = userEvent.setup();
  m.marcarFavorito.mockResolvedValue(marca({ favorito: true, favorito_desde: "2026-10-08" }));
  montar();
  const estrela = await screen.findByRole("button", { name: "Favorito" });
  await waitFor(() => expect(estrela).toHaveAttribute("aria-pressed", "false"));
  await u.click(estrela);
  expect(m.marcarFavorito).toHaveBeenCalledWith("procedimento", "0301010072", true);
  await waitFor(() => expect(screen.getByRole("button", { name: "Favorito" })).toHaveAttribute("aria-pressed", "true"));
  expect(m.ficha).toHaveBeenCalledTimes(1);
});

test("favorito já marcado abre marcado; desmarcar grava false", async () => {
  const u = userEvent.setup();
  m.marcado.mockResolvedValue(marca({ favorito: true }));
  m.marcarFavorito.mockResolvedValue(marca());
  montar();
  const estrela = await screen.findByRole("button", { name: "Favorito" });
  await waitFor(() => expect(estrela).toHaveAttribute("aria-pressed", "true"));
  await u.click(estrela);
  expect(m.marcarFavorito).toHaveBeenCalledWith("procedimento", "0301010072", false);
});

test("erro ao favoritar avisa e mantém o estado", async () => {
  const u = userEvent.setup();
  m.marcarFavorito.mockRejectedValue(new Error("banco do usuário bloqueado"));
  montar();
  const estrela = await screen.findByRole("button", { name: "Favorito" });
  await waitFor(() => expect(estrela).toHaveAttribute("aria-pressed", "false"));
  await u.click(estrela);
  expect(await screen.findByText(/Não foi possível favoritar\. banco do usuário bloqueado/)).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Favorito" })).toHaveAttribute("aria-pressed", "false");
});

test("Anotar abre o campo; a anotação grava ao sair do campo e mostra Salvo", async () => {
  const u = userEvent.setup();
  m.anotar.mockResolvedValue(marca({ anotacao: "Conferir o CBO" }));
  montar();
  const botao = await screen.findByRole("button", { name: "Anotar" });
  expect(botao).toHaveAttribute("aria-expanded", "false");
  await u.click(botao);
  const campo = await screen.findByRole("textbox", { name: "Anotação" });
  expect(campo).toHaveFocus();
  await u.type(campo, "  Conferir o CBO ");
  await u.tab();
  await waitFor(() => expect(m.anotar).toHaveBeenCalledWith("procedimento", "0301010072", "Conferir o CBO"));
  expect(await screen.findByText("Salvo")).toBeInTheDocument();
});

test("Ctrl+Enter salva sem sair do campo; sem mudança não grava", async () => {
  const u = userEvent.setup();
  m.anotar.mockResolvedValue(marca({ anotacao: "Nova" }));
  montar();
  await u.click(await screen.findByRole("button", { name: "Anotar" }));
  const campo = await screen.findByRole("textbox", { name: "Anotação" });
  await u.tab();
  expect(m.anotar).not.toHaveBeenCalled();
  campo.focus();
  await u.type(campo, "Nova");
  await u.keyboard("{Control>}{Enter}{/Control}");
  await waitFor(() => expect(m.anotar).toHaveBeenCalledWith("procedimento", "0301010072", "Nova"));
  expect(campo).toHaveFocus();
});

test("com anotação gravada, a ficha mostra a linha resumida com Editar, que abre o campo com o texto", async () => {
  const u = userEvent.setup();
  m.marcado.mockResolvedValue(marca({ anotacao: "Conferir CBO antes de lançar" }));
  montar();
  expect(await screen.findByText("Conferir CBO antes de lançar")).toBeInTheDocument();
  await u.click(screen.getByRole("button", { name: "Editar" }));
  expect(await screen.findByRole("textbox", { name: "Anotação" })).toHaveValue("Conferir CBO antes de lançar");
});

test("erro ao salvar a anotação avisa e o texto continua no campo", async () => {
  const u = userEvent.setup();
  m.anotar.mockRejectedValue(new Error("a anotação passa de 4000 caracteres"));
  montar();
  await u.click(await screen.findByRole("button", { name: "Anotar" }));
  const campo = await screen.findByRole("textbox", { name: "Anotação" });
  await u.type(campo, "texto");
  await u.tab();
  expect(await screen.findByText(/Não foi possível salvar a anotação\. a anotação passa de 4000 caracteres/)).toBeInTheDocument();
  expect(campo).toHaveValue("texto");
});
