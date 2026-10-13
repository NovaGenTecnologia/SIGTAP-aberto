import { useState } from "react";
import { Button, Disclosure, DisclosurePanel } from "react-aria-components";
import { mudou } from "../../api/comandos";
import type { ItemDeMudanca, Mudancas, TabelaDeMudanca } from "../../api/tipos";
import { inteiro } from "../../util/formatos";
import { ir } from "../../shell/rotas";
import { descreverItem, nomeDoProcedimento, ROTULO_DA_MUDANCA, SECOES, secaoDaTabela, type IdDeSecao } from "./modelo";

const total = (t: TabelaDeMudanca) => t.incluidos + t.excluidos + t.alterados;
/** Quantos itens o Rust já devolveu desta tabela (a próxima página começa depois deles). */
const devolvidos = (t: TabelaDeMudanca) => total(t) - t.desde - t.itens_omitidos;

function Selo({ tipo }: { tipo: ItemDeMudanca["tipo"] }) {
  return <span className={`mud__selo mud__selo--${tipo}`}>{ROTULO_DA_MUDANCA[tipo]}</span>;
}

function Linhas({ itens, comProcedimento }: { itens: ItemDeMudanca[]; comProcedimento: boolean }) {
  return (
    <table className="mud__tabela">
      <thead>
        <tr>
          {comProcedimento && <th scope="col">Procedimento</th>}
          <th scope="col">Detalhe</th>
          <th scope="col">Mudança</th>
          <th scope="col">Afeta</th>
        </tr>
      </thead>
      <tbody>
        {itens.map((i, k) => {
          const proc = i.chave.co_procedimento;
          return (
            <tr key={`${Object.values(i.chave).join("|")}-${k}`}>
              {comProcedimento && (
                <th scope="row" className="mud__proc">
                  {proc && <a className="mud__codigo" href={`#/consultar/${proc}`} onClick={(e) => { e.preventDefault(); ir("consultar", proc); }}>{proc}</a>}
                  {nomeDoProcedimento(i) && <span className="mud__nome">{nomeDoProcedimento(i)}</span>}
                </th>
              )}
              <td>{descreverItem(i) || (comProcedimento ? "—" : Object.values(i.chave).join(" · "))}</td>
              <td><Selo tipo={i.tipo} /></td>
              <td>{i.afeta ? <span className="mud__selo mud__selo--apta">afeta</span> : null}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function Tabela({ t, de, para, soAfeta, comTitulo }: { t: TabelaDeMudanca; de: string; para: string; soAfeta: boolean; comTitulo: boolean }) {
  const [mais, setMais] = useState<{ itens: ItemDeMudanca[]; atual: TabelaDeMudanca } | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [buscando, setBuscando] = useState(false);
  const atual = mais?.atual ?? t;
  const itens = [...t.itens, ...(mais?.itens ?? [])];
  const verMais = async () => {
    setBuscando(true);
    setErro(null);
    try {
      const r = await mudou(de, para, { tabela: t.tabela, desde: atual.desde + devolvidos(atual), soAfeta });
      const nova = r.tabelas[0];
      if (nova) setMais({ itens: [...(mais?.itens ?? []), ...nova.itens], atual: nova });
    } catch (e) {
      setErro(typeof e === "string" ? e : e instanceof Error ? e.message : "Não foi possível carregar mais.");
    } finally {
      setBuscando(false);
    }
  };
  return (
    <div className="mud__tabela-bloco">
      {comTitulo && <h4 className="mud__subtitulo">{t.tabela} <span className="mud__dica">{inteiro(total(t))} mudanças</span></h4>}
      {itens.length === 0 ? <p className="mud__vazio">{soAfeta ? (atual.itens_omitidos > 0 ? "Nada neste trecho afeta a sua unidade" : "Nada nesta tabela afeta a sua unidade") : "Sem mudanças"}</p> : <Linhas itens={itens} comProcedimento={itens.some((i) => i.chave.co_procedimento)} />}
      {atual.itens_omitidos > 0 && (
        <button type="button" className="mud__mais" disabled={buscando} onClick={() => void verMais()}>
          {buscando ? "Carregando…" : soAfeta ? "Ver mais mudanças" : `Ver mais ${inteiro(atual.itens_omitidos)} mudanças`}
        </button>
      )}
      {erro && <p role="alert" className="mud__erro">{erro}</p>}
    </div>
  );
}

function Secao({ id, titulo, tabelas, de, para, soAfeta }: { id: IdDeSecao; titulo: string; tabelas: TabelaDeMudanca[]; de: string; para: string; soAfeta: boolean }) {
  const n = tabelas.reduce((s, t) => s + total(t), 0);
  const afetam = tabelas.some((t) => t.afetam !== undefined) ? tabelas.reduce((s, t) => s + (t.afetam ?? 0), 0) : null;
  return (
    <Disclosure className="mud__secao" id={id}>
      {({ isExpanded }) => (
        <>
          <Button slot="trigger" className="mud__secao-botao">
            <span className="mud__seta" aria-hidden="true">{isExpanded ? "▾" : "▸"}</span>
            <span className="mud__secao-titulo">{titulo}</span>
            <span className="mud__dica">{inteiro(n)} mudanças{afetam !== null ? ` · ${afetam === 1 ? "1 afeta" : `${inteiro(afetam)} afetam`} a unidade` : ""}</span>
          </Button>
          <DisclosurePanel className="mud__secao-painel">
            {tabelas.map((t) => <Tabela key={t.tabela} t={t} de={de} para={para} soAfeta={soAfeta} comTitulo={id === "cadastro"} />)}
          </DisclosurePanel>
        </>
      )}
    </Disclosure>
  );
}

/** Exigências e tabelas do cadastro que mudaram, em seções recolhidas; só aparece o que teve mudança. */
export function SecoesTecnicas({ mudancas, de, para, soAfeta }: { mudancas: Mudancas; de: string; para: string; soAfeta: boolean }) {
  const secoes = SECOES.map((s) => ({ ...s, tabelas: mudancas.tabelas.filter((t) => secaoDaTabela(t.tabela) === s.id && total(t) > 0) })).filter((s) => s.tabelas.length > 0);
  if (secoes.length === 0) return null;
  return (
    <section className="mud__tecnicas" aria-labelledby="mud-tecnicas">
      <h2 id="mud-tecnicas" className="mud__secao-grupo">Exigências e outras tabelas</h2>
      <div className="mud__cartao">
        {secoes.map((s) => <Secao key={s.id} id={s.id} titulo={s.titulo} tabelas={s.tabelas} de={de} para={para} soAfeta={soAfeta} />)}
      </div>
    </section>
  );
}
