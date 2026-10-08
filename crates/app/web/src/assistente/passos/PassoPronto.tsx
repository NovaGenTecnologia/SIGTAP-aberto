import { useState } from "react";
import { producaoBaixar, producaoPlano } from "../../api/comandos";
import type { PlanoProducao } from "../../api/tipos";
import { useAvisos } from "../../componentes/base/Avisos";
import { Botao } from "../../componentes/base/Botao";
import { Progresso } from "../../componentes/base/Progresso";
import { Selecao } from "../../componentes/base/Selecao";
import { ConfirmarAcao } from "../../componentes/dominio/ConfirmarAcao";
import { useAcaoDeTarefa } from "../../dados/acaoDeTarefa";
import { useTarefaAtiva } from "../../dados/tarefas";
import type { Pendencia } from "../pendencias";

const PERIODOS = [1, 3, 6, 12].map((n) => ({ id: String(n), rotulo: n === 1 ? "1 mês" : `${n} meses` }));

export interface PassoProntoProps {
  unidade: string | null;
  uf: string | null;
  pendencias: Pendencia[];
  aoTentar: (p: Pendencia) => void;
  aoAbrir: () => void;
}

function LinhaDePendencia({ p, aoTentar }: { p: Pendencia; aoTentar: (p: Pendencia) => void }) {
  const { progresso, fim, ativa, naFila } = p.tarefa;
  const falhou = !ativa && !!fim && !fim.ok && !fim.cancelada;
  const determinado = ativa && !!progresso && !progresso.indeterminado;
  const detalhe = falhou ? fim.mensagem : ativa ? progresso?.resumo || progresso?.mensagem || "Em andamento" : naFila > 0 ? "Na fila" : "Aguardando";
  return (
    <li className="pendencia">
      <div className="pendencia__texto">
        <strong>{p.rotulo}</strong>
        <span className="pendencia__detalhe">{detalhe}</span>
      </div>
      {falhou
        ? <Botao onPress={() => aoTentar(p)}>Tentar de novo</Botao>
        : <Progresso rotulo={p.rotulo} valor={determinado ? Math.round(progresso.fracao * 100) : undefined} />}
    </li>
  );
}

export function PassoPronto({ unidade, uf, pendencias, aoTentar, aoAbrir }: PassoProntoProps) {
  const { avisar } = useAvisos();
  const producao = useTarefaAtiva("producao");
  const { executar, erro } = useAcaoDeTarefa(producao);
  const [meses, setMeses] = useState(3);
  const [plano, setPlano] = useState<PlanoProducao | null>(null);
  const [calculando, setCalculando] = useState(false);
  const pendente = pendencias.length > 0;

  async function verPlano() {
    if (!uf) return;
    setCalculando(true);
    try { setPlano(await producaoPlano(uf, meses)); }
    catch (e) { avisar(e instanceof Error ? e.message : String(e), "erro"); }
    finally { setCalculando(false); }
  }

  return (
    <div className="passo">
      <p className="passo__resumo">{unidade ? <>Unidade: <strong>{unidade}</strong></> : "Sem unidade escolhida. Você pode escolher depois."}</p>
      <p role="status" className={pendente ? "passo__falta" : "sr-only"}>
        {pendente ? `Falta terminar: ${pendencias.map((p) => p.rotulo).join(", ")}` : "Tudo pronto"}
      </p>
      {pendente && <ul className="pendencias">{pendencias.map((p) => <LinhaDePendencia key={p.id} p={p} aoTentar={aoTentar} />)}</ul>}

      {uf && (
        <section className="producao-opcional" aria-labelledby="producao-opcional-titulo">
          <h2 id="producao-opcional-titulo" className="producao-opcional__titulo">Produção (opcional)</h2>
          {producao.ativa ? (
            <p className="passo__resumo">Baixando em segundo plano.</p>
          ) : (
            <div className="passo__acoes passo__acoes--base">
              <Selecao rotulo="Período" itens={PERIODOS} selectedKey={String(meses)} onSelectionChange={(k) => setMeses(Number(k))} />
              <Botao carregando={calculando} onPress={() => void verPlano()}>Ver o que será baixado</Botao>
            </div>
          )}
          {erro && <p role="alert" className="passo__erro">{erro}</p>}
        </section>
      )}

      <div className="passo__acoes"><Botao variante="primario" isDisabled={pendente} onPress={aoAbrir}>Abrir o Painel</Botao></div>

      {plano && (
        <ConfirmarAcao
          aberto titulo={`Baixar a produção de ${plano.uf}?`}
          detalhe={`${plano.itens.length} ${plano.itens.length === 1 ? "arquivo" : "arquivos"} · últimos ${meses} ${meses === 1 ? "mês" : "meses"}`}
          tamanhoBytes={plano.total_bytes} rotuloConfirmar="Baixar"
          aoCancelar={() => setPlano(null)}
          aoConfirmar={() => { const p = plano; setPlano(null); void executar(() => producaoBaixar({ uf: p.uf, meses, confirmado: true }, "agora")); }}
        />
      )}
    </div>
  );
}
