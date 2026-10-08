import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { TarefasProvider } from "../dados/TarefasProvider";
import { Assistente } from "./Assistente";
import { etapaAtual } from "./etapas";
import * as comandos from "../api/comandos";
import * as eventos from "../api/eventos";
import type { SituacaoCnesCompleta, Situacao } from "../api/tipos";

vi.mock("../api/comandos");
vi.mock("../api/eventos");
const m = vi.mocked(comandos);
const ev = vi.mocked(eventos);

const VAZIA: Situacao = { primeira_execucao: true, bloqueio: null, competencias: [], territorio: null, pasta_dados: "", ocupado: false, recuperacao: null };
const COMP = { competencia: "202609", rotulo: "09/2026", arquivo: "x.zip", versao: null, publicado_em: null, sha256: "" };
const CARREGADA: Situacao = { ...VAZIA, competencias: [COMP], territorio: { ok: true } };
const CNES_VAZIO: SituacaoCnesCompleta = { minha: null, unidades: [], ufs_disponiveis: [], ufs: [] };
const arq = (tipo: string) => ({ tipo, uf: "SP", competencia: "202608", arquivo: `${tipo}SP2608.dbc`, bytes: 1, registros_gravados: 1, carregado_em: "" });
const CNES_COMPLETO: SituacaoCnesCompleta = {
  minha: { uf: "SP", cnes: "2077396", nome: "HOSPITAL DE BASE" }, unidades: [], ufs_disponiveis: ["SP"],
  ufs: [{ uf: "SP", resumo: { arquivos: ["ST", "HB", "SR", "LT", "EQ"].map(arq) } }],
};
const CNES_SP: SituacaoCnesCompleta = {
  minha: null, unidades: [], ufs_disponiveis: ["SP"],
  ufs: [{ uf: "SP", resumo: { arquivos: [{ tipo: "ST", uf: "SP", competencia: "202608", arquivo: "STSP2608.dbc", bytes: 1, registros_gravados: 1, carregado_em: "" }] } }],
};

let aoProgresso: (p: any) => void;
let aoFim: (f: any) => void;

function montar() {
  const cliente = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={cliente}><TarefasProvider><Assistente /></TarefasProvider></QueryClientProvider>);
}

beforeEach(() => {
  vi.resetAllMocks();
  m.situacao.mockResolvedValue(VAZIA);
  m.cnesSituacao.mockResolvedValue(CNES_VAZIO);
  m.baixar.mockResolvedValue(undefined);
  m.importar.mockResolvedValue(undefined);
  m.cancelar.mockResolvedValue(undefined);
  ev.ouvirProgresso.mockImplementation(async (cb) => { aoProgresso = cb; return () => {}; });
  ev.ouvirFimTarefa.mockImplementation(async (cb) => { aoFim = cb; return () => {}; });
});

describe("etapaAtual", () => {
  test("sem competência carregada ou sem território, começa pelo SIGTAP", () => {
    expect(etapaAtual(VAZIA, CNES_VAZIO, null, false)).toBe("sigtap");
    expect(etapaAtual({ ...CARREGADA, territorio: null }, CNES_VAZIO, null, false)).toBe("sigtap");
  });
  test("SIGTAP carregado e nenhum estado escolhido: pede o estado", () => {
    expect(etapaAtual(CARREGADA, CNES_VAZIO, null, false)).toBe("uf");
  });
  test("estado escolhido sem CNES carregado: baixa o CNES", () => {
    expect(etapaAtual(CARREGADA, CNES_VAZIO, "SP", false)).toBe("cnes");
  });
  test("CNES carregado sem unidade: pede a unidade", () => {
    expect(etapaAtual(CARREGADA, CNES_SP, null, false)).toBe("unidade");
  });
  test("pular a unidade leva ao fim; unidade definida também", () => {
    expect(etapaAtual(CARREGADA, CNES_SP, null, true)).toBe("pronto");
    const com = { ...CNES_SP, minha: { uf: "SP", cnes: "2077396", nome: "X" } };
    expect(etapaAtual(CARREGADA, com, null, false)).toBe("pronto");
  });
  test("ainda sem a situação do CNES, não adianta etapa", () => {
    expect(etapaAtual(CARREGADA, undefined, null, false)).toBe("uf");
  });
});

test("a primeira etapa explica o que é o programa e diz que não é oficial, uma única vez", async () => {
  montar();
  expect(await screen.findByRole("heading", { level: 1, name: /tabela sigtap/i })).toBeInTheDocument();
  expect(screen.getAllByText(/não oficial/i)).toHaveLength(1);
});

test("o indicador de etapas marca a etapa atual", async () => {
  montar();
  await screen.findByRole("heading", { level: 1 });
  const lista = screen.getByRole("list", { name: "Etapas" });
  const itens = lista.querySelectorAll("li");
  expect(itens).toHaveLength(5);
  expect(itens[0]).toHaveAttribute("aria-current", "step");
  expect(itens[1]).not.toHaveAttribute("aria-current");
});

async function baixarSoOUltimo(u: ReturnType<typeof userEvent.setup>) {
  await u.click(await screen.findByRole("button", { name: "Baixar" }));
  await u.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Continuar" }));
}

const VIGENTE = { sigtap: "vigente", territorio: true };

test("Baixar abre a pergunta dos meses anteriores; Só o último mês pede o vigente com o território, uma vez só", async () => {
  const u = userEvent.setup();
  montar();
  await u.click(await screen.findByRole("button", { name: "Baixar" }));
  const d = await screen.findByRole("dialog", { name: "Baixar também os meses anteriores?" });
  expect(within(d).getByRole("radio", { name: "Só o último mês" })).toBeChecked();
  await u.dblClick(within(d).getByRole("button", { name: "Continuar" }));
  expect(m.baixar).toHaveBeenCalledTimes(1);
  expect(m.baixar).toHaveBeenCalledWith(VIGENTE);
});

test("Baixar mais meses pede o vigente agora e os outros meses em segundo plano, na mesma ação", async () => {
  const u = userEvent.setup();
  montar();
  await u.click(await screen.findByRole("button", { name: "Baixar" }));
  const d = await screen.findByRole("dialog", { name: "Baixar também os meses anteriores?" });
  await u.click(within(d).getByRole("radio", { name: "Baixar mais meses" }));
  await u.dblClick(within(d).getByRole("button", { name: "Continuar" }));
  await waitFor(() => expect(m.baixar).toHaveBeenCalledTimes(2));
  expect(m.baixar).toHaveBeenNthCalledWith(1, VIGENTE);
  expect(m.baixar).toHaveBeenNthCalledWith(2, { sigtap: "12", territorio: false }, "depois");
});

test("fechar a pergunta dos meses não baixa nada", async () => {
  const u = userEvent.setup();
  montar();
  await u.click(await screen.findByRole("button", { name: "Baixar" }));
  await screen.findByRole("dialog", { name: "Baixar também os meses anteriores?" });
  await u.keyboard("{Escape}");
  await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  expect(m.baixar).not.toHaveBeenCalled();
});

test("durante o download aparece o progresso e o botão de cancelar", async () => {
  const u = userEvent.setup();
  montar();
  await baixarSoOUltimo(u);
  act(() => aoProgresso({ fonte: "sigtap", tarefa: 1, rotulo: "SIGTAP", fase: "baixando", resumo: "Fazendo download 1 de 2", mensagem: "TAB_SIGTAP.zip", fracao: 0.4, indeterminado: false }));
  expect(await screen.findByText("Fazendo download 1 de 2")).toBeInTheDocument();
  await u.click(screen.getByRole("button", { name: "Cancelar" }));
  expect(m.cancelar).toHaveBeenCalledTimes(1);
});

test("Escolher pasta com os arquivos escolhe a pasta e importa", async () => {
  const u = userEvent.setup();
  m.escolherPasta.mockResolvedValue("D:/dados/sigtap");
  montar();
  await u.click(await screen.findByRole("button", { name: "Escolher pasta com os arquivos" }));
  await waitFor(() => expect(m.importar).toHaveBeenCalledWith("D:/dados/sigtap"));
});

test("cancelar a escolha da pasta não importa nada", async () => {
  const u = userEvent.setup();
  m.escolherPasta.mockResolvedValue(null);
  montar();
  await u.click(await screen.findByRole("button", { name: "Escolher pasta com os arquivos" }));
  await waitFor(() => expect(m.escolherPasta).toHaveBeenCalledTimes(1));
  expect(m.importar).not.toHaveBeenCalled();
});

test("falha no download mostra a causa, oferece tentar de novo e mantém a escolha da pasta", async () => {
  const u = userEvent.setup();
  montar();
  await baixarSoOUltimo(u);
  act(() => aoFim({ fonte: "sigtap", tarefa: 1, ok: false, cancelada: false, mensagem: "Sem conexão com o servidor" }));
  const alerta = await screen.findByRole("alert");
  expect(alerta).toHaveTextContent("Sem conexão com o servidor");
  expect(screen.getByRole("button", { name: "Tentar de novo" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Escolher pasta com os arquivos" })).toBeInTheDocument();
});

test("SIGTAP já carregado abre direto na escolha do estado", async () => {
  m.situacao.mockResolvedValue(CARREGADA);
  montar();
  expect(await screen.findByRole("heading", { level: 1, name: "Seu estado" })).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Baixar" })).toBeNull();
});

test("Continuar no estado leva ao passo do CNES e o foco vai para o título", async () => {
  const u = userEvent.setup();
  m.situacao.mockResolvedValue(CARREGADA);
  montar();
  await screen.findByRole("heading", { level: 1, name: "Seu estado" });
  await u.click(screen.getByRole("button", { name: "Continuar" }));
  const titulo = await screen.findByRole("heading", { level: 1, name: "CNES de SP" });
  await waitFor(() => expect(titulo).toHaveFocus());
});

// ---- Passos 3 a 5 ----
const HOSPITAIS = [
  { cnes: "2077396", nome: "HOSPITAL DE BASE DE SAO JOSE DO RIO PRETO", municipio: "354980", municipio_nome: "São José do Rio Preto", tipo: "05", tipo_nome: "Hospital geral" },
  { cnes: "2748223", nome: "HOSPITAL DE BASE DE BAURU", municipio: "350600", municipio_nome: "Bauru", tipo: "05", tipo_nome: "Hospital geral" },
];

async function irParaCnes(u: ReturnType<typeof userEvent.setup>) {
  m.situacao.mockResolvedValue(CARREGADA);
  m.cnesBaixar.mockResolvedValue(undefined);
  montar();
  await screen.findByRole("heading", { level: 1, name: "Seu estado" });
  await u.click(screen.getByRole("button", { name: "Continuar" }));
  await screen.findByRole("heading", { level: 1, name: "CNES de SP" });
}

test("o passo do CNES baixa o estado escolhido assim que abre, uma vez só", async () => {
  const u = userEvent.setup();
  await irParaCnes(u);
  await waitFor(() => expect(m.cnesBaixar).toHaveBeenCalledWith("SP", { fase: "busca" }));
  expect(m.cnesBaixar).toHaveBeenCalledTimes(1);
});

test("terminada a busca do CNES, o restante entra na fila em segundo plano, uma vez só", async () => {
  const u = userEvent.setup();
  await irParaCnes(u);
  await waitFor(() => expect(m.cnesBaixar).toHaveBeenCalledTimes(1));
  act(() => aoProgresso({ fonte: "cnes", tarefa: 1, rotulo: "CNES de SP", fase: "baixando", resumo: "r", mensagem: "m", fracao: 0.5, indeterminado: false }));
  act(() => aoFim({ fonte: "cnes", tarefa: 1, ok: true, cancelada: false, mensagem: "CNES de SP carregado" }));
  await waitFor(() => expect(m.cnesBaixar).toHaveBeenCalledTimes(2));
  expect(m.cnesBaixar).toHaveBeenNthCalledWith(2, "SP", { fase: "restante", quando: "depois" });
  act(() => aoFim({ fonte: "cnes", tarefa: 2, ok: true, cancelada: false, mensagem: "restante" }));
  await new Promise((r) => setTimeout(r, 50));
  expect(m.cnesBaixar).toHaveBeenCalledTimes(2);
});

test("busca do CNES cancelada ou com erro não enfileira o restante", async () => {
  const u = userEvent.setup();
  await irParaCnes(u);
  await waitFor(() => expect(m.cnesBaixar).toHaveBeenCalledTimes(1));
  act(() => aoFim({ fonte: "cnes", tarefa: 1, ok: false, cancelada: true, mensagem: "cancelado" }));
  await new Promise((r) => setTimeout(r, 50));
  expect(m.cnesBaixar).toHaveBeenCalledTimes(1);
});

test("falha no CNES mostra a causa, tenta de novo e aceita importar de uma pasta", async () => {
  const u = userEvent.setup();
  await irParaCnes(u);
  await waitFor(() => expect(m.cnesBaixar).toHaveBeenCalledTimes(1));
  act(() => aoFim({ fonte: "cnes", tarefa: 1, ok: false, cancelada: false, mensagem: "Não foi possível baixar do DATASUS: sem conexão" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("sem conexão");
  await u.click(screen.getByRole("button", { name: "Tentar de novo" }));
  await waitFor(() => expect(m.cnesBaixar).toHaveBeenCalledTimes(2));
  act(() => aoFim({ fonte: "cnes", tarefa: 2, ok: false, cancelada: false, mensagem: "falhou de novo" }));
  m.escolherPasta.mockResolvedValue("D:/cnes");
  m.cnesImportar.mockResolvedValue(undefined);
  await u.click(await screen.findByRole("button", { name: "Escolher pasta com os arquivos" }));
  await waitFor(() => expect(m.cnesImportar).toHaveBeenCalledWith("D:/cnes", "SP"));
});

describe("passo da unidade", () => {
  const comCnes = () => { m.situacao.mockResolvedValue(CARREGADA); m.cnesSituacao.mockResolvedValue(CNES_SP); };

  test("a busca espera a pausa na digitação e a lista é uma listbox", async () => {
    const u = userEvent.setup();
    comCnes();
    m.cnesBuscar.mockResolvedValue(HOSPITAIS);
    montar();
    await screen.findByRole("heading", { level: 1, name: "Sua unidade" });
    await u.type(screen.getByRole("searchbox", { name: /unidade/i }), "hospital");
    expect(m.cnesBuscar).not.toHaveBeenCalledWith("SP", "h");
    await waitFor(() => expect(m.cnesBuscar).toHaveBeenCalledWith("SP", "hospital"));
    expect(await screen.findByRole("listbox")).toBeInTheDocument();
    expect(screen.getAllByRole("option")).toHaveLength(2);
  });

  test("Enter no item escolhe a unidade, uma vez só, e o resultado não traz sequência de CPF", async () => {
    const u = userEvent.setup();
    comCnes();
    m.cnesBuscar.mockResolvedValue(HOSPITAIS);
    m.unidadeDefinir.mockResolvedValue(undefined);
    montar();
    await screen.findByRole("heading", { level: 1, name: "Sua unidade" });
    await u.type(screen.getByRole("searchbox", { name: /unidade/i }), "hospital");
    const opcoes = await screen.findAllByRole("option");
    expect(document.body.textContent).not.toMatch(/\d{11}/);
    opcoes[0]!.focus();
    await u.keyboard("{Enter}");
    await waitFor(() => expect(m.unidadeDefinir).toHaveBeenCalledWith("SP", "2077396"));
    expect(m.unidadeDefinir).toHaveBeenCalledTimes(1);
  });

  test("depois de escolher a unidade, os profissionais entram na fila em segundo plano", async () => {
    const u = userEvent.setup();
    comCnes();
    m.cnesBuscar.mockResolvedValue(HOSPITAIS);
    m.unidadeDefinir.mockResolvedValue(undefined);
    m.cnesBaixar.mockResolvedValue(undefined);
    montar();
    await screen.findByRole("heading", { level: 1, name: "Sua unidade" });
    await u.type(screen.getByRole("searchbox", { name: /unidade/i }), "bauru");
    await u.click((await screen.findAllByRole("option"))[1]!);
    await u.click(screen.getByRole("button", { name: "Escolher esta unidade" }));
    await waitFor(() => expect(m.cnesBaixar).toHaveBeenCalledWith("SP", { fase: "pessoas", quando: "depois" }));
    expect(m.cnesBaixar).toHaveBeenCalledTimes(1);
  });

  test("Escolher esta unidade vale para o item marcado", async () => {
    const u = userEvent.setup();
    comCnes();
    m.cnesBuscar.mockResolvedValue(HOSPITAIS);
    m.unidadeDefinir.mockResolvedValue(undefined);
    montar();
    await screen.findByRole("heading", { level: 1, name: "Sua unidade" });
    expect(screen.getByRole("button", { name: "Escolher esta unidade" })).toBeDisabled();
    await u.type(screen.getByRole("searchbox", { name: /unidade/i }), "bauru");
    await u.click((await screen.findAllByRole("option"))[1]!);
    await u.click(screen.getByRole("button", { name: "Escolher esta unidade" }));
    await waitFor(() => expect(m.unidadeDefinir).toHaveBeenCalledWith("SP", "2748223"));
  });

  test("Pular vai ao fim sem definir unidade; o fim diz que não há unidade e abre o Painel", async () => {
    const u = userEvent.setup();
    comCnes();
    const aoConcluir = vi.fn();
    const cliente = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<QueryClientProvider client={cliente}><TarefasProvider><Assistente aoConcluir={aoConcluir} /></TarefasProvider></QueryClientProvider>);
    await u.click(await screen.findByRole("button", { name: "Pular" }));
    expect(await screen.findByRole("heading", { level: 1, name: "Tudo pronto" })).toBeInTheDocument();
    expect(m.unidadeDefinir).not.toHaveBeenCalled();
    expect(screen.getByText(/sem unidade/i)).toBeInTheDocument();
    await u.click(screen.getByRole("button", { name: "Abrir o Painel" }));
    expect(window.location.hash).toBe("#/painel");
    expect(aoConcluir).toHaveBeenCalledTimes(1);
  });

  test("com unidade definida, o fim mostra o nome dela", async () => {
    m.situacao.mockResolvedValue(CARREGADA);
    m.cnesSituacao.mockResolvedValue(CNES_COMPLETO);
    montar();
    expect(await screen.findByRole("heading", { level: 1, name: "Tudo pronto" })).toBeInTheDocument();
    expect(screen.getByText("HOSPITAL DE BASE")).toBeInTheDocument();
  });
});

describe("passo pronto", () => {
  const SEM_RESTANTE = { ...CNES_SP, minha: { uf: "SP", cnes: "2077396", nome: "HOSPITAL DE BASE" } };
  const pendente = () => { m.situacao.mockResolvedValue(CARREGADA); m.cnesSituacao.mockResolvedValue(SEM_RESTANTE); };
  const rodandoCnes = { fonte: "cnes", tarefa: 3, rotulo: "CNES de SP", fase: "baixando", resumo: "Baixando HB", mensagem: "HBSP2608.dbc", fracao: 0.4, indeterminado: false };

  test("com pendência, o painel não abre, a falta é dita e há uma barra por pendência", async () => {
    pendente();
    montar();
    expect(await screen.findByRole("heading", { level: 1, name: "Quase pronto" })).toBeInTheDocument();
    act(() => aoProgresso(rodandoCnes));
    expect(await screen.findByText("Falta terminar: CNES")).toBeInTheDocument();
    expect(screen.getByRole("progressbar", { name: "CNES" })).toHaveAttribute("aria-valuenow", "40");
    expect(screen.getByRole("button", { name: "Abrir o Painel" })).toBeDisabled();
  });

  test("ao terminar a pendência o botão habilita sozinho", async () => {
    pendente();
    montar();
    await screen.findByRole("heading", { level: 1, name: "Quase pronto" });
    act(() => aoProgresso(rodandoCnes));
    m.cnesSituacao.mockResolvedValue(CNES_COMPLETO);
    act(() => aoFim({ fonte: "cnes", tarefa: 3, ok: true, cancelada: false, mensagem: "ok" }));
    expect(await screen.findByRole("heading", { level: 1, name: "Tudo pronto" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Abrir o Painel" })).toBeEnabled();
  });

  test("pendência com falha mostra a causa e Tentar de novo pede o restante do CNES", async () => {
    const u = userEvent.setup();
    pendente();
    m.cnesBaixar.mockResolvedValue(undefined);
    montar();
    await screen.findByRole("heading", { level: 1, name: "Quase pronto" });
    act(() => aoFim({ fonte: "cnes", tarefa: 3, ok: false, cancelada: false, mensagem: "sem rede" }));
    expect(await screen.findByText("sem rede")).toBeInTheDocument();
    await u.click(screen.getByRole("button", { name: "Tentar de novo" }));
    await waitFor(() => expect(m.cnesBaixar).toHaveBeenCalledWith("SP", { fase: "restante" }));
  });

  test("a produção é opcional: o plano é mostrado, a confirmação baixa, e nada disso trava o painel", async () => {
    const u = userEvent.setup();
    m.situacao.mockResolvedValue(CARREGADA);
    m.cnesSituacao.mockResolvedValue(CNES_COMPLETO);
    m.producaoPlano.mockResolvedValue({ uf: "SP", itens: [{ arquivo: "a", bytes: 10, competencia: "202608", tipo: "SIA" }], total_bytes: 10, precisa_confirmar: false });
    m.producaoBaixar.mockResolvedValue(undefined);
    montar();
    await screen.findByRole("heading", { level: 1, name: "Tudo pronto" });
    expect(screen.getByRole("button", { name: "Abrir o Painel" })).toBeEnabled();
    await u.click(screen.getByRole("button", { name: "Ver o que será baixado" }));
    expect(m.producaoPlano).toHaveBeenCalledWith("SP", 3);
    await u.click(await screen.findByRole("button", { name: "Baixar" }));
    await waitFor(() => expect(m.producaoBaixar).toHaveBeenCalledWith({ uf: "SP", meses: 3, confirmado: true }, "agora"));
    expect(screen.getByRole("button", { name: "Abrir o Painel" })).toBeEnabled();
  });
});
