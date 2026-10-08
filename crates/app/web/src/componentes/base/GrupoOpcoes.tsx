import { Label, Radio, RadioGroup, type RadioGroupProps } from "react-aria-components";
import "./base.css";

export interface GrupoOpcoesProps extends Omit<RadioGroupProps, "className" | "children"> {
  rotulo: string;
  opcoes: { valor: string; rotulo: string }[];
}

export function GrupoOpcoes({ rotulo, opcoes, ...resto }: GrupoOpcoesProps) {
  return (
    <RadioGroup {...resto} className="grupo">
      <Label className="campo__rotulo">{rotulo}</Label>
      <div className="grupo__linha">
        {opcoes.map((o) => (
          <Radio key={o.valor} value={o.valor} className="opcao">
            <span className="opcao__bolinha" aria-hidden="true" />
            {o.rotulo}
          </Radio>
        ))}
      </div>
    </RadioGroup>
  );
}
