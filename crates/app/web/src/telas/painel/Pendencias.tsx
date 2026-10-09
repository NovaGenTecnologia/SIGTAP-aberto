import { Button, Disclosure, DisclosurePanel } from "react-aria-components";
import type { Pendencia } from "../../api/tipos";
import { intervaloDeCompetencias, reais } from "../../util/formatos";
import { ir } from "../../shell/rotas";
import { DeOndeVem, type LinhaDeOrigem } from "./DeOndeVem";

function Selo({ gravidade }: { gravidade: Pendencia["gravidade"] }) {
  return <span className={`painel__selo painel__selo--${gravidade}`}>{gravidade === "atencao" ? "Atenção" : "Info"}</span>;
}

function origemDe(p: Pendencia): LinhaDeOrigem[] {
  const periodo = intervaloDeCompetencias(p.origem.competencias);
  return [
    { rotulo: "Fonte", texto: [p.origem.fonte, periodo].filter(Boolean).join(" · ") },
    { rotulo: p.valor_envolvido_centavos === null ? "Conta" : "Valor envolvido", texto: p.origem.conta },
    ...(p.perda_estimada ? [{ rotulo: "Perda estimada", texto: `Essa diferença vezes ${p.perda_estimada.horizonte_meses} meses, ${p.perda_estimada.premissa}. É uma estimativa.` }] : []),
    { rotulo: "Não prova", texto: p.origem.nao_prova },
  ];
}

function ItensDaPendencia({ itens }: { itens: Pendencia["itens"] }) {
  return (
    <table className="painel__itens">
      <thead><tr><th scope="col">Procedimento</th><th scope="col" className="painel__direita">Valor</th></tr></thead>
      <tbody>
        {itens.map((i) => (
          <tr key={i.codigo}>
            <td>
              <a className="painel__codigo" href={`#/consultar/${i.codigo}`} onClick={(e) => { e.preventDefault(); ir("consultar", i.codigo); }}>{i.codigo}</a>
              {i.nome && <span className="painel__nome">{i.nome}</span>}
            </td>
            <td className="num painel__direita">{reais(i.valor_centavos)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function Guia({ p }: { p: Pendencia }) {
  const periodo = intervaloDeCompetencias(p.origem.competencias);
  const passos = ["Alerta", p.origem.fonte, periodo].filter(Boolean);
  return <p className="painel__guia" aria-label="Caminho do alerta até a origem">{passos.join(" › ")}</p>;
}

function Cartao({ p }: { p: Pendencia }) {
  const temItens = p.itens.length > 0;
  const corpo = (aberto: boolean) => (
    <>
      <div className="pend__topo">
        <div className="pend__titulo-linha"><Selo gravidade={p.gravidade} /><h3 className="pend__titulo">{p.titulo}</h3></div>
        {p.valor_envolvido_centavos !== null && (
          <div className="pend__valor-bloco">
            <strong className="pend__valor num">{reais(p.valor_envolvido_centavos)}</strong>
            <span className="pend__legenda">valor envolvido</span>
          </div>
        )}
      </div>
      <p className="pend__texto">{p.texto}</p>
      <Guia p={p} />
      <div className="pend__rodape">
        {p.perda_estimada ? (
          <p className="pend__perda">
            <span>Perda estimada</span>
            <strong className="num">{reais(p.perda_estimada.centavos)} por ano</strong>
            <span className="painel__selo painel__selo--atencao">Estimativa</span>
            <span className="pend__premissa">{p.perda_estimada.premissa}</span>
          </p>
        ) : <span />}
        <div className="pend__acoes">
          {temItens && <Button slot="trigger" className="botao botao--secundario">{aberto ? "Ocultar itens" : "Ver itens"}</Button>}
          <DeOndeVem titulo={p.titulo} linhas={origemDe(p)} />
        </div>
      </div>
      {temItens && <DisclosurePanel className="pend__painel"><ItensDaPendencia itens={p.itens} /></DisclosurePanel>}
    </>
  );
  return temItens ? <Disclosure className="pend">{({ isExpanded }) => corpo(isExpanded)}</Disclosure> : <div className="pend">{corpo(false)}</div>;
}

function LinhaSemValor({ p }: { p: Pendencia }) {
  return (
    <li className="semvalor__linha">
      <Selo gravidade={p.gravidade} />
      <span className="semvalor__titulo">{p.titulo}</span>
      <span className="semvalor__texto">{p.texto}</span>
      <span className="semvalor__origem"><DeOndeVem titulo={p.titulo} linhas={origemDe(p)} /></span>
    </li>
  );
}

/** Pendências da unidade: as valoradas em cartões, na ordem do Rust; as demais numa faixa à parte. */
export function Pendencias({ itens }: { itens: Pendencia[] }) {
  const comValor = itens.filter((p) => p.valor_envolvido_centavos !== null);
  const semValor = itens.filter((p) => p.valor_envolvido_centavos === null);
  if (itens.length === 0) return <p className="painel__vazio">Nada pede atenção nesta competência</p>;
  return (
    <div className="painel__pendencias">
      {comValor.length > 0 && (
        <ul className="painel__lista" aria-label="Pendências">
          {comValor.map((p) => <li key={p.id}><Cartao p={p} /></li>)}
        </ul>
      )}
      {semValor.length > 0 && (
        <Disclosure className="semvalor" defaultExpanded>
          {({ isExpanded }) => (
            <>
              <Button slot="trigger" className="semvalor__botao">
                <span>Sem valor calculável ({semValor.length})</span>
                <span className="semvalor__dica">{isExpanded ? "por gravidade" : "mostrar"}</span>
              </Button>
              <DisclosurePanel><ul className="semvalor__lista">{semValor.map((p) => <LinhaSemValor key={p.id} p={p} />)}</ul></DisclosurePanel>
            </>
          )}
        </Disclosure>
      )}
    </div>
  );
}
