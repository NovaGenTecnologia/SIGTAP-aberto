import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { arvore, arvoreCid } from "../../api/comandos";
import { useSessao } from "../../shell/sessao";
import { cadeiaDe, deCid, deProcedimentos, type EstadoDosFilhos, type No, type TipoDeArvore } from "./modelo/arvore";

/**
 * Estado da árvore carregada aos poucos: filhos por pai ("" é a raiz), nós abertos e quantos filhos de cada pai se mostram.
 * Os filhos moram num mapa mutável (com um contador para repintar): carregar vários nós ao mesmo tempo não pode perder resposta.
 */
export function usarArvore(tipo: TipoDeArvore) {
  const cliente = useQueryClient();
  const { competencia } = useSessao();
  const filhos = useRef(new Map<string, EstadoDosFilhos>());
  const promessas = useRef(new Map<string, Promise<No[]>>());
  const [, repintar] = useReducer((n: number) => n + 1, 0);
  const [abertos, setAbertos] = useState<Set<string>>(new Set());
  const [limites, setLimites] = useState<Record<string, number>>({});
  const geracao = useRef(0);

  // Outra competência: o que estava carregado já não vale.
  useEffect(() => {
    geracao.current += 1;
    filhos.current = new Map();
    promessas.current = new Map();
    setAbertos(new Set());
    setLimites({});
    repintar();
  }, [competencia]);

  const carregar = useCallback((pai: string | null): Promise<No[]> => {
    const chave = pai ?? "";
    const atual = filhos.current.get(chave);
    if (atual?.estado === "ok") return Promise.resolve(atual.nos);
    const emCurso = promessas.current.get(chave);
    if (emCurso) return emCurso;
    const minha = geracao.current;
    const mapa = filhos.current;
    mapa.set(chave, { estado: "carregando" });
    repintar();
    const comp = competencia ?? undefined;
    const p = (async (): Promise<No[]> => {
      try {
        const nos = tipo === "cid"
          ? (await cliente.fetchQuery({ queryKey: ["arvore_cid", competencia, pai], queryFn: () => arvoreCid(pai, comp), staleTime: 60_000 })).map((n) => deCid(n, pai))
          : (await cliente.fetchQuery({ queryKey: ["arvore", competencia, pai], queryFn: () => arvore(pai, comp), staleTime: 60_000 })).map((n) => deProcedimentos(n, pai));
        if (minha === geracao.current) mapa.set(chave, { estado: "ok", nos });
        return nos;
      } catch (e) {
        if (minha === geracao.current) mapa.set(chave, { estado: "erro", mensagem: e instanceof Error ? e.message : String(e) });
        return [];
      } finally {
        if (minha === geracao.current) { promessas.current.delete(chave); repintar(); }
      }
    })();
    promessas.current.set(chave, p);
    return p;
  }, [cliente, competencia, tipo]);

  useEffect(() => { void carregar(null); }, [carregar]);

  const abrirVarios = useCallback((ids: string[]) => {
    setAbertos((s) => { const n = new Set(s); ids.forEach((i) => n.add(i)); return n; });
    ids.forEach((i) => void carregar(i));
  }, [carregar]);
  const abrir = useCallback((id: string) => abrirVarios([id]), [abrirVarios]);
  const fechar = useCallback((id: string) => setAbertos((s) => { const n = new Set(s); n.delete(id); return n; }), []);
  const recolher = useCallback(() => setAbertos(new Set()), []);
  const tentarDeNovo = useCallback((pai: string) => { filhos.current.delete(pai); promessas.current.delete(pai); void carregar(pai); }, [carregar]);
  const maisFilhos = useCallback((pai: string, quantos: number) => setLimites((l) => ({ ...l, [pai]: (l[pai] ?? 200) + quantos })), []);

  /** Abre a cadeia de pais do nó, de cima para baixo, carregando cada nível. */
  const revelar = useCallback(async (id: string) => {
    await carregar(null);
    for (const pai of cadeiaDe(tipo, id)) { setAbertos((s) => new Set(s).add(pai)); await carregar(pai); }
  }, [carregar, tipo]);

  /** Abre todos os nós até a profundidade dada (0 = só a raiz visível; 1 = abre a raiz...). */
  const abrirAte = useCallback(async (profundidade: number) => {
    let nivel = await carregar(null);
    for (let d = 0; d < profundidade; d++) {
      const pais = nivel.filter((n) => !n.folha);
      if (!pais.length) break;
      setAbertos((s) => { const n = new Set(s); pais.forEach((p) => n.add(p.id)); return n; });
      nivel = (await Promise.all(pais.map((p) => carregar(p.id)))).flat();
    }
  }, [carregar]);

  return { filhos: filhos.current, abertos, limites, carregar, abrir, abrirVarios, fechar, recolher, tentarDeNovo, maisFilhos, revelar, abrirAte };
}
