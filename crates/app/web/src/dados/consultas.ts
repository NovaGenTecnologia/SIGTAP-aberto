import { QueryClient, useQuery } from "@tanstack/react-query";
import { cnesSituacao, ofertas, producaoSituacao, situacao } from "../api/comandos";

export const clienteDeConsultas = new QueryClient({
  defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false, staleTime: 30_000 } },
});

export const useSituacao = () => useQuery({ queryKey: ["situacao"], queryFn: situacao });
export const useUnidades = () => useQuery({ queryKey: ["cnes_situacao"], queryFn: cnesSituacao });
export const useCnesCompleta = useUnidades;
export const useProducao = () => useQuery({ queryKey: ["producao_situacao"], queryFn: producaoSituacao });
export const useOfertas = () => useQuery({ queryKey: ["ofertas"], queryFn: () => ofertas(false), staleTime: 5 * 60_000 });
