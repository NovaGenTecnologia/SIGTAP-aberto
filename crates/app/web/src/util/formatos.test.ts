import { reais, inteiro, rotuloCompetencia, ordenarCompetencias } from "./formatos";

test("ordenarCompetencias ordena por AAAAMM sem alterar a lista original", () => {
  const original = [{ competencia: "202609" }, { competencia: "202601" }, { competencia: "202612" }];
  expect(ordenarCompetencias(original).map((c) => c.competencia)).toEqual(["202601", "202609", "202612"]);
  expect(original[0]!.competencia).toBe("202609");
});

test("reais formata centavos em moeda brasileira", () => {
  expect(reais(123456).replace(/\u00a0/g, " ")).toBe("R$ 1.234,56");
  expect(reais(0).replace(/\u00a0/g, " ")).toBe("R$ 0,00");
});
test("inteiro usa ponto de milhar", () => { expect(inteiro(1234567)).toBe("1.234.567"); });
test("rotuloCompetencia converte AAAAMM em MM/AAAA", () => {
  expect(rotuloCompetencia("202609")).toBe("09/2026");
  expect(rotuloCompetencia("x")).toBe("x");
});

import { tamanho } from "./formatos";
test.each([
  [0, "0 B"], [512, "512 B"], [1536, "1,5 KB"], [734003200, "700 MB"], [1375874564, "1,3 GB"], [135774208, "129,5 MB"],
])("tamanho(%i) = %s", (bytes, texto) => expect(tamanho(bytes)).toBe(texto));

import { comSinal, percentual } from "./formatos";
test("percentual usa o sinal de menos e arredonda", () => {
  expect(percentual(22.4)).toBe("22%");
  expect(percentual(-22.4)).toBe("−22%");
  expect(percentual(0)).toBe("0%");
  expect(percentual(-0.2)).toBe("0%");
});
test("comSinal mostra mais, menos e zero", () => {
  expect(comSinal(100).replace(/\u00a0/g, " ")).toBe("+R$ 1,00");
  expect(comSinal(-100).replace(/\u00a0/g, " ")).toBe("−R$ 1,00");
  expect(comSinal(0).replace(/\u00a0/g, " ")).toBe("R$ 0,00");
});

import { intervaloDeCompetencias, reaisCompacto } from "./formatos";
test("reaisCompacto abrevia milhões e milhares em reais", () => {
  const n = (s: string) => s.replace(/\u00a0/g, " ");
  expect(n(reaisCompacto(310_000_000))).toBe("R$ 3,1 mi");
  expect(n(reaisCompacto(120_000_000))).toBe("R$ 1,2 mi");
  expect(n(reaisCompacto(85_000_000))).toBe("R$ 850 mil");
  expect(n(reaisCompacto(123_456))).toBe("R$ 1.234,56");
});
test("intervaloDeCompetencias mostra o ano uma vez quando é o mesmo", () => {
  expect(intervaloDeCompetencias(["202604", "202605", "202606"])).toBe("04–06/2026");
  expect(intervaloDeCompetencias(["202511", "202602"])).toBe("11/2025–02/2026");
  expect(intervaloDeCompetencias(["202604"])).toBe("04/2026");
  expect(intervaloDeCompetencias([])).toBe("");
});
