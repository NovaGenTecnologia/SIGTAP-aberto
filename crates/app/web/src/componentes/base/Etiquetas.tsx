import { Label, Tag, TagGroup, TagList, type TagGroupProps } from "react-aria-components";
import "./base.css";

export interface EtiquetasProps extends Omit<TagGroupProps, "className" | "children"> {
  rotulo: string;
  itens: { id: string; rotulo: string }[];
}

export function Etiquetas({ rotulo, itens, ...resto }: EtiquetasProps) {
  return (
    <TagGroup {...resto} className="etiquetas">
      <Label className="campo__rotulo">{rotulo}</Label>
      <TagList items={itens} className="etiquetas__lista">
        {(i) => <Tag id={i.id} textValue={i.rotulo} className="etiqueta">{i.rotulo}</Tag>}
      </TagList>
    </TagGroup>
  );
}
