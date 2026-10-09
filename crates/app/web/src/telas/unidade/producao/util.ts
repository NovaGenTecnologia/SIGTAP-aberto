import type { FaturamentoUnidade, MesDaUnidade, Pendencia, TendenciaDoValor } from "../../../api/tipos";
import { intervaloDeCompetencias, inteiro, rotuloCompetencia } from "../../../util/formatos";

const decimais = (n: number, casas: number) => n.toLocaleString("pt-BR", { minimumFractionDigits: casas, maximumFractionDigits: casas });

/** "R$ 1,06 bi", "R$ 2,3 mi", "R$ 74,6 mil" e, abaixo de mil, reais inteiros (`casas` troca o 1 de mi e mil). Passa para a unidade de cima quando o arredondamento chegaria a 1.000. */
export function valorCompacto(centavos: number, casas?: number): string {
  const sinal = centavos < 0 ? "−" : "";
  const r = Math.abs(centavos) / 100;
  const arredonda = (n: number, casas: number) => Number(n.toFixed(casas));
  const d = casas ?? 1;
  if (arredonda(r / 1_000_000, d) >= 1_000) return `${sinal}R$ ${decimais(r / 1_000_000_000, casas ?? 2)} bi`;
  if (arredonda(r / 1_000, d) >= 1_000) return `${sinal}R$ ${decimais(r / 1_000_000, d)} mi`;
  if (r >= 1_000_000) return `${sinal}R$ ${decimais(r / 1_000_000, d)} mi`;
  if (r >= 1_000) return `${sinal}R$ ${decimais(r / 1_000, d)} mil`;
  return `${sinal}R$ ${inteiro(Math.round(r))}`;
}

const SENTIDO = { sobe: { rotulo: "sobe", sinal: "▲" }, cai: { rotulo: "cai", sinal: "▼" }, estavel: { rotulo: "estável", sinal: "●" } } as const;

/** O sentido da tendência em palavra, símbolo e texto com a variação; o Rust decide o sentido (estável = dentro de 3%). */
export function sentidoDe(t: TendenciaDoValor | null): { rotulo: "sobe" | "cai" | "estável"; sinal: "▲" | "▼" | "●"; texto: string } | null {
  if (!t) return null;
  const s = SENTIDO[t.sentido];
  const v = t.variacao_percentual;
  const variacao = v === null ? "" : ` ${v > 0 ? "+" : v < 0 ? "−" : ""}${decimais(Math.abs(v), 1)}%`;
  return { rotulo: s.rotulo, sinal: s.sinal, texto: `${s.rotulo}${variacao}` };
}

/** O último mês da série que está completo. */
export function ultimoCompleto(meses: MesDaUnidade[], completos: string[]): MesDaUnidade | null {
  return [...meses].reverse().find((m) => completos.includes(m.competencia)) ?? null;
}

export interface AvisoDeCobertura { sistema: "SIA" | "SIH"; competencia: string; estabelecimentos: number; texto: string }

/** Os meses incompletos de cada sistema, com o que a faixa do topo diz. */
export function faixaDeCobertura(c: FaturamentoUnidade["cobertura"]): AvisoDeCobertura[] {
  const de = (sistema: "SIA" | "SIH", meses: FaturamentoUnidade["cobertura"]["sia"]) =>
    meses.filter((m) => !m.completo).map((m) => ({
      sistema, competencia: m.competencia, estabelecimentos: m.estabelecimentos,
      texto: `${sistema} de ${rotuloCompetencia(m.competencia)} incompleto (${inteiro(m.estabelecimentos)} estabelecimentos): fora da conta`,
    }));
  return [...de("SIA", c.sia), ...de("SIH", c.sih)];
}

const DE_PRODUCAO = new Set(["rejeicao_acima_dos_pares", "quantidade_atipica", "permanencia_fora_do_previsto"]);

/** As pendências de produção do Painel (o mês incompleto já está na faixa), da mais cara à mais barata; sem valor, atenção antes de info. */
export function oQueOlhar(pendencias: Pendencia[]): Pendencia[] {
  const peso = (p: Pendencia) => (p.valor_envolvido_centavos ?? -1);
  return pendencias
    .filter((p) => DE_PRODUCAO.has(p.tipo))
    .sort((a, b) => peso(b) - peso(a) || Number(b.gravidade === "atencao") - Number(a.gravidade === "atencao"))
    .slice(0, 5);
}

/** Os meses em texto: "08–10/2025" quando são seguidos, "08/2025, 10/2025" quando há buraco. */
export function mesesEmTexto(cs: string[]): string {
  const indice = (c: string) => Number(c.slice(0, 4)) * 12 + Number(c.slice(4)) - 1;
  const seguidos = cs.every((c, i) => i === 0 || indice(c) === indice(cs[i - 1]!) + 1);
  return seguidos ? intervaloDeCompetencias(cs) : cs.map(rotuloCompetencia).join(", ");
}

export const temSia = (f: FaturamentoUnidade) => f.meses.some((m) => m.sia_valor_centavos > 0 || m.sia_quantidade > 0);
export const temSih = (f: FaturamentoUnidade) => f.meses.some((m) => m.sih_valor_centavos > 0 || m.sih_aih > 0);

export const SEM_SIA = "Esta unidade não tem produção ambulatorial (SIA) nos meses carregados";
export const SEM_SIH = "Esta unidade não tem internações (SIH) nos meses carregados";

/** "<1%" para o que é pouco mas existe, e o inteiro arredondado nos demais casos. */
export const parteEmTexto = (p: number): string => (p > 0 && p < 1 ? "<1%" : `${Math.round(p)}%`);
/** Quanto `parte` é de `total`, em pontos percentuais; 0 quando o total é zero. */
export const parteDe = (parte: number, total: number): number => (total > 0 ? (parte * 100) / total : 0);
