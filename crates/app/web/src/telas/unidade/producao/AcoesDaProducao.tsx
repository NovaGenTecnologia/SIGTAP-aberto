import { createContext, useContext, type ReactNode } from "react";
import { createPortal } from "react-dom";

/** O lugar, no cabeçalho, onde cada aba põe a sua ação (Exportar), para ela ficar sempre no canto de cima. */
const Lugar = createContext<HTMLElement | null>(null);
export const LugarDasAcoes = Lugar.Provider;

export function NoCabecalho({ children }: { children: ReactNode }) {
  const lugar = useContext(Lugar);
  return lugar ? createPortal(children, lugar) : null;
}
