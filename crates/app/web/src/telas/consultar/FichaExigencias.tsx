import { useEffect, useMemo, useRef, useState } from "react";
import { Button, Dialog, DialogTrigger, Disclosure, DisclosurePanel, Heading, Popover, type SortDescriptor } from "react-aria-components";
import type { Ficha, RelacaoOficial } from "../../api/tipos";
import { CampoBusca } from "../../componentes/base/CampoBusca";
import { Ligacao } from "../../componentes/base/Ligacao";
import { TabelaDeDados, type Coluna } from "../../componentes/base/TabelaDeDados";
import { inteiro } from "../../util/formatos";
import { mascararProcedimento } from "../../util/campos";
import { Exportar } from "./Exportar";
import { planilhaDaRelacao } from "./modelo/planilha";
import { agruparRelacoes, chaveDaRelacao, nomeDaRelacao } from "./modelo/relacoes";
import { montarTabela, type CelulaDaRelacao, type LinhaDaRelacao } from "./modelo/tabelaRelacao";

const normalizar = (s: string) => s.toLocaleLowerCase("pt-BR").normalize("NFD").replace(/[̀-ͯ]/g, "");
const textoDaCelula = (c: CelulaDaRelacao | undefined) => (c ? `${c.codigo} ${c.nome ?? ""}`.trim() : "");

function Celula({ celula }: { celula: CelulaDaRelacao | undefined }) {
  if (!celula) return null;
  return (
    <span className="exigencias__celula">
      {celula.procedimento
        ? <Ligacao href={`#/consultar/${celula.procedimento}`}>{mascararProcedimento(celula.procedimento)}</Ligacao>
        : <span className="num exigencias__codigo">{celula.codigo}</span>}
      {celula.nome && <span title={celula.nome}>{celula.nome}</span>}
      {celula.falta && <span className="exigencias__falta">{celula.falta}</span>}
      {celula.textos.length > 0 && (
        <DialogTrigger>
          <Button className="exigencias__texto">Texto oficial</Button>
          <Popover className="balao" placement="bottom start">
            <Dialog className="exigencias__dialogo" aria-label="Texto oficial">
              {celula.textos.map((t) => <p key={t}>{t}</p>)}
            </Dialog>
          </Popover>
        </DialogTrigger>
      )}
    </span>
  );
}

function TabelaDaRelacao({ relacao }: { relacao: RelacaoOficial }) {
  const nome = nomeDaRelacao(relacao);
  const tabela = useMemo(() => montarTabela(relacao), [relacao]);
  const [filtro, setFiltro] = useState("");
  const [ordem, setOrdem] = useState<SortDescriptor>();

  const linhas = useMemo(() => {
    const q = normalizar(filtro.trim());
    let r = q ? tabela.linhas.filter((l) => l.busca.includes(q)) : tabela.linhas;
    if (ordem?.column) {
      const col = String(ordem.column);
      const sinal = ordem.direction === "descending" ? -1 : 1;
      const chave = (l: LinhaDaRelacao) => col === "repeticoes" ? String(l.repeticoes) : textoDaCelula(l.celulas[col]);
      r = [...r].sort((a, b) => sinal * chave(a).localeCompare(chave(b), "pt-BR", { numeric: true }));
    }
    return r;
  }, [tabela, filtro, ordem]);

  const colunas: Coluna<LinhaDaRelacao>[] = [
    ...tabela.colunas.map((c) => ({ id: c.id, rotulo: c.rotulo, ordenavel: true, larguraMinima: 160, celula: (l: LinhaDaRelacao) => <Celula celula={l.celulas[c.id]} /> })),
    ...(tabela.temRepeticoes ? [{ id: "repeticoes", rotulo: "Repetições no arquivo", ordenavel: true, numerica: true, larguraMinima: 160, celula: (l: LinhaDaRelacao) => String(l.repeticoes) }] : []),
  ];
  const total = tabela.linhas.length;
  return (
    <div className="exigencias__tabela">
      <div className="exigencias__ferramentas">
        {total > 12 && <div className="exigencias__filtro"><CampoBusca rotulo={`Filtrar ${nome}`} placeholder="Filtrar por código ou nome" value={filtro} onChange={setFiltro} /></div>}
        <span role="status" className="exigencias__contagem">{filtro.trim() ? `${inteiro(linhas.length)} de ${inteiro(total)} linhas` : `${inteiro(total)} ${total === 1 ? "linha" : "linhas"}`}</span>
        <span className="exigencias__exportar"><Exportar nome={nome} montar={() => planilhaDaRelacao(nome, tabela)} mensagemOk={() => `Planilha salva com ${inteiro(total)} ${total === 1 ? "linha" : "linhas"}.`} /></span>
      </div>
      <TabelaDeDados rotulo={nome} colunas={colunas} linhas={linhas} ordenacao={ordem} aoOrdenar={setOrdem} altura={Math.min(Math.max(linhas.length, 1), 10) * 36 + 40} />
    </div>
  );
}

function Secao({ id, titulo, contagem, aberta, aoAlternar, foco, children }: {
  id: string; titulo: string; contagem: number; aberta: boolean; aoAlternar: (a: boolean) => void; foco: boolean; children: React.ReactNode;
}) {
  const botao = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!foco) return;
    botao.current?.focus();
    botao.current?.scrollIntoView?.({ block: "start" });
  }, [foco]);
  return (
    <Disclosure id={id} isExpanded={aberta} onExpandedChange={aoAlternar} className="exigencias__secao">
      <Heading level={3} className="exigencias__titulo">
        <Button slot="trigger" ref={botao} className="exigencias__gatilho">
          <span aria-hidden="true" className="exigencias__seta">{aberta ? "▾" : "▸"}</span>
          <span className="exigencias__nome">{titulo}</span>
          {contagem > 0 && <span className="exigencias__total">{inteiro(contagem)}</span>}
        </Button>
      </Heading>
      <DisclosurePanel>{aberta && children}</DisclosurePanel>
    </Disclosure>
  );
}

export function FichaExigencias({ ficha, secao }: { ficha: Ficha; secao?: string }) {
  const grupos = useMemo(() => agruparRelacoes(ficha), [ficha]);
  const alvo = useMemo(() => {
    if (!secao) return undefined;
    return grupos.flatMap((g) => g.relacoes).find((r) => chaveDaRelacao(r) === secao || r.tabela === secao);
  }, [grupos, secao]);
  const [abertas, setAbertas] = useState<Set<string>>(() => new Set(alvo ? [chaveDaRelacao(alvo)] : []));
  const [vaziasAbertas, setVaziasAbertas] = useState(false);
  const alvoId = alvo ? chaveDaRelacao(alvo) : undefined;

  useEffect(() => {
    if (alvoId) setAbertas((a) => (a.has(alvoId) ? a : new Set(a).add(alvoId)));
  }, [alvoId]);

  const alternar = (id: string, a: boolean) => setAbertas((s) => { const n = new Set(s); if (a) n.add(id); else n.delete(id); return n; });
  const vazias = grupos.flatMap((g) => g.vazias);

  return (
    <div className="exigencias">
      {grupos.filter((g) => g.relacoes.length > 0).map((g) => (
        <section key={g.id} aria-labelledby={`grupo-${g.id}`} className="exigencias__grupo">
          <h2 id={`grupo-${g.id}`}>{g.rotulo}</h2>
          {g.relacoes.map((r) => {
            const id = chaveDaRelacao(r);
            return (
              <Secao key={id} id={id} titulo={nomeDaRelacao(r)} contagem={r.linhas.length} aberta={abertas.has(id)} aoAlternar={(a) => alternar(id, a)} foco={id === alvoId}>
                <TabelaDaRelacao relacao={r} />
              </Secao>
            );
          })}
        </section>
      ))}
      {vazias.length > 0 && (
        <Disclosure isExpanded={vaziasAbertas} onExpandedChange={setVaziasAbertas} className="exigencias__secao exigencias__secao--vazias">
          <Heading level={3} className="exigencias__titulo">
            <Button slot="trigger" className="exigencias__gatilho">
              <span aria-hidden="true" className="exigencias__seta">{vaziasAbertas ? "▾" : "▸"}</span>
              <span className="exigencias__nome">Sem linhas nesta competência ({vazias.length})</span>
            </Button>
          </Heading>
          <DisclosurePanel>
            {vaziasAbertas && <ul className="exigencias__lista-vazias">{vazias.map((r) => <li key={chaveDaRelacao(r)}>{nomeDaRelacao(r)}</li>)}</ul>}
          </DisclosurePanel>
        </Disclosure>
      )}
    </div>
  );
}
