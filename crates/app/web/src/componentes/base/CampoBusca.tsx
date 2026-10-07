import { Button, Input, Label, SearchField, type SearchFieldProps } from "react-aria-components";
import "./base.css";

export interface CampoBuscaProps extends Omit<SearchFieldProps, "className" | "children"> {
  rotulo: string;
  placeholder?: string;
}

export function CampoBusca({ rotulo, placeholder, ...resto }: CampoBuscaProps) {
  return (
    <SearchField {...resto} className="campo campo--busca">
      <Label className="campo__rotulo">{rotulo}</Label>
      <div className="campo__linha">
        <Input className="campo__entrada" placeholder={placeholder} />
        <Button className="campo__limpar" aria-label="Limpar busca">×</Button>
      </div>
    </SearchField>
  );
}
