import { FILTROS_NA_ROTA_VAZIOS } from "../../../shell/rotas";
import { paraFiltrosDaBusca } from "./filtros";

test("sem Só favoritos não restringe por código", () => {
  expect(paraFiltrosDaBusca({ ...FILTROS_NA_ROTA_VAZIOS, complexidade: ["2"] }, ["0301010072"])).toEqual({
    tipo: [], complexidade: ["2"], instrumento: [], grupo: [], forma: [], codigos: null,
  });
});

test("com Só favoritos manda os códigos; sem favoritos manda a lista vazia (nada passa)", () => {
  expect(paraFiltrosDaBusca({ ...FILTROS_NA_ROTA_VAZIOS, fav: true }, ["0301010072"]).codigos).toEqual(["0301010072"]);
  expect(paraFiltrosDaBusca({ ...FILTROS_NA_ROTA_VAZIOS, fav: true }, []).codigos).toEqual([]);
});
