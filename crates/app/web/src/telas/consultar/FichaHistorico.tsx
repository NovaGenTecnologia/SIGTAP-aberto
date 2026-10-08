import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { Button, Disclosure, DisclosurePanel, Heading } from "react-aria-components";
import { GrupoOpcoes } from "../../componentes/base/GrupoOpcoes";
import { Ligacao } from "../../componentes/base/Ligacao";
import { Botao } from "../../componentes/base/Botao";
import { Selecao } from "../../componentes/base/Selecao";
import { Carregando, EstadoErro } from "../../componentes/dominio/Estados";
import { useSituacao } from "../../dados/consultas";
import { useHistorico } from "../../dados/consultar";
import { inteiro } from "../../util/formatos";
import {
  contagemPorCompetencia, montarGrupos, tabelasDoHistorico,
  type CartaoDeEvento, type GrupoDeCompetencia, type TipoDeFiltro,
} from "./modelo/historico";

const LIMITE_DA_TIRA = 12;
const BLOCO_DE_CARTOES = 50;
const BLOCO_DE_ANOS = 5;
const SELO = { alterado: "◆ Alterado", incluido: "+ Incluído", excluido: "− Excluído" } as const;
const OPCOES = [{ valor: "tudo", rotulo: "Tudo" }, { valor: "valores", rotulo: "Valores" }, { valor: "exigencias", rotulo: "Exigências" }];

const plural = (n: number, um: string, varios: string) => `${inteiro(n)} ${n === 1 ? um : varios}`;
const mudancas = (n: number) => plural(n, "mudança", "mudanças");
const rotulo = (c: string) => `${c.slice(4)}/${c.slice(0, 4)}`;

/** Setas ←/→ pulam entre os botões da tira (só os que têm mudança existem como botão). */
function pularComSetas(e: KeyboardEvent<HTMLElement>) {
  if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
  const botoes = [...e.currentTarget.querySelectorAll<HTMLButtonElement>("button")];
  const i = botoes.indexOf(document.activeElement as HTMLButtonElement);
  if (i < 0) return;
  const alvo = botoes[i + (e.key === "ArrowRight" ? 1 : -1)];
  if (alvo) { e.preventDefault(); alvo.focus(); }
}

function Cartao({ c }: { c: CartaoDeEvento }) {
  return (
    <li className={`hist__item hist__item--${c.tipo}`}>
      <div className="hist__topo">
        <span className={`hist__selo hist__selo--${c.tipo}`}>{SELO[c.tipo]}</span>
        <span className="hist__tabela">{c.nome}</span>
      </div>
      {c.nota && <p className="hist__nota">{c.nota}</p>}
      {c.mudancas.length > 0 && (
        <ul className="hist__mudancas">
          {c.mudancas.map((m) => (
            <li key={m.campo}>
              <span className="hist__campo">{m.campo}</span>
              <span className="hist__antes">{m.antes}</span>
              <span aria-hidden="true">→</span>
              <span className="hist__depois">{m.depois}</span>
            </li>
          ))}
        </ul>
      )}
      {c.itens.length > 0 && <ul className="hist__itens">{c.itens.map((i, k) => { const corte = i.indexOf(", "); return <li key={`${i}-${k}`}>{corte < 0 ? i : <>{i.slice(0, corte)}<span className="hist__detalhe">{i.slice(corte)}</span></>}</li>; })}</ul>}
    </li>
  );
}

function Competencia({ g, nivel, cartoes }: { g: GrupoDeCompetencia; nivel: 3 | 4; cartoes: CartaoDeEvento[] }) {
  const H = nivel === 3 ? "h3" : "h4";
  return (
    <section id={`ev-${g.competencia}`} className="hist__competencia" aria-labelledby={`ev-t-${g.competencia}`}>
      <H id={`ev-t-${g.competencia}`} tabIndex={-1}>{g.rotulo}</H>
      <ul className="hist__lista">{cartoes.map((c) => <Cartao key={c.id} c={c} />)}</ul>
    </section>
  );
}

function Tira({ comps, contagem, aoEscolher }: { comps: string[]; contagem: Record<string, number>; aoEscolher: (c: string) => void }) {
  const max = Math.max(1, ...comps.map((c) => contagem[c] ?? 0));
  const compacta = comps.length > LIMITE_DA_TIRA;
  const lista = useRef<HTMLOListElement>(null);
  // A tira começa no fim (a competência mais recente é a que o faturista procura) e o acompanha enquanto a janela muda, até a pessoa mexer nela.
  const mexeu = useRef(false);
  useEffect(() => {
    const el = lista.current;
    if (!compacta || !el) return;
    const fim = () => { if (!mexeu.current) el.scrollLeft = el.scrollWidth; };
    fim();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(fim);
    ro.observe(el);
    return () => ro.disconnect();
  }, [compacta, comps.length]);
  return (
    <ol ref={lista} onWheel={() => { mexeu.current = true; }} onPointerDown={() => { mexeu.current = true; }} className={`hist__tira${compacta ? " hist__tira--compacta" : ""}`} aria-label="Competências carregadas" onKeyDown={pularComSetas}>
      {comps.map((c, i) => {
        const n = contagem[c] ?? 0;
        const ano = c.slice(0, 4);
        const primeiroDoAno = i === 0 || comps[i - 1]!.slice(0, 4) !== ano;
        if (!compacta) {
          return (
            <li key={c} className="hist__marcador">
              {n > 0
                ? <button type="button" className="hist__ponto hist__ponto--ativo" onClick={() => aoEscolher(c)}><span className="hist__mes">{rotulo(c)}</span><span className="hist__qtd">{mudancas(n)}</span></button>
                : <span className="hist__ponto"><span className="hist__mes">{rotulo(c)}</span><span className="hist__qtd">—</span></span>}
            </li>
          );
        }
        return (
          <li key={c} className="hist__barra">
            {n > 0
              ? <button type="button" className="hist__coluna" style={{ height: `${Math.max(12, Math.round((n / max) * 48))}px` }} aria-label={`${rotulo(c)}: ${mudancas(n)}`} onClick={() => aoEscolher(c)} />
              : <span className="hist__coluna hist__coluna--vazia" aria-hidden="true" />}
            <span className="hist__ano" aria-hidden="true">{primeiroDoAno ? ano : ""}</span>
          </li>
        );
      })}
    </ol>
  );
}

export function FichaHistorico({ codigo }: { codigo: string }) {
  const h = useHistorico(codigo);
  const sit = useSituacao();
  const [tipo, setTipo] = useState<TipoDeFiltro>("tudo");
  const [tabela, setTabela] = useState("");
  const [limite, setLimite] = useState(BLOCO_DE_CARTOES);
  const [anosVisiveis, setAnosVisiveis] = useState(BLOCO_DE_ANOS);
  const [abertos, setAbertos] = useState<Set<string> | null>(null);
  const raiz = useRef<HTMLDivElement>(null);

  const dados = h.data;
  const grupos = useMemo(() => (dados ? montarGrupos(dados, { tipo, tabela }) : []), [dados, tipo, tabela]);
  const contagem = useMemo(() => (dados ? contagemPorCompetencia(dados) : {}), [dados]);
  const tabelas = useMemo(() => (dados ? tabelasDoHistorico(dados) : []), [dados]);

  const comps = useMemo(() => {
    const dasSituacao = (sit.data?.competencias ?? []).map((c) => c.competencia);
    const todas = new Set([...dasSituacao, ...(dados?.competencias_com_mudanca ?? [])]);
    return [...todas].sort();
  }, [sit.data, dados]);

  if (h.isError) return <EstadoErro mensagem={h.error instanceof Error ? h.error.message : String(h.error)} aoTentar={() => void h.refetch()} />;
  if (!dados) return <Carregando rotulo="Montando o histórico" />;

  const anos = [...new Set(grupos.map((g) => g.competencia.slice(0, 4)))].sort().reverse();
  const compactar = comps.length > LIMITE_DA_TIRA;
  const abertosAgora = abertos ?? new Set(anos.slice(0, 1));
  const alternar = (ano: string, a: boolean) => setAbertos((s) => { const n = new Set(s ?? abertosAgora); if (a) n.add(ano); else n.delete(ano); return n; });

  const irPara = (c: string) => {
    const ano = c.slice(0, 4);
    if (compactar && !abertosAgora.has(ano)) alternar(ano, true);
    const indiceDoAno = anos.indexOf(ano);
    if (indiceDoAno >= anosVisiveis) setAnosVisiveis(indiceDoAno + 1);
    // O painel do ano abre no próximo quadro; a rolagem espera por ele.
    requestAnimationFrame(() => {
      const alvo = document.getElementById(`ev-${c}`);
      alvo?.scrollIntoView?.({ block: "start" });
      alvo?.querySelector<HTMLElement>("h3, h4")?.focus({ preventScroll: true });
    });
  };

  const nCom = dados.competencias_com_mudanca.length;
  const total = grupos.reduce((s, g) => s + g.cartoes.length, 0);
  let restante = limite;
  const cortado = grupos.map((g) => { const cs = g.cartoes.slice(0, Math.max(restante, 0)); restante -= cs.length; return { g, cs }; }).filter((x) => x.cs.length > 0);
  const mostrados = cortado.reduce((s, x) => s + x.cs.length, 0);
  const aviso = dados.competencias_carregadas <= 1;

  return (
    <div className="hist" ref={raiz}>
      <div className="hist__cabecalho">
        <p>Carregado em {plural(dados.competencias_carregadas, "competência", "competências")}, de {rotulo(dados.primeira_carregada)} a {rotulo(dados.ultima_carregada)}</p>
        <p className="hist__resumo">{nCom === 0 ? "Nenhuma competência com mudança" : `${plural(nCom, "competência", "competências")} com mudança`}</p>
      </div>

      {aviso && <p className="hist__aviso">Só uma competência carregada. Baixe o histórico em <Ligacao href="#/dados">Dados</Ligacao> para ver as mudanças.</p>}

      {!aviso && comps.length > 0 && <Tira comps={comps} contagem={contagem} aoEscolher={irPara} />}

      {!aviso && dados.eventos.length === 0 && <p className="hist__vazio">Sem mudanças nas competências carregadas.</p>}

      {dados.eventos.length > 0 && (
        <div className="hist__filtros">
          <div className="consultar__filtro"><GrupoOpcoes rotulo="Mostrar" opcoes={OPCOES} value={tipo} onChange={(v) => { setTipo(v as TipoDeFiltro); setLimite(BLOCO_DE_CARTOES); }} orientation="horizontal" /></div>
          {tabelas.length > 1 && (
            <Selecao
              rotulo="Tabela" itens={[{ id: "todas", rotulo: "Todas as tabelas" }, ...tabelas]}
              selectedKey={tabela || "todas"} onSelectionChange={(k) => { setTabela(k === "todas" ? "" : String(k)); setLimite(BLOCO_DE_CARTOES); }}
            />
          )}
          {compactar && anos.length > 1 && (
            <Selecao
              rotulo="Ir para" itens={anos.map((a) => ({ id: a, rotulo: a }))} selectedKey={null} placeholder="Ano"
              onSelectionChange={(k) => { const ano = String(k); const alvo = grupos.find((g) => g.competencia.startsWith(ano)); if (alvo) irPara(alvo.competencia); }}
            />
          )}
        </div>
      )}

      {dados.eventos.length > 0 && grupos.length === 0 && <p className="hist__vazio">Nada neste filtro.</p>}

      {!compactar && cortado.map(({ g, cs }) => <Competencia key={g.competencia} g={g} nivel={3} cartoes={cs} />)}

      {compactar && anos.slice(0, anosVisiveis).map((ano) => {
        const doAno = grupos.filter((g) => g.competencia.startsWith(ano));
        const cartoesDoAno = doAno.reduce((s, g) => s + g.cartoes.length, 0);
        const aberto = abertosAgora.has(ano);
        return (
          <Disclosure key={ano} isExpanded={aberto} onExpandedChange={(a) => alternar(ano, a)} className="hist__ano-bloco">
            <Heading level={2} className="hist__ano-titulo">
              <Button slot="trigger" className="exigencias__gatilho">
                <span aria-hidden="true" className="exigencias__seta">{aberto ? "▾" : "▸"}</span>
                <span className="exigencias__nome">{ano}</span>
                <span className="hist__ano-resumo">{mudancas(cartoesDoAno)} em {plural(doAno.length, "competência", "competências")}</span>
              </Button>
            </Heading>
            <DisclosurePanel>
              {aberto && cortado.filter(({ g }) => g.competencia.startsWith(ano)).map(({ g, cs }) => <Competencia key={g.competencia} g={g} nivel={4} cartoes={cs} />)}
            </DisclosurePanel>
          </Disclosure>
        );
      })}

      {compactar && anos.length > anosVisiveis && (
        <div><Botao onPress={() => setAnosVisiveis((n) => n + BLOCO_DE_ANOS)}>Mostrar mais anos</Botao></div>
      )}

      {mostrados < total && (
        <div className="hist__mais">
          <span role="status">{inteiro(mostrados)} de {inteiro(total)} mudanças</span>
          <Botao onPress={() => setLimite((n) => n + BLOCO_DE_CARTOES)}>Mostrar mais</Botao>
        </div>
      )}
    </div>
  );
}
