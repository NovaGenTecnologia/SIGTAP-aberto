import { rotuloCompetencia } from "../../../util/formatos";

/** Doze barras pequenas da evolução mensal; o texto do `aria-label` traz cada mês e o valor, para quem não vê o desenho. */
export function MiniSerie({ pontos, rotulo }: { pontos: { competencia: string; valor: number }[]; rotulo: string }) {
  const maximo = Math.max(1, ...pontos.map((p) => p.valor));
  const largura = 4, vao = 2, altura = 16;
  const detalhe = pontos.map((p) => `${rotuloCompetencia(p.competencia)}: ${p.valor}`).join("; ");
  return (
    <svg className="pr__mini" role="img" aria-label={`${rotulo}. Maior valor: ${maximo}. ${detalhe}`}
      viewBox={`0 0 ${Math.max(1, pontos.length * (largura + vao))} ${altura}`} width={pontos.length * (largura + vao)} height={altura}>
      {pontos.map((p, i) => {
        const h = p.valor === 0 ? 1 : Math.max(2, (p.valor / maximo) * altura);
        return <rect key={p.competencia} x={i * (largura + vao)} y={altura - h} width={largura} height={h} fill="var(--cor-texto-3)" />;
      })}
    </svg>
  );
}
