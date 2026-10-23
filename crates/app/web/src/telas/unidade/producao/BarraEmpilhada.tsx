export interface ParteDaBarra { rotulo: string; valor: number }

export const TONS = ["var(--cor-acao-escura)", "var(--cor-info)", "var(--cor-atencao)", "var(--cor-nconf)", "var(--cor-linha-controle)"] as const;
const arredondado = (p: number) => (p > 0 && p < 1 ? "<1" : String(Math.round(p)));

/** Uma faixa com a parte de cada item no total; o `aria-label` traz os mesmos números em texto e a cor não é a única pista. */
export function BarraEmpilhada({ quem, partes }: { quem: string; partes: ParteDaBarra[] }) {
  const total = partes.reduce((s, p) => s + p.valor, 0);
  const pct = (v: number) => (total > 0 ? (v * 100) / total : 0);
  const texto = partes.map((p) => `${p.rotulo} ${arredondado(pct(p.valor))}%`).join("; ");
  let x = 0;
  return (
    <svg className="pr__proporcao" role="img" aria-label={`${quem}: ${texto}`} viewBox="0 0 100 8" preserveAspectRatio="none" width="100%" height="8">
      {partes.map((p, i) => {
        const largura = pct(p.valor);
        const rect = <rect key={p.rotulo} x={x} y={0} width={largura} height={8} fill={TONS[i % TONS.length]} stroke="var(--cor-superficie)" strokeWidth={0.4} vectorEffect="non-scaling-stroke" />;
        x += largura;
        return rect;
      })}
    </svg>
  );
}
