import { useRef, type ReactNode } from "react";
import type { UnidadeCompleta } from "../../api/tipos";
import { usePainel } from "../../dados/painel";
import { ir } from "../../shell/rotas";
import { useSessao } from "../../shell/sessao";
import { contarPorArea, ROTULO_DA_AREA, type Area } from "../painel/areas";
import { definirOrigem, useOrigem } from "../painel/origemDaPendencia";
import { rotuloCompetencia } from "../../util/formatos";

export type TelaIrma = "cadastro" | "aptidao" | "producao";

/** Esfera administrativa (ou gestão) com nome, quando o cadastro traz; senão nada. */
function gestaoDe(u: UnidadeCompleta): string | null {
  const g = u.gerais.find(([rotulo]) => /^esfera/i.test(rotulo))?.[1].nome;
  return g ? g.toLowerCase() : null;
}

function Ligacao({ para, ativa, pendencias }: { para: TelaIrma; ativa: boolean; pendencias: number | null }) {
  const nome = ROTULO_DA_AREA[para];
  const n = pendencias ?? 0;
  return (
    <a className="un__irmao" href={`#/painel/${para}`} aria-current={ativa ? "page" : undefined}
      aria-label={n > 0 ? `${nome}, ${n} ${n === 1 ? "pendência" : "pendências"}` : undefined}
      onClick={(e) => { e.preventDefault(); ir("painel", para); }}>
      {nome}{n > 0 && <span className="un__pend" aria-hidden="true">{n}</span>}
    </a>
  );
}

/** "Você veio de": a pendência que levou a esta área, com a volta e a dispensa. */
function VeioDe({ aoDispensar }: { aoDispensar: () => void }) {
  const origem = useOrigem();
  if (!origem) return null;
  return (
    <p className="un__veio" role="note">
      <span>Você veio de: <strong>{origem.titulo}</strong></span>
      <a className="un__ver" href="#/painel" onClick={(e) => { e.preventDefault(); definirOrigem(null); ir("painel"); }}>Voltar à pendência</a>
      <button type="button" className="un__veio-fechar" aria-label="Dispensar aviso" onClick={() => { definirOrigem(null); aoDispensar(); }}>×</button>
    </p>
  );
}

/** Cabeçalho comum das subtelas da unidade: caminho, título, a unidade e o seletor irmão (navegação, não abas). */
export function CabecalhoDaUnidade({ tela, unidade, acoes }: { tela: TelaIrma; unidade: UnidadeCompleta | null; acoes?: ReactNode }) {
  const { competencia } = useSessao();
  const painel = usePainel(competencia ?? undefined);
  const contagem: Record<Area, number> | null = painel.data?.disponivel ? contarPorArea(painel.data.pendencias) : null;
  const titulo = useRef<HTMLHeadingElement>(null);
  const gestao = unidade ? gestaoDe(unidade) : null;
  const dados = unidade
    ? [
        unidade.nome.trim() || `CNES ${unidade.cnes}`,
        `CNES ${unidade.cnes}`,
        `${unidade.municipio_nome || unidade.municipio} (${unidade.uf})`,
        `CNES de ${rotuloCompetencia(unidade.competencia_cnes)}`,
        gestao ? `gestão ${gestao}` : null,
      ].filter(Boolean).join(" · ")
    : null;
  return (
    <header className="un__cabeca">
      <div className="un__topo">
        <div>
          <nav aria-label="Caminho" className="un__caminho">
            <a href="#/painel" onClick={(e) => { e.preventDefault(); ir("painel"); }}>Painel</a>
            <span aria-hidden="true"> ›</span>
          </nav>
          <h1 ref={titulo} tabIndex={-1}>{ROTULO_DA_AREA[tela]}</h1>
        </div>
        {acoes && <div className="un__acoes">{acoes}</div>}
      </div>
      {dados && <p className="un__unidade">{dados}</p>}
      <nav aria-label="Telas da unidade" className="un__irmaos">
        {(["cadastro", "aptidao", "producao"] as const).map((a) => <Ligacao key={a} para={a} ativa={tela === a} pendencias={contagem?.[a] ?? null} />)}
      </nav>
      <VeioDe aoDispensar={() => titulo.current?.focus()} />
    </header>
  );
}
