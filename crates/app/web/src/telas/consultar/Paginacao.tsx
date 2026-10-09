import { inteiro } from "../../util/formatos";

/** Procedimentos por página: igual ao do backend (`TAMANHO_DA_PAGINA`), sem seletor. */
export const TAMANHO_DA_PAGINA = 100;

/** Números a mostrar: até 7 páginas todas; senão a primeira, a vizinhança da atual e a última, com "…" nos buracos. */
export function numerosDaPaginacao(pagina: number, paginas: number): (number | "…")[] {
  if (paginas <= 7) return Array.from({ length: paginas }, (_, i) => i + 1);
  if (pagina <= 3) return [1, 2, 3, 4, "…", paginas];
  if (pagina >= paginas - 2) return [1, "…", paginas - 3, paginas - 2, paginas - 1, paginas];
  return [1, "…", pagina - 1, pagina, pagina + 1, "…", paginas];
}

export interface PaginacaoProps {
  /** Página atual, a partir de 1. */
  pagina: number;
  paginas: number;
  /** Procedimentos que passam nos filtros. */
  total: number;
  aoIr: (pagina: number) => void;
}

/** Faixa "1–100 de 237 procedimentos" e os botões de página. Com uma página só, não aparece. */
export function Paginacao({ pagina, paginas, total, aoIr }: PaginacaoProps) {
  if (paginas <= 1) return null;
  const de = (pagina - 1) * TAMANHO_DA_PAGINA + 1;
  const ate = Math.min(pagina * TAMANHO_DA_PAGINA, total);
  return (
    <div className="paginacao">
      <p className="paginacao__faixa num">{`${inteiro(de)}–${inteiro(ate)} de ${inteiro(total)} procedimentos`}</p>
      <nav aria-label="Paginação" className="paginacao__botoes">
        <button type="button" className="paginacao__botao" aria-label="Página anterior" disabled={pagina <= 1} onClick={() => aoIr(pagina - 1)}>‹</button>
        {numerosDaPaginacao(pagina, paginas).map((n, i) =>
          n === "…" ? (
            <span key={`r${i}`} className="paginacao__reticencias" aria-hidden="true">…</span>
          ) : (
            <button key={n} type="button" className="paginacao__botao num" aria-label={`Página ${n}`} aria-current={n === pagina ? "page" : undefined}
              onClick={() => { if (n !== pagina) aoIr(n); }}>{n}</button>
          ),
        )}
        <button type="button" className="paginacao__botao" aria-label="Próxima página" disabled={pagina >= paginas} onClick={() => aoIr(pagina + 1)}>›</button>
      </nav>
    </div>
  );
}
