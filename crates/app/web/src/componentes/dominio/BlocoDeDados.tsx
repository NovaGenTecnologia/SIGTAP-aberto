import { useId, type ReactNode } from "react";
import "./dominio.css";

export function BlocoDeDados({ titulo, acoes, children }: { titulo: string; acoes?: ReactNode; children: ReactNode }) {
  const id = useId();
  return (
    <section className="bloco" aria-labelledby={id}>
      <header className="bloco__topo">
        <h2 id={id} className="bloco__titulo">{titulo}</h2>
        {acoes && <div className="bloco__acoes">{acoes}</div>}
      </header>
      {children}
    </section>
  );
}
