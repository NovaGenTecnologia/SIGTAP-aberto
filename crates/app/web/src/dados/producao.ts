import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { faturamentoUnidade, producaoProcedimentos } from "../api/comandos";

/** O fechamento da unidade (rejeições, curva, apresentado × aprovado, origem do valor...), um só para todas as abas de Produção. */
export const useFaturamentoUnidade = (competencia?: string, unidade = "") =>
  useQuery({ queryKey: ["faturamento-unidade", competencia ?? null, unidade], queryFn: () => faturamentoUnidade(competencia) });

/** Os procedimentos da unidade por valor, de 50 em 50: `fetchNextPage` pede o próximo `desde`. */
export function useProducaoProcedimentos(
  origem: "sia" | "sih",
  filtro: { q?: string; classe?: "A" | "B" | "C" | null; ordem?: "valor" | "quantidade"; competencia?: string; unidade?: string } = {},
) {
  const chave = ["producao-procedimentos", origem, filtro.q ?? "", filtro.classe ?? null, filtro.ordem ?? "valor", filtro.competencia ?? null, filtro.unidade ?? ""];
  return useInfiniteQuery({
    queryKey: chave,
    initialPageParam: 0,
    queryFn: ({ pageParam }) =>
      producaoProcedimentos({
        origem, q: filtro.q || undefined, classe: filtro.classe ?? undefined, ordem: filtro.ordem,
        desde: pageParam || undefined, competencia: filtro.competencia,
      }),
    getNextPageParam: (ultima) => (ultima.disponivel && ultima.itens_omitidos > 0 ? ultima.desde + ultima.itens.length : undefined),
    // Só a digitação (q) reaproveita a lista anterior; outra origem, classe, ordem, competência ou unidade nunca mostra linhas alheias.
    placeholderData: (anterior, consulta) => (consulta && [1, 3, 4, 5, 6].every((i) => consulta.queryKey[i] === chave[i]) ? anterior : undefined),
  });
}
