import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from "react";
import "./superficie.css";

type Tipo = "info" | "ok" | "erro";
interface Aviso { id: number; texto: string; tipo: Tipo }
interface ContextoAvisos { avisar: (texto: string, tipo?: Tipo) => void }

const Contexto = createContext<ContextoAvisos>({ avisar: () => {} });
export const useAvisos = () => useContext(Contexto);

export function ProvedorDeAvisos({ children }: { children: ReactNode }) {
  const [avisos, setAvisos] = useState<Aviso[]>([]);
  const proximo = useRef(1);
  const avisar = useCallback((texto: string, tipo: Tipo = "info") => {
    const id = proximo.current++;
    setAvisos((a) => [...a, { id, texto, tipo }]);
    setTimeout(() => setAvisos((a) => a.filter((x) => x.id !== id)), 6000);
  }, []);
  const valor = useMemo(() => ({ avisar }), [avisar]);
  return (
    <Contexto.Provider value={valor}>
      {children}
      <div role="status" aria-live="polite" className="avisos">
        {avisos.map((a) => <p key={a.id} className={`avisos__item avisos__item--${a.tipo}`}>{a.texto}</p>)}
      </div>
    </Contexto.Provider>
  );
}
