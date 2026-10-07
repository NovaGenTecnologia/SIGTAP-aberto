import { createContext, useContext, useMemo, useState, type ReactNode } from "react";

interface Sessao { competencia: string | null; definirCompetencia: (c: string) => void }
const Contexto = createContext<Sessao>({ competencia: null, definirCompetencia: () => {} });
export const useSessao = () => useContext(Contexto);

export function ProvedorDaSessao({ children }: { children: ReactNode }) {
  const [competencia, definirCompetencia] = useState<string | null>(null);
  const valor = useMemo(() => ({ competencia, definirCompetencia }), [competencia]);
  return <Contexto.Provider value={valor}>{children}</Contexto.Provider>;
}
