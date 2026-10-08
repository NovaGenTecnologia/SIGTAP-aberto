import { useEffect, useRef, useState } from "react";
import { fecharPrograma } from "../api/comandos";
import { ouvirPedidoDeFechar } from "../api/eventos";
import { ConfirmarAcao } from "../componentes/dominio/ConfirmarAcao";
import { FONTES, nomeDaFonte, useTarefas } from "../dados/tarefas";

const lista = (nomes: string[]) => (nomes.length > 1 ? `${nomes.slice(0, -1).join(", ")} e ${nomes.at(-1)}` : nomes[0] ?? "");

/** O programa pede confirmação ao fechar a janela com download em andamento. */
export function ConfirmarSaida() {
  const { tarefas } = useTarefas();
  const [aberto, setAberto] = useState(false);
  const fechando = useRef(false);

  useEffect(() => {
    let parar: (() => void) | undefined, vivo = true;
    void ouvirPedidoDeFechar(() => setAberto(true)).then((f) => { if (vivo) parar = f; else f(); }).catch(() => {});
    return () => { vivo = false; parar?.(); };
  }, []);

  const baixando = FONTES.filter((f) => tarefas[f].ativa).map(nomeDaFonte);
  return (
    <ConfirmarAcao
      aberto={aberto}
      titulo="Fechar o programa agora?"
      detalhe={`${lista(baixando)} ${baixando.length > 1 ? "ainda estão baixando" : "ainda está baixando"}. Se fechar, ${baixando.length > 1 ? "eles param" : "ele para"}.`}
      rotuloCancelar="Continuar baixando"
      rotuloConfirmar="Fechar mesmo assim"
      perigo
      aoCancelar={() => setAberto(false)}
      aoConfirmar={() => { if (fechando.current) return; fechando.current = true; void fecharPrograma().catch(() => { fechando.current = false; }); }}
    />
  );
}
