import { ouvir } from "./tauri";
import type { FimDeTarefa, ProgressoDeTarefa } from "./tipos";

export const ouvirProgresso = (cb: (p: ProgressoDeTarefa) => void) => ouvir<ProgressoDeTarefa>("progresso", cb);
export const ouvirFimTarefa = (cb: (f: FimDeTarefa) => void) => ouvir<FimDeTarefa>("tarefa_fim", cb);
export const ouvirPedidoDeFechar = (cb: () => void) => ouvir<null>("pedido_de_fechar", () => cb());
