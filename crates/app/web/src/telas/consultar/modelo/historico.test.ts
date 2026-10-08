import type { EventoDeHistorico, Historico } from "../../../api/tipos";
import { campo, linha, nome } from "../exemplos";
import { contagemPorCompetencia, montarGrupos, tabelasDoHistorico } from "./historico";

const nbsp = (s: string) => s.replace(/ /g, " ");

const base = (e: Partial<EventoDeHistorico> & Pick<EventoDeHistorico, "competencia" | "tabela" | "tipo">): EventoDeHistorico => ({
  rotulo: `${e.competencia.slice(4)}/${e.competencia.slice(0, 4)}`, coluna: "co_procedimento", chave: { co_procedimento: "0301010072" },
  antes: null, depois: null, campos_alterados: [], ...e,
});

const proc = (sa: number) => linha([campo("co_procedimento", "0301010072"), campo("vl_sa", sa, { unidade: "centavos" }), campo("vl_sh", 0, { unidade: "centavos" })]);
const cbo = (cod: string, texto: string) => linha([campo("co_procedimento", "0301010072"), campo("co_ocupacao", cod)], [nome("tb_ocupacao", "co_ocupacao", { no_ocupacao: texto })]);

const historico = (eventos: EventoDeHistorico[]): Historico => ({
  codigo: "0301010072", codigo_mascarado: "03.01.01.007-2", primeira_carregada: "202604", ultima_carregada: "202609",
  competencias_carregadas: 6, competencias_com_mudanca: [...new Set(eventos.map((e) => e.competencia))], eventos,
});

const alterado = base({ competencia: "202609", tabela: "tb_procedimento", tipo: "alterado", antes: proc(900), depois: proc(1000), campos_alterados: ["vl_sa"] });
const incluidoA = base({ competencia: "202609", tabela: "rl_procedimento_ocupacao", tipo: "incluido", depois: cbo("225125", "Médico clínico") });
const incluidoB = base({ competencia: "202609", tabela: "rl_procedimento_ocupacao", tipo: "incluido", depois: cbo("225130", "Médico de família") });
const excluido = base({ competencia: "202607", tabela: "rl_procedimento_cid", tipo: "excluido", antes: linha([campo("co_procedimento", "0301010072"), campo("co_cid", "I10")], [nome("tb_cid", "co_cid", { no_cid: "Hipertensão" })]) });

test("agrupa por competência, da mais recente para a mais antiga", () => {
  const g = montarGrupos(historico([excluido, alterado, incluidoA]), { tipo: "tudo", tabela: "" });
  expect(g.map((x) => x.competencia)).toEqual(["202609", "202607"]);
  expect(g[0]!.rotulo).toBe("09/2026");
});

test("alterado: campo, antes e depois formatados; nome legível do campo", () => {
  const c = montarGrupos(historico([alterado]), { tipo: "tudo", tabela: "" })[0]!.cartoes[0]!;
  expect(c).toMatchObject({ tipo: "alterado", nome: "Procedimento" });
  expect(c.mudancas.map((m) => [m.campo, nbsp(m.antes), nbsp(m.depois)])).toEqual([["Valor do serviço ambulatorial", "R$ 9,00", "R$ 10,00"]]);
});

test("incluídos da mesma tabela e competência viram um só cartão com os itens", () => {
  const cartoes = montarGrupos(historico([incluidoA, incluidoB]), { tipo: "tudo", tabela: "" })[0]!.cartoes;
  expect(cartoes).toHaveLength(1);
  expect(cartoes[0]!.itens).toEqual(["225125 Médico clínico", "225130 Médico de família"]);
  expect(cartoes[0]!.nome).toBe("CBO");
});

test("procedimento incluído mostra o código mascarado", () => {
  const e = base({ competencia: "202604", tabela: "tb_procedimento", tipo: "incluido", depois: proc(800) });
  expect(montarGrupos(historico([e]), { tipo: "tudo", tabela: "" })[0]!.cartoes[0]!.itens).toEqual(["03.01.01.007-2"]);
});

test("tabela ausente ou de volta vira nota em vez de 'excluído' seco", () => {
  const a = base({ competencia: "202607", tabela: "rl_procedimento_cid", tipo: "excluido", tabela_ausente: true, antes: excluido.antes });
  const v = base({ competencia: "202608", tabela: "rl_procedimento_cid", tipo: "incluido", tabela_voltou: true, depois: excluido.antes });
  const cartoes = montarGrupos(historico([a, v]), { tipo: "tudo", tabela: "" }).flatMap((g) => g.cartoes);
  expect(cartoes.map((c) => c.nota)).toEqual(["a tabela voltou a vir no ZIP", "a tabela não veio no ZIP desta competência"]);
});

test("filtros: valores, exigências e tabela", () => {
  const h = historico([alterado, incluidoA, excluido]);
  const ids = (f: { tipo: "tudo" | "valores" | "exigencias"; tabela: string }) => montarGrupos(h, f).flatMap((g) => g.cartoes.map((c) => c.tabela));
  expect(ids({ tipo: "valores", tabela: "" })).toEqual(["tb_procedimento"]);
  expect(ids({ tipo: "exigencias", tabela: "" })).toEqual(["rl_procedimento_ocupacao", "rl_procedimento_cid"]);
  expect(ids({ tipo: "tudo", tabela: "rl_procedimento_cid" })).toEqual(["rl_procedimento_cid"]);
  expect(tabelasDoHistorico(h).map((t) => t.rotulo)).toEqual(["Procedimento", "CBO", "CID"]);
});

test("contagem por competência conta os eventos sem filtro", () => {
  expect(contagemPorCompetencia(historico([alterado, incluidoA, incluidoB, excluido]))).toEqual({ "202609": 3, "202607": 1 });
});
