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

// ---- Mudanças: De, Para e o filtro moram na rota ("-" no lugar de um De ainda não escolhido) ----
export interface TelaMudancas { de: string | null; para: string | null; soAfeta: boolean }

const competenciaDe = (t: string | undefined): string | null => (t && /^\d{6}$/.test(t) ? t : null);

export function lerMudancas(resto: string[]): TelaMudancas {
  return { de: competenciaDe(resto[0]), para: competenciaDe(resto[1]), soAfeta: resto[2] === "afeta" };
}

/** Segmentos para `ir("mudancas", ...caminhoMudancas(t))`. */
export function caminhoMudancas(t: TelaMudancas): string[] {
  if (!t.de && !t.para && !t.soAfeta) return [];
  const base = [t.de ?? "-", t.para ?? "-"];
  return t.soAfeta ? [...base, "afeta"] : t.de ? base : t.para ? base : [];
}

// ---- Subtelas da unidade (Painel): Cadastro e Aptidão; o estado da tela mora na rota ----
export type AbaDeCadastro = "habilitacoes" | "servicos" | "leitos" | "equipamentos" | "profissionais" | "terceiros";
export type GrupoDeAptidaoNaRota = "risco" | "oportunidade" | "ordem";
export type AbaDeProducao = "visao-geral" | "rejeicoes" | "procedimentos" | "fora-do-padrao" | "origem-do-valor";
export type TelaDaUnidade =
  | { tela: "painel" }
  | { tela: "producao"; aba: AbaDeProducao; q: string; classe: "A" | "B" | "C" | null; origem: "sia" | "sih"; motivo: string; bloco: string }
  | { tela: "cadastro"; aba: AbaDeCadastro; q: string }
  | { tela: "aptidao"; grupo: GrupoDeAptidaoNaRota | null; q: string; hab: string | null };

const ABAS_DE_CADASTRO: AbaDeCadastro[] = ["habilitacoes", "servicos", "leitos", "equipamentos", "profissionais", "terceiros"];
const GRUPOS: GrupoDeAptidaoNaRota[] = ["risco", "oportunidade", "ordem"];
export const ABAS_DE_PRODUCAO: AbaDeProducao[] = ["visao-geral", "rejeicoes", "procedimentos", "fora-do-padrao", "origem-do-valor"];
const CLASSES: ("A" | "B" | "C")[] = ["A", "B", "C"];

/** A Produção na Visão geral, sem filtro: o que a rota vazia de Produção significa. */
export const PRODUCAO_NA_VISAO_GERAL: Extract<TelaDaUnidade, { tela: "producao" }> =
  { tela: "producao", aba: "visao-geral", q: "", classe: null, origem: "sia", motivo: "", bloco: "" };

/** Separa `nome?a=1&b=2` em nome e parâmetros já decodificados. */
function separarParametros(segmento: string | undefined): [string, URLSearchParams] {
  const [nome = "", resto = ""] = (segmento ?? "").split("?", 2);
  const params = new URLSearchParams();
  for (const par of resto.split("&").filter(Boolean)) {
    const i = par.indexOf("=");
    const chave = decodificar(i < 0 ? par : par.slice(0, i));
    params.set(chave, i < 0 ? "" : decodificar(par.slice(i + 1)));
  }
  return [nome, params];
}

/** `resto` é o que vem depois de `#/painel/`. */
export function lerUnidade(resto: string[]): TelaDaUnidade {
  const [nome, params] = separarParametros(resto[0]);
  if (nome === "producao") {
    const [aba, pa] = separarParametros(resto[1]);
    const [origem, po] = separarParametros(resto[2]);
    const parametro = (k: string) => po.get(k) ?? pa.get(k) ?? params.get(k) ?? "";
    const classe = CLASSES.find((c) => c === parametro("classe")) ?? null;
    return {
      ...PRODUCAO_NA_VISAO_GERAL, aba: ABAS_DE_PRODUCAO.find((a) => a === aba) ?? "visao-geral",
      q: parametro("q"), classe, origem: origem === "sih" ? "sih" : "sia", motivo: parametro("motivo"), bloco: parametro("bloco"),
    };
  }
  if (nome === "cadastro") {
    const [aba, p] = separarParametros(resto[1]);
    const busca = p.get("q") ?? params.get("q") ?? "";
    return { tela: "cadastro", aba: ABAS_DE_CADASTRO.find((a) => a === aba) ?? "habilitacoes", q: busca };
  }
  if (nome === "aptidao") {
    const [grupo, p] = separarParametros(resto[1]);
    const busca = p.get("q") ?? params.get("q") ?? "";
    const hab = p.get("hab") ?? params.get("hab") ?? null;
    return { tela: "aptidao", grupo: GRUPOS.find((g) => g === grupo) ?? null, q: busca, hab: hab || null };
  }
  return { tela: "painel" };
}

function comParametros(base: string, params: [string, string | null][]): string {
  const ps = params.filter(([, v]) => v).map(([k, v]) => `${k}=${encodeURIComponent(v as string)}`);
  return ps.length ? `${base}?${ps.join("&")}` : base;
}

/** Segmentos depois de `#/painel/`, para `ir("painel", ...caminhoUnidade(t))`. */
export function caminhoUnidade(t: TelaDaUnidade): string[] {
  if (t.tela === "painel") return [];
  if (t.tela === "producao") {
    if (t.aba === "visao-geral") return ["producao"];
    if (t.aba === "rejeicoes") return ["producao", comParametros("rejeicoes", [["motivo", t.motivo.trim() || null]])];
    if (t.aba === "fora-do-padrao") return ["producao", comParametros("fora-do-padrao", [["bloco", t.bloco || null]])];
    if (t.aba === "origem-do-valor") return ["producao", "origem-do-valor"];
    const ps: [string, string | null][] = [["q", t.q.trim() || null], ["classe", t.classe]];
    return t.origem === "sih" ? ["producao", "procedimentos", comParametros("sih", ps)] : ["producao", comParametros("procedimentos", ps)];
  }
  if (t.tela === "cadastro") {
    const ps: [string, string | null][] = [["q", t.q.trim() || null]];
    return t.aba === "habilitacoes" ? [comParametros("cadastro", ps)] : ["cadastro", comParametros(t.aba, ps)];
  }
  const ps: [string, string | null][] = [["q", t.q.trim() || null], ["hab", t.hab]];
  return t.grupo ? ["aptidao", comParametros(t.grupo, ps)] : [comParametros("aptidao", ps)];
}

/** `href` (com `#/painel/...`) de uma subtela da unidade, para links que também navegam por `ir`. */
export const hrefUnidade = (t: TelaDaUnidade): string => ["#/painel", ...caminhoUnidade(t)].join("/");
