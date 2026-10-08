import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import type { SortDescriptor } from "react-aria-components";
import { buscarTodos } from "../../api/comandos";
import type { ItemDeApoio, ItemProcedimento } from "../../api/tipos";
import { Botao } from "../../componentes/base/Botao";
import { CampoBusca } from "../../componentes/base/CampoBusca";
import { GrupoOpcoes } from "../../componentes/base/GrupoOpcoes";
import { TabelaDeDados, type Coluna } from "../../componentes/base/TabelaDeDados";
import { Carregando, EstadoErro, EstadoVazio } from "../../componentes/dominio/Estados";
import { useSituacao } from "../../dados/consultas";
import { useBusca, useLigados } from "../../dados/consultar";
import { caminhoConsultar, ir, lerConsultar, substituir, useRota } from "../../shell/rotas";
import { Marcados } from "./Marcados";
import { MarcasDaLinha, useMapaDeMarcas, type MarcasDoItem } from "./MarcasDaLinha";
import { Exportar } from "./Exportar";
import { planilhaDeProcedimentos } from "./modelo/planilha";
import { useDebounce } from "../../shell/useDebounce";
import { inteiro, reais, rotuloCompetencia } from "../../util/formatos";
import { codigoDeApoio, idDeApoio, rotuloDaTabela } from "./modelo/apoio";
import { complexidadeCurta, instrumentosCurtos } from "./modelo/procedimento";
import "./consultar.css";

const EXEMPLOS = ["0301010072", "consulta médica", "cid I10"];
const ALTURA_LINHA = 36;

// O código aberto por último: ao voltar da ficha, o foco retorna à linha de onde se saiu.
let ultimoAberto: string | null = null;

const alturaDa = (linhas: number) => Math.min(Math.max(linhas, 1), 7) * ALTURA_LINHA + ALTURA_LINHA + 2;
const mascararForma = (f: string) => (f.length === 6 ? `${f.slice(0, 2)}.${f.slice(2, 4)}.${f.slice(4, 6)}` : f);
const plural = (n: number, um: string, varios: string) => `${inteiro(n)} ${n === 1 ? um : varios}`;

interface LinhaProcedimento extends ItemProcedimento { id: string }
const comId = (itens: ItemProcedimento[]): LinhaProcedimento[] => itens.map((i) => ({ ...i, id: i.codigo }));

const pesoDaComplexidade = (c: string) => (/b[áa]sica/i.test(c) ? 1 : /m[ée]dia/i.test(c) ? 2 : /alta/i.test(c) ? 3 : 0);

/** Colunas da lista; as marcas (favorito e anotação) entram no fim da linha. */
function colunasDe(marcas: Map<string, MarcasDoItem>): Coluna<LinhaProcedimento>[] {
  return [
    { id: "codigo", rotulo: "Código", ordenavel: true, largura: "14%", larguraMinima: 130, celula: (l) => <span className="num consultar__codigo">{l.codigo_mascarado}</span> },
    { id: "nome", rotulo: "Nome", ordenavel: true, largura: "35%", larguraMinima: 200, celula: (l) => <span title={l.nome}>{l.nome}</span> },
    { id: "complexidade", rotulo: "Complexidade", ordenavel: true, largura: "15%", larguraMinima: 120, celula: (l) => complexidadeCurta(l.complexidade ?? l.tp_complexidade) },
    { id: "valor", rotulo: "Valor total", ordenavel: true, largura: "13%", larguraMinima: 100, celula: (l) => <span className="num consultar__valor">{reais(l.valor_total_centavos)}</span> },
    { id: "instrumento", rotulo: "Instrumento", ordenavel: true, largura: "17%", larguraMinima: 120, celula: (l) => <span title={l.instrumentos.join(", ")}>{instrumentosCurtos(l.instrumentos)}</span> },
    { id: "marcas", rotulo: "Marcas", largura: "6%", larguraMinima: 64, celula: (l) => <MarcasDaLinha marcas={marcas.get(l.codigo)} /> },
  ];
}

const chaveDe = (l: LinhaProcedimento, coluna: string): string | number => {
  switch (coluna) {
    case "codigo": return l.codigo;
    case "nome": return l.nome;
    case "complexidade": return pesoDaComplexidade(complexidadeCurta(l.complexidade ?? l.tp_complexidade));
    case "valor": return l.valor_total_centavos;
    default: return instrumentosCurtos(l.instrumentos);
  }
};

function ordenar(linhas: LinhaProcedimento[], o: SortDescriptor | undefined): LinhaProcedimento[] {
  if (!o?.column) return linhas;
  const sinal = o.direction === "descending" ? -1 : 1;
  const coluna = String(o.column);
  return [...linhas].sort((x, y) => {
    const a = chaveDe(x, coluna), b = chaveDe(y, coluna);
    const c = typeof a === "number" && typeof b === "number" ? a - b : String(a).localeCompare(String(b), "pt-BR", { numeric: true });
    return sinal * c || x.codigo.localeCompare(y.codigo);
  });
}

interface LinhaApoio extends ItemDeApoio { id: string }
const COLUNAS_APOIO: Coluna<LinhaApoio>[] = [
  { id: "tabela", rotulo: "Tabela", largura: "16%", larguraMinima: 130, celula: (l) => <span className="consultar__chip">{rotuloDaTabela(l.tabela)}</span> },
  { id: "codigo", rotulo: "Código", largura: "16%", larguraMinima: 100, celula: (l) => <span className="num consultar__codigo">{codigoDeApoio(l)}</span> },
  { id: "nome", rotulo: "Nome", largura: "46%", larguraMinima: 220, celula: (l) => l.nome },
  { id: "procedimentos", rotulo: "Procedimentos", largura: "22%", larguraMinima: 130, celula: (l) => plural(l.procedimentos, "procedimento", "procedimentos") },
];

function abrir(l: { codigo: string }) {
  ultimoAberto = l.codigo;
  ir("consultar", l.codigo);
}

function TabelaDeProcedimentos({ rotulo, itens }: { rotulo: string; itens: ItemProcedimento[] }) {
  const marcas = useMapaDeMarcas("procedimento");
  const colunas = useMemo(() => colunasDe(marcas), [marcas]);
  const [ordem, setOrdem] = useState<SortDescriptor | undefined>(undefined);
  const linhas = useMemo(() => ordenar(comId(itens), ordem), [itens, ordem]);
  return <TabelaDeDados rotulo={rotulo} colunas={colunas} linhas={linhas} altura={alturaDa(itens.length)} ordenacao={ordem} aoOrdenar={setOrdem} aoAbrir={abrir} />;
}

function PorForma({ itens }: { itens: ItemProcedimento[] }) {
  const grupos = new Map<string, ItemProcedimento[]>();
  for (const i of itens) grupos.set(i.forma, [...(grupos.get(i.forma) ?? []), i]);
  return (
    <>
      {[...grupos.entries()].map(([forma, lista]) => {
        const nome = lista[0]?.forma_nome ?? "Forma sem nome nesta competência";
        return (
          <section key={forma} className="consultar__forma" aria-label={nome}>
            <h3>{mascararForma(forma)} <span className="consultar__forma-nome">{nome}</span> <span className="consultar__contagem">{lista.length}</span></h3>
            <TabelaDeProcedimentos rotulo={`Procedimentos: ${nome}`} itens={lista} />
          </section>
        );
      })}
    </>
  );
}

function Ligados({ item, aoVoltar }: { item: ItemDeApoio; aoVoltar: () => void }) {
  const q = useLigados(item);
  return (
    <section className="consultar__secao">
      <div className="consultar__cabeca">
        <h2>Procedimentos com {rotuloDaTabela(item.tabela)} {codigoDeApoio(item)}</h2>
        <Botao onPress={aoVoltar}>Voltar à busca</Botao>
      </div>
      {q.isError ? <EstadoErro mensagem={q.error instanceof Error ? q.error.message : String(q.error)} aoTentar={() => void q.refetch()} />
        : q.data ? <TabelaDeProcedimentos rotulo="Procedimentos ligados" itens={q.data} /> : <Carregando rotulo="Carregando os procedimentos" />}
    </section>
  );
}

function Exemplos({ aoEscolher }: { aoEscolher: (t: string) => void }) {
  return (
    <section className="consultar__exemplos" aria-label="Exemplos">
      <p className="consultar__rotulo">Exemplos</p>
      <div className="consultar__chips">
        {EXEMPLOS.map((e) => <Botao key={e} onPress={() => aoEscolher(e)}>{e}</Botao>)}
      </div>
    </section>
  );
}

export function Buscar() {
  const { resto } = useRota();
  const rota = lerConsultar(resto);
  const textoDaRota = rota.tela === "buscar" ? rota.texto : "";
  const [texto, setTexto] = useState(textoDaRota);
  const [visao, setVisao] = useState("lista");
  const [instrumento, setInstrumento] = useState("");
  const [apoio, setApoio] = useState<ItemDeApoio | null>(null);
  const escrito = useRef(textoDaRota);
  const resultados = useRef<HTMLDivElement>(null);
  const situacao = useSituacao();
  const busca = useBusca(textoDaRota);

  // A rota mudou por fora (Voltar): o campo acompanha.
  useEffect(() => {
    if (textoDaRota !== escrito.current) { escrito.current = textoDaRota; setTexto(textoDaRota); }
  }, [textoDaRota]);

  // Digitação: só depois da pausa o texto vai para a rota (sem empilhar histórico).
  const pausa = useDebounce(texto, 350);
  useEffect(() => {
    const t = pausa.trim();
    if (t === escrito.current) return;
    escrito.current = t;
    substituir("consultar", ...caminhoConsultar({ tela: "buscar", texto: t }));
  }, [pausa]);

  // Voltando da ficha: o foco volta à linha aberta (a lista virtualizada leva alguns quadros para montar as linhas).
  const pronto = !!busca.data && !busca.isPlaceholderData;
  useEffect(() => {
    const alvo = ultimoAberto;
    if (!pronto || !alvo) return;
    let quadro = 0, tentativas = 0;
    const procurar = () => {
      const linha = [...(resultados.current?.querySelectorAll<HTMLElement>('[role="row"]') ?? [])]
        .find((r) => r.getAttribute("data-key") === alvo);
      if (linha) { ultimoAberto = null; linha.focus(); return; }
      if (++tentativas < 30) quadro = requestAnimationFrame(procurar);
      else ultimoAberto = null;
    };
    quadro = requestAnimationFrame(procurar);
    return () => cancelAnimationFrame(quadro);
  }, [pronto]);

  const escolher = (t: string) => {
    escrito.current = t;
    setTexto(t);
    substituir("consultar", ...caminhoConsultar({ tela: "buscar", texto: t }));
  };

  const descer = (e: KeyboardEvent) => {
    if (e.key !== "ArrowDown") return;
    const primeira = resultados.current?.querySelectorAll<HTMLElement>('[role="row"]')[1];
    if (!primeira) return;
    e.preventDefault();
    primeira.focus();
  };

  if (situacao.data && situacao.data.competencias.length === 0) {
    return <EstadoVazio titulo="Carregue a Tabela SIGTAP" descricao="Sem uma competência carregada não há o que consultar." acao={{ rotulo: "Abrir Dados", aoAcionar: () => ir("dados") }} />;
  }

  const consulta = textoDaRota.trim();
  const buscando = busca.isFetching && consulta.length >= 2;
  const dados = busca.data;
  let corpo;
  if (consulta.length < 2) corpo = <><Exemplos aoEscolher={escolher} /><Marcados /></>;
  else if (busca.isError && !dados) corpo = <EstadoErro mensagem={busca.error instanceof Error ? busca.error.message : String(busca.error)} aoTentar={() => void busca.refetch()} />;
  else if (!dados) corpo = <Carregando rotulo="Buscando" />;
  else if (apoio) corpo = <Ligados item={apoio} aoVoltar={() => setApoio(null)} />;
  else if (dados.procedimentos.length === 0 && dados.apoio.length === 0) {
    corpo = (
      <section className="consultar__vazio">
        <h2>Nada encontrado para “{dados.consulta}” em {rotuloCompetencia(dados.competencia)}.</h2>
        <p>Tente o código, parte do nome ou um CID.</p>
        <Exemplos aoEscolher={escolher} />
      </section>
    );
  } else {
    const mostrados = dados.procedimentos.length;
    const porInstrumento = new Map<string, number>();
    for (const p of dados.procedimentos) for (const i of p.instrumentos) porInstrumento.set(i, (porInstrumento.get(i) ?? 0) + 1);
    const ativo = porInstrumento.has(instrumento) ? instrumento : "";
    const filtrados = ativo ? dados.procedimentos.filter((p) => p.instrumentos.includes(ativo)) : dados.procedimentos;
    corpo = (
      <div className={`consultar__resultados${busca.isPlaceholderData ? " consultar__resultados--esmaecido" : ""}`}>
        {mostrados > 0 && (
          <section className="consultar__secao">
            <div className="consultar__cabeca">
              <h2>Procedimentos</h2>
              {dados.total_procedimentos > mostrados && <p className="consultar__contagem">Mostrando {inteiro(mostrados)} de {inteiro(dados.total_procedimentos)}. Refine a busca.</p>}
              <div className="consultar__visao">
                <GrupoOpcoes rotulo="Visão" orientation="horizontal" value={visao} onChange={setVisao}
                  opcoes={[{ valor: "lista", rotulo: "Lista" }, { valor: "forma", rotulo: "Por forma" }]} />
              </div>
              <Exportar nome={`Procedimentos ${dados.consulta}`}
                montar={async () => {
                  // A tela mostra até 200; a planilha leva todos os encontrados (com o filtro de instrumento, se houver).
                  const todos = mostrados < dados.total_procedimentos ? (await buscarTodos(dados.consulta, dados.competencia)).procedimentos : dados.procedimentos;
                  return planilhaDeProcedimentos(ativo ? todos.filter((p) => p.instrumentos.includes(ativo)) : todos, `Busca: ${dados.consulta}`);
                }}
                mensagemOk={(p) => `Planilha salva com ${plural(p.abas[0]?.linhas.length ?? 0, "procedimento", "procedimentos")}.`} />
            </div>
            {porInstrumento.size > 0 && (
              <div className="consultar__filtro">
                <GrupoOpcoes rotulo="Instrumento" orientation="horizontal" value={ativo} onChange={setInstrumento}
                  opcoes={[{ valor: "", rotulo: `Todos ${inteiro(mostrados)}` }, ...[...porInstrumento].map(([i, n]) => ({ valor: i, rotulo: `${i} ${inteiro(n)}` }))]} />
              </div>
            )}
            {visao === "forma" ? <PorForma itens={filtrados} /> : <TabelaDeProcedimentos rotulo="Procedimentos" itens={filtrados} />}
          </section>
        )}
        {dados.apoio.length > 0 && (
          <section className="consultar__secao">
            <div className="consultar__cabeca"><h2>Apoio</h2></div>
            <TabelaDeDados rotulo="Apoio" colunas={COLUNAS_APOIO} linhas={[...dados.apoio].sort((x, y) => y.procedimentos - x.procedimentos).map((a) => ({ ...a, id: idDeApoio(a) }))}
              altura={alturaDa(dados.apoio.length)} aoAbrir={(l) => setApoio(l)} />
          </section>
        )}
      </div>
    );
  }

  return (
    <div className="consultar__buscar" onKeyDown={descer}>
      <div className="consultar__linha-campo">
        <div className="consultar__campo">
          <CampoBusca rotulo="Buscar" placeholder="Código, nome do procedimento ou CID" autoFocus value={texto} onChange={setTexto} />
        </div>
        {buscando && <span role="status" className="consultar__buscando">Buscando…</span>}
      </div>
      <div className="consultar__progresso" aria-hidden="true" data-ativo={buscando || undefined} />
      <div ref={resultados} aria-busy={buscando}>{corpo}</div>
    </div>
  );
}
