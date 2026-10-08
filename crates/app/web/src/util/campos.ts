import type { CampoOficial, LinhaOficial } from "../api/tipos";
import { reais } from "./formatos";

/** 0301010072 -> 03.01.01.007-2 (códigos mais curtos ficam como estão). */
export function mascararProcedimento(codigo: string): string {
  if (!/^\d{10}$/.test(codigo)) return codigo;
  return `${codigo.slice(0, 2)}.${codigo.slice(2, 4)}.${codigo.slice(4, 6)}.${codigo.slice(6, 9)}-${codigo.slice(9)}`;
}

/** Tira a máscara só quando o texto inteiro é um código mascarado; nome e buscas mistas ficam intactos. */
export function normalizarEntrada(texto: string): string {
  const t = texto.trim();
  if (/^[\d.-]+$/.test(t)) {
    const limpo = t.replace(/[.-]/g, "");
    if (/^\d+$/.test(limpo)) return limpo;
  }
  return t;
}

const decimal = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 2 });

function plural(n: number, um: string, varios: string): string {
  return `${n} ${n === 1 ? um : varios}`;
}

function textoDeMeses(meses: number): string {
  const anos = Math.floor(meses / 12);
  const resto = meses % 12;
  if (anos === 0) return plural(resto, "mês", "meses");
  if (resto === 0) return plural(anos, "ano", "anos");
  return `${plural(anos, "ano", "anos")} e ${plural(resto, "mês", "meses")}`;
}

/** Valor do campo como o faturista lê: sentinela, unidade, descrição do código ou o valor cru. */
export function textoDoCampo(c: CampoOficial): string {
  if (c.sentinela) return c.sentinela_inferida ? `${c.sentinela} (inferido)` : c.sentinela;
  if (c.valor === null || c.valor === "") return "—";
  const numero = typeof c.valor === "number" ? c.valor : Number(c.valor);
  if (c.unidade && Number.isFinite(numero)) {
    if (c.unidade === "centavos") return reais(numero);
    if (c.unidade === "meses") return textoDeMeses(numero);
    return `${decimal.format(numero / 100)}%`;
  }
  if (c.descricao) return c.descricao;
  return String(c.valor);
}

export function campoDe(l: LinhaOficial | undefined, coluna: string): CampoOficial | undefined {
  return l?.campos.find((c) => c.coluna === coluna);
}

/** SH + SA + SP, em centavos; campo ausente ou nulo conta zero. */
export function valorTotalCentavos(p: LinhaOficial): number {
  return ["vl_sh", "vl_sa", "vl_sp"].reduce((soma, col) => {
    const v = campoDe(p, col)?.valor;
    return soma + (typeof v === "number" ? v : Number(v) || 0);
  }, 0);
}
