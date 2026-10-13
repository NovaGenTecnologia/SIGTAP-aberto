import type { Painel, ResumoDeSistema } from "../../api/tipos";
import { percentual, reais, rotuloCompetencia } from "../../util/formatos";

type Dados = Extract<Painel, { disponivel: true }>;

const decimal = new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 });

function Variacao({ v }: { v: number | null }) {
  if (v === null) return <span className="resumo__sub">—</span>;
  const r = Math.round(v);
  const tom = r < 0 ? "baixa" : r > 0 ? "alta" : "igual";
  return <span className={`resumo__sub resumo__sub--${tom}`}>{r > 0 ? "+" : ""}{percentual(v)} contra a média de 3 meses</span>;
}

function Sistema({ nome, r }: { nome: string; r: ResumoDeSistema | null }) {
  return (
    <div className="resumo__coluna">
      <p className="resumo__rotulo">{r ? `${nome} aprovado em ${rotuloCompetencia(r.competencia)}` : `${nome} aprovado`}</p>
      <p className="resumo__valor num">{r ? reais(r.valor_centavos) : "—"}</p>
      <Variacao v={r?.variacao_media_3_meses ?? null} />
    </div>
  );
}

/** Três números da unidade; cada um só aparece com valor, nunca "0" no lugar de "sem dado". */
export function Resumo({ painel }: { painel: Dados }) {
  const taxa = painel.rejeicoes.por_100_aih;
  const mediana = painel.pares?.taxa_mediana_dos_pares ?? null;
  return (
    <section className="resumo" aria-label="Resumo da unidade">
      <Sistema nome="SIA" r={painel.sia} />
      <Sistema nome="SIH" r={painel.sih} />
      <div className="resumo__coluna">
        <p className="resumo__rotulo">Rejeições por 100 AIH</p>
        <p className="resumo__valor num">{taxa === null ? "—" : decimal.format(taxa)}</p>
        <span className="resumo__sub">{mediana === null ? "—" : `Unidades parecidas: ${decimal.format(mediana)}`}</span>
      </div>
    </section>
  );
}
