import { useSyncExternalStore } from "react";

/** Pesquisas feitas em Consultar, da mais recente para a mais antiga; ficam só neste computador. */
const CHAVE = "sa.pesquisas.v1";
const MAXIMO = 8;
const MINIMO_DE_CARACTERES = 2;

const semAcento = (s: string) => s.toLocaleLowerCase("pt-BR").normalize("NFD").replace(/[̀-ͯ]/g, "");

function ler(): string[] {
  try {
    const bruto = window.localStorage.getItem(CHAVE);
    if (!bruto) return [];
    const valor: unknown = JSON.parse(bruto);
    if (!Array.isArray(valor)) return [];
    return valor.filter((t): t is string => typeof t === "string" && t.trim().length >= MINIMO_DE_CARACTERES).slice(0, MAXIMO);
  } catch {
    return [];
  }
}

function gravar(itens: string[]): void {
  try {
    window.localStorage.setItem(CHAVE, JSON.stringify(itens));
  } catch {
    /* sem armazenamento (janela privada, dados bloqueados): a lista só some */
  }
}

// A lista lida é guardada, com o texto gravado de onde veio, para o `useSyncExternalStore` receber
// sempre a mesma referência enquanto nada muda; se o texto gravado mudar por fora, lê de novo.
let atual: string[] | null = null;
let gravado: string | null = null;
const ouvintes = new Set<() => void>();
const avisar = () => ouvintes.forEach((o) => o());

function instantaneo(): string[] {
  let bruto: string | null;
  try {
    bruto = window.localStorage.getItem(CHAVE);
  } catch {
    return atual ?? []; // sem armazenamento: vale o que está em memória
  }
  if (atual === null || bruto !== gravado) {
    gravado = bruto;
    atual = ler();
  }
  return atual;
}

export function lerPesquisas(): string[] {
  return ler();
}

/** Põe o texto na frente da lista (sem repetir, ignorando caixa e acento); devolve a lista nova. */
export function guardarPesquisa(texto: string): string[] {
  const t = texto.trim();
  if (t.length < MINIMO_DE_CARACTERES) return ler();
  const chave = semAcento(t);
  const itens = [t, ...ler().filter((x) => semAcento(x) !== chave)].slice(0, MAXIMO);
  gravar(itens);
  atual = itens;
  avisar();
  return itens;
}

export function limparPesquisas(): void {
  try {
    window.localStorage.removeItem(CHAVE);
  } catch {
    /* ver acima */
  }
  atual = [];
  avisar();
}

function assinar(ouvinte: () => void): () => void {
  ouvintes.add(ouvinte);
  return () => { ouvintes.delete(ouvinte); };
}

export function usePesquisasRecentes(): { itens: string[]; guardar: (t: string) => void; limpar: () => void } {
  const itens = useSyncExternalStore(assinar, instantaneo, instantaneo);
  return { itens, guardar: guardarPesquisa, limpar: limparPesquisas };
}
