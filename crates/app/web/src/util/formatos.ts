const moeda = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const numero = new Intl.NumberFormat("pt-BR");

export const reais = (centavos: number): string => moeda.format(centavos / 100);
export const inteiro = (n: number): string => numero.format(n);
export function rotuloCompetencia(c: string): string {
  return /^\d{6}$/.test(c) ? `${c.slice(4)}/${c.slice(0, 4)}` : c;
}

/** Competências em ordem crescente por AAAAMM; a mais recente fica por último. */
export function ordenarCompetencias<T extends { competencia: string }>(lista: T[]): T[] {
  return [...lista].sort((a, b) => a.competencia.localeCompare(b.competencia));
}
