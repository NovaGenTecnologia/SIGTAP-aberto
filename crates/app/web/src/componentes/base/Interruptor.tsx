import { Switch, type SwitchProps } from "react-aria-components";
import "./base.css";

export function Interruptor({ children, ...resto }: Omit<SwitchProps, "className">) {
  return (
    <Switch {...resto} className="interruptor">
      {(estado) => (
        <>
          <span className="interruptor__trilho" aria-hidden="true"><span className="interruptor__botao" /></span>
          {typeof children === "function" ? children(estado) : children}
        </>
      )}
    </Switch>
  );
}
