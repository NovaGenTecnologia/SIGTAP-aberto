import type { ReactNode } from "react";
import { EstadoErro, CarregandoComEspera } from "../componentes/dominio/Estados";
import { useSituacao } from "../dados/consultas";
import { Rodape } from "./Rodape";
import { Topo } from "./Topo";
import { Trilho } from "./Trilho";
import "./shell.css";

export function Shell({ children }: { children: ReactNode }) {
  const situacao = useSituacao();
  if (situacao.isPending) return <div className="shell shell--simples"><CarregandoComEspera rotulo="Abrindo o programa" /></div>;
  if (situacao.isError) return <div className="shell shell--simples"><EstadoErro mensagem={(situacao.error as Error).message} aoTentar={() => void situacao.refetch()} /></div>;
  const s = situacao.data;
  const bloqueado = s.bloqueio !== null;
  return (
    <div className="shell">
      <Topo competencias={s.competencias} bloqueado={bloqueado} />
      <Trilho />
      <main className="shell__conteudo" id="conteudo" tabIndex={-1}>
        {bloqueado
          ? <EstadoErro mensagem="Os dados desta pasta são de uma versão mais nova do programa. Atualize o programa para usá-los." aoTentar={() => void situacao.refetch()} />
          : children}
      </main>
      <Rodape competencias={s.competencias} />
    </div>
  );
}
