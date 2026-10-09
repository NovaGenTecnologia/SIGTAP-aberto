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

/** Percentual inteiro com o sinal de menos tipográfico (−22%); sem sinal para zero. */
export const percentual = (n: number): string => {
  const r = Math.round(n);
  return `${r < 0 ? "−" : ""}${Math.abs(r)}%`;
};

/** Valor com sinal explícito (+R$ 1,00 / −R$ 1,00); zero sem sinal. */
export const comSinal = (centavos: number): string =>
  centavos === 0 ? reais(0) : `${centavos > 0 ? "+" : "−"}${reais(Math.abs(centavos))}`;

const unidadeDe = (n: number, sufixo: string) => `R$ ${decimal.format(n)} ${sufixo}`.replace(/ /g, "\u00a0");
/** Valor abreviado para listas estreitas: R$ 3,1 mi, R$ 850 mil; abaixo de R$ 10 mil, o valor inteiro. */
export function reaisCompacto(centavos: number): string {
  const r = Math.abs(centavos) / 100;
  if (r >= 1_000_000) return unidadeDe(centavos / 100 / 1_000_000, "mi");
  if (r >= 10_000) return unidadeDe(centavos / 100 / 1_000, "mil");
  return reais(centavos);
}

/** "04–06/2026" (mesmo ano) ou "11/2025–02/2026"; competências em AAAAMM, em ordem. */
export function intervaloDeCompetencias(cs: string[]): string {
  const [a, b] = [cs[0], cs[cs.length - 1]];
  if (!a || !b) return "";
  if (a === b) return rotuloCompetencia(a);
  return a.slice(0, 4) === b.slice(0, 4) ? `${a.slice(4)}–${rotuloCompetencia(b)}` : `${rotuloCompetencia(a)}–${rotuloCompetencia(b)}`;
}
