import { ouvir } from "./tauri";
import type { FimTarefa, Progresso } from "./tipos";

export const ouvirProgresso = (cb: (p: Progresso) => void) => ouvir<Progresso>("progresso", cb);
export const ouvirFimTarefa = (cb: (f: FimTarefa) => void) => ouvir<FimTarefa>("tarefa_fim", cb);
