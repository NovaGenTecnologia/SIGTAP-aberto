import { createContext, useCallback, useContext } from "react";
import type { FimDeTarefa, Fonte, ProgressoDeTarefa } from "../api/tipos";

export const FONTES: Fonte[] = ["sigtap", "cnes", "producao"];
const NOMES: Record<Fonte, string> = { sigtap: "SIGTAP", cnes: "CNES", producao: "Produção" };
export const nomeDaFonte = (f: Fonte) => NOMES[f];
export const mensagemOcupado = (f: Fonte) => `Já há um download de ${NOMES[f]} em andamento.`;
// O backend e a trava da tela dizem a mesma frase; quem chama não precisa mostrar esse erro de novo.
export const ehOcupado = (e: unknown) => e instanceof Error && e.message.startsWith("Já há um download de ");

export interface TarefaAtiva { ativa: boolean; progresso: ProgressoDeTarefa | null; fim: FimDeTarefa | null }
export interface TarefaDeFonte extends TarefaAtiva { naFila: number }

export interface ValorDasTarefas {
  tarefas: Record<Fonte, TarefaDeFonte>;
  algumaCarregando: boolean;
  iniciar: (fonte: Fonte, executar: () => Promise<unknown>) => Promise<void>;
  cancelar: (fonte?: Fonte) => Promise<void>;
  limparFim: (fonte: Fonte) => void;
  /** Repete o último pedido da fonte (o que a tela que iniciou registrou em `iniciar`). */
  repetir: (fonte: Fonte) => Promise<void>;
}

export const ContextoDeTarefas = createContext<ValorDasTarefas | null>(null);

function usar(): ValorDasTarefas {
  const v = useContext(ContextoDeTarefas);
  if (!v) throw new Error("TarefasProvider ausente");
  return v;
}

/** Estado de todas as fontes de uma vez (rodapé, assistente). */
export function useTarefas() {
  const { tarefas, algumaCarregando, cancelar, repetir, limparFim } = usar();
  return { tarefas, algumaCarregando, cancelar, repetir, limparFim };
}

/** Um único caminho para baixar, importar e cancelar numa fonte: a tela só chama `iniciar`. */
export function useTarefaAtiva(fonte: Fonte) {
  const v = usar();
  const { iniciar: iniciarNaFonte, cancelar: cancelarNaFonte, limparFim: limparNaFonte } = v;
  const iniciar = useCallback((executar: () => Promise<unknown>) => iniciarNaFonte(fonte, executar), [iniciarNaFonte, fonte]);
  const cancelar = useCallback(() => cancelarNaFonte(fonte), [cancelarNaFonte, fonte]);
  const limparFim = useCallback(() => limparNaFonte(fonte), [limparNaFonte, fonte]);
  return { ...v.tarefas[fonte], iniciar, cancelar, limparFim };
}
