import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { TarefasProvider } from "../../dados/TarefasProvider";
import { Dados } from "./Dados";
import * as comandos from "../../api/comandos";
import * as eventos from "../../api/eventos";
import type { Situacao } from "../../api/tipos";

vi.mock("../../api/comandos");
vi.mock("../../api/eventos");
const m = vi.mocked(comandos);
const ev = vi.mocked(eventos);

const SITUACAO: Situacao = {
  primeira_execucao: false, bloqueio: null, competencias: [], territorio: { ok: true }, pasta_dados: "", ocupado: false, recuperacao: null,
};
const UNIDADE = "HOSPITAL DE BASE DE SAO JOSE DO RIO PRETO";
const ARQ_CNES = (uf: string) => ({ tipo: "ST", uf, competencia: "202608", arquivo: `ST${uf}2608.dbc`, bytes: 1, registros_gravados: 1, carregado_em: "" });
const CNES = {
  minha: { uf: "SP", cnes: "2077396", nome: UNIDADE }, unidades: [], ufs_disponiveis: ["SP", "MS"],
  ufs: [
    { uf: "SP", bytes: 135_790_592, resumo: { arquivos: [ARQ_CNES("SP")] } },
    { uf: "MS", bytes: 61_000_000, resumo: { arquivos: [ARQ_CNES("MS")] } },
  ],
};
const PRODUCAO = {
  manter_brutos: false,
  ufs: [
    { uf: "SP", bytes_banco: 412 * 1024 * 1024, guardados: { arquivos: 4, bytes: 1.3 * 1024 ** 3 }, defasagem: { sia_ate: "202607", sih_ate: "202607", sia_incompleto: "202607", sih_incompleto: null } },
    { uf: "MS", bytes_banco: 96 * 1024 * 1024, defasagem: { sia_ate: "202606", sih_ate: "202607", sia_incompleto: null, sih_incompleto: null } },
  ],
};
const PLANO = (extra = {}) => ({
  uf: "SP", total_bytes: 1.3 * 1024 ** 3, precisa_confirmar: false,
  itens: Array.from({ length: 14 }, (_, i) => ({ arquivo: `a${i}.dbc`, bytes: 1, competencia: "202607", tipo: "SIA" })), ...extra,
});

function montar() {
  const cliente = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={cliente}><TarefasProvider><Dados /></TarefasProvider></QueryClientProvider>);
}
async function abrirAba(u: ReturnType<typeof userEvent.setup>, nome: string) {
  await u.click(await screen.findByRole("tab", { name: nome }));
}

beforeEach(() => {
  vi.resetAllMocks();
  m.situacao.mockResolvedValue(SITUACAO);
  m.ofertas.mockResolvedValue({ servidor: "x", competencias: [] });
  m.cnesSituacao.mockResolvedValue(CNES);
  m.producaoSituacao.mockResolvedValue(PRODUCAO);
  m.cancelar.mockResolvedValue(undefined);
  ev.ouvirProgresso.mockImplementation(async () => () => {});
  ev.ouvirFimTarefa.mockImplementation(async () => () => {});
});

describe("aba CNES", () => {
  beforeEach(() => {
    m.cnesBaixar.mockResolvedValue(undefined);
    m.cnesApagar.mockResolvedValue("ok");
  });

  test("uma linha por estado, com o tamanho, e a unidade ativa marcada", async () => {
    const u = userEvent.setup();
    montar();
    await abrirAba(u, "CNES");
    const tabela = await screen.findByRole("grid", { name: /CNES carregado/i });
    expect(within(tabela).getByRole("row", { name: /SP/ })).toHaveTextContent("129,5 MB");
    expect(within(tabela).getByRole("row", { name: /SP/ })).toHaveTextContent("Sua unidade");
    expect(within(tabela).getByRole("row", { name: /MS/ })).not.toHaveTextContent("Sua unidade");
  });

  test("Baixar CNES e Atualizar chamam cnesBaixar com o estado", async () => {
    const u = userEvent.setup();
    montar();
    await abrirAba(u, "CNES");
    await u.click(await screen.findByRole("button", { name: "Atualizar o CNES de MS" }));
    await waitFor(() => expect(m.cnesBaixar).toHaveBeenCalledWith("MS"));
  });

  test("apagar o estado da unidade ativa avisa que o Painel fica sem dados", async () => {
    const u = userEvent.setup();
    montar();
    await abrirAba(u, "CNES");
    await u.click(await screen.findByRole("button", { name: "Apagar o CNES de SP" }));
    const dialogo = await screen.findByRole("alertdialog");
    expect(dialogo).toHaveTextContent(UNIDADE);
    expect(dialogo).toHaveTextContent(/Painel/);
    expect(m.cnesApagar).not.toHaveBeenCalled();
    await u.click(within(dialogo).getByRole("button", { name: "Apagar" }));
    await waitFor(() => expect(m.cnesApagar).toHaveBeenCalledWith("SP"));
  });

  test("apagar outro estado usa a confirmação simples", async () => {
    const u = userEvent.setup();
    montar();
    await abrirAba(u, "CNES");
    await u.click(await screen.findByRole("button", { name: "Apagar o CNES de MS" }));
    const dialogo = await screen.findByRole("alertdialog");
    expect(dialogo).not.toHaveTextContent(/Painel/);
    await u.click(within(dialogo).getByRole("button", { name: "Apagar" }));
    await waitFor(() => expect(m.cnesApagar).toHaveBeenCalledWith("MS"));
  });

  test("estado com erro mostra a causa e oferece baixar de novo", async () => {
    const u = userEvent.setup();
    m.cnesSituacao.mockResolvedValue({ ...CNES, ufs: [{ uf: "MS", erro: "arquivo danificado" }] });
    montar();
    await abrirAba(u, "CNES");
    expect(await screen.findByText(/arquivo danificado/)).toBeInTheDocument();
    await u.click(screen.getByRole("button", { name: "Baixar de novo o CNES de MS" }));
    await waitFor(() => expect(m.cnesBaixar).toHaveBeenCalledWith("MS"));
  });
});

describe("aba Produção", () => {
  beforeEach(() => {
    m.producaoPlano.mockResolvedValue(PLANO());
    m.producaoBaixar.mockResolvedValue(undefined);
    m.manterBrutosDefinir.mockResolvedValue(true);
  });

  test("Ver o que será baixado abre o diálogo com arquivos, tamanho e a frase fixa", async () => {
    const u = userEvent.setup();
    montar();
    await abrirAba(u, "Produção");
    await u.click(await screen.findByRole("button", { name: "Ver o que será baixado" }));
    const dialogo = await screen.findByRole("alertdialog");
    expect(m.producaoPlano).toHaveBeenCalledWith("SP", 12);
    expect(dialogo).toHaveTextContent("14 arquivos");
    expect(dialogo).toHaveTextContent("1,3 GB");
    expect(dialogo).toHaveTextContent("O download pode demorar.");
    expect(within(dialogo).getByRole("button", { name: "Cancelar" })).toBeEnabled();
    expect(within(dialogo).getByRole("button", { name: "Baixar" })).toBeEnabled();
    expect(m.producaoBaixar).not.toHaveBeenCalled();
  });

  test("só o Baixar do diálogo baixa, com a confirmação marcada", async () => {
    const u = userEvent.setup();
    montar();
    await abrirAba(u, "Produção");
    await u.click(await screen.findByRole("button", { name: "Ver o que será baixado" }));
    await u.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Baixar" }));
    await waitFor(() => expect(m.producaoBaixar).toHaveBeenCalledWith({ uf: "SP", meses: 12, confirmado: true }));
    expect(m.producaoBaixar).toHaveBeenCalledTimes(1);
  });

  test("Cancelar e Esc não baixam nada", async () => {
    const u = userEvent.setup();
    montar();
    await abrirAba(u, "Produção");
    await u.click(await screen.findByRole("button", { name: "Ver o que será baixado" }));
    await u.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Cancelar" }));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    await u.click(screen.getByRole("button", { name: "Ver o que será baixado" }));
    await screen.findByRole("alertdialog");
    await u.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    expect(m.producaoBaixar).not.toHaveBeenCalled();
  });

  test("plano grande não ganha aviso de limite nem frase sobre o estado ser grande", async () => {
    const u = userEvent.setup();
    m.producaoPlano.mockResolvedValue(PLANO({ total_bytes: 3 * 1024 ** 3, precisa_confirmar: true }));
    montar();
    await abrirAba(u, "Produção");
    await u.click(await screen.findByRole("button", { name: "Ver o que será baixado" }));
    const dialogo = await screen.findByRole("alertdialog");
    expect(dialogo).toHaveTextContent("O download pode demorar.");
    expect(dialogo.textContent).not.toMatch(/limite|500|demora mais/i);
    expect(within(dialogo).getByRole("button", { name: "Baixar" })).toBeEnabled();
    expect(document.body.textContent).not.toMatch(/Demora mais que as outras/);
  });

  test("Manter arquivos baixados chama manterBrutosDefinir", async () => {
    const u = userEvent.setup();
    montar();
    await abrirAba(u, "Produção");
    await u.click(await screen.findByRole("switch", { name: "Manter arquivos baixados" }));
    await waitFor(() => expect(m.manterBrutosDefinir).toHaveBeenCalledWith(true));
  });

  test("a tabela mostra até quando há dados e avisa de mês incompleto", async () => {
    const u = userEvent.setup();
    montar();
    await abrirAba(u, "Produção");
    const tabela = await screen.findByRole("grid", { name: /produção carregada/i });
    expect(within(tabela).getByRole("row", { name: /SP/ })).toHaveTextContent("SIA incompleto");
    expect(within(tabela).getByRole("row", { name: /MS/ })).not.toHaveTextContent("incompleto");
  });

  test.each([
    ["Reconstruir a produção de SP", "Reconstruir", () => m.producaoReconstruir],
    ["Apagar arquivos guardados de SP", "Apagar", () => m.producaoApagarGuardados],
    ["Apagar a produção de SP", "Apagar", () => m.producaoApagar],
  ])("%s pede confirmação antes de agir", async (botao, confirmar, comando) => {
    const u = userEvent.setup();
    m.producaoReconstruir.mockResolvedValue(undefined);
    m.producaoApagarGuardados.mockResolvedValue("ok");
    m.producaoApagar.mockResolvedValue("ok");
    montar();
    await abrirAba(u, "Produção");
    await u.click(await screen.findByRole("button", { name: botao }));
    const dialogo = await screen.findByRole("alertdialog");
    expect(comando()).not.toHaveBeenCalled();
    await u.click(within(dialogo).getByRole("button", { name: confirmar }));
    await waitFor(() => expect(comando()).toHaveBeenCalledWith("SP"));
  });
});

describe("menu Manutenção", () => {
  beforeEach(() => {
    m.verificarBancos.mockResolvedValue({ completo: false, itens: [] });
    m.recriarBanco.mockResolvedValue(undefined);
  });

  test("verifica os bancos no modo rápido e no completo", async () => {
    const u = userEvent.setup();
    montar();
    await u.click(await screen.findByRole("button", { name: "Manutenção" }));
    await u.click(await screen.findByRole("menuitem", { name: "Verificar bancos (rápido)" }));
    await waitFor(() => expect(m.verificarBancos).toHaveBeenCalledWith(false));
    await u.click(screen.getByRole("button", { name: "Manutenção" }));
    await u.click(await screen.findByRole("menuitem", { name: "Verificar bancos (completo)" }));
    await waitFor(() => expect(m.verificarBancos).toHaveBeenCalledWith(true));
  });

  test("recriar o banco só acontece depois de confirmar", async () => {
    const u = userEvent.setup();
    montar();
    await u.click(await screen.findByRole("button", { name: "Manutenção" }));
    await u.click(await screen.findByRole("menuitem", { name: /Recriar banco a partir dos ZIPs/ }));
    const dialogo = await screen.findByRole("alertdialog");
    expect(m.recriarBanco).not.toHaveBeenCalled();
    await u.click(within(dialogo).getByRole("button", { name: "Recriar" }));
    await waitFor(() => expect(m.recriarBanco).toHaveBeenCalledWith(true));
  });
});
