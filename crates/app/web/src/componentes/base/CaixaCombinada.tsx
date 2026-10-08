import { Button, ComboBox, Input, Label, ListBox, ListBoxItem, Popover, type ComboBoxProps } from "react-aria-components";
import type { ItemSimples } from "./Selecao";
import "./base.css";

export interface CaixaCombinadaProps extends Omit<ComboBoxProps<ItemSimples>, "className" | "children" | "items"> {
  rotulo: string;
  itens: ItemSimples[];
}

export function CaixaCombinada({ rotulo, itens, ...resto }: CaixaCombinadaProps) {
  return (
    <ComboBox {...resto} defaultItems={itens} className="campo">
      <Label className="campo__rotulo">{rotulo}</Label>
      <div className="campo__linha">
        <Input className="campo__entrada" />
        <Button className="campo__limpar" aria-label="Mostrar opções">▾</Button>
      </div>
      <Popover className="balao">
        <ListBox className="lista">
          {(i: ItemSimples) => <ListBoxItem id={i.id} textValue={i.rotulo} className="lista__item">{i.rotulo}</ListBoxItem>}
        </ListBox>
      </Popover>
    </ComboBox>
  );
}
