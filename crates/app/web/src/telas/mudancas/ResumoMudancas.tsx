import type { Impacto, Mudancas } from "../../api/tipos";
import { inteiro, reais } from "../../util/formatos";
import { DeOndeVem } from "../painel/DeOndeVem";

type ComImpacto = Extract<Impacto, { disponivel: true }>;

/** Quatro números da comparação; o impacto é estimativa e diz de onde vem. */
export function ResumoMudancas({ impacto, mudancas }: { impacto: ComImpacto; mudancas: Mudancas | undefined }) {
  const procedimentos = mudancas?.tabelas.find((t) => t.tabela === "tb_procedimento");
  return (
    <section className="mud__resumo" aria-label="Resumo das mudanças">
      <div className="mud__coluna">
        <p className="mud__rotulo">Mudanças de valor</p>
        <p className="mud__numero num">{inteiro(impacto.mudancas_de_valor)}</p>
        <p className="mud__dica">{inteiro(impacto.mudancas_com_producao)} com produção na UF</p>
      </div>
      <div className="mud__coluna">
        <p className="mud__rotulo">Impacto na unidade</p>
        <p className="mud__numero num">{reais(impacto.impacto_unidade_anual_centavos)} <span className="mud__unidade">por ano</span></p>
        <p className="mud__dica">estimativa <DeOndeVem titulo="Impacto estimado" linhas={[{ rotulo: "Conta", texto: impacto.aviso }]} /></p>
      </div>
      <div className="mud__coluna">
        <p className="mud__rotulo">Impacto na UF de {impacto.uf}</p>
        <p className="mud__numero num">{reais(impacto.impacto_uf_anual_centavos)} <span className="mud__unidade">por ano</span></p>
        <p className="mud__dica">estimativa</p>
      </div>
      <div className="mud__coluna">
        <p className="mud__rotulo">Procedimentos</p>
        <p className="mud__numero num">{procedimentos ? <>{inteiro(procedimentos.incluidos)} <span className="mud__unidade">incluídos</span> · {inteiro(procedimentos.excluidos)} <span className="mud__unidade">excluídos</span></> : "—"}</p>
        <p className="mud__dica">na tabela</p>
      </div>
    </section>
  );
}
