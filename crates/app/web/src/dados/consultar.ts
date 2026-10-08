import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { arvore, arvoreCid, buscar, ficha, historico, ligados } from "../api/comandos";
import type { ItemDeApoio } from "../api/tipos";
import { useSessao } from "../shell/sessao";
import { normalizarEntrada } from "../util/campos";

// Todas leem a competência escolhida no topo e a incluem na chave: trocar a competência recarrega a mesma tela.

/** Busca com pelo menos 2 caracteres; o resultado anterior fica até o novo chegar. */
export function useBusca(texto: string) {
  const { competencia } = useSessao();
  const consulta = normalizarEntrada(texto);
  return useQuery({
    queryKey: ["buscar", competencia, consulta],
    queryFn: () => buscar(consulta, competencia ?? undefined),
    enabled: consulta.length >= 2,
    placeholderData: keepPreviousData,
  });
}

export function useFicha(codigo: string) {
  const { competencia } = useSessao();
  return useQuery({ queryKey: ["ficha", competencia, codigo], queryFn: () => ficha(codigo, competencia ?? undefined), enabled: codigo !== "" });
}

/** O histórico não depende da competência escolhida: cobre todas as carregadas. */
export function useHistorico(codigo: string) {
  return useQuery({ queryKey: ["historico", codigo], queryFn: () => historico(codigo) });
}

export function useArvore(pai: string | null, ativo = true) {
  const { competencia } = useSessao();
  return useQuery({ queryKey: ["arvore", competencia, pai], queryFn: () => arvore(pai, competencia ?? undefined), enabled: ativo });
}

export function useArvoreCid(pai: string | null, ativo = true) {
  const { competencia } = useSessao();
  return useQuery({ queryKey: ["arvore_cid", competencia, pai], queryFn: () => arvoreCid(pai, competencia ?? undefined), enabled: ativo });
}

/** Procedimentos ligados a um item de apoio; só consulta quando há item escolhido. */
export function useLigados(item: ItemDeApoio | null) {
  const { competencia } = useSessao();
  return useQuery({
    queryKey: ["ligados", competencia, item?.tabela, item?.codigo],
    queryFn: () => ligados(item!.tabela, item!.codigo, competencia ?? undefined),
    enabled: item !== null,
  });
}
