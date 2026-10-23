import type { FiltrosDaBusca } from "../../../api/tipos";
import type { FiltrosNaRota } from "../../../shell/rotas";

/** Filtros da rota no formato do comando de busca; `Só favoritos` vira a lista de códigos dos favoritos. */
export function paraFiltrosDaBusca(f: FiltrosNaRota, favoritos: string[]): FiltrosDaBusca {
  return {
    tipo: f.tipo, complexidade: f.complexidade, instrumento: f.instrumento, grupo: f.grupo, forma: f.forma,
    codigos: f.fav ? favoritos : null,
  };
}
