import type { ReactElement } from "react";
import { Tooltip, TooltipTrigger } from "react-aria-components";
import "./superficie.css";

export function Dica({ texto, children }: { texto: string; children: ReactElement }) {
  return (
    <TooltipTrigger delay={400} closeDelay={0}>
      {children}
      <Tooltip className="dica" offset={6}>{texto}</Tooltip>
    </TooltipTrigger>
  );
}
