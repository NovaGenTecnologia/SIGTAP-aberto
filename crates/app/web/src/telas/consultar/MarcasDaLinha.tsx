import { useMemo } from "react";
import type { TipoMarcado } from "../../api/comandos";
import { useMarcados } from "../../dados/marcados";

export interface MarcasDoItem { favorito: boolean; anotacao: boolean }

/** Favoritos e anotações de um tipo, por código, para as linhas das listas e da árvore. */
export function useMapaDeMarcas(tipo: TipoMarcado): Map<string, MarcasDoItem> {
  const { data } = useMarcados(tipo);
  return useMemo(() => {
    const mapa = new Map<string, MarcasDoItem>();
    for (const i of data ?? []) mapa.set(i.codigo, { favorito: i.favorito, anotacao: !!i.anotacao });
    return mapa;
  }, [data]);
}

/** Estrela e lápis discretos: só aparecem no que o usuário marcou. */
export function MarcasDaLinha({ marcas }: { marcas?: MarcasDoItem }) {
  if (!marcas || (!marcas.favorito && !marcas.anotacao)) return null;
  return (
    <span className="marcas-linha">
      {marcas.favorito && (
        <svg role="img" aria-label="Favorito" width="14" height="14" viewBox="0 0 24 24"><title>Favorito</title>
          <path d="M12 2.8l2.76 5.6 6.18.9-4.47 4.36 1.06 6.15L12 16.9l-5.53 2.91 1.06-6.15L3.06 9.3l6.18-.9z" fill="currentColor" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
        </svg>
      )}
      {marcas.anotacao && (
        <svg role="img" aria-label="Com anotação" width="14" height="14" viewBox="0 0 24 24"><title>Com anotação</title>
          <path d="M4 20l1-4.5L16.5 4a2 2 0 0 1 2.8 0l.7.7a2 2 0 0 1 0 2.8L8.5 19z" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
        </svg>
      )}
    </span>
  );
}
