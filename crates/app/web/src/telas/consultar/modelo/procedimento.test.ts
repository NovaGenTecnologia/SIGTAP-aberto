import { complexidadeCurta, instrumentosCurtos } from "./procedimento";

test("complexidade perde o sufixo repetido", () => {
  expect(complexidadeCurta("Média Complexidade")).toBe("Média");
  expect(complexidadeCurta("Atenção Básica Complexidade")).toBe("Atenção Básica");
  expect(complexidadeCurta("Alta Complexidade")).toBe("Alta");
  expect(complexidadeCurta(null)).toBe("—");
});

test("instrumentos ficam só com a sigla, sem repetir", () => {
  expect(instrumentosCurtos(["BPA (Consolidado)", "BPA (Individualizado)", "APAC (Proc. Principal)"])).toBe("BPA · APAC");
  expect(instrumentosCurtos(["AIH (Proc. Especial)", "AIH (Proc. Secundário)", "e-SUS APS (Atenção Primária à Saúde)"])).toBe("AIH · e-SUS APS");
  expect(instrumentosCurtos([])).toBe("—");
});
