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
