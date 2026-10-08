import { useMemo, useState } from "react";
import { Botao } from "../../componentes/base/Botao";
import { Ligacao } from "../../componentes/base/Ligacao";
import { Carregando, EstadoErro } from "../../componentes/dominio/Estados";
import { useLigados, useFicha } from "../../dados/consultar";
import { ir } from "../../shell/rotas";
import { inteiro, reais } from "../../util/formatos";
import type { ItemDeApoio } from "../../api/tipos";
import type { No, TipoDeArvore } from "./modelo/arvore";
import { BotaoFavorito } from "./FichaMarcas";
import { montarResumo, type LinhaDoResumo, type ListaCurta } from "./modelo/resumo";
import { complexidadeCurta, instrumentosCurtos } from "./modelo/procedimento";

const COBRAR = ["Sexo", "Idade", "Quantidade máxima", "Permanência", "CID", "CBO"];
const valorDe = (linhas: LinhaDoResumo[], rotulo: string) => linhas.find((l) => l.rotulo === rotulo)?.valor ?? "—";
const mensagem = (e: unknown) => (e instanceof Error ? e.message : String(e));

function Lista({ titulo, linhas, forte }: { titulo: string; linhas: { rotulo: string; valor: string }[]; forte?: string }) {
  return (
    <section className="previa__secao">
      <h3>{titulo}</h3>
      <dl>
        {linhas.map((l) => (
          <div key={l.rotulo} className={l.rotulo === forte ? "previa__linha previa__linha--forte" : "previa__linha"}>
            <dt>{l.rotulo}</dt><dd className="num">{l.valor}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

/** "ver mais N" abre os itens ocultos; o estado vale só para o item da prévia (ela é recriada ao trocar de item). */
function VerMais({ mais, aberto, aoAlternar }: { mais: number; aberto: boolean; aoAlternar: () => void }) {
  if (mais <= 0) return null;
  return <Botao variante="discreto" aria-expanded={aberto} onPress={aoAlternar}>{aberto ? "ver menos" : `ver mais ${inteiro(mais)}`}</Botao>;
}

function Exigencia({ titulo, lista }: { titulo: string; lista: ListaCurta }) {
  const [aberta, setAberta] = useState(false);
  if (lista.aceitos === 0) return null;
  return (
    <section className="previa__secao" aria-label={titulo}>
      <h3>{titulo} · {lista.aceitos} {lista.aceitos === 1 ? "aceito" : "aceitos"}</h3>
      <ul className="previa__codigos">
        {(aberta ? lista.todos : lista.itens).map((i) => <li key={i}>{i}</li>)}
      </ul>
      <VerMais mais={lista.mais} aberto={aberta} aoAlternar={() => setAberta((a) => !a)} />
    </section>
  );
}

function PreviaProcedimento({ no, compacta }: { no: No; compacta: boolean }) {
  const q = useFicha(no.id);
  if (q.isError) return <EstadoErro mensagem={mensagem(q.error)} aoTentar={() => void q.refetch()} />;
  if (!q.data) return <Carregando rotulo="Carregando a prévia" />;
  const r = montarResumo(q.data);
  const resumo = [r.instrumento, r.complexidade, r.modalidade, r.financiamentoCurto].join(" · ");
  const abrir = <Botao variante="primario" onPress={() => ir("consultar", no.id)}>Abrir ficha</Botao>;
  if (compacta) {
    const v = (rot: string) => valorDe(r.valores, rot);
    return (
      <div className="previa__compacta">
        <p className="previa__sub">{resumo}</p>
        <p className="previa__total">
          <strong className="num">Total {v("Total")}</strong>
          <span className="num"> (hospitalar {v("Serviço hospitalar")} · profissional {v("Serviço profissional")} · ambulatorial {v("Serviço ambulatorial")})</span>
        </p>
        <p className="previa__sub">{[`Sexo ${valorDe(r.cobrar, "Sexo")}`, valorDe(r.cobrar, "Idade"), `${valorDe(r.cobrar, "CID")} CID`, `${valorDe(r.cobrar, "CBO")} CBO`].join(" · ")}</p>
        <div className="previa__acao">{abrir}<BotaoFavorito tipo="procedimento" codigo={no.id} /></div>
      </div>
    );
  }
  return (
    <>
      <div className="previa__cabeca">
        <p className="previa__codigo num">{no.mascarado}</p>
        <h2 className="previa__nome">{r.nome}</h2>
        <p className="previa__sub">{resumo}</p>
      </div>
      <Lista titulo="Valores" forte="Total" linhas={r.valores.slice(0, 4)} />
      <Lista titulo="Para cobrar" linhas={r.cobrar.filter((l) => COBRAR.includes(l.rotulo) && l.rotulo !== "CBO" && l.rotulo !== "CID")} />
      <Exigencia titulo="CBO" lista={r.cbos} />
      <Exigencia titulo="CID" lista={r.cids} />
      <div className="previa__acao">{abrir}<BotaoFavorito tipo="procedimento" codigo={no.id} /></div>
    </>
  );
}

function PreviaCid({ no, compacta }: { no: No; compacta: boolean }) {
  const item = useMemo<ItemDeApoio>(() => ({ tabela: "tb_cid", colunas: ["co_cid"], codigo: [no.id], nome: no.nome ?? "", procedimentos: no.contagem ?? 0 }), [no.id, no.nome, no.contagem]);
  const q = useLigados(item);
  const [todos, setTodos] = useState(false);
  if (q.isError) return <EstadoErro mensagem={mensagem(q.error)} aoTentar={() => void q.refetch()} />;
  if (!q.data) return <Carregando rotulo="Carregando a prévia" />;
  const lista = q.data;
  const n = lista.length;
  const ligados = n === 0 ? "Nenhum procedimento ligado" : `${inteiro(n)} ${n === 1 ? "procedimento ligado" : "procedimentos ligados"}`;
  const valores = lista.map((p) => p.valor_total_centavos);
  const faixa = n === 0 ? "—" : Math.min(...valores) === Math.max(...valores) ? reais(valores[0]!) : `${reais(Math.min(...valores))} a ${reais(Math.max(...valores))}`;
  const instrumentos = instrumentosCurtos(lista.flatMap((p) => p.instrumentos));
  const complexidade = [...new Set(lista.map((p) => complexidadeCurta(p.complexidade)))].join(" · ") || "—";
  const grupos = [...new Set(lista.map((p) => p.codigo.slice(0, 2)))].sort().join(" · ") || "—";
  const botao = n > 0 && <Botao variante="primario" onPress={() => ir("consultar", "q", encodeURIComponent(no.mascarado))}>{n === 1 ? "Ver o procedimento" : `Ver os ${inteiro(n)} procedimentos`}</Botao>;
  if (compacta) {
    return (
      <div className="previa__compacta">
        <p className="previa__total"><strong className="num">{ligados}</strong><span className="num"> · {faixa}</span></p>
        <p className="previa__sub">{instrumentos} · {complexidade} · grupos {grupos}</p>
        {lista[0] && <p className="previa__sub"><span className="num">{lista[0].codigo_mascarado}</span> {lista[0].nome}{n > 1 ? `  e mais ${n - 1}` : ""}</p>}
        <div className="previa__acao">{botao}<BotaoFavorito tipo="cid" codigo={no.id} /></div>
      </div>
    );
  }
  return (
    <>
      <div className="previa__cabeca">
        <p className="previa__codigo num">{no.mascarado}</p>
        <h2 className="previa__nome">{no.nome ?? "sem nome nesta competência"}</h2>
        <p className="previa__sub">{ligados}</p>
      </div>
      {n > 0 && <Lista titulo="Resumo" linhas={[{ rotulo: "Valor total", valor: faixa }, { rotulo: "Instrumentos", valor: instrumentos }, { rotulo: "Complexidade", valor: complexidade }, { rotulo: "Grupos", valor: grupos }]} />}
      {n > 0 && (
        <section className="previa__secao">
          <h3>Procedimentos</h3>
          <ul className="previa__itens">
            {(todos ? lista : lista.slice(0, 2)).map((p) => (
              <li key={p.codigo}>
                <Ligacao href={`#/consultar/${p.codigo}`}>{p.codigo_mascarado}</Ligacao>
                <span className="num previa__item-valor">{reais(p.valor_total_centavos)}</span>
                <span className="previa__item-nome">{p.nome}</span>
              </li>
            ))}
          </ul>
          <VerMais mais={n - 2} aberto={todos} aoAlternar={() => setTodos((t) => !t)} />
        </section>
      )}
      <div className="previa__acao">{botao}<BotaoFavorito tipo="cid" codigo={no.id} /></div>
    </>
  );
}

/** O que mostrar sobre o item escolhido, sem sair da árvore. Nó que ainda tem filhos só diz o tamanho. */
export function Previa({ tipo, no, compacta = false }: { tipo: TipoDeArvore; no: No; compacta?: boolean }) {
  if (no.folha) return tipo === "cid" ? <PreviaCid key={no.id} no={no} compacta={compacta} /> : <PreviaProcedimento key={no.id} no={no} compacta={compacta} />;
  if (compacta) return null;
  return (
    <div className="previa__cabeca">
      <p className="previa__codigo num">{no.mascarado}</p>
      <h2 className="previa__nome">{no.nome ?? "sem nome nesta competência"}</h2>
      {no.contagem !== null && <p className="previa__sub">{inteiro(no.contagem)} {no.contagem === 1 ? "procedimento" : "procedimentos"}</p>}
    </div>
  );
}
