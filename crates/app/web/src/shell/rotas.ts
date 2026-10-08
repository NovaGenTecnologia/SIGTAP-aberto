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

/** Como `ir`, mas troca a entrada atual do histórico (para estado que muda a cada pausa de digitação). */
export function substituir(destino: Destino | "galeria", ...resto: string[]): void {
  window.history.replaceState(null, "", "#/" + [destino, ...resto].join("/"));
  window.dispatchEvent(new HashChangeEvent("hashchange"));
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

// ---- Consultar: o estado da tela mora na rota, para o Voltar restaurar tudo ----
export type AbaFicha = "resumo" | "exigencias" | "historico";
export type TelaConsultar =
  | { tela: "buscar"; texto: string }
  | { tela: "explorar"; arvore: "procedimentos" | "cid"; no: string | null }
  | { tela: "ficha"; codigo: string; aba: AbaFicha; secao?: string };

const ABAS: AbaFicha[] = ["resumo", "exigencias", "historico"];

function decodificar(t: string): string {
  try { return decodeURIComponent(t); } catch { return t; }
}

/** Código de procedimento (10 dígitos), com ou sem máscara; senão `null`. */
function codigoDe(segmento: string): string | null {
  const limpo = segmento.replace(/[.-]/g, "");
  return /^\d{10}$/.test(limpo) && /^[\d.-]+$/.test(segmento) ? limpo : null;
}

export function lerConsultar(resto: string[]): TelaConsultar {
  const [primeiro, segundo, terceiro] = resto;
  if (primeiro === "q") return { tela: "buscar", texto: decodificar(segundo ?? "") };
  if (primeiro === "explorar") {
    const arvore = segundo === "cid" ? "cid" : "procedimentos";
    const no = segundo === "cid" || segundo === "procedimentos" ? terceiro : segundo;
    return { tela: "explorar", arvore, no: no ? decodificar(no) : null };
  }
  const codigo = primeiro ? codigoDe(primeiro) : null;
  if (codigo) {
    const aba = ABAS.find((a) => a === segundo) ?? "resumo";
    return terceiro && aba !== "resumo" ? { tela: "ficha", codigo, aba, secao: decodificar(terceiro) } : { tela: "ficha", codigo, aba };
  }
  return { tela: "buscar", texto: "" };
}

/** Segmentos para `ir("consultar", ...caminhoConsultar(t))`. */
export function caminhoConsultar(t: TelaConsultar): string[] {
  if (t.tela === "buscar") return t.texto.trim() ? ["q", encodeURIComponent(t.texto.trim())] : [];
  if (t.tela === "explorar") {
    if (t.arvore === "cid") return t.no ? ["explorar", "cid", encodeURIComponent(t.no)] : ["explorar", "cid"];
    return t.no ? ["explorar", "procedimentos", encodeURIComponent(t.no)] : ["explorar"];
  }
  if (t.aba === "resumo") return [t.codigo];
  return t.secao ? [t.codigo, t.aba, encodeURIComponent(t.secao)] : [t.codigo, t.aba];
}
