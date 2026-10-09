import type { CompetenciaInfo } from "../../api/tipos";
import { Interruptor } from "../../componentes/base/Interruptor";
import { Selecao } from "../../componentes/base/Selecao";
import { ordenarCompetencias } from "../../util/formatos";

export interface FiltrosProps {
  competencias: CompetenciaInfo[];
  de: string;
  para: string;
  soAfeta: boolean;
  temUnidade: boolean;
  resumo?: string;
  aoMudar: (v: { de: string; para: string; soAfeta: boolean }) => void;
}

/** De → Para (só competências carregadas, De sempre antes de Para) e o filtro "Só o que me afeta". */
export function Filtros({ competencias, de, para, soAfeta, temUnidade, resumo, aoMudar }: FiltrosProps) {
  const ordem = ordenarCompetencias(competencias);
  const itens = (lista: CompetenciaInfo[]) => [...lista].reverse().map((c) => ({ id: c.competencia, rotulo: c.rotulo }));
  const anteriores = ordem.filter((c) => c.competencia < para);
  const posteriores = ordem.filter((c) => c.competencia > de);
  return (
    <div className="mud__filtros">
      <Selecao rotulo="De" itens={itens(anteriores)} selectedKey={de} onSelectionChange={(k) => k && aoMudar({ de: String(k), para, soAfeta })} />
      <span className="mud__seta-de-para" aria-hidden="true">→</span>
      <Selecao rotulo="Para" itens={itens(posteriores)} selectedKey={para} onSelectionChange={(k) => {
        if (!k) return;
        const novoPara = String(k);
        const antes = ordem.filter((c) => c.competencia < novoPara);
        aoMudar({ de: de < novoPara ? de : (antes.at(-1)?.competencia ?? de), para: novoPara, soAfeta });
      }} />
      <div className="mud__interruptor">
        <Interruptor isSelected={soAfeta} isDisabled={!temUnidade} onChange={(v) => aoMudar({ de, para, soAfeta: v })}>Só o que me afeta</Interruptor>
        {!temUnidade && <span className="mud__dica">Escolha a sua unidade para filtrar</span>}
      </div>
      {resumo && <p className="mud__contagem">{resumo}</p>}
    </div>
  );
}
