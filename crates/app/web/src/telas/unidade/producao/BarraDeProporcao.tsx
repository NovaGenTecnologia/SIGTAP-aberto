import type { ResumoDaCurva } from "../../../api/tipos";
import { inteiro } from "../../../util/formatos";

const CLASSES = ["A", "B", "C"] as const;
const COR = { A: "var(--cor-acao-escura)", B: "var(--cor-acao)", C: "var(--cor-linha-controle)" } as const;

/** Uma faixa com a parte do valor de cada classe da curva; o `aria-label` traz os mesmos números em texto. */
export function BarraDeProporcao({ resumo, total }: { resumo: ResumoDaCurva; total: number }) {
  const partes = CLASSES.map((c) => ({ c, p: total > 0 ? (resumo[c].valor_centavos * 100) / total : 0 }));
  const texto = partes.map(({ c, p }) => `classe ${c}: ${inteiro(resumo[c].procedimentos)} procedimentos, ${Math.round(p)}% do valor`).join("; ");
  let x = 0;
  return (
    <svg className="pr__proporcao" role="img" aria-label={`Parte do valor por classe. ${texto}`} viewBox="0 0 100 8" preserveAspectRatio="none" width="100%" height="8">
      {partes.map(({ c, p }) => {
        const rect = <rect key={c} x={x} y={0} width={p} height={8} fill={COR[c]} />;
        x += p;
        return rect;
      })}
    </svg>
  );
}
