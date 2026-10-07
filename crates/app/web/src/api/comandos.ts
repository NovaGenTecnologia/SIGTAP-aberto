import { chamar } from "./tauri";
import type { Busca, InfoPrograma, Situacao, SituacaoCnes } from "./tipos";

export const situacao = () => chamar<Situacao>("situacao");
export const cnesSituacao = () => chamar<SituacaoCnes>("cnes_situacao");
export const unidadeDefinir = (uf: string, cnes: string) => chamar<unknown>("unidade_definir", { uf, cnes });
export const buscar = (texto: string, competencia?: string) =>
  chamar<Busca>("buscar", { competencia: competencia ?? null, texto });
export const infoPrograma = () => chamar<InfoPrograma>("info_programa");
