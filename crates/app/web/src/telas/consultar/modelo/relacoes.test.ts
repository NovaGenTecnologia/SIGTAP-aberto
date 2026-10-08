import type { Ficha, RelacaoOficial } from "../../../api/tipos";
import { agruparRelacoes, nomeDaRelacao } from "./relacoes";

const rel = (tabela: string, coluna: string, n: number): RelacaoOficial => ({
  tabela, coluna, linhas: Array.from({ length: n }, () => ({ quantidade: 1, campos: [], nomes: [] })),
});
const ficha = (relacoes: RelacaoOficial[]): Ficha => ({
  competencia: "202609", rotulo: "09/2026", codigo: "0301010072", codigo_mascarado: "03.01.01.007-2", estrutura: [], procedimento: [], relacoes,
});

test("três grupos na ordem; vazias separadas; desconhecida cai em Relações", () => {
  const g = agruparRelacoes(ficha([
    rel("rl_procedimento_cid", "co_procedimento", 3),
    rel("rl_procedimento_habilitacao", "co_procedimento", 0),
    rel("rl_procedimento_compativel", "co_procedimento_principal", 2),
    rel("rl_novo", "x", 1),
    rel("tb_descricao", "co_procedimento", 1),
  ]));
  expect(g.map((x) => x.id)).toEqual(["exigencias", "valores", "relacoes"]);
  expect(g.map((x) => x.rotulo)).toEqual(["Exigências para cobrar", "Valores e regras", "Relações"]);
  expect(g[0]!.relacoes.map((r) => r.tabela)).toEqual(["rl_procedimento_cid"]);
  expect(g[0]!.vazias.map((r) => r.tabela)).toEqual(["rl_procedimento_habilitacao"]);
  expect(g[2]!.relacoes.map((r) => nomeDaRelacao(r))).toEqual(["Compatíveis", "rl_novo (x)"]);
  expect(g.flatMap((x) => [...x.relacoes, ...x.vazias]).some((r) => r.tabela === "tb_descricao")).toBe(false);
});
test("ordem dentro do grupo segue a lista oficial, não a da ficha", () => {
  const g = agruparRelacoes(ficha([rel("rl_procedimento_ocupacao", "co_procedimento", 1), rel("rl_procedimento_registro", "co_procedimento", 1)]));
  expect(g[0]!.relacoes.map((r) => nomeDaRelacao(r))).toEqual(["Instrumento", "CBO"]);
});
test("nomes conhecidos", () => {
  expect(nomeDaRelacao(rel("rl_procedimento_cid", "co_procedimento", 0))).toBe("CID");
});
