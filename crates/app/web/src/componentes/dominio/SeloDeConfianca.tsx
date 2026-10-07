import type { ReactElement } from "react";
import "./dominio.css";

export type Confianca = "confirmada" | "nao-confirmada" | "estimativa" | "prova-indireta" | "informativo";

const ROTULO: Record<Confianca, string> = {
  "confirmada": "Confirmada",
  "nao-confirmada": "Não confirmada",
  "estimativa": "Estimativa",
  "prova-indireta": "Prova indireta",
  "informativo": "Informativo",
};

const FORMA: Record<Confianca, ReactElement> = {
  "confirmada": <><circle cx="8" cy="8" r="7" fill="currentColor" /><path d="M4.6 8.2l2.3 2.3 4.5-4.7" fill="none" stroke="var(--cor-superficie)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></>,
  "nao-confirmada": <circle cx="8" cy="8" r="6.2" fill="none" stroke="currentColor" strokeWidth="1.8" strokeDasharray="3 2.4" />,
  "estimativa": <path d="M2.5 9c1.3-3 2.7-3 4-1s2.7 2 4-1 2.7-2 3.5 0" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />,
  "prova-indireta": <path d="M8 1.5L14.5 8 8 14.5 1.5 8z" fill="currentColor" />,
  "informativo": <><circle cx="8" cy="8" r="7" fill="currentColor" /><path d="M8 7.2v4M8 4.6v.1" stroke="var(--cor-superficie)" strokeWidth="1.8" strokeLinecap="round" /></>,
};

export function SeloDeConfianca({ estado, texto }: { estado: Confianca; texto?: string }) {
  return (
    <span className={`selo selo--${estado}`}>
      <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">{FORMA[estado]}</svg>
      <span>{texto ?? ROTULO[estado]}</span>
    </span>
  );
}
