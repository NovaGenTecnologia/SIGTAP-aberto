import type { CompetenciaInfo } from "../api/tipos";
import { ordenarCompetencias } from "../util/formatos";
import { RodapeDeTarefas } from "./RodapeDeTarefas";
import { useSessao } from "./sessao";

export function Rodape({ competencias }: { competencias: CompetenciaInfo[] }) {
  const { competencia } = useSessao();
  const atual = competencias.find((c) => c.competencia === competencia) ?? ordenarCompetencias(competencias).at(-1);
  return (
    <footer className="rodape">
      {atual ? <span>Tabela SIGTAP {atual.rotulo}{atual.publicado_em ? `, publicada em ${atual.publicado_em}` : ""}</span> : <span>Sem tabela carregada</span>}
      <span className="topo__espaco" />
      <RodapeDeTarefas />
    </footer>
  );
}
