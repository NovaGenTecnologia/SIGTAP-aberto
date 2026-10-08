import type { ReactNode } from "react";
import { Tab, TabList, TabPanel, Tabs, type TabsProps } from "react-aria-components";
import "./superficie.css";

export interface AbasProps extends Omit<TabsProps, "className" | "children"> {
  rotulo: string;
  abas: { id: string; rotulo: string; conteudo: ReactNode }[];
}

export function Abas({ rotulo, abas, ...resto }: AbasProps) {
  return (
    <Tabs {...resto} className="abas">
      <TabList aria-label={rotulo} className="abas__lista">
        {abas.map((a) => <Tab key={a.id} id={a.id} className="abas__aba">{a.rotulo}</Tab>)}
      </TabList>
      {abas.map((a) => <TabPanel key={a.id} id={a.id} className="abas__painel">{a.conteudo}</TabPanel>)}
    </Tabs>
  );
}
