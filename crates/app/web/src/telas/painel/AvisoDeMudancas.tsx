import type { Impacto } from "../../api/tipos";
import { ir } from "../../shell/rotas";
import { reais, rotuloCompetencia } from "../../util/formatos";

/** Linha de aviso abaixo do fechamento: a tabela nova não é produção da unidade, então não é um número do fechamento. */
export function AvisoDeMudancas({ impacto }: { impacto: Impacto | undefined }) {
  if (!impacto?.disponivel) return null;
  const unidade = impacto.impacto_unidade_anual_centavos;
  return (
    <p className="painel__aviso" role="note" aria-label="Mudanças da tabela">
      <span>
        Tabela SIGTAP {rotuloCompetencia(impacto.de)} → {rotuloCompetencia(impacto.para)}:{" "}
        {unidade === 0 ? "sem impacto nesta unidade" : `${reais(unidade)} por ano nesta unidade`} · UF {reais(impacto.impacto_uf_anual_centavos)} por ano
      </span>
      <a className="painel__ligacao" href="#/mudancas" onClick={(e) => { e.preventDefault(); ir("mudancas"); }}>Ver mudanças</a>
    </p>
  );
}
