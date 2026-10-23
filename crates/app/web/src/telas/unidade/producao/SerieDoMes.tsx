import type { MesDaUnidade } from "../../../api/tipos";
import { SerieMensal, type PontoSerie } from "../../../componentes/dominio/SerieMensal";
import { rotuloCompetencia } from "../../../util/formatos";
import { valorCompacto } from "./util";

/** O valor aprovado mês a mês, com o mês incompleto hachurado e dito em texto; o valor de cada mês está na tabela do leitor de tela. */
export function SerieDoMes({ rotulo, meses, completos, valor }: {
  rotulo: string; meses: MesDaUnidade[]; completos: string[]; valor: (m: MesDaUnidade) => number;
}) {
  const pontos: PontoSerie[] = meses.map((m) => ({ competencia: m.competencia, valor: valor(m), completo: completos.includes(m.competencia) }));
  const primeiro = pontos[0], ultimo = pontos.at(-1);
  return (
    <section className="pr__serie un__cartao" aria-label={rotulo}>
      <h3 className="pr__rotulo">{rotulo}</h3>
      {primeiro && ultimo && <p className="un__sub">{rotuloCompetencia(primeiro.competencia)} a {rotuloCompetencia(ultimo.competencia)}</p>}
      <SerieMensal rotulo={rotulo} pontos={pontos} formatar={(v) => valorCompacto(v)} altura={80} />
      {pontos.every((p) => p.completo) && <p className="un__sub">Todos os meses completos.</p>}
    </section>
  );
}
