import type { RefObject } from "react";
import { Botao } from "../../componentes/base/Botao";
import { useHistorico } from "../../dados/consultar";
import { useSessao } from "../../shell/sessao";
import { mascararProcedimento } from "../../util/campos";
import { rotuloCompetencia } from "../../util/formatos";
import { CaixasDoCodigo } from "./FaixaDaFicha";
import { FichaHistorico } from "./FichaHistorico";

/** Código válido em outra competência: diz que não existe nesta e mostra o histórico. */
export function FichaInexistente({ codigo, refTitulo }: { codigo: string; refTitulo: RefObject<HTMLHeadingElement | null> }) {
  const { competencia, definirCompetencia } = useSessao();
  const h = useHistorico(codigo);
  const onde = competencia ? `em ${rotuloCompetencia(competencia)}` : "em competência atual";
  const existiu = h.data?.eventos.find((e) => e.tipo !== "excluido");
  const semRegistro = !!h.data && h.data.eventos.length === 0;
  return (
    <div className="ficha-inexistente">
      <CaixasDoCodigo codigo={codigo} />
      <h1 ref={refTitulo} tabIndex={-1}>{mascararProcedimento(codigo)} não existe {onde}</h1>
      <p className="ficha-inexistente__texto">
        {semRegistro ? "Não há registro dele nas competências carregadas." : "Ele existe em outras competências. O histórico mostra quando entrou e o que mudou."}
      </p>
      {existiu && <div><Botao variante="primario" onPress={() => definirCompetencia(existiu.competencia)}>Ver em {rotuloCompetencia(existiu.competencia)}</Botao></div>}
      {!semRegistro && <section className="ficha-inexistente__historico">
        <h2>Histórico</h2>
        <FichaHistorico codigo={codigo} />
      </section>}
    </div>
  );
}
