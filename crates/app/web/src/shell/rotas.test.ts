import { DESTINOS, lerRota } from "./rotas";

test("os cinco destinos, na ordem da spec", () => {
  expect(DESTINOS.map((d) => d.rotulo)).toEqual(["Painel", "Consultar", "Mudanças", "Conferir arquivo", "Dados"]);
});
test("lerRota entende hash vazio, destino, resto e galeria", () => {
  expect(lerRota("")).toEqual({ destino: "painel", resto: [] });
  expect(lerRota("#/consultar/0301010072")).toEqual({ destino: "consultar", resto: ["0301010072"] });
  expect(lerRota("#/galeria")).toEqual({ destino: "galeria", resto: [] });
  expect(lerRota("#/qualquer-coisa")).toEqual({ destino: "painel", resto: [] });
});
