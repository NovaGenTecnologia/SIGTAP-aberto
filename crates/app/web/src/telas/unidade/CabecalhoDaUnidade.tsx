import type { ReactNode } from "react";
import type { UnidadeCompleta } from "../../api/tipos";
import { ir } from "../../shell/rotas";
import { rotuloCompetencia } from "../../util/formatos";

export type TelaIrma = "cadastro" | "aptidao" | "producao";
const TITULO: Record<TelaIrma, string> = { cadastro: "Cadastro", aptidao: "Aptidão", producao: "Produção" };

/** Esfera administrativa (ou gestão) com nome, quando o cadastro traz; senão nada. */
function gestaoDe(u: UnidadeCompleta): string | null {
  const g = u.gerais.find(([rotulo]) => /^esfera/i.test(rotulo))?.[1].nome;
  return g ? g.toLowerCase() : null;
}

function Ligacao({ para, ativa, children }: { para: TelaIrma; ativa: boolean; children: string }) {
  return (
    <a className="un__irmao" href={`#/painel/${para}`} aria-current={ativa ? "page" : undefined}
      onClick={(e) => { e.preventDefault(); ir("painel", para); }}>{children}</a>
  );
}

/** Cabeçalho comum das subtelas da unidade: caminho, título, a unidade e o seletor irmão (navegação, não abas). */
export function CabecalhoDaUnidade({ tela, unidade, acoes }: { tela: TelaIrma; unidade: UnidadeCompleta | null; acoes?: ReactNode }) {
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
          <h1>{TITULO[tela]}</h1>
        </div>
        {acoes && <div className="un__acoes">{acoes}</div>}
      </div>
      {dados && <p className="un__unidade">{dados}</p>}
      <nav aria-label="Telas da unidade" className="un__irmaos">
        <Ligacao para="cadastro" ativa={tela === "cadastro"}>Cadastro</Ligacao>
        <Ligacao para="aptidao" ativa={tela === "aptidao"}>Aptidão</Ligacao>
        {tela === "producao"
          ? <span className="un__irmao un__irmao--breve" aria-current="page">Produção · Em breve</span>
          : <span className="un__irmao un__irmao--breve">Produção · Em breve</span>}
      </nav>
    </header>
  );
}
