import type { AptidaoUnidade, HabilitacaoComProducao } from "../../../api/tipos";

/** Habilitações vigentes que citam procedimentos e não produziram nos meses carregados; nulo quando não há produção para comparar. */
export function citamENaoProduzem(a: AptidaoUnidade | undefined): HabilitacaoComProducao[] | null {
  if (!a || a.sem_producao || !a.habilitacoes) return null;
  return a.habilitacoes.filter((h) => h.vigente && h.procedimentos_que_citam > 0 && h.procedimentos_produzidos === 0);
}
