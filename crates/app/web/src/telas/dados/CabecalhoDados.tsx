import { useQueryClient } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { ofertas } from "../../api/comandos";
import { Botao } from "../../componentes/base/Botao";
import { useOfertas, useSituacao } from "../../dados/consultas";
import { tamanho } from "../../util/formatos";

const hora = new Intl.DateTimeFormat("pt-BR", { hour: "2-digit", minute: "2-digit" });
const dia = new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit" });

function quando(ms: number): string {
  const d = new Date(ms);
  return new Date().toDateString() === d.toDateString() ? `hoje ${hora.format(d)}` : `${dia.format(d)} ${hora.format(d)}`;
}

export function CabecalhoDados({ ocupado, acoes }: { ocupado: boolean; acoes?: ReactNode }) {
  const cliente = useQueryClient();
  const { data: situacao } = useSituacao();
  const { dataUpdatedAt, isFetching } = useOfertas();
  const zips = situacao?.zips;

  // Só os ZIPs são medidos aqui: dizer "em uso" com um número que não conta os bancos seria enganoso.
  const partes: string[] = [];
  if (zips && zips.bytes > 0) partes.push(`ZIPs guardados ${tamanho(zips.bytes)}`);
  if (zips && zips.bytes_apagaveis > 0) partes.push(`podem ser liberados ${tamanho(zips.bytes_apagaveis)}`);
  if (dataUpdatedAt > 0) partes.push(`verificado ${quando(dataUpdatedAt)}`);

  // A falha fica no estado da consulta de ofertas: a aba mostra a causa.
  const procurar = () => void cliente.fetchQuery({ queryKey: ["ofertas"], queryFn: () => ofertas(true), staleTime: 0 }).catch(() => {});

  return (
    <header className="dados__cabecalho">
      <div className="dados__titulo">
        <h1>Dados</h1>
        {partes.length > 0 && <p className="dados__armazenamento">{partes.join(" · ")}</p>}
      </div>
      <div className="dados__acoes-topo">
        {acoes}
        <Botao onPress={procurar} isDisabled={ocupado} carregando={isFetching && !ocupado}>Procurar atualizações</Botao>
      </div>
    </header>
  );
}
