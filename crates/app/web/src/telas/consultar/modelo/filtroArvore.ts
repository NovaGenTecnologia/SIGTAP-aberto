import type { ItemDeApoio, ItemProcedimento } from "../../../api/tipos";
import { mascararNivel, type Linha, type No } from "./arvore";

/**
 * Resultado do filtro como árvore: grupo > subgrupo > forma > procedimento, só com o que casou, tudo aberto.
 * `nomeDe` dá o nome de grupos e subgrupos (a busca só traz o nome da forma).
 */
export function linhasDoFiltroDeProcedimentos(itens: ItemProcedimento[], nomeDe: (id: string) => string | null, limite: number): Linha[] {
  const mostrados = itens.slice(0, limite);
  const ordenados = [...mostrados].sort((a, b) => a.codigo.localeCompare(b.codigo));
  const saida: Linha[] = [];
  const contar = (prefixo: string) => mostrados.filter((i) => i.codigo.startsWith(prefixo)).length;
  const no = (id: string, nome: string | null, profundidade: number, pai: string | null, folha: boolean, contagem: number | null, mascarado = mascararNivel(id)): No =>
    ({ id, mascarado, nome, contagem, pai, profundidade, folha });
  let grupo = "", subgrupo = "", forma = "";
  for (const i of ordenados) {
    const g = i.codigo.slice(0, 2), s = i.codigo.slice(0, 4), f = i.codigo.slice(0, 6);
    if (g !== grupo) { grupo = g; saida.push({ tipo: "no", no: no(g, nomeDe(g), 0, null, false, contar(g)), profundidade: 0, aberto: true, expansivel: true }); }
    if (s !== subgrupo) { subgrupo = s; saida.push({ tipo: "no", no: no(s, nomeDe(s), 1, g, false, contar(s)), profundidade: 1, aberto: true, expansivel: true }); }
    if (f !== forma) { forma = f; saida.push({ tipo: "no", no: no(f, i.forma_nome, 2, s, false, contar(f)), profundidade: 2, aberto: true, expansivel: true }); }
    saida.push({ tipo: "no", no: no(i.codigo, i.nome, 3, f, true, null, i.codigo_mascarado), profundidade: 3, aberto: false, expansivel: false });
  }
  if (itens.length > limite) saida.push({ tipo: "mais", pai: "filtro", profundidade: 0, restantes: itens.length - limite });
  return saida;
}

/** Códigos de CID que casaram: lista plana, cada um já é o item a consultar. */
export function linhasDoFiltroDeCid(apoio: ItemDeApoio[]): Linha[] {
  return apoio.filter((a) => a.tabela === "tb_cid").map((a) => {
    const id = a.codigo[0] ?? "";
    const mascarado = id.length === 4 ? `${id.slice(0, 3)}.${id.slice(3)}` : id;
    return { tipo: "no", no: { id, mascarado, nome: a.nome, contagem: a.procedimentos, pai: null, profundidade: 0, folha: true }, profundidade: 0, aberto: false, expansivel: false } as Linha;
  });
}
