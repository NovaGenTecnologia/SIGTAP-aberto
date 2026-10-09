import { useSyncExternalStore } from "react";

export interface OrigemDaPendencia { titulo: string }

let atual: OrigemDaPendencia | null = null;
const ouvintes = new Set<() => void>();

/** A pendência de onde o usuário abriu uma área; vive na memória, só para a faixa "Você veio de". */
export const lerOrigem = () => atual;
export function definirOrigem(o: OrigemDaPendencia | null) {
  atual = o;
  ouvintes.forEach((f) => f());
}
const assinar = (f: () => void) => { ouvintes.add(f); return () => { ouvintes.delete(f); }; };
export const useOrigem = () => useSyncExternalStore(assinar, lerOrigem);
