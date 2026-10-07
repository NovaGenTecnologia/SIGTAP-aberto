import { EstadoVazio } from "../componentes/dominio/Estados";
import "./telas.css";

export function Mudancas() {
  return (
    <div className="tela">
      <h1>Mudanças</h1>
      <EstadoVazio titulo="Comparação entre competências" descricao="Chega na próxima etapa." />
    </div>
  );
}
