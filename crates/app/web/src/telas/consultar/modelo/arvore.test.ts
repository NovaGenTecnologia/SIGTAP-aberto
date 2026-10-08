import type { NoDeArvore, NoDeCid } from "../../../api/tipos";
import {
  achatar, cadeiaDe, capituloDaLetra, deCid, deProcedimentos, mascararNivel, segmentoDoCaminho, tituloDe,
  type EstadoDosFilhos,
} from "./arvore";

const nodeP = (codigo: string, nivel: NoDeArvore["nivel"], nome: string | null, procedimentos = 1): NoDeArvore =>
  ({ nivel, codigo, codigo_mascarado: codigo, nome, procedimentos });
const nodeC = (codigo: string, nivel: NoDeCid["nivel"], nome: string | null, codigos = 2, procedimentos = 5): NoDeCid =>
  ({ nivel, codigo, codigo_mascarado: codigo, nome, codigos, procedimentos });

test("máscara por nível: 03, 03.01, 03.01.01 e o procedimento completo", () => {
  expect(["03", "0301", "030101", "0301010072"].map(mascararNivel)).toEqual(["03", "03.01", "03.01.01", "03.01.01.007-2"]);
});

test("cadeia de pais: do grupo ao nó, sem o próprio nó", () => {
  expect(cadeiaDe("procedimentos", "0301010072")).toEqual(["03", "0301", "030101"]);
  expect(cadeiaDe("procedimentos", "0301")).toEqual(["03"]);
  expect(cadeiaDe("procedimentos", "03")).toEqual([]);
  expect(cadeiaDe("cid", "I119")).toEqual(["I", "I11"]);
  expect(cadeiaDe("cid", "I11")).toEqual(["I"]);
  expect(cadeiaDe("cid", "I")).toEqual([]);
});

test("nós de procedimento: profundidade, folha e contagem só onde há filhos", () => {
  const g = deProcedimentos(nodeP("03", "grupo", "Procedimentos clínicos", 864), null);
  const p = deProcedimentos(nodeP("0301010072", "procedimento", "CONSULTA MEDICA"), "030101");
  expect(g).toMatchObject({ id: "03", mascarado: "03", profundidade: 0, folha: false, contagem: 864, pai: null });
  expect(p).toMatchObject({ id: "0301010072", mascarado: "03.01.01.007-2", profundidade: 3, folha: true, contagem: null, pai: "030101" });
});

test("nós de CID: letra ganha o nome do capítulo; categoria de um código só é folha", () => {
  const letra = deCid(nodeC("I", "letra", null, 700, 362), null);
  expect(letra).toMatchObject({ nome: "Doenças do aparelho circulatório", profundidade: 0, folha: false });
  expect(deCid(nodeC("H", "letra", null), null).nome).toBe("Doenças do olho, anexos e ouvido");
  expect(deCid(nodeC("I10", "categoria", "Hipertensão", 1, 26), "I")).toMatchObject({ folha: true, profundidade: 1 });
  expect(deCid(nodeC("I11", "categoria", "Doença", 3, 7), "I")).toMatchObject({ folha: false });
  expect(deCid(nodeC("I119", "subcategoria", "Doença", 1, 5), "I11")).toMatchObject({ folha: true, profundidade: 2, mascarado: "I119" });
  expect(deCid(nodeC("J01", "categoria", null, 3), "J").nome).toBeNull();
});

test("capítulos da CID-10 cobrem todas as letras usadas", () => {
  for (const l of "ABCDEFGHIJKLMNOPQRSTUVWXYZ") expect(capituloDaLetra(l)).toEqual(expect.any(String));
});

test("título do caminho: número do nível, nome em maiúsculas iniciais e sem espaço na barra", () => {
  const f = deProcedimentos(nodeP("030101", "forma", "Consultas médicas/outros profissionais  de nivel superior", 38), "0301");
  expect(segmentoDoCaminho("procedimentos", f)).toBe("01 Consultas Médicas/Outros Profissionais de Nivel Superior");
  const s = deProcedimentos(nodeP("0301", "subgrupo", "Consultas / Atendimentos / Acompanhamentos", 221), "03");
  expect(segmentoDoCaminho("procedimentos", s)).toBe("01 Consultas/Atendimentos/Acompanhamentos");
  const c = deCid(nodeC("I11", "categoria", "Doença cardíaca hipertensiva", 3), "I");
  expect(segmentoDoCaminho("cid", c)).toBe("I11 Doença cardíaca hipertensiva");
  expect(tituloDe("PROCEDIMENTOS CLÍNICOS")).toBe("Procedimentos Clínicos");
});

const ok = (...nos: ReturnType<typeof deProcedimentos>[]): EstadoDosFilhos => ({ estado: "ok", nos });
const grupo03 = deProcedimentos(nodeP("03", "grupo", "Procedimentos clínicos", 864), null);
const grupo04 = deProcedimentos(nodeP("04", "grupo", "Procedimentos cirúrgicos", 1698), null);
const sub0301 = deProcedimentos(nodeP("0301", "subgrupo", "Consultas", 221), "03");

test("achatar: só entra o que está aberto, na ordem da árvore, com a profundidade", () => {
  const filhos = new Map<string, EstadoDosFilhos>([["", ok(grupo03, grupo04)], ["03", ok(sub0301)]]);
  expect(achatar(filhos, new Set(), {}).map((l) => (l.tipo === "no" ? l.no.id : l.tipo))).toEqual(["03", "04"]);
  const l = achatar(filhos, new Set(["03"]), {});
  expect(l.map((x) => [x.tipo, x.tipo === "no" ? x.no.id : "", x.profundidade])).toEqual([["no", "03", 0], ["no", "0301", 1], ["no", "04", 0]]);
});

test("achatar: nó aberto ainda carregando mostra a linha de espera; com erro, a de tentar de novo", () => {
  const filhos = new Map<string, EstadoDosFilhos>([["", ok(grupo03, grupo04)], ["03", { estado: "carregando" }], ["04", { estado: "erro", mensagem: "falhou" }]]);
  const l = achatar(filhos, new Set(["03", "04"]), {});
  expect(l.map((x) => x.tipo)).toEqual(["no", "carregando", "no", "erro"]);
});

test("achatar: lista longa é cortada no limite e ganha 'Mostrar mais'", () => {
  const muitos = Array.from({ length: 450 }, (_, i) => deProcedimentos(nodeP(`03010100${String(i).padStart(2, "0")}`, "procedimento", `P${i}`), "030101"));
  const filhos = new Map<string, EstadoDosFilhos>([["", ok(grupo03)], ["03", ok(...muitos)]]);
  const l = achatar(filhos, new Set(["03"]), {});
  expect(l.filter((x) => x.tipo === "no")).toHaveLength(1 + 200);
  const mais = l.find((x) => x.tipo === "mais");
  expect(mais).toMatchObject({ pai: "03", restantes: 250 });
  expect(achatar(filhos, new Set(["03"]), { "03": 400 }).filter((x) => x.tipo === "no")).toHaveLength(1 + 400);
});

test("nó carregado sem filhos deixa de parecer expansível", () => {
  const filhos = new Map<string, EstadoDosFilhos>([["", ok(grupo03)], ["03", ok()]]);
  const l = achatar(filhos, new Set(["03"]), {});
  expect(l[0]).toMatchObject({ tipo: "no", expansivel: false });
});
