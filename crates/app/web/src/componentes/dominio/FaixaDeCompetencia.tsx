import { Label, Radio, RadioGroup } from "react-aria-components";
import "./dominio.css";

export interface FaixaDeCompetenciaProps {
  competencias: { competencia: string; rotulo: string }[];
  selecionada: string;
  aoSelecionar: (competencia: string) => void;
}

export function FaixaDeCompetencia({ competencias, selecionada, aoSelecionar }: FaixaDeCompetenciaProps) {
  return (
    <RadioGroup value={selecionada} onChange={aoSelecionar} orientation="horizontal" className="faixa">
      <Label className="so-leitor">Competência</Label>
      <div className="faixa__linha">
        {competencias.map((c) => (
          <Radio key={c.competencia} value={c.competencia} className="faixa__item"><span className="num">{c.rotulo}</span></Radio>
        ))}
      </div>
    </RadioGroup>
  );
}
