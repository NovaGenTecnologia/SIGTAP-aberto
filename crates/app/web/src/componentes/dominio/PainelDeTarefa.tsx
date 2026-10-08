import type { FimTarefa, Progresso as ProgressoDaTarefa } from "../../api/tipos";
import { Botao } from "../base/Botao";
import { Progresso } from "../base/Progresso";
import { EstadoErro } from "./Estados";
import "./dominio.css";

export interface PainelDeTarefaProps {
  tarefa: { ativa: boolean; progresso: ProgressoDaTarefa | null; fim: FimTarefa | null };
  aoCancelar: () => void;
  aoTentarDeNovo?: () => void;
}

export function PainelDeTarefa({ tarefa, aoCancelar, aoTentarDeNovo }: PainelDeTarefaProps) {
  const { ativa, progresso, fim } = tarefa;
  if (ativa) {
    const rotulo = progresso?.resumo || "Em andamento";
    const determinado = progresso && !progresso.indeterminado;
    return (
      <div className="tarefa">
        <div className="tarefa__texto">
          <strong>{rotulo}</strong>
          {progresso?.mensagem && <span className="tarefa__mensagem">{progresso.mensagem}</span>}
        </div>
        <Progresso rotulo={rotulo} valor={determinado ? Math.round(progresso.fracao * 100) : undefined} />
        <Botao onPress={aoCancelar}>Cancelar</Botao>
      </div>
    );
  }
  if (fim && !fim.ok && !fim.cancelada) {
    return <EstadoErro mensagem={fim.mensagem} aoTentar={aoTentarDeNovo ?? (() => {})} />;
  }
  return null;
}
