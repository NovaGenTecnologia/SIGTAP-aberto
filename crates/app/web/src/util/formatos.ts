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

const decimal = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 1 });
/** Tamanho de arquivo em B, KB, MB ou GB (base 1024), com vírgula decimal. */
export function tamanho(bytes: number): string {
  if (bytes < 1024) return `${inteiro(bytes)} B`;
  const unidades = ["KB", "MB", "GB", "TB"];
  let valor = bytes / 1024, i = 0;
  while (valor >= 1024 && i < unidades.length - 1) { valor /= 1024; i++; }
  return `${decimal.format(valor)} ${unidades[i]}`;
}
