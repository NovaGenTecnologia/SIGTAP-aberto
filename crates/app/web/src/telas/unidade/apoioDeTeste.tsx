import { render } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Painel } from "../Painel";
import { ProvedorDaSessao } from "../../shell/sessao";
import { ProvedorDeAvisos } from "../../componentes/base/Avisos";
import * as comandos from "../../api/comandos";
import type { UnidadeRef } from "../../api/tipos";
import { aptidaoExemplo, unidadeExemplo } from "./exemplos";

/** Apoio só dos testes das subtelas da unidade: monta o Painel numa rota e prepara os comandos simulados. */
export const m = vi.mocked(comandos);

export function abrir(rota: string) {
  window.location.hash = rota;
  const cliente = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={cliente}><ProvedorDeAvisos><ProvedorDaSessao><Painel /></ProvedorDaSessao></ProvedorDeAvisos></QueryClientProvider>,
  );
}

export const minha: UnidadeRef = { uf: "SP", cnes: "0000000", nome: "UNIDADE DE EXEMPLO DE SAUDE" };

export function preparar(terceiros: UnidadeRef[] = []) {
  vi.resetAllMocks();
  m.cnesSituacao.mockResolvedValue({ minha, unidades: [minha], ufs: [{ uf: "SP", resumo: { arquivos: [] } }], ufs_disponiveis: ["SP"], terceiros });
  m.situacao.mockResolvedValue({ primeira_execucao: false, bloqueio: null, competencias: [{ competencia: "202609" }], territorio: null, pasta_dados: "", ocupado: false, recuperacao: null } as never);
  m.unidadeVer.mockResolvedValue(unidadeExemplo);
  m.aptidaoUnidade.mockImplementation(async (o) => aptidaoExemplo({ grupo: o?.grupo ? { id: o.grupo, itens: [], desde: 0, itens_omitidos: 0, total: 0, ninguem_produziu: null } : null }));
}
