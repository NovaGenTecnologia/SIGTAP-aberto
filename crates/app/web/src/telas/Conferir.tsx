import { EstadoVazio } from "../componentes/dominio/Estados";
import { SeloDeConfianca } from "../componentes/dominio/SeloDeConfianca";
import "./telas.css";

export function Conferir() {
  return (
    <div className="tela">
      <h1>Conferir arquivo</h1>
      <SeloDeConfianca estado="nao-confirmada" />
      <EstadoVazio titulo="Conferência de BPA, APAC e AIH" descricao="Em desenvolvimento. Cada regra só passa a confirmada depois de provada com arquivo rejeitado e retorno oficial." />
    </div>
  );
}
