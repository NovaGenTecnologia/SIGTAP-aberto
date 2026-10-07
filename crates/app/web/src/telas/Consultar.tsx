import { EstadoVazio } from "../componentes/dominio/Estados";
import { useRota } from "../shell/rotas";
import "./telas.css";

export function Consultar() {
  const { resto } = useRota();
  const codigo = resto[0];
  return (
    <div className="tela">
      <h1>Consultar</h1>
      {codigo ? <p className="num tela__codigo">{codigo}</p> : null}
      <EstadoVazio titulo={codigo ? "Ficha do procedimento" : "Busca e árvore"} descricao="Chegam na próxima etapa." />
    </div>
  );
}
