import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { anotar, marcado, marcados, marcarFavorito, type TipoMarcado } from "../api/comandos";
import type { Marcado } from "../api/tipos";
import { useSessao } from "../shell/sessao";

// Favoritos e anotações são do usuário, não da competência; só os nomes da lista dependem dela.

export function useMarcado(tipo: TipoMarcado, codigo: string) {
  return useQuery({ queryKey: ["marcado", tipo, codigo], queryFn: () => marcado(tipo, codigo), enabled: codigo !== "" });
}

export function useMarcados(tipo: TipoMarcado) {
  const { competencia } = useSessao();
  return useQuery({ queryKey: ["marcados", tipo, competencia], queryFn: () => marcados(tipo, competencia ?? undefined) });
}

/** Grava e já coloca a resposta no cache: a tela muda sem recarregar a ficha; as listas se atualizam. */
function useGravar<V>(tipo: TipoMarcado, codigo: string, gravar: (v: V) => Promise<Marcado>) {
  const cliente = useQueryClient();
  return useMutation<Marcado, Error, V>({
    mutationFn: gravar,
    onSuccess: (m) => {
      cliente.setQueryData(["marcado", tipo, codigo], m);
      void cliente.invalidateQueries({ queryKey: ["marcados", tipo] });
    },
  });
}

export const useFavoritar = (tipo: TipoMarcado, codigo: string) =>
  useGravar<boolean>(tipo, codigo, (favorito) => marcarFavorito(tipo, codigo, favorito));

export const useAnotar = (tipo: TipoMarcado, codigo: string) =>
  useGravar<string>(tipo, codigo, (texto) => anotar(tipo, codigo, texto));
