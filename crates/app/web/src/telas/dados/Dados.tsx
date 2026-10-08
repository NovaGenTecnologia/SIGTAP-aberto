import { Abas } from "../../componentes/base/Abas";
import { useTarefaAtiva } from "../../dados/tarefas";
import { AbaCnes } from "./AbaCnes";
import { AbaProducao } from "./AbaProducao";
import { AbaSigtap } from "./AbaSigtap";
import { CabecalhoDados } from "./CabecalhoDados";
import { MaisDados } from "./MaisDados";
import { ManterArquivos } from "./ManterArquivos";
import "./dados.css";

export function Dados() {
  const sigtap = useTarefaAtiva("sigtap");
  const cnes = useTarefaAtiva("cnes");
  const producao = useTarefaAtiva("producao");
  return (
    <div className="dados">
      <CabecalhoDados ocupado={sigtap.ativa} acoes={<><ManterArquivos /><MaisDados tarefa={sigtap} /></>} />
      <Abas
        rotulo="Tipo de dado"
        abas={[
          { id: "sigtap", rotulo: "SIGTAP", conteudo: <AbaSigtap tarefa={sigtap} /> },
          { id: "cnes", rotulo: "CNES", conteudo: <AbaCnes tarefa={cnes} /> },
          { id: "producao", rotulo: "Produção", conteudo: <AbaProducao tarefa={producao} /> },
        ]}
      />
    </div>
  );
}
