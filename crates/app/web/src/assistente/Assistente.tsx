import { useEffect, useRef, useState } from "react";
import { baixar, cnesBaixar } from "../api/comandos";
import { Marca } from "../componentes/dominio/Marca";
import { Carregando, EstadoErro } from "../componentes/dominio/Estados";
import { useSituacao, useUnidades } from "../dados/consultas";
import { ir } from "../shell/rotas";
import { useTarefaAtiva, useTarefas } from "../dados/tarefas";
import { pendencias as calcularPendencias, type Pendencia } from "./pendencias";
import { ETAPAS, etapaAtual, type Etapa } from "./etapas";
import { PassoCnes } from "./passos/PassoCnes";
import { PassoPronto } from "./passos/PassoPronto";
import { PassoSigtap } from "./passos/PassoSigtap";
import { PassoUnidade } from "./passos/PassoUnidade";
import { PassoUf } from "./passos/PassoUf";
import "./assistente.css";

const TEXTOS: Record<Etapa, (uf: string | null) => { titulo: string; apoio: string }> = {
  sigtap: () => ({ titulo: "Tabela SIGTAP", apoio: "Baixe a tabela vigente e o território (estados e municípios) do DATASUS." }),
  uf: () => ({ titulo: "Seu estado", apoio: "Escolha o estado da sua unidade." }),
  cnes: (uf) => ({ titulo: `CNES de ${uf ?? ""}`.trim(), apoio: "Cadastro dos estabelecimentos do estado." }),
  unidade: () => ({ titulo: "Sua unidade", apoio: "Busque pelo nome ou pelo número do CNES." }),
  pronto: () => ({ titulo: "Tudo pronto", apoio: "Os dados estão no computador." }),
};

function Etapas({ atual }: { atual: Etapa }) {
  const indice = ETAPAS.findIndex((e) => e.id === atual);
  return (
    <ol className="etapas" aria-label="Etapas">
      {ETAPAS.map((e, i) => (
        <li key={e.id} className={`etapas__item${i < indice ? " etapas__item--feita" : ""}`} aria-current={i === indice ? "step" : undefined}>
          <span className="etapas__marca" aria-hidden="true">{i < indice ? "✓" : ""}</span>
          <span className="etapas__rotulo">{e.rotulo}</span>
          {i < indice && <span className="sr-only"> (concluída)</span>}
        </li>
      ))}
    </ol>
  );
}

export function Assistente({ aoConcluir }: { aoConcluir?: () => void }) {
  const situacao = useSituacao();
  const cnes = useUnidades();
  const tarefaSigtap = useTarefaAtiva("sigtap");
  const tarefaCnes = useTarefaAtiva("cnes");
  const [ufEscolhida, setUfEscolhida] = useState<string | null>(null);
  const [pulouUnidade, setPulouUnidade] = useState(false);
  const { tarefas } = useTarefas();
  // Estado em que a busca do CNES foi pedida por este assistente: quando ela termina bem, o restante entra na fila.
  const buscaPedida = useRef<string | null>(null);
  const titulo = useRef<HTMLHeadingElement>(null);
  const anterior = useRef<Etapa | null>(null);

  const s = situacao.data;
  const sigtapPronto = !!s && s.competencias.length > 0 && !!s.territorio;
  const pronta = !!s && (!sigtapPronto || !cnes.isPending);
  const etapa = pronta ? etapaAtual(s, cnes.data, ufEscolhida, pulouUnidade) : null;
  const uf = ufEscolhida ?? cnes.data?.ufs.find((u) => (u.resumo?.arquivos.length ?? 0) > 0)?.uf ?? null;

  useEffect(() => {
    if (etapa && anterior.current && anterior.current !== etapa) titulo.current?.focus();
    if (etapa) anterior.current = etapa;
  }, [etapa]);

  useEffect(() => {
    const ufDaBusca = buscaPedida.current;
    if (!ufDaBusca || tarefaCnes.ativa || !tarefaCnes.fim?.ok) return;
    buscaPedida.current = null;
    void tarefaCnes.iniciar(() => cnesBaixar(ufDaBusca, { fase: "restante", quando: "depois" })).catch(() => {});
  }, [tarefaCnes]);

  const pendentes = s && etapa === "pronto" ? calcularPendencias(s, cnes.data, tarefas, { ufEscolhida: uf, pulouUnidade }) : [];
  const tentar = (p: Pendencia) => {
    if (p.fonte === "cnes" && uf) void tarefaCnes.iniciar(() => cnesBaixar(uf, { fase: "restante" })).catch(() => {});
    else if (p.fonte === "sigtap") void tarefaSigtap.iniciar(() => baixar({ sigtap: "vigente", territorio: true })).catch(() => {});
  };

  const texto = etapa ? TEXTOS[etapa](uf) : null;
  const tituloDaEtapa = etapa === "pronto" && pendentes.length > 0 ? "Quase pronto" : texto?.titulo;
  const apoio = etapa === "pronto" && pendentes.length > 0 ? "" : texto?.apoio;
  return (
    <div className="assistente">
      <header className="assistente__topo"><Marca variante="horizontal" altura={36} /></header>
      <main className="assistente__miolo">
        {etapa && <Etapas atual={etapa} />}
        <section key={etapa ?? "carregando"} className="assistente__cartao">
          {situacao.isError ? (
            <EstadoErro mensagem="Não foi possível ler a situação dos dados." aoTentar={() => void situacao.refetch()} />
          ) : !etapa || !texto ? (
            <Carregando rotulo="Carregando" />
          ) : (
            <>
              <h1 ref={titulo} tabIndex={-1} className="assistente__titulo">{tituloDaEtapa}</h1>
              {apoio && <p className="assistente__apoio">{apoio}</p>}
              {etapa === "sigtap" && <PassoSigtap tarefa={tarefaSigtap} />}
              {etapa === "uf" && <PassoUf aoEscolher={setUfEscolhida} />}
              {etapa === "cnes" && uf && <PassoCnes tarefa={tarefaCnes} uf={uf} aoIniciarBusca={() => { buscaPedida.current = uf; }} />}
              {etapa === "unidade" && uf && <PassoUnidade uf={uf} aoPular={() => setPulouUnidade(true)} />}
              {etapa === "pronto" && <PassoPronto unidade={cnes.data?.minha?.nome ?? null} uf={uf} pendencias={pendentes} aoTentar={tentar} aoAbrir={() => { ir("painel"); aoConcluir?.(); }} />}
            </>
          )}
        </section>
      </main>
    </div>
  );
}
