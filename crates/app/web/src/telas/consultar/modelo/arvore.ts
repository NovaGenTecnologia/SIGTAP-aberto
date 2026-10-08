import type { NoDeArvore, NoDeCid } from "../../../api/tipos";
import { mascararProcedimento } from "../../../util/campos";

export type TipoDeArvore = "procedimentos" | "cid";

export interface No {
  /** Código sem máscara: é o que a rota guarda e o que a API recebe como pai. */
  id: string;
  mascarado: string;
  nome: string | null;
  /** Procedimentos abaixo do nó; `null` nas folhas. */
  contagem: number | null;
  pai: string | null;
  profundidade: number;
  folha: boolean;
}

/** Nome do capítulo da CID-10 (apresentação; o arquivo do SIGTAP não traz o nome da letra). */
const CAPITULOS: Record<string, string> = {
  A: "Algumas doenças infecciosas e parasitárias", B: "Algumas doenças infecciosas e parasitárias",
  C: "Neoplasias [tumores]", D: "Neoplasias e doenças do sangue", E: "Doenças endócrinas, nutricionais e metabólicas",
  F: "Transtornos mentais e comportamentais", G: "Doenças do sistema nervoso", H: "Doenças do olho, anexos e ouvido",
  I: "Doenças do aparelho circulatório", J: "Doenças do aparelho respiratório", K: "Doenças do aparelho digestivo",
  L: "Doenças da pele e do tecido subcutâneo", M: "Doenças do sistema osteomuscular e do tecido conjuntivo",
  N: "Doenças do aparelho geniturinário", O: "Gravidez, parto e puerpério", P: "Afecções originadas no período perinatal",
  Q: "Malformações congênitas e anomalias cromossômicas", R: "Sintomas, sinais e achados anormais de exames",
  S: "Lesões, envenenamento e outras causas externas", T: "Lesões, envenenamento e outras causas externas",
  U: "Códigos para propósitos especiais", V: "Causas externas de morbidade e de mortalidade", W: "Causas externas de morbidade e de mortalidade",
  X: "Causas externas de morbidade e de mortalidade", Y: "Causas externas de morbidade e de mortalidade",
  Z: "Fatores que influenciam o estado de saúde",
};
export const capituloDaLetra = (letra: string): string => CAPITULOS[letra.toUpperCase()] ?? "";

export function mascararNivel(codigo: string): string {
  if (codigo.length === 4) return `${codigo.slice(0, 2)}.${codigo.slice(2)}`;
  if (codigo.length === 6) return `${codigo.slice(0, 2)}.${codigo.slice(2, 4)}.${codigo.slice(4)}`;
  if (codigo.length === 10) return mascararProcedimento(codigo);
  return codigo;
}

const NIVEL_PROCEDIMENTO = { grupo: 0, subgrupo: 1, forma: 2, procedimento: 3 } as const;
const NIVEL_CID = { letra: 0, categoria: 1, subcategoria: 2 } as const;

export function deProcedimentos(n: NoDeArvore, pai: string | null): No {
  const folha = n.nivel === "procedimento";
  return { id: n.codigo, mascarado: mascararNivel(n.codigo), nome: n.nome, contagem: folha ? null : n.procedimentos, pai, profundidade: NIVEL_PROCEDIMENTO[n.nivel], folha };
}

export function deCid(n: NoDeCid, pai: string | null): No {
  // Categoria com um só código não tem subcategorias: o próprio código é o que se consulta.
  const folha = n.nivel === "subcategoria" || (n.nivel === "categoria" && n.codigos <= 1);
  const nome = n.nome ?? (n.nivel === "letra" ? capituloDaLetra(n.codigo) || null : null);
  return { id: n.codigo, mascarado: n.codigo_mascarado, nome, contagem: n.procedimentos, pai, profundidade: NIVEL_CID[n.nivel], folha };
}

/** Pais do nó, do mais alto ao mais próximo. */
export function cadeiaDe(tipo: TipoDeArvore, id: string): string[] {
  if (tipo === "cid") {
    const r: string[] = [];
    if (id.length > 1) r.push(id.slice(0, 1));
    if (id.length > 3) r.push(id.slice(0, 3));
    return r;
  }
  return [2, 4, 6].filter((n) => n < id.length).map((n) => id.slice(0, n));
}

const PEQUENAS = new Set(["de", "da", "do", "das", "dos", "e", "em", "a", "o", "para", "com", "por", "na", "no", "nas", "nos"]);

/** "PROCEDIMENTOS CLÍNICOS" → "Procedimentos Clínicos": só para o caminho; o nome oficial não muda. */
export function tituloDe(nome: string): string {
  return nome
    .replace(/\s*\/\s*/g, "/").trim().toLocaleLowerCase("pt-BR")
    .split(/(\s+|\/)/)
    .map((t, i) => (/^\s+$/.test(t) ? " " : t === "/" ? t : i > 0 && PEQUENAS.has(t) ? t : t.charAt(0).toLocaleUpperCase("pt-BR") + t.slice(1)))
    .join("");
}

/** Um trecho do caminho fixo: o número do próprio nível e o nome. */
export function segmentoDoCaminho(tipo: TipoDeArvore, no: No): string {
  if (tipo === "cid") return [no.mascarado, no.nome ?? "sem nome nesta competência"].join(" ");
  const numero = no.id.length < 10 ? no.id.slice(-2) : no.mascarado;
  return `${numero} ${no.nome ? tituloDe(no.nome) : "sem nome nesta competência"}`;
}

export type EstadoDosFilhos =
  | { estado: "carregando" }
  | { estado: "erro"; mensagem: string }
  | { estado: "ok"; nos: No[] };

export type Linha =
  | { tipo: "no"; no: No; profundidade: number; aberto: boolean; expansivel: boolean }
  | { tipo: "carregando"; pai: string; profundidade: number }
  | { tipo: "erro"; pai: string; profundidade: number; mensagem: string }
  | { tipo: "mais"; pai: string; profundidade: number; restantes: number };

export const LIMITE_DE_FILHOS = 200;

/** As linhas visíveis da árvore, na ordem de leitura. `filhos` usa "" para a raiz. */
export function achatar(filhos: Map<string, EstadoDosFilhos>, abertos: Set<string>, limites: Record<string, number>): Linha[] {
  const saida: Linha[] = [];
  const visitar = (pai: string, profundidade: number) => {
    const e = filhos.get(pai);
    if (!e) return;
    if (e.estado === "carregando") { saida.push({ tipo: "carregando", pai, profundidade }); return; }
    if (e.estado === "erro") { saida.push({ tipo: "erro", pai, profundidade, mensagem: e.mensagem }); return; }
    const limite = limites[pai] ?? LIMITE_DE_FILHOS;
    for (const no of e.nos.slice(0, limite)) {
      const f = filhos.get(no.id);
      const expansivel = !no.folha && !(f?.estado === "ok" && f.nos.length === 0);
      const aberto = expansivel && abertos.has(no.id);
      saida.push({ tipo: "no", no, profundidade, aberto, expansivel });
      if (aberto) visitar(no.id, profundidade + 1);
    }
    if (e.nos.length > limite) saida.push({ tipo: "mais", pai, profundidade, restantes: e.nos.length - limite });
  };
  visitar("", 0);
  return saida;
}
