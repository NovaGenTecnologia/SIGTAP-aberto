import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useReducer, useRef, type ReactNode } from "react";
import { cancelar as cancelarNoBackend } from "../api/comandos";
import { ouvirFimTarefa, ouvirProgresso } from "../api/eventos";
import type { FimDeTarefa, Fonte, ProgressoDeTarefa } from "../api/tipos";
import { useSituacao } from "./consultas";
import { ContextoDeTarefas, FONTES, mensagemOcupado, type TarefaDeFonte, type ValorDasTarefas } from "./tarefas";

const CHAVES_A_ATUALIZAR = ["situacao", "cnes_situacao", "producao_situacao", "ofertas"];

interface PorFonte { emAndamento: boolean; progresso: ProgressoDeTarefa | null; fim: FimDeTarefa | null }
type Estado = Record<Fonte, PorFonte>;
type Acao =
  | { tipo: "progresso"; p: ProgressoDeTarefa }
  | { tipo: "fim"; f: FimDeTarefa }
  | { tipo: "comecar" | "desistir" | "limpar"; fonte: Fonte };

const vazia = (): PorFonte => ({ emAndamento: false, progresso: null, fim: null });
const inicial = (): Estado => ({ sigtap: vazia(), cnes: vazia(), producao: vazia() });

function reduzir(e: Estado, a: Acao): Estado {
  switch (a.tipo) {
    case "progresso": return { ...e, [a.p.fonte]: { ...e[a.p.fonte], emAndamento: true, progresso: a.p } };
    case "fim": return { ...e, [a.f.fonte]: { emAndamento: false, progresso: null, fim: a.f } };
    case "comecar": return { ...e, [a.fonte]: { ...e[a.fonte], emAndamento: true, fim: null } };
    case "desistir": return { ...e, [a.fonte]: { ...e[a.fonte], emAndamento: false } };
    case "limpar": return { ...e, [a.fonte]: { ...e[a.fonte], fim: null } };
  }
}

// Estado das tarefas por fonte. Fontes diferentes andam juntas; na mesma fonte, uma por vez.
export function TarefasProvider({ children }: { children: ReactNode }) {
  const cliente = useQueryClient();
  const { data } = useSituacao();
  const [estado, despachar] = useReducer(reduzir, undefined, inicial);
  const trava = useRef(new Set<Fonte>()); // vale antes do próximo render (duplo clique)
  const ultimo = useRef<Partial<Record<Fonte, () => Promise<unknown>>>>({});

  const noBackend = useMemo(() => {
    const ativa: Record<Fonte, boolean> = { sigtap: false, cnes: false, producao: false };
    const fila: Record<Fonte, number> = { sigtap: 0, cnes: 0, producao: 0 };
    for (const t of data?.tarefas ?? []) { if (t.na_fila) fila[t.fonte] += 1; else ativa[t.fonte] = true; }
    return { ativa, fila };
  }, [data?.tarefas]);
  const ativaNoBackend = useRef(noBackend.ativa);
  ativaNoBackend.current = noBackend.ativa;

  useEffect(() => {
    let parar1: (() => void) | undefined, parar2: (() => void) | undefined, vivo = true;
    void ouvirProgresso((p) => { trava.current.add(p.fonte); despachar({ tipo: "progresso", p }); })
      .then((f) => { if (vivo) parar1 = f; else f(); }).catch(() => {});
    void ouvirFimTarefa((f) => {
      trava.current.delete(f.fonte);
      despachar({ tipo: "fim", f });
      for (const k of CHAVES_A_ATUALIZAR) void cliente.invalidateQueries({ queryKey: [k] });
    }).then((f) => { if (vivo) parar2 = f; else f(); }).catch(() => {});
    return () => { vivo = false; parar1?.(); parar2?.(); };
  }, [cliente]);

  const iniciar = useCallback(async (fonte: Fonte, executar: () => Promise<unknown>) => {
    if (trava.current.has(fonte) || ativaNoBackend.current[fonte]) throw new Error(mensagemOcupado(fonte));
    trava.current.add(fonte);
    ultimo.current[fonte] = executar;
    despachar({ tipo: "comecar", fonte });
    try {
      await executar();
    } catch (e) {
      trava.current.delete(fonte);
      despachar({ tipo: "desistir", fonte });
      throw e;
    }
  }, []);
  const cancelar = useCallback(async (fonte?: Fonte) => { await cancelarNoBackend(fonte); }, []);
  const limparFim = useCallback((fonte: Fonte) => despachar({ tipo: "limpar", fonte }), []);
  const repetir = useCallback(async (fonte: Fonte) => {
    const executar = ultimo.current[fonte];
    if (executar) await iniciar(fonte, executar);
  }, [iniciar]);

  const valor = useMemo<ValorDasTarefas>(() => {
    const tarefas = {} as Record<Fonte, TarefaDeFonte>;
    for (const f of FONTES) {
      tarefas[f] = { ativa: estado[f].emAndamento || noBackend.ativa[f], progresso: estado[f].progresso, fim: estado[f].fim, naFila: noBackend.fila[f] };
    }
    const algumaCarregando = FONTES.some((f) => estado[f].emAndamento && estado[f].progresso?.fase === "carregando");
    return { tarefas, algumaCarregando, iniciar, cancelar, limparFim, repetir };
  }, [estado, noBackend, iniciar, cancelar, limparFim, repetir]);

  return <ContextoDeTarefas.Provider value={valor}>{children}</ContextoDeTarefas.Provider>;
}
