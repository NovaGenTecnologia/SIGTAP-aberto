import { useState } from "react";
import { baixar, importar } from "../../api/comandos";
import type { PedidoDownload } from "../../api/tipos";
import { Botao } from "../../componentes/base/Botao";
import { EstadoErro } from "../../componentes/dominio/Estados";
import { useSituacao } from "../../dados/consultas";
import { PainelDeTarefa } from "../../componentes/dominio/PainelDeTarefa";
import { useAcaoDeTarefa, type Tarefa } from "../../dados/acaoDeTarefa";
import { DialogoDeMeses, type MesesAnteriores } from "./DialogoDeMeses";

const VIGENTE: PedidoDownload = { sigtap: "vigente", territorio: true };

export function PassoSigtap({ tarefa }: { tarefa: Tarefa }) {
  const { erro, escolhendo, executar, daPasta, falhou } = useAcaoDeTarefa(tarefa);
  const [perguntando, setPerguntando] = useState(false);
  const situacao = useSituacao().data;
  const carregadas = situacao?.competencias.length ?? 0;
  // O último mês vem na frente; os meses anteriores entram na fila do SIGTAP e seguem em segundo plano.
  const baixarMeses = (mais: MesesAnteriores | null) => {
    setPerguntando(false);
    void executar(async () => {
      await baixar(VIGENTE);
      if (mais) await baixar({ sigtap: mais, territorio: false }, "depois");
    });
  };
  const cancelar = () => void tarefa.cancelar();
  const outraVez = () => void executar(() => baixar(VIGENTE));

  return (
    <div className="passo">
      <p className="aviso-caixa">Programa não oficial, de código aberto. Não é do Ministério da Saúde nem do DATASUS.</p>
      {carregadas > 0 && !tarefa.ativa && !falhou && !erro && (
        <p role="status" className="passo__nota">
          {tarefa.fim?.cancelada ? "Cancelado. " : ""}{carregadas === 1 ? "1 competência carregada" : `${carregadas} competências carregadas`}{situacao?.territorio ? "." : "; falta o território."}
        </p>
      )}
      {tarefa.ativa && <PainelDeTarefa tarefa={tarefa} aoCancelar={cancelar} />}
      {!tarefa.ativa && falhou && <PainelDeTarefa tarefa={tarefa} aoCancelar={cancelar} aoTentarDeNovo={outraVez} />}
      {!tarefa.ativa && erro && <EstadoErro mensagem={erro} aoTentar={outraVez} />}
      {!tarefa.ativa && (
        <div className="passo__acoes">
          {!falhou && !erro && <Botao variante="primario" onPress={() => setPerguntando(true)}>Baixar</Botao>}
          <Botao onPress={() => void daPasta(importar)} isDisabled={escolhendo}>Escolher pasta com os arquivos</Botao>
        </div>
      )}
      {perguntando && <DialogoDeMeses aberto aoEscolher={baixarMeses} aoCancelar={() => setPerguntando(false)} />}
    </div>
  );
}
