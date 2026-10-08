import { useEffect } from "react";
import type { CompetenciaInfo } from "../api/tipos";
import { Selecao } from "../componentes/base/Selecao";
import { ordenarCompetencias } from "../util/formatos";
import { useSessao } from "./sessao";

export function SeletorDeCompetencia({ competencias, desativado }: { competencias: CompetenciaInfo[]; desativado: boolean }) {
  const { competencia, definirCompetencia } = useSessao();
  const ordenadas = ordenarCompetencias(competencias);
  const maisRecente = ordenadas.at(-1)?.competencia ?? null;
  useEffect(() => { if (!competencia && maisRecente) definirCompetencia(maisRecente); }, [competencia, maisRecente, definirCompetencia]);
  const itens = [...ordenadas].reverse().map((c) => ({ id: c.competencia, rotulo: c.rotulo }));
  return (
    <Selecao rotulo="Competência" itens={itens} selectedKey={competencia ?? maisRecente}
      onSelectionChange={(k) => k && definirCompetencia(String(k))} isDisabled={desativado || itens.length === 0} />
  );
}
