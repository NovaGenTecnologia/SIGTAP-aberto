import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { faturamentoImpacto, faturamentoPainel, mudou } from "../api/comandos";

export const usePainel = (competencia?: string) =>
  useQuery({ queryKey: ["painel", competencia ?? null], queryFn: () => faturamentoPainel(competencia) });

export const useImpacto = (de?: string, para?: string, ligado = true) =>
  useQuery({ queryKey: ["impacto", de ?? null, para ?? null], queryFn: () => faturamentoImpacto(de, para), placeholderData: keepPreviousData, enabled: ligado });

export const useMudancas = (de?: string, para?: string, soAfeta = false, ligado = true) =>
  useQuery({ queryKey: ["mudou", de ?? null, para ?? null, soAfeta], queryFn: () => mudou(de, para, { soAfeta }), placeholderData: keepPreviousData, enabled: ligado });

