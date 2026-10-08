import type { Situacao, SituacaoCnesCompleta } from "../api/tipos";

export type Etapa = "sigtap" | "uf" | "cnes" | "unidade" | "pronto";

export const ETAPAS: { id: Etapa; rotulo: string }[] = [
  { id: "sigtap", rotulo: "SIGTAP" },
  { id: "uf", rotulo: "Estado" },
  { id: "cnes", rotulo: "CNES" },
  { id: "unidade", rotulo: "Unidade" },
  { id: "pronto", rotulo: "Pronto" },
];

// A etapa vem do que já está carregado: fechar e reabrir o programa retoma de onde parou.
export function etapaAtual(
  s: Situacao,
  c: SituacaoCnesCompleta | undefined,
  ufEscolhida: string | null,
  pulouUnidade: boolean,
): Etapa {
  if (s.competencias.length === 0 || !s.territorio) return "sigtap";
  const cnesCarregado = !!c?.ufs.some((u) => (u.resumo?.arquivos.length ?? 0) > 0);
  if (cnesCarregado) return c?.minha || pulouUnidade ? "pronto" : "unidade";
  return ufEscolhida ? "cnes" : "uf";
}
