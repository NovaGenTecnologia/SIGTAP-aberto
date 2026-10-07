import type { ReactNode } from "react";
import "./dominio.css";

export function AvisoDeLimite({ children }: { children: ReactNode }) {
  return (
    <p role="note" className="limite">
      <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="7" fill="currentColor" /><path d="M8 7.2v4M8 4.6v.1" stroke="var(--cor-superficie)" strokeWidth="1.8" strokeLinecap="round" /></svg>
      <span>{children}</span>
    </p>
  );
}
