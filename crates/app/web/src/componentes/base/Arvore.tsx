import { Collection, Tree, TreeItem, TreeItemContent } from "react-aria-components";
import "./dados.css";

export interface NoArvore { id: string; rotulo: string; filhos?: NoArvore[] }

function No({ no }: { no: NoArvore }) {
  return (
    <TreeItem id={no.id} textValue={no.rotulo} className="arvore__item">
      <TreeItemContent>
        {({ hasChildItems, isExpanded }) => (
          <span className="arvore__linha">
            <span className="arvore__seta" aria-hidden="true">{hasChildItems ? (isExpanded ? "▾" : "▸") : ""}</span>
            {no.rotulo}
          </span>
        )}
      </TreeItemContent>
      {no.filhos && <Collection items={no.filhos}>{(f) => <No no={f} />}</Collection>}
    </TreeItem>
  );
}

export function Arvore({ rotulo, itens, aoAbrir }: { rotulo: string; itens: NoArvore[]; aoAbrir?: (id: string) => void }) {
  return (
    <Tree aria-label={rotulo} items={itens} onAction={aoAbrir ? (k) => aoAbrir(String(k)) : undefined} className="arvore">
      {(n) => <No no={n} />}
    </Tree>
  );
}
