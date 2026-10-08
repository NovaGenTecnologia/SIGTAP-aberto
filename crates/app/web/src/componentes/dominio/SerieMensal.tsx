import { rotuloCompetencia } from "../../util/formatos";
import "./dominio.css";

export interface PontoSerie { competencia: string; valor: number; completo: boolean }

export function SerieMensal({ rotulo, pontos, formatar }: { rotulo: string; pontos: PontoSerie[]; formatar: (v: number) => string }) {
  const maximo = Math.max(1, ...pontos.map((p) => p.valor));
  const largura = 24, vao = 8, altura = 120;
  const total = pontos.length * (largura + vao);
  const incompletos = pontos.filter((p) => !p.completo).map((p) => rotuloCompetencia(p.competencia));
  const primeiro = pontos[0], ultimo = pontos.at(-1);
  const resumo = `${rotulo}: ${pontos.length} meses, de ${primeiro ? rotuloCompetencia(primeiro.competencia) : "-"} a ${ultimo ? rotuloCompetencia(ultimo.competencia) : "-"}`;
  return (
    <figure className="serie">
      <svg role="img" aria-label={resumo} viewBox={`0 0 ${Math.max(total, 1)} ${altura + 4}`} className="serie__grafico" preserveAspectRatio="xMinYMax meet">
        <defs>
          <pattern id="serie-hachura" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <rect width="6" height="6" fill="var(--cor-superficie)" /><rect width="3" height="6" fill="var(--cor-nconf)" />
          </pattern>
        </defs>
        {pontos.map((p, i) => {
          const h = Math.max(2, (p.valor / maximo) * altura);
          return <rect key={p.competencia} x={i * (largura + vao)} y={altura - h + 2} width={largura} height={h}
            fill={p.completo ? "var(--cor-acao)" : "url(#serie-hachura)"} stroke={p.completo ? "none" : "var(--cor-nconf)"} />;
        })}
      </svg>
      {incompletos.length > 0 && <figcaption className="serie__legenda">{incompletos.join(", ")}: mês incompleto, fora da conta</figcaption>}
      <table className="so-leitor">
        <caption>{rotulo}</caption>
        <thead><tr><th>Competência</th><th>Valor</th><th>Situação</th></tr></thead>
        <tbody>{pontos.map((p) => <tr key={p.competencia}><td>{rotuloCompetencia(p.competencia)}</td><td>{formatar(p.valor)}</td><td>{p.completo ? "Completo" : "Incompleto"}</td></tr>)}</tbody>
      </table>
    </figure>
  );
}
