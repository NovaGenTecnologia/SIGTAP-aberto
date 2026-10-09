import type { Ausente } from "../../../api/tipos";
import { Botao } from "../../../componentes/base/Botao";
import { ir } from "../../../shell/rotas";
import { mesesEmTexto } from "./util";

/** O que um bloco opcional diz quando não há o que mostrar: falta o campo, falta o dado da unidade ou falta o cadastro. */
export function AvisoDeAusente({ bloco, ausente }: { bloco: string; ausente: Ausente }) {
  if (ausente.motivo === "sem_dado") {
    return <p className="pr__ausente un__vazio" role="note" aria-label={`${bloco}: sem dado`}>Nada a mostrar para esta unidade no período</p>;
  }
  const meses = ausente.meses ?? [];
  return (
    <div className="pr__ausente" role="note" aria-label={`${bloco}: sem dado`}>
      <div className="pr__ausente-texto">
        <p>
          {ausente.motivo === "sem_cadastro"
            ? "Sem o cadastro de serviços do CNES desta unidade"
            : `Sem o campo ${ausente.campo ?? "do arquivo"} nos meses carregados. Baixe de novo para ver.`}
        </p>
        {ausente.motivo === "sem_campo" && meses.length > 0 && <p className="pr__ref num">{mesesEmTexto(meses)}</p>}
      </div>
      <Botao onPress={() => ir("dados")}>Abrir em Dados</Botao>
    </div>
  );
}
