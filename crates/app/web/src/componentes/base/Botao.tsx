import { Button, type ButtonProps } from "react-aria-components";
import "./base.css";

export interface BotaoProps extends Omit<ButtonProps, "className"> {
  variante?: "primario" | "secundario" | "discreto" | "perigo";
  carregando?: boolean;
}

export function Botao({ variante = "secundario", carregando = false, children, ...resto }: BotaoProps) {
  return (
    <Button
      {...resto}
      isPending={carregando}
      className={`botao botao--${variante}`}
    >
      {(estado) => (
        <>
          {carregando && <span className="botao__ponto" aria-hidden="true" />}
          {typeof children === "function" ? children(estado) : children}
        </>
      )}
    </Button>
  );
}
