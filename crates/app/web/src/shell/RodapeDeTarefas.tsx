import { useEffect, useRef } from "react";
import { Button, Dialog, DialogTrigger, Popover } from "react-aria-components";
import type { FimDeTarefa, Fonte } from "../api/tipos";
import { useAvisos } from "../componentes/base/Avisos";
import { Botao } from "../componentes/base/Botao";
import { Progresso } from "../componentes/base/Progresso";
import { FONTES, nomeDaFonte, useTarefas } from "../dados/tarefas";
import "./rodape-tarefas.css";

const porcentagem = (fracao: number) => Math.round(fracao * 100);

/** Fim de tarefa que ainda pede uma decisão do usuário (falhou; cancelar não é falha). */
const falhou = (fim: FimDeTarefa | null) => fim !== null && !fim.ok && !fim.cancelada;

export function RodapeDeTarefas() {
  const { tarefas, algumaCarregando, cancelar, repetir, limparFim } = useTarefas();
  const { avisar } = useAvisos();

  // Conclusão e cancelamento viram aviso uma vez só (o `fim` fica para quem espera por ele, como o assistente); a falha fica no rodapé até ser dispensada.
  const avisados = useRef(new Map<Fonte, FimDeTarefa>());
  useEffect(() => {
    for (const f of FONTES) {
      const fim = tarefas[f].fim;
      if (!fim || avisados.current.get(f) === fim) continue;
      avisados.current.set(f, fim);
      if (!falhou(fim)) { avisar(fim.mensagem, fim.ok ? "ok" : "info"); }
    }
  }, [tarefas, avisar]);

  const ativas = FONTES.filter((f) => tarefas[f].ativa);
  const falhas = FONTES.filter((f) => !tarefas[f].ativa && falhou(tarefas[f].fim));
  const naFila = FONTES.reduce((n, f) => n + tarefas[f].naFila, 0);
  if (ativas.length === 0 && falhas.length === 0) return null;
  const nome = [
    ativas.length > 0 ? `Downloads em andamento: ${ativas.map((f) => nomeDaFonte(f)).join(", ")}` : "",
    ...falhas.map((f) => `${nomeDaFonte(f)}: falhou`),
  ].filter(Boolean).join(". ");

  return (
    <span className="rodape-tarefas">
      {algumaCarregando && <span role="status" className="rodape-tarefas__lento">Carregando dados: a navegação pode ficar mais lenta.</span>}
      <DialogTrigger>
        <Button className="rodape-tarefas__abrir" aria-label={nome}>
          {ativas.map((f) => {
            const p = tarefas[f].progresso;
            const determinado = p !== null && !p.indeterminado;
            return (
              <span key={f} className="rodape-tarefas__item">
                <span className="rodape-tarefas__nome">{nomeDaFonte(f)}</span>
                <span className="rodape-tarefas__barra">
                  <Progresso rotulo={nomeDaFonte(f)} valor={determinado ? porcentagem(p.fracao) : undefined} />
                </span>
                {determinado && <span className="rodape-tarefas__pct">{porcentagem(p.fracao)}%</span>}
              </span>
            );
          })}
          {falhas.map((f) => <span key={f} className="rodape-tarefas__item rodape-tarefas__item--falha">{nomeDaFonte(f)}: falhou</span>)}
          {naFila > 0 && <span className="rodape-tarefas__fila">+{naFila} na fila</span>}
        </Button>
        <Popover className="balao rodape-tarefas__balao" placement="top end" offset={8}>
          <Dialog aria-label="Downloads" className="rodape-tarefas__detalhe">
            {ativas.map((f) => {
              const t = tarefas[f];
              const p = t.progresso;
              return (
                <section key={f} className="rodape-tarefas__bloco">
                  <header>
                    <strong>{p?.rotulo || nomeDaFonte(f)}</strong>
                    <Botao variante="discreto" onPress={() => void cancelar(f)} aria-label={`Cancelar ${nomeDaFonte(f)}`}>Cancelar</Botao>
                  </header>
                  {p?.resumo && <p>{p.resumo}</p>}
                  <Progresso rotulo={`Detalhe de ${nomeDaFonte(f)}`} valor={p && !p.indeterminado ? porcentagem(p.fracao) : undefined} />
                  {p?.mensagem && <p className="rodape-tarefas__mensagem">{p.mensagem}</p>}
                  {t.naFila > 0 && <p className="rodape-tarefas__mensagem">+{t.naFila} na fila</p>}
                </section>
              );
            })}
            {falhas.map((f) => (
              <section key={f} className="rodape-tarefas__bloco rodape-tarefas__bloco--falha">
                <header><strong>{nomeDaFonte(f)}</strong></header>
                <p>{tarefas[f].fim?.mensagem}</p>
                <div className="rodape-tarefas__acoes">
                  <Botao variante="primario" onPress={() => void repetir(f).catch(() => {})}>Tentar de novo</Botao>
                  <Botao variante="discreto" onPress={() => limparFim(f)}>Dispensar</Botao>
                </div>
              </section>
            ))}
          </Dialog>
        </Popover>
      </DialogTrigger>
    </span>
  );
}
