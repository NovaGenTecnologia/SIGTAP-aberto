import { FieldError, Input, Label, Text, TextField, type TextFieldProps } from "react-aria-components";
import "./base.css";

export interface CampoTextoProps extends Omit<TextFieldProps, "className" | "children"> {
  rotulo: string;
  descricao?: string;
  erro?: string;
}

export function CampoTexto({ rotulo, descricao, erro, ...resto }: CampoTextoProps) {
  return (
    <TextField {...resto} className="campo">
      <Label className="campo__rotulo">{rotulo}</Label>
      <Input className="campo__entrada" />
      {descricao && <Text slot="description" className="campo__ajuda">{descricao}</Text>}
      <FieldError className="campo__erro">{erro}</FieldError>
    </TextField>
  );
}
