import { citamENaoProduzem } from "./citam";
import { aptidaoExemplo } from "../exemplos";

test("só as vigentes que citam e não produzem entram; sem produção devolve nulo", () => {
  const r = citamENaoProduzem(aptidaoExemplo());
  expect(r?.map((h) => h.codigo)).toEqual(["3801"]); // 2601 também não produz, mas está encerrada
  expect(citamENaoProduzem(aptidaoExemplo({ sem_producao: true }))).toBeNull();
  expect(citamENaoProduzem(undefined)).toBeNull();
  expect(citamENaoProduzem(aptidaoExemplo({ habilitacoes: null }))).toBeNull();
});
