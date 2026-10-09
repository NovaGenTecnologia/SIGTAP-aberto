import { descreverItem, nomeDoProcedimento, SECOES, secaoDaTabela, totalDoValor, variacaoDoValor } from "./modelo";
import { caminhoMudancas, lerMudancas } from "../../shell/rotas";
import type { ItemDeMudanca, LinhaOficial } from "../../api/tipos";

const linha = (nomes: LinhaOficial["nomes"]): LinhaOficial => ({ quantidade: 1, campos: [], nomes });
const item = (chave: Record<string, string>, depois: LinhaOficial | null, tipo: ItemDeMudanca["tipo"] = "incluido"): ItemDeMudanca =>
  ({ tipo, chave, antes: null, depois, campos_alterados: [] });

test("totalDoValor soma ambulatorial, hospitalar e profissional (em centavos)", () => {
  expect(totalDoValor({ sa: 100, sh: 20, sp: 3 })).toBe(123);
});

test("variacaoDoValor é percentual sobre o valor antes; sem valor antes não há variação", () => {
  expect(variacaoDoValor({ sa: 1000, sh: 0, sp: 0 }, { sa: 1100, sh: 0, sp: 0 })).toBeCloseTo(10);
  expect(variacaoDoValor({ sa: 1000, sh: 0, sp: 0 }, { sa: 900, sh: 0, sp: 0 })).toBeCloseTo(-10);
  expect(variacaoDoValor({ sa: 0, sh: 0, sp: 0 }, { sa: 900, sh: 0, sp: 0 })).toBeNull();
});

test("nomeDoProcedimento e descreverItem leem os nomes que o Rust já trouxe", () => {
  const depois = linha([
    { tabela: "tb_procedimento", colunas: ["co_procedimento"], tabela_presente: true, encontrados: [{ no_procedimento: "CONSULTA MEDICA" }] },
    { tabela: "tb_habilitacao", colunas: ["co_habilitacao"], tabela_presente: true, encontrados: [{ no_habilitacao: "Cardiologia" }] },
  ]);
  const i = item({ co_procedimento: "0301010072", co_habilitacao: "1802" }, depois);
  expect(nomeDoProcedimento(i)).toBe("CONSULTA MEDICA");
  expect(descreverItem(i)).toBe("1802 Cardiologia");
});

test("descreverItem de item excluído usa a linha de antes e, sem nome, só o código", () => {
  const antes = linha([{ tabela: "tb_habilitacao", colunas: ["co_habilitacao"], tabela_presente: true, encontrados: [{ no_habilitacao: "Oftalmologia" }] }]);
  const i: ItemDeMudanca = { tipo: "excluido", chave: { co_procedimento: "0301010072", co_habilitacao: "1801" }, antes, depois: null, campos_alterados: [] };
  expect(descreverItem(i)).toBe("1801 Oftalmologia");
  expect(descreverItem(item({ co_procedimento: "1", co_forma: "010101" }, null))).toBe("010101");
  expect(nomeDoProcedimento(item({ co_procedimento: "1" }, null))).toBeNull();
});

test("as tabelas técnicas caem nas quatro seções, com cadastro e auxiliares como resto", () => {
  expect(secaoDaTabela("rl_procedimento_habilitacao")).toBe("habilitacoes");
  expect(secaoDaTabela("rl_procedimento_regra_cond")).toBe("regras");
  expect(secaoDaTabela("rl_procedimento_incremento")).toBe("incrementos");
  expect(secaoDaTabela("tb_cid")).toBe("cadastro");
  expect(SECOES.map((s) => s.id)).toEqual(["habilitacoes", "regras", "incrementos", "cadastro"]);
});

test("a rota de Mudanças guarda De, Para e o filtro, e ignora o que não é competência", () => {
  expect(lerMudancas([])).toEqual({ de: null, para: null, soAfeta: false });
  expect(lerMudancas(["202608", "202609", "afeta"])).toEqual({ de: "202608", para: "202609", soAfeta: true });
  expect(lerMudancas(["x", "202609"])).toEqual({ de: null, para: "202609", soAfeta: false });
  expect(caminhoMudancas({ de: "202608", para: "202609", soAfeta: true })).toEqual(["202608", "202609", "afeta"]);
  expect(caminhoMudancas({ de: null, para: null, soAfeta: false })).toEqual([]);
  expect(caminhoMudancas({ de: null, para: "202609", soAfeta: false })).toEqual(["-", "202609"]);
  expect(lerMudancas(["-", "202609"])).toEqual({ de: null, para: "202609", soAfeta: false });
});
