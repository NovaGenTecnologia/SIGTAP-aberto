import { Checkbox, type CheckboxProps } from "react-aria-components";
import "./base.css";

export function CaixaMarcacao({ children, ...resto }: Omit<CheckboxProps, "className">) {
  return (
    <Checkbox {...resto} className="marca">
      {(estado) => (
        <>
          <span className="marca__caixa" aria-hidden="true">{estado.isSelected ? "✓" : estado.isIndeterminate ? "−" : ""}</span>
          {typeof children === "function" ? children(estado) : children}
        </>
      )}
    </Checkbox>
  );
}
