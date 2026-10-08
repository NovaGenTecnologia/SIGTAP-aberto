import { useState } from "react";
import { escolherPasta } from "../api/comandos";
import { ehOcupado, type useTarefaAtiva } from "./tarefas";

export type Tarefa = ReturnType<typeof useTarefaAtiva>;
const texto = (e: unknown) => (e instanceof Error ? e.message : String(e));

// O que os passos que baixam têm em comum: uma tarefa por vez, falha com causa e importar de uma pasta.
export function useAcaoDeTarefa(tarefa: Tarefa) {
  const [erro, setErro] = useState<string | null>(null);
  const [escolhendo, setEscolhendo] = useState(false);

  async function executar(fazer: () => Promise<unknown>) {
    setErro(null);
    try { await tarefa.iniciar(fazer); }
    catch (e) { if (!ehOcupado(e)) setErro(texto(e)); }
  }

  // A janela de escolha fica fora de `iniciar`: só vira tarefa quando há pasta.
  async function daPasta(importar: (pasta: string) => Promise<unknown>) {
    if (escolhendo) return;
    setEscolhendo(true);
    try {
      const pasta = await escolherPasta();
      if (pasta) await executar(() => importar(pasta));
    } catch (e) { setErro(texto(e)); }
    finally { setEscolhendo(false); }
  }

  const falhou = !!tarefa.fim && !tarefa.fim.ok && !tarefa.fim.cancelada;
  return { erro, escolhendo, executar, daPasta, falhou };
}
