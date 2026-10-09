import { useId, useState, type ReactNode } from "react";
import type { ItemDeApoio } from "../../api/tipos";
import { inteiro } from "../../util/formatos";
import { rotuloDaTabela } from "./modelo/apoio";

const listaComE = (nomes: string[]): string =>
  nomes.length <= 1 ? (nomes[0] ?? "") : `${nomes.slice(0, -1).join(", ")} e ${nomes[nomes.length - 1]}`;

export interface ApoioRecolhidoProps {
  itens: ItemDeApoio[];
  /** A tabela de apoio, mostrada quando a barra está aberta. */
  children: ReactNode;
  /** Abre já na primeira vez (a busca só achou apoio). */
  inicialmenteAberto?: boolean;
}

/** "Apoio · 3 resultados em CID e CBO": o apoio (CID, CBO, habilitação...) fica numa barra recolhida acima da tabela. */
export function ApoioRecolhido({ itens, children, inicialmenteAberto = false }: ApoioRecolhidoProps) {
  const [aberto, setAberto] = useState(inicialmenteAberto);
  const id = useId();
  if (itens.length === 0) return null;
  const tabelas = [...new Set(itens.map((i) => rotuloDaTabela(i.tabela)))];
  return (
    <section className="apoio-recolhido" aria-label="Apoio">
      <button type="button" className="apoio-recolhido__barra" aria-expanded={aberto} aria-controls={id} onClick={() => setAberto((a) => !a)}>
        <span className="apoio-recolhido__titulo">Apoio</span>{" "}
        <span>{`· ${inteiro(itens.length)} ${itens.length === 1 ? "resultado" : "resultados"} em ${listaComE(tabelas)}`}</span>
        <span className="apoio-recolhido__seta" aria-hidden="true">{aberto ? "▾" : "▸"}</span>
      </button>
      {aberto && <div id={id} className="apoio-recolhido__conteudo">{children}</div>}
    </section>
  );
}
