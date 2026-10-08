import type { ItemProcedimento } from "../../../api/tipos";
import type { TabelaDaRelacao } from "./tabelaRelacao";
import { planilhaDaRelacao, planilhaDeProcedimentos } from "./planilha";

const item = (codigo: string, mascarado: string, nome: string, centavos: number): ItemProcedimento => ({
  codigo, codigo_mascarado: mascarado, nome, tp_complexidade: "2", complexidade: "Média", valor_total_centavos: centavos,
  instrumentos: ["BPA-C", "BPA-I"], forma: "030101", forma_nome: "Consultas médicas",
});

test("lista de procedimentos: todas as linhas, cabeçalhos legíveis, código como texto e valor em reais", () => {
  const itens = Array.from({ length: 450 }, (_, i) => item(`03010100${String(i).padStart(2, "0")}`, `03.01.01.00${i}-0`, `Nome ${i}`, 1000 + i));
  const p = planilhaDeProcedimentos(itens, "Busca: consulta");
  expect(p.titulo).toBe("Busca: consulta");
  expect(p.abas).toHaveLength(1);
  const aba = p.abas[0]!;
  expect(aba.colunas).toEqual(["Código", "Nome", "Complexidade", "Valor total (R$)", "Instrumentos", "Forma"]);
  expect(aba.linhas).toHaveLength(450);
  expect(aba.linhas[0]).toEqual(["03.01.01.00" + "0-0", "Nome 0", "Média", 10, "BPA-C, BPA-I", "03.01.01 Consultas médicas"]);
  expect(aba.linhas[1]![3]).toBe(10.01);
});

test("relação: código e nome em colunas separadas, repetições quando há, todas as linhas", () => {
  const tabela: TabelaDaRelacao = {
    colunas: [{ id: "co_cbo", rotulo: "Ocupação" }],
    temRepeticoes: true,
    linhas: [
      { id: "1", repeticoes: 1, busca: "", celulas: { co_cbo: { codigo: "225125", nome: "Médico clínico", textos: [], falta: null, procedimento: null } } },
      { id: "2", repeticoes: 2, busca: "", celulas: { co_cbo: { codigo: "225130", nome: null, textos: [], falta: "sem nome nesta competência", procedimento: null } } },
    ],
  };
  const p = planilhaDaRelacao("CBO", tabela);
  expect(p.titulo).toBe("CBO");
  expect(p.abas[0]!.nome).toBe("CBO");
  expect(p.abas[0]!.colunas).toEqual(["Ocupação (código)", "Ocupação (nome)", "Repetições no arquivo"]);
  expect(p.abas[0]!.linhas).toEqual([["225125", "Médico clínico", 1], ["225130", "", 2]]);
});
