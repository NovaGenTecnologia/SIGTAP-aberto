import type { ReactNode } from "react";
import { Button, Menu as MenuRAC, MenuItem, MenuTrigger, Popover } from "react-aria-components";
import "./superficie.css";

export interface MenuProps {
  rotulo: string;
  itens: { id: string; rotulo: string; separado?: boolean }[];
  aoEscolher: (id: string) => void;
  children: ReactNode;
}

export function Menu({ rotulo, itens, aoEscolher, children }: MenuProps) {
  return (
    <MenuTrigger>
      <Button className="menu__botao" aria-label={rotulo}>
        {children}<span aria-hidden="true">▾</span>
      </Button>
      <Popover className="balao">
        <MenuRAC aria-label={rotulo} items={itens} onAction={(k) => aoEscolher(String(k))} className="lista">
          {(i) => <MenuItem id={i.id} textValue={i.rotulo} className="lista__item" data-separado={i.separado || undefined}>{i.rotulo}</MenuItem>}
        </MenuRAC>
      </Popover>
    </MenuTrigger>
  );
}
