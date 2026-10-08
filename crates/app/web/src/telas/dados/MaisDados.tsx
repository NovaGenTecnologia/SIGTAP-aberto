import { useState } from "react";
import { recriarBanco, verificarBancos } from "../../api/comandos";
import { useAvisos } from "../../componentes/base/Avisos";
import { Menu } from "../../componentes/base/Menu";
import { ConfirmarAcao } from "../../componentes/dominio/ConfirmarAcao";
import { useAcaoDeTarefa, type Tarefa } from "../../dados/acaoDeTarefa";
import { mensagemOcupado } from "../../dados/tarefas";

const ITENS = [
  { id: "rapido", rotulo: "Verificar bancos (rápido)" },
  { id: "completo", rotulo: "Verificar bancos (completo)" },
  { id: "recriar", rotulo: "Recriar banco a partir dos ZIPs…" },
];

interface ResultadoVerificacao { itens?: { nome: string; existe: boolean; ok: boolean }[] }

export function MaisDados({ tarefa }: { tarefa: Tarefa }) {
  const { avisar } = useAvisos();
  const { executar } = useAcaoDeTarefa(tarefa);
  const [confirmando, setConfirmando] = useState(false);

  async function verificar(completo: boolean) {
    try {
      const r = (await verificarBancos(completo)) as ResultadoVerificacao;
      const ruins = (r.itens ?? []).filter((i) => i.existe && !i.ok).map((i) => i.nome);
      avisar(ruins.length ? `Problema em: ${ruins.join(", ")}.` : "Bancos verificados: nenhum problema.", ruins.length ? "erro" : "ok");
    } catch (e) { avisar(e instanceof Error ? e.message : String(e), "erro"); }
  }

  function escolher(id: string) {
    if (id === "recriar") { if (tarefa.ativa) avisar(mensagemOcupado("sigtap"), "info"); else setConfirmando(true); }
    else void verificar(id === "completo");
  }

  return (
    <>
      <Menu rotulo="Manutenção" itens={ITENS} aoEscolher={escolher}>Manutenção</Menu>
      <ConfirmarAcao
        aberto={confirmando} titulo="Recriar o banco a partir dos ZIPs?"
        detalhe="O banco atual é guardado numa pasta de segurança e refeito a partir dos ZIPs guardados. Pode levar alguns minutos."
        rotuloConfirmar="Recriar" aoCancelar={() => setConfirmando(false)}
        aoConfirmar={() => { setConfirmando(false); void executar(() => recriarBanco(true)); }}
      />
    </>
  );
}
