import { Abas } from "../componentes/base/Abas";
import { ir, lerConsultar, useRota } from "../shell/rotas";
import { Buscar } from "./consultar/Buscar";
import { Explorar } from "./consultar/Explorar";
import { Ficha } from "./consultar/Ficha";
import "./consultar/consultar.css";

export function Consultar() {
  const { resto } = useRota();
  const rota = lerConsultar(resto);

  // A ficha ocupa a tela inteira (sem abas).
  if (rota.tela === "ficha") return <Ficha />;

  const aba = rota.tela === "explorar" ? "explorar" : "buscar";
  return (
    <div className="consultar">
      <header className="consultar__titulo"><h1>Consultar</h1></header>
      <Abas
        rotulo="Modo de consulta"
        selectedKey={aba}
        onSelectionChange={(k) => (k === "explorar" ? ir("consultar", "explorar") : ir("consultar"))}
        abas={[
          { id: "buscar", rotulo: "Buscar", conteudo: aba === "buscar" ? <Buscar /> : null },
          { id: "explorar", rotulo: "Explorar", conteudo: aba === "explorar" ? <Explorar /> : null },
        ]}
      />
    </div>
  );
}
