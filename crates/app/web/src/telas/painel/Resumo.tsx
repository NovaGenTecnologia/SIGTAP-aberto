import type { Impacto, Painel, ResumoDeSistema } from "../../api/tipos";
import { percentual, reais, rotuloCompetencia } from "../../util/formatos";
import { ir } from "../../shell/rotas";

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

/** Quatro números da unidade; cada um só aparece com valor, nunca "0" no lugar de "sem dado". */
export function Resumo({ painel, impacto }: { painel: Dados; impacto: Impacto | undefined }) {
  const taxa = painel.rejeicoes.por_100_aih;
  const mediana = painel.pares?.taxa_mediana_dos_pares ?? null;
  const mud = impacto?.disponivel ? impacto : null;
  return (
    <section className="resumo" aria-label="Resumo da unidade">
      <Sistema nome="SIA" r={painel.sia} />
      <Sistema nome="SIH" r={painel.sih} />
      <div className="resumo__coluna">
        <p className="resumo__rotulo">Rejeições por 100 AIH</p>
        <p className="resumo__valor num">{taxa === null ? "—" : decimal.format(taxa)}</p>
        <span className="resumo__sub">{mediana === null ? "—" : `Unidades parecidas: ${decimal.format(mediana)}`}</span>
      </div>
      <div className="resumo__coluna">
        <p className="resumo__rotulo">{mud ? `Mudanças ${rotuloCompetencia(mud.de)} → ${rotuloCompetencia(mud.para)}` : "Mudanças da tabela"}</p>
        <p className="resumo__valor num">{mud ? `${reais(mud.impacto_unidade_anual_centavos)} por ano` : "—"}</p>
        <span className="resumo__sub">
          {mud ? `UF: ${reais(mud.impacto_uf_anual_centavos)} por ano` : "—"}{" "}
          <a className="painel__ligacao" href="#/mudancas" onClick={(e) => { e.preventDefault(); ir("mudancas"); }}>Ver mudanças</a>
        </span>
      </div>
    </section>
  );
}
