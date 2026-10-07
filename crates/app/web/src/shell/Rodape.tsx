import { useCallback } from "react";
import type { CompetenciaInfo, FimTarefa } from "../api/tipos";
import { useAvisos } from "../componentes/base/Avisos";
import { Progresso } from "../componentes/base/Progresso";
import { ordenarCompetencias } from "../util/formatos";
import { useSessao } from "./sessao";
import { useTarefa } from "./useTarefa";

export function Rodape({ competencias }: { competencias: CompetenciaInfo[] }) {
  const { competencia } = useSessao();
  const { avisar } = useAvisos();
  const terminou = useCallback((f: FimTarefa) => avisar(f.mensagem, f.ok ? "ok" : "erro"), [avisar]);
  const { emAndamento, progresso } = useTarefa(terminou);
  const atual = competencias.find((c) => c.competencia === competencia) ?? ordenarCompetencias(competencias).at(-1);
  return (
    <footer className="rodape">
      {atual ? <span>Tabela SIGTAP {atual.rotulo}{atual.publicado_em ? `, publicada em ${atual.publicado_em}` : ""}</span> : <span>Sem tabela carregada</span>}
      <span className="topo__espaco" />
      {emAndamento && progresso && (
        <span className="rodape__tarefa">
          <span className="rodape__resumo">{progresso.resumo || progresso.mensagem}</span>
          <span className="rodape__barra"><Progresso rotulo="Andamento da tarefa" valor={progresso.indeterminado ? undefined : Math.round(progresso.fracao * 100)} /></span>
        </span>
      )}
    </footer>
  );
}
