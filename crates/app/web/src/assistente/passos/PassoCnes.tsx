import { useEffect, useRef } from "react";
import { cnesBaixar, cnesImportar } from "../../api/comandos";
import { Botao } from "../../componentes/base/Botao";
import { EstadoErro } from "../../componentes/dominio/Estados";
import { PainelDeTarefa } from "../../componentes/dominio/PainelDeTarefa";
import { useAcaoDeTarefa, type Tarefa } from "../../dados/acaoDeTarefa";

export function PassoCnes({ tarefa, uf, aoIniciarBusca }: { tarefa: Tarefa; uf: string; aoIniciarBusca: () => void }) {
  const { erro, escolhendo, executar, daPasta, falhou } = useAcaoDeTarefa(tarefa);
  // Só o suficiente para escolher a unidade; o restante do CNES entra na fila depois (ver Assistente).
  const baixar = () => { aoIniciarBusca(); void executar(() => cnesBaixar(uf, { fase: "busca" })); };
  const cancelar = () => void tarefa.cancelar();

  // Começa sozinho ao abrir o passo: o estado já foi escolhido. O ref impede um segundo disparo ao re-renderizar.
  const comecou = useRef(false);
  useEffect(() => {
    if (comecou.current) return;
    comecou.current = true;
    baixar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const parado = !tarefa.ativa;
  return (
    <div className="passo">
      {tarefa.ativa && <PainelDeTarefa tarefa={tarefa} aoCancelar={cancelar} />}
      {parado && falhou && <PainelDeTarefa tarefa={tarefa} aoCancelar={cancelar} aoTentarDeNovo={baixar} />}
      {parado && erro && <EstadoErro mensagem={erro} aoTentar={baixar} />}
      {parado && (falhou || erro) && (
        <div className="passo__acoes">
          <Botao onPress={() => void daPasta((pasta) => cnesImportar(pasta, uf))} isDisabled={escolhendo}>Escolher pasta com os arquivos</Botao>
        </div>
      )}
    </div>
  );
}
