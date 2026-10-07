import { useEffect, useState } from "react";

export type Destino = "painel" | "consultar" | "mudancas" | "conferir" | "dados";
export const DESTINOS: { id: Destino; rotulo: string }[] = [
  { id: "painel", rotulo: "Painel" },
  { id: "consultar", rotulo: "Consultar" },
  { id: "mudancas", rotulo: "Mudanças" },
  { id: "conferir", rotulo: "Conferir arquivo" },
  { id: "dados", rotulo: "Dados" },
];

export interface Rota { destino: Destino | "galeria"; resto: string[] }

export function lerRota(hash: string): Rota {
  const [primeiro, ...resto] = hash.replace(/^#\/?/, "").split("/").filter(Boolean);
  if (primeiro === "galeria") return { destino: "galeria", resto: [] };
  const destino = DESTINOS.find((d) => d.id === primeiro)?.id;
  return destino ? { destino, resto } : { destino: "painel", resto: [] };
}

export function ir(destino: Destino | "galeria", ...resto: string[]): void {
  window.location.hash = "#/" + [destino, ...resto].join("/");
}

export function useRota(): Rota {
  const [rota, setRota] = useState(() => lerRota(window.location.hash));
  useEffect(() => {
    const aoMudar = () => setRota(lerRota(window.location.hash));
    window.addEventListener("hashchange", aoMudar);
    return () => window.removeEventListener("hashchange", aoMudar);
  }, []);
  return rota;
}
