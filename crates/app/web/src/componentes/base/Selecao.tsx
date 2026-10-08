import { Button, Label, ListBox, ListBoxItem, Popover, Select, SelectValue, type SelectProps } from "react-aria-components";
import "./base.css";

export interface ItemSimples { id: string; rotulo: string }
export interface SelecaoProps extends Omit<SelectProps<ItemSimples>, "className" | "children"> {
  rotulo: string;
  itens: ItemSimples[];
}

export function Selecao({ rotulo, itens, ...resto }: SelecaoProps) {
  return (
    <Select {...resto} className="campo">
      <Label className="campo__rotulo">{rotulo}</Label>
      <Button className="selecao__botao">
        <SelectValue className="selecao__valor" />
        <span aria-hidden="true" className="selecao__seta">▾</span>
      </Button>
      <Popover className="balao">
        <ListBox items={itens} className="lista">
          {(i) => <ListBoxItem id={i.id} textValue={i.rotulo} className="lista__item">{i.rotulo}</ListBoxItem>}
        </ListBox>
      </Popover>
    </Select>
  );
}
