import type { CampoOficial, LinhaOficial } from "../api/tipos";
import { campoDe, mascararProcedimento, normalizarEntrada, textoDoCampo, valorTotalCentavos } from "./campos";

const campo = (o: Partial<CampoOficial>): CampoOficial => ({ coluna: "x", coluna_origem: "X", valor: 0, ...o });
const linha = (campos: CampoOficial[]): LinhaOficial => ({ quantidade: 1, campos, nomes: [] });

test("máscara do procedimento", () => {
  expect(mascararProcedimento("0301010072")).toBe("03.01.01.007-2");
  expect(mascararProcedimento("03")).toBe("03");
});
test("normalizarEntrada só tira a máscara de código inteiro", () => {
  expect(normalizarEntrada("03.01.01.007-2")).toBe("0301010072");
  expect(normalizarEntrada("0301010072")).toBe("0301010072");
  expect(normalizarEntrada("consulta 1.5")).toBe("consulta 1.5");
  expect(normalizarEntrada("  cid I10 ")).toBe("cid I10");
});
describe("textoDoCampo", () => {
  test("centavos em reais", () => expect(textoDoCampo(campo({ unidade: "centavos", valor: 12345 }))).toBe("R$ 123,45"));
  test("meses em anos e meses", () => {
    expect(textoDoCampo(campo({ unidade: "meses", valor: 480 }))).toBe("40 anos");
    expect(textoDoCampo(campo({ unidade: "meses", valor: 18 }))).toBe("1 ano e 6 meses");
    expect(textoDoCampo(campo({ unidade: "meses", valor: 5 }))).toBe("5 meses");
    expect(textoDoCampo(campo({ unidade: "meses", valor: 1 }))).toBe("1 mês");
  });
  test("centésimos de percentual", () => {
    expect(textoDoCampo(campo({ unidade: "centesimos_de_percentual", valor: 2500 }))).toBe("25%");
    expect(textoDoCampo(campo({ unidade: "centesimos_de_percentual", valor: 1250 }))).toBe("12,5%");
  });
  test("sentinela vence a unidade; inferida leva aviso", () => {
    expect(textoDoCampo(campo({ unidade: "meses", valor: 9999, sentinela: "Não se aplica" }))).toBe("Não se aplica");
    expect(textoDoCampo(campo({ valor: 9999, sentinela: "Não se aplica", sentinela_inferida: true }))).toBe("Não se aplica (inferido)");
  });
  test("código com descrição mostra descrição", () => {
    expect(textoDoCampo(campo({ valor: "2", descricao: "Feminino" }))).toBe("Feminino");
  });
  test("nulo e vazio viram traço; texto fica como está", () => {
    expect(textoDoCampo(campo({ valor: null }))).toBe("—");
    expect(textoDoCampo(campo({ valor: "" }))).toBe("—");
    expect(textoDoCampo(campo({ valor: "ABC" }))).toBe("ABC");
    expect(textoDoCampo(campo({ valor: 7 }))).toBe("7");
  });
});
test("valor total soma SH, SA e SP e ignora ausentes", () => {
  const l = linha([campo({ coluna: "vl_sh", valor: 100 }), campo({ coluna: "vl_sa", valor: 250 }), campo({ coluna: "vl_sp", valor: null })]);
  expect(valorTotalCentavos(l)).toBe(350);
  expect(valorTotalCentavos(linha([]))).toBe(0);
});
test("campoDe acha pela coluna", () => {
  const l = linha([campo({ coluna: "a", valor: 1 })]);
  expect(campoDe(l, "a")?.valor).toBe(1);
  expect(campoDe(l, "b")).toBeUndefined();
  expect(campoDe(undefined, "a")).toBeUndefined();
});
