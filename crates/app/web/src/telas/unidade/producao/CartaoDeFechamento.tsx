import { useId, type ReactNode } from "react";

export type TomDoSentido = "ok" | "atencao" | "neutro";

/** Um número do fechamento do mês: rótulo, valor, o sentido em símbolo e palavra (nunca só cor) e a referência. */
export function CartaoDeFechamento({ rotulo, valor, sentido, referencia }: {
  rotulo: string; valor: ReactNode; sentido?: { texto: string; tom: TomDoSentido } | null; referencia?: ReactNode[];
}) {
  const id = useId();
  return (
    <section className="pr__cartao un__cartao" aria-labelledby={id}>
      <h3 className="pr__rotulo" id={id}>{rotulo}</h3>
      <p className="pr__valor num">{valor}</p>
      {sentido && <p className={`pr__sentido pr__sentido--${sentido.tom}`}>{sentido.texto}</p>}
      {referencia?.map((r, i) => <p key={i} className="pr__ref">{r}</p>)}
    </section>
  );
}
