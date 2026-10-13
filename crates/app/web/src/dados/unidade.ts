import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { aptidaoUnidade, terceiroAdicionar, terceiroRemover, unidadeVer } from "../api/comandos";
import type { GrupoDeAptidao } from "../api/tipos";

/** O cadastro completo de uma unidade (a ativa, ou a indicada). */
export const useUnidade = (competencia?: string, alvo?: { uf: string; cnes: string }, ligado = true) =>
  useQuery({ queryKey: ["unidade", competencia ?? null, alvo?.uf ?? null, alvo?.cnes ?? null], queryFn: () => unidadeVer(competencia, alvo), enabled: ligado });

/** Só o resumo por prioridade e as habilitações com produção (sem lista). */
export const useAptidaoResumo = (competencia?: string, unidade = "", ligado = true) =>
  useQuery({ queryKey: ["aptidao-resumo", competencia ?? null, unidade], queryFn: () => aptidaoUnidade({ competencia }), enabled: ligado });

/** A lista de um grupo, de 50 em 50: `fetchNextPage` pede o próximo `desde`. */
export function useAptidao(
  grupo: GrupoDeAptidao | null,
  filtro: { q?: string; hab?: string | null; soProduzidosNaUf?: boolean; competencia?: string; unidade?: string } = {},
) {
  const chave = ["aptidao", grupo, filtro.q ?? "", filtro.hab ?? null, filtro.soProduzidosNaUf ?? false, filtro.competencia ?? null, filtro.unidade ?? ""];
  return useInfiniteQuery({
    queryKey: chave,
    enabled: grupo !== null,
    initialPageParam: 0,
    queryFn: ({ pageParam }) =>
      aptidaoUnidade({
        grupo: grupo ?? undefined, q: filtro.q || undefined, hab: filtro.hab ?? undefined,
        desde: pageParam, soProduzidosNaUf: filtro.soProduzidosNaUf, competencia: filtro.competencia,
      }),
    getNextPageParam: (ultima) => {
      const g = ultima.grupo;
      return g && g.itens_omitidos > 0 ? g.desde + g.itens.length : undefined;
    },
    // Só a digitação (q) reaproveita a lista anterior; outro grupo, habilitação, competência ou unidade nunca mostra linhas alheias.
    placeholderData: (anterior, consulta) => (consulta && [1, 3, 4, 5, 6].every((i) => consulta.queryKey[i] === chave[i]) ? anterior : undefined),
  });
}

/** Adicionar e remover terceiros; a lista vem de `useUnidades` (situação do CNES) e recarrega depois. */
export function useTerceiros(uf: string, cnes: string) {
  const cliente = useQueryClient();
  const recarregar = () => Promise.all([
    cliente.invalidateQueries({ queryKey: ["cnes_situacao"] }),
    cliente.invalidateQueries({ queryKey: ["aptidao"] }),
    cliente.invalidateQueries({ queryKey: ["aptidao-resumo"] }),
    cliente.invalidateQueries({ queryKey: ["unidade"] }),
    cliente.invalidateQueries({ queryKey: ["painel"] }),
  ]);
  const adicionar = useMutation({
    mutationFn: (t: { uf: string; cnes: string }) => terceiroAdicionar(uf, cnes, t.uf, t.cnes),
    onSuccess: recarregar,
  });
  const remover = useMutation({
    mutationFn: (t: { uf: string; cnes: string }) => terceiroRemover(uf, cnes, t.uf, t.cnes),
    onSuccess: recarregar,
  });
  return { adicionar, remover };
}
