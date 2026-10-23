import type { ItemDeMudanca, LinhaOficial, ValorDoProcedimento } from "../../api/tipos";

/** Valor total do procedimento na competência (centavos): ambulatorial + hospitalar + profissional. */
export const totalDoValor = (v: ValorDoProcedimento): number => v.sa + v.sh + v.sp;

/** Variação percentual do total; sem valor antes não há base de comparação. */
export function variacaoDoValor(antes: ValorDoProcedimento, depois: ValorDoProcedimento): number | null {
  const a = totalDoValor(antes);
  return a > 0 ? ((totalDoValor(depois) - a) * 100) / a : null;
}

const linhaDe = (i: ItemDeMudanca): LinhaOficial | null => i.depois ?? i.antes;

/** Primeiro nome encontrado para uma coluna de código, nos nomes que o Rust já trouxe junto da linha. */
function nomeDaColuna(linha: LinhaOficial | null, coluna: string): string | null {
  const achado = linha?.nomes.find((n) => n.colunas.includes(coluna))?.encontrados[0];
  return achado ? (Object.values(achado)[0] ?? null) : null;
}

export const nomeDoProcedimento = (i: ItemDeMudanca): string | null => nomeDaColuna(linhaDe(i), "co_procedimento");

/** Os outros códigos da chave, cada um com o seu nome quando há ("1802 Cardiologia"). */
export function descreverItem(i: ItemDeMudanca): string {
  const linha = linhaDe(i);
  return Object.entries(i.chave)
    .filter(([coluna]) => coluna !== "co_procedimento")
    .map(([coluna, codigo]) => [codigo, nomeDaColuna(linha, coluna)].filter(Boolean).join(" "))
    .join(" · ");
}

export type IdDeSecao = "habilitacoes" | "regras" | "incrementos" | "cadastro";
export const SECOES: { id: IdDeSecao; titulo: string; tabelas: string[] | null }[] = [
  { id: "habilitacoes", titulo: "Habilitações exigidas", tabelas: ["rl_procedimento_habilitacao"] },
  { id: "regras", titulo: "Regras condicionadas", tabelas: ["rl_procedimento_regra_cond"] },
  { id: "incrementos", titulo: "Incrementos", tabelas: ["rl_procedimento_incremento"] },
  { id: "cadastro", titulo: "Cadastro e tabelas auxiliares", tabelas: null },
];

export function secaoDaTabela(tabela: string): IdDeSecao {
  return SECOES.find((s) => s.tabelas?.includes(tabela))?.id ?? "cadastro";
}

export const ROTULO_DA_MUDANCA: Record<ItemDeMudanca["tipo"], string> = { incluido: "Incluída", excluido: "Excluída", alterado: "Alterada" };
