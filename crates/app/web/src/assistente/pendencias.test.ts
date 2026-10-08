import type { FimDeTarefa, Fonte, Situacao, SituacaoCnesCompleta } from "../api/tipos";
import type { TarefaDeFonte } from "../dados/tarefas";
import { pendencias } from "./pendencias";

const VAZIA: Situacao = { primeira_execucao: true, bloqueio: null, competencias: [], territorio: null, pasta_dados: "", ocupado: false, recuperacao: null };
const COMP = { competencia: "202609", rotulo: "09/2026", arquivo: "x.zip", versao: null, publicado_em: null, sha256: "" };
const SIGTAP_OK: Situacao = { ...VAZIA, competencias: [COMP], territorio: { ok: true } };
const arq = (tipo: string) => ({ tipo, uf: "SP", competencia: "202608", arquivo: `${tipo}SP2608.dbc`, bytes: 1, registros_gravados: 1, carregado_em: "" });
const cnes = (tipos: string[]): SituacaoCnesCompleta => ({
  minha: { uf: "SP", cnes: "2077396", nome: "X" }, unidades: [], ufs_disponiveis: ["SP"],
  ufs: [{ uf: "SP", resumo: { arquivos: tipos.map(arq) } }],
});
const parada = (): TarefaDeFonte => ({ ativa: false, progresso: null, fim: null, naFila: 0 });
const tarefas = (extra: Partial<Record<Fonte, TarefaDeFonte>> = {}) => ({ sigtap: parada(), cnes: parada(), producao: parada(), ...extra });
const opcoes = { ufEscolhida: "SP" as string | null, pulouUnidade: false };

test("SIGTAP sem competência é pendência do SIGTAP; com competência e sem território, do território", () => {
  expect(pendencias(VAZIA, cnes(["ST"]), tarefas(), opcoes).map((p) => p.id)).toContain("sigtap");
  const semTerritorio = { ...SIGTAP_OK, territorio: null };
  expect(pendencias(semTerritorio, cnes(["ST", "HB"]), tarefas(), opcoes).map((p) => p.id)).toEqual(["territorio"]);
});

test("CNES sem o restante carregado pende; com HB carregado não", () => {
  expect(pendencias(SIGTAP_OK, cnes(["ST"]), tarefas(), opcoes).map((p) => p.id)).toEqual(["cnes"]);
  expect(pendencias(SIGTAP_OK, cnes(["ST", "HB", "SR", "LT", "EQ"]), tarefas(), opcoes)).toEqual([]);
});

test("quem pulou a unidade não fica esperando o restante do CNES", () => {
  const rodando: TarefaDeFonte = { ...parada(), ativa: true };
  expect(pendencias(SIGTAP_OK, cnes(["ST"]), tarefas({ cnes: rodando }), { ufEscolhida: "SP", pulouUnidade: true })).toEqual([]);
});

test("meses extras do SIGTAP e produção nunca entram", () => {
  const rodando: TarefaDeFonte = { ...parada(), ativa: true, naFila: 3 };
  expect(pendencias(SIGTAP_OK, cnes(["ST", "HB"]), tarefas({ sigtap: rodando, producao: rodando }), opcoes)).toEqual([]);
});

test("a pendência carrega a tarefa da fonte, inclusive a falha", () => {
  const fim: FimDeTarefa = { fonte: "cnes", tarefa: 2, ok: false, cancelada: false, mensagem: "sem rede" };
  const t = { ...parada(), fim };
  const [p] = pendencias(SIGTAP_OK, cnes(["ST"]), tarefas({ cnes: t }), opcoes);
  expect(p).toMatchObject({ id: "cnes", fonte: "cnes", rotulo: "CNES" });
  expect(p?.tarefa.fim?.mensagem).toBe("sem rede");
});

test("sem a situação do CNES ainda, não inventa pendência de CNES", () => {
  expect(pendencias(SIGTAP_OK, undefined, tarefas(), opcoes)).toEqual([]);
});
