import type { Fonte, Situacao, SituacaoCnesCompleta } from "../api/tipos";
import type { TarefaDeFonte } from "../dados/tarefas";

export interface Pendencia { id: "sigtap" | "territorio" | "cnes"; rotulo: string; fonte: Fonte; tarefa: TarefaDeFonte }

/** O que ainda falta para o programa servir à unidade. Meses extras do SIGTAP e produção são opcionais e ficam de fora. */
export function pendencias(
  s: Situacao,
  c: SituacaoCnesCompleta | undefined,
  t: Record<Fonte, TarefaDeFonte>,
  opcoes: { ufEscolhida: string | null; pulouUnidade: boolean },
): Pendencia[] {
  const lista: Pendencia[] = [];
  if (s.competencias.length === 0) lista.push({ id: "sigtap", rotulo: "SIGTAP", fonte: "sigtap", tarefa: t.sigtap });
  else if (!s.territorio) lista.push({ id: "territorio", rotulo: "Território", fonte: "sigtap", tarefa: t.sigtap });

  const uf = opcoes.ufEscolhida ?? c?.ufs.find((u) => (u.resumo?.arquivos.length ?? 0) > 0)?.uf ?? null;
  const arquivos = c?.ufs.find((u) => u.uf === uf)?.resumo?.arquivos ?? [];
  const restanteCarregado = arquivos.some((a) => a.tipo === "HB");
  if (c && uf && !opcoes.pulouUnidade && !restanteCarregado) lista.push({ id: "cnes", rotulo: "CNES", fonte: "cnes", tarefa: t.cnes });
  return lista;
}
