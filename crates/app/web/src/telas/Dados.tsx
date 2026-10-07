import { EstadoVazio } from "../componentes/dominio/Estados";
import "./telas.css";

export function Dados() {
  return (
    <div className="tela">
      <h1>Dados</h1>
      <EstadoVazio titulo="Tabelas, CNES e produção" descricao="Chegam na próxima etapa." />
    </div>
  );
}
