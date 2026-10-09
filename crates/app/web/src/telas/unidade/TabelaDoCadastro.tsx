import type { ReactNode } from "react";
import type { Planilha } from "../../api/tipos";
import { CampoBusca } from "../../componentes/base/CampoBusca";
import { contem } from "../../util/busca";
import { Exportar } from "../consultar/Exportar";

export interface ColunaDoCadastro<L> {
  id: string;
  rotulo: string;
  numerica?: boolean;
  celula: (linha: L) => ReactNode;
}

export interface TabelaDoCadastroProps<L extends { id: string }> {
  /** Nome da tabela (aria-label) e base do rótulo do filtro. */
  rotulo: string;
  colunas: ColunaDoCadastro<L>[];
  linhas: L[];
  /** Texto de cada linha que o filtro procura (código, nome...). */
  texto: (linha: L) => string;
  busca: string;
  aoBuscar: (texto: string) => void;
  /** Texto da contagem das linhas que ficaram; padrão: "N <rotulo>". */
  contagem?: (linhas: L[]) => string;
  planilha: (linhas: L[]) => Planilha;
  nomeDoArquivo: string;
  aoAbrir?: (linha: L) => void;
  vazio?: string;
  /** Substitui as linhas padrão do `<tbody>` (ex.: linhas agrupadas); recebe as linhas que passaram no filtro e se há filtro de texto. */
  corpo?: (mostradas: L[], filtrando: boolean) => ReactNode;
  /** Controles extras na barra, depois da contagem (ex.: chips de filtro). */
  extras?: ReactNode;
  /** Texto abaixo da tabela. */
  legenda?: ReactNode;
}

/** Tabela comum das abas do Cadastro: filtro por texto, contagem, exportar e rolagem por dentro. */
export function TabelaDoCadastro<L extends { id: string }>({
  rotulo, colunas, linhas, texto, busca, aoBuscar, contagem, planilha, nomeDoArquivo, aoAbrir, vazio = "Nenhum registro.", corpo, extras, legenda,
}: TabelaDoCadastroProps<L>) {
  const mostradas = busca.trim() ? linhas.filter((l) => contem(texto(l), busca)) : linhas;
  return (
    <div className="un__bloco">
      <div className="un__barra">
        <CampoBusca rotulo={`Filtrar ${rotulo.toLowerCase()}`} value={busca} onChange={aoBuscar} />
        <span className="un__contagem">{contagem ? contagem(mostradas) : `${mostradas.length} ${rotulo.toLowerCase()}`}</span>
        {extras}
        <span className="un__barra-fim">
          <Exportar montar={() => planilha(mostradas)} nome={nomeDoArquivo} mensagemOk={(p) => `${p.abas[0]?.linhas.length ?? 0} linhas exportadas.`} />
        </span>
      </div>
      <div className="un__cartao">
        <div className="un__rolagem" role="region" aria-label={`Rolagem: ${rotulo}`} tabIndex={0}>
          <table className="un__tabela" aria-label={rotulo}>
            <thead>
              <tr>{colunas.map((c) => <th key={c.id} scope="col" className={c.numerica ? "un__direita" : undefined}>{c.rotulo}</th>)}</tr>
            </thead>
            <tbody>
              {corpo ? corpo(mostradas, busca.trim() !== "") : mostradas.map((l) => (
                <tr key={l.id} className={aoAbrir ? "un__linha-clicavel" : undefined} onClick={aoAbrir ? () => aoAbrir(l) : undefined}>
                  {colunas.map((c) => <td key={c.id} className={c.numerica ? "un__direita num" : undefined}>{c.celula(l)}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {legenda && <p className="un__legenda">{legenda}</p>}
        {mostradas.length === 0 && <p className="un__vazio">{busca.trim() ? `Nenhum resultado para «${busca.trim()}»` : vazio}</p>}
      </div>
    </div>
  );
}

/** Código e nome em duas linhas; sem nome, só o código (nunca "null"). */
export function CodigoENome({ codigo, nome, extra }: { codigo: string; nome?: string | null; extra?: ReactNode }) {
  return (
    <>
      <span className="un__codigo">{codigo}</span>{extra}
      {nome && <span className="un__nome">{nome}</span>}
    </>
  );
}
