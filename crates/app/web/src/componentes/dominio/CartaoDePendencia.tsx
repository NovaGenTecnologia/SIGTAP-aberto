import { Botao } from "../base/Botao";
import { reais } from "../../util/formatos";
import { LinhaGuia, type PassoGuia } from "./LinhaGuia";
import "./dominio.css";

export interface CartaoDePendenciaProps {
  titulo: string;
  valorCentavos?: number;
  gravidade: "alta" | "media" | "info";
  passos: PassoGuia[];
  acao: { rotulo: string; aoAcionar: () => void };
}

export function CartaoDePendencia({ titulo, valorCentavos, gravidade, passos, acao }: CartaoDePendenciaProps) {
  return (
    <article className={`pendencia pendencia--${gravidade}`}>
      <header className="pendencia__topo">
        <h3 className="pendencia__titulo">{titulo}</h3>
        {valorCentavos !== undefined && <strong className="pendencia__valor num">{reais(valorCentavos)}</strong>}
      </header>
      <LinhaGuia passos={passos} />
      <div className="pendencia__acao"><Botao onPress={acao.aoAcionar}>{acao.rotulo}</Botao></div>
    </article>
  );
}
