import { useEffect, useState, type ReactNode } from "react";
import { Botao } from "../componentes/base/Botao";
import { Marca } from "../componentes/dominio/Marca";
import { EstadoErro, CarregandoComEspera } from "../componentes/dominio/Estados";
import { useSituacao } from "../dados/consultas";
import { ir } from "./rotas";
import { ConfirmarSaida } from "./ConfirmarSaida";
import { Rodape } from "./Rodape";
import { Topo } from "./Topo";
import { Trilho } from "./Trilho";
import "./shell.css";

// O programa abre em 2 s: a animação de inicialização toca inteira (1,84 s) e a abertura sai em 0,16 s.
// Com redução de movimento não há o que esperar: a interface entra assim que os dados chegam.
const MOVIMENTO_DA_ABERTURA_MS = 1840;
const SAIDA_DA_ABERTURA_MS = 160;

function movimentoReduzido(): boolean {
  return typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function Abertura({ saindo, esperando }: { saindo: boolean; esperando: boolean }) {
  return (
    <div className={saindo ? "abertura abertura--saindo" : "abertura"}>
      <Marca variante="vertical" animacao={esperando ? "sutil" : "inicial"} altura={168} />
      {esperando
        ? <CarregandoComEspera rotulo="Abrindo o programa" semIndicador />
        : <span className="so-leitor" role="status">Abrindo o programa</span>}
    </div>
  );
}

export function Shell({ children, assistente }: { children: ReactNode; assistente?: (aoConcluir: () => void) => ReactNode }) {
  const situacao = useSituacao();
  const [reduzido] = useState(movimentoReduzido);
  const [movimentoCumprido, setMovimentoCumprido] = useState(reduzido);
  const [abertura, setAbertura] = useState(true);
  useEffect(() => {
    if (reduzido) return;
    const t = setTimeout(() => setMovimentoCumprido(true), MOVIMENTO_DA_ABERTURA_MS);
    return () => clearTimeout(t);
  }, [reduzido]);

  const pronto = !situacao.isPending;
  // Erro aparece na hora; os dados esperam a animação terminar.
  const liberado = situacao.isError || (pronto && movimentoCumprido);
  useEffect(() => {
    if (!liberado) return;
    const t = setTimeout(() => setAbertura(false), reduzido ? 0 : SAIDA_DA_ABERTURA_MS);
    return () => clearTimeout(t);
  }, [liberado, reduzido]);

  return (
    <>
      {liberado && <Moldura situacao={situacao} entrando={!reduzido} assistente={assistente}>{children}</Moldura>}
      {abertura && <Abertura saindo={liberado} esperando={movimentoCumprido && !pronto} />}
    </>
  );
}

function Moldura({ situacao, entrando, assistente, children }: { situacao: ReturnType<typeof useSituacao>; entrando: boolean; assistente?: (aoConcluir: () => void) => ReactNode; children: ReactNode }) {
  const s = situacao.data;
  // Na primeira execução o assistente fica até o fim, mesmo depois que o SIGTAP carregado já tira a situação de "primeira execução".
  const [emAssistente, setEmAssistente] = useState(() => !!s && s.primeira_execucao && s.bloqueio === null && !s.recuperacao);
  if (situacao.isError) return <div className="shell shell--simples"><EstadoErro mensagem={(situacao.error as Error).message} aoTentar={() => void situacao.refetch()} /></div>;
  if (!s) return null;
  const bloqueado = s.bloqueio !== null;
  if (emAssistente && assistente && !bloqueado) return <>{assistente(() => setEmAssistente(false))}</>;
  return (
    <div className={entrando ? "shell shell--entra" : "shell"}>
      <Topo competencias={s.competencias} bloqueado={bloqueado} />
      <Trilho />
      <main className="shell__conteudo" id="conteudo" tabIndex={-1}>
        {bloqueado
          ? <EstadoErro mensagem="Os dados desta pasta são de uma versão mais nova do programa. Atualize o programa para usá-los." aoTentar={() => void situacao.refetch()} />
          : <>
              {s.recuperacao !== null && (
                <div className="shell__aviso" role="alert">
                  <p>Há bancos de dados danificados ou de versão anterior. Abra Dados para recriá-los.</p>
                  <Botao onPress={() => ir("dados")}>Abrir Dados</Botao>
                </div>
              )}
              {children}
            </>}
      </main>
      <Rodape competencias={s.competencias} />
      <ConfirmarSaida />
    </div>
  );
}
