import { vi } from "vitest";

vi.mock("./tauri", () => ({ chamar: vi.fn(async () => ({})) }));
import { chamar } from "./tauri";
import * as c from "./comandos";

beforeEach(() => vi.mocked(chamar).mockClear());

const casos: [string, () => Promise<unknown>, string, Record<string, unknown>?][] = [
  ["ofertas sem forçar", () => c.ofertas(), "ofertas", { deNovo: false }],
  ["ofertas de novo", () => c.ofertas(true), "ofertas", { deNovo: true }],
  ["baixar envia o pedido", () => c.baixar({ sigtap: "vigente", territorio: true }), "baixar",
    { pedido: { sigtap: "vigente", territorio: true } }],
  ["importar envia a pasta", () => c.importar("D:/x"), "importar", { pasta: "D:/x" }],
  ["cancelar", () => c.cancelar(), "cancelar", undefined],
  ["fechar o programa", () => c.fecharPrograma(), "fechar_programa", undefined],
  ["cancelar uma fonte", () => c.cancelar("cnes"), "cancelar", { fonte: "cnes" }],
  ["baixar para depois entra na fila da fonte", () => c.baixar({ sigtap: "12", territorio: false }, "depois"), "baixar",
    { pedido: { sigtap: "12", territorio: false }, quando: "depois" }],
  ["CNES restante para depois", () => c.cnesBaixar("MS", { fase: "restante", quando: "depois" }), "cnes_baixar",
    { pedido: { uf: "MS", competencia: "", fase: "restante" }, quando: "depois" }],
  ["CNES busca", () => c.cnesBaixar("MS", { fase: "busca" }), "cnes_baixar", { pedido: { uf: "MS", competencia: "", fase: "busca" } }],
  ["ficha", () => c.ficha("0301010072", "202609"), "ficha", { competencia: "202609", codigo: "0301010072" }],
  ["ficha sem competência", () => c.ficha("0301010072"), "ficha", { competencia: null, codigo: "0301010072" }],
  ["histórico", () => c.historico("0301010072"), "historico", { codigo: "0301010072" }],
  ["árvore sem pai", () => c.arvore(null, "202609"), "arvore", { competencia: "202609", pai: null }],
  ["árvore com pai", () => c.arvore("0301", "202609"), "arvore", { competencia: "202609", pai: "0301" }],
  ["árvore de CID", () => c.arvoreCid("I", "202609"), "arvore_cid", { competencia: "202609", pai: "I" }],
  ["ligados", () => c.ligados("tb_cid", ["I10"], "202609"), "ligados", { competencia: "202609", tabela: "tb_cid", codigo: ["I10"] }],
  ["marcado", () => c.marcado("procedimento", "0301010072"), "marcado", { tipo: "procedimento", codigo: "0301010072" }],
  ["favoritar", () => c.marcarFavorito("procedimento", "0301010072", true), "marcar_favorito", { tipo: "procedimento", codigo: "0301010072", favorito: true }],
  ["anotar", () => c.anotar("procedimento", "0301010072", "conferir"), "anotar", { tipo: "procedimento", codigo: "0301010072", texto: "conferir" }],
  ["marcados", () => c.marcados("procedimento", "202609"), "marcados", { tipo: "procedimento", competencia: "202609" }],
  ["exportar", () => c.exportar({ titulo: "t", abas: [] }, "lista"), "exportar", { planilha: { titulo: "t", abas: [] }, nome: "lista", aba: null }],
  ["apagar ZIPs", () => c.apagarZips(), "apagar_zips", undefined],
  ["escolher pasta", () => c.escolherPasta(), "escolher_pasta", undefined],
  ["CNES baixar com competência vazia", () => c.cnesBaixar("MS"), "cnes_baixar", { pedido: { uf: "MS", competencia: "", fase: "tudo" } }],
  ["CNES importar", () => c.cnesImportar("D:/x", "MS"), "cnes_importar", { pasta: "D:/x", uf: "MS" }],
  ["CNES apagar", () => c.cnesApagar("MS"), "cnes_apagar", { uf: "MS" }],
  ["CNES verificar", () => c.cnesVerificar(), "cnes_verificar", undefined],
  ["buscar todos", () => c.buscarTodos("consulta", "202609"), "buscar_todos", { competencia: "202609", texto: "consulta" }],
  ["CNES buscar", () => c.cnesBuscar("MS", "hospital"), "cnes_buscar", { uf: "MS", texto: "hospital" }],
  ["produção situação", () => c.producaoSituacao(), "producao_situacao", undefined],
  ["produção plano", () => c.producaoPlano("SP", 12), "producao_plano", { uf: "SP", meses: 12 }],
  ["produção baixar confirmada", () => c.producaoBaixar({ uf: "SP", meses: 12, confirmado: true }), "producao_baixar",
    { pedido: { uf: "SP", meses: 12, confirmado: true } }],
  ["produção importar", () => c.producaoImportar("D:/x", "SP"), "producao_importar", { pasta: "D:/x", uf: "SP" }],
  ["produção apagar", () => c.producaoApagar("SP"), "producao_apagar", { uf: "SP" }],
  ["produção reconstruir", () => c.producaoReconstruir("SP"), "producao_reconstruir", { uf: "SP" }],
  ["produção apagar guardados", () => c.producaoApagarGuardados("SP"), "producao_apagar_guardados", { uf: "SP" }],
  ["manter brutos", () => c.manterBrutosDefinir(true), "manter_brutos_definir", { ligada: true }],
  ["verificar bancos rápido", () => c.verificarBancos(false), "verificar_bancos", { completo: false }],
  ["recriar banco", () => c.recriarBanco(), "recriar_banco", { forcar: true }],
  ["painel do faturista", () => c.faturamentoPainel("202609"), "faturamento_painel", { competencia: "202609" }],
  ["painel sem competência", () => c.faturamentoPainel(), "faturamento_painel", { competencia: null }],
  ["impacto das mudanças", () => c.faturamentoImpacto("202608", "202609"), "faturamento_impacto", { de: "202608", para: "202609" }],
  ["mudou com o filtro", () => c.mudou("202608", "202609", { soAfeta: true }), "mudou",
    { de: "202608", para: "202609", tabela: null, desde: null, soAfeta: true }],
  ["mudou: ver mais de uma tabela", () => c.mudou("202608", "202609", { tabela: "rl_procedimento_habilitacao", desde: 300 }), "mudou",
    { de: "202608", para: "202609", tabela: "rl_procedimento_habilitacao", desde: 300, soAfeta: false }],
  ["unidade completa (a ativa)", () => c.unidadeVer("202609"), "unidade_ver", { competencia: "202609", uf: null, cnes: null }],
  ["unidade completa de outra", () => c.unidadeVer(undefined, { uf: "MS", cnes: "2754291" }), "unidade_ver", { competencia: null, uf: "MS", cnes: "2754291" }],
  ["aptidão da unidade: resumo", () => c.aptidaoUnidade({}), "aptidao_unidade",
    { competencia: null, grupo: null, q: null, hab: null, desde: null, soProduzidosNaUf: false }],
  ["aptidão da unidade: uma página filtrada", () => c.aptidaoUnidade({ grupo: "oportunidade", q: "biopsia", hab: "0203", desde: 50, soProduzidosNaUf: true, competencia: "202609" }), "aptidao_unidade",
    { competencia: "202609", grupo: "oportunidade", q: "biopsia", hab: "0203", desde: 50, soProduzidosNaUf: true }],
  ["terceiro: adicionar", () => c.terceiroAdicionar("SP", "2077396", "SP", "2077400"), "terceiro_adicionar",
    { uf: "SP", cnes: "2077396", terceiroUf: "SP", terceiroCnes: "2077400" }],
  ["terceiro: remover", () => c.terceiroRemover("SP", "2077396", "SP", "2077400"), "terceiro_remover",
    { uf: "SP", cnes: "2077396", terceiroUf: "SP", terceiroCnes: "2077400" }],
  ["buscar unidades", () => c.unidadesBuscar("hospital"), "unidades_buscar", { texto: "hospital" }],
];

test.each(casos)("%s", async (_nome, chamarFuncao, comando, args) => {
  await chamarFuncao();
  if (args === undefined) expect(chamar).toHaveBeenCalledWith(comando);
  else expect(chamar).toHaveBeenCalledWith(comando, args);
});
