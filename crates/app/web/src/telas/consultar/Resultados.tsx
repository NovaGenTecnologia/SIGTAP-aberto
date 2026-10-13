import { useEffect, useMemo, useRef, useState } from "react";
import type { SortDescriptor } from "react-aria-components";
import { buscarExportar } from "../../api/comandos";
import type { BuscaPaginada, ItemDeApoio, ItemProcedimento } from "../../api/tipos";
import { Botao } from "../../componentes/base/Botao";
import { GrupoOpcoes } from "../../componentes/base/GrupoOpcoes";
import { TabelaDeDados, type Coluna } from "../../componentes/base/TabelaDeDados";
import { Carregando, EstadoErro } from "../../componentes/dominio/Estados";
import { useBuscaPaginada, useLigados } from "../../dados/consultar";
import { useMarcados } from "../../dados/marcados";
import { FILTROS_NA_ROTA_VAZIOS, type FiltrosNaRota } from "../../shell/rotas";
import { inteiro, reais, rotuloCompetencia } from "../../util/formatos";
import { ApoioRecolhido } from "./ApoioRecolhido";
import { ChipsDeFiltro, FiltrosDaBusca } from "./FiltrosDaBusca";
import { Exportar } from "./Exportar";
import { MarcasDaLinha, useMapaDeMarcas, type MarcasDoItem } from "./MarcasDaLinha";
import { codigoDeApoio, idDeApoio, rotuloDaTabela } from "./modelo/apoio";
import { paraFiltrosDaBusca } from "./modelo/filtros";
import { planilhaDeProcedimentos } from "./modelo/planilha";
import { complexidadeCurta, instrumentosCurtos } from "./modelo/procedimento";
import { Paginacao } from "./Paginacao";

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
    { id: "codigo", rotulo: "Código", ordenavel: true, largura: "16%", larguraMinima: 150, celula: (l) => <span className="num consultar__codigo">{l.codigo_mascarado}</span> },
    {
      id: "nome", rotulo: "Nome", ordenavel: true, largura: "30%", larguraMinima: 200,
      celula: (l) => (
        <>
          <span title={l.nome}>{l.nome}</span>
          {l.na_descricao && <span className="consultar__chip consultar__chip--descricao" title="Achado no texto da descrição oficial, não no nome">na descrição</span>}
        </>
      ),
    },
    { id: "complexidade", rotulo: "Complexidade", ordenavel: true, largura: "15%", larguraMinima: 120, celula: (l) => complexidadeCurta(l.complexidade ?? l.tp_complexidade) },
    { id: "valor", rotulo: "Valor total", ordenavel: true, largura: "13%", larguraMinima: 100, celula: (l) => <span className="num consultar__valor">{reais(l.valor_total_centavos)}</span> },
    { id: "instrumento", rotulo: "Instrumento", ordenavel: true, largura: "17%", larguraMinima: 120, celula: (l) => <span title={l.instrumentos.join(", ")}>{instrumentosCurtos(l.instrumentos)}</span> },
    { id: "marcas", rotulo: "Marcas", largura: "7%", larguraMinima: 72, celula: (l) => <MarcasDaLinha marcas={marcas.get(l.codigo)} /> },
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

interface TabelaProps { rotulo: string; itens: ItemProcedimento[]; aoAbrir: (codigo: string) => void; altura?: number | string }

function TabelaDeProcedimentos({ rotulo, itens, aoAbrir, altura }: TabelaProps) {
  const marcas = useMapaDeMarcas("procedimento");
  const colunas = useMemo(() => colunasDe(marcas), [marcas]);
  const [ordem, setOrdem] = useState<SortDescriptor | undefined>(undefined);
  const linhas = useMemo(() => ordenar(comId(itens), ordem), [itens, ordem]);
  return (
    <TabelaDeDados rotulo={rotulo} colunas={colunas} linhas={linhas} altura={altura ?? alturaDa(itens.length)} ordenacao={ordem} aoOrdenar={setOrdem}
      aoAbrir={(l) => { ultimoAberto = l.codigo; aoAbrir(l.codigo); }} />
  );
}

/** A página dividida em seções (forma ou grupo), cada uma com a sua tabela. */
function Agrupada({ itens, chave, titulo, aoAbrir }: {
  itens: ItemProcedimento[]; chave: (i: ItemProcedimento) => string;
  titulo: (chave: string, lista: ItemProcedimento[]) => { codigo: string; nome: string }; aoAbrir: (codigo: string) => void;
}) {
  const grupos = new Map<string, ItemProcedimento[]>();
  for (const i of itens) grupos.set(chave(i), [...(grupos.get(chave(i)) ?? []), i]);
  return (
    <>
      {[...grupos.entries()].map(([k, lista]) => {
        const { codigo, nome } = titulo(k, lista);
        return (
          <section key={k} className="consultar__forma" aria-label={nome}>
            <h3>{codigo} <span className="consultar__forma-nome">{nome}</span> <span className="consultar__contagem">{lista.length}</span></h3>
            <TabelaDeProcedimentos rotulo={`Procedimentos: ${nome}`} itens={lista} aoAbrir={aoAbrir} />
          </section>
        );
      })}
    </>
  );
}

function Ligados({ item, aoVoltar, aoAbrir }: { item: ItemDeApoio; aoVoltar: () => void; aoAbrir: (codigo: string) => void }) {
  const q = useLigados(item);
  return (
    <section className="consultar__secao">
      <div className="consultar__cabeca">
        <h2>Procedimentos com {rotuloDaTabela(item.tabela)} {codigoDeApoio(item)}</h2>
        <Botao onPress={aoVoltar}>Voltar à busca</Botao>
      </div>
      {q.isError ? <EstadoErro mensagem={q.error instanceof Error ? q.error.message : String(q.error)} aoTentar={() => void q.refetch()} />
        : q.data ? <TabelaDeProcedimentos rotulo="Procedimentos ligados" itens={q.data} aoAbrir={aoAbrir} /> : <Carregando rotulo="Carregando os procedimentos" />}
    </section>
  );
}

const mensagemDe = (e: unknown) => (e instanceof Error ? e.message : String(e));

export interface ResultadosProps {
  texto: string;
  filtros: FiltrosNaRota;
  /** Página atual, a partir de 1. */
  pagina: number;
  aoMudarFiltros: (f: FiltrosNaRota) => void;
  aoIrParaPagina: (pagina: number) => void;
  /** Abre a ficha de um procedimento (quem chama guarda a pesquisa nas recentes). */
  aoAbrir: (codigo: string) => void;
}

/** O resultado da busca: filtros à esquerda, chips, lista paginada (100 por página), apoio recolhido e paginação. */
export function Resultados({ texto, filtros, pagina, aoMudarFiltros, aoIrParaPagina, aoAbrir }: ResultadosProps) {
  const [visao, setVisao] = useState("lista");
  const [apoio, setApoio] = useState<ItemDeApoio | null>(null);
  const corpo = useRef<HTMLDivElement>(null);
  const marcados = useMarcados("procedimento").data;
  const favoritos = useMemo(() => (marcados ?? []).filter((i) => i.favorito).map((i) => i.codigo), [marcados]);
  const doBackend = useMemo(() => paraFiltrosDaBusca(filtros, favoritos), [filtros, favoritos]);
  const busca = useBuscaPaginada(texto, doBackend, pagina);
  const dados = busca.data;

  // Voltando da ficha: o foco volta à linha aberta (a lista virtualizada leva alguns quadros para montar as linhas).
  const pronto = !!dados && !busca.isPlaceholderData;
  useEffect(() => {
    const alvo = ultimoAberto;
    if (!pronto || !alvo) return;
    let quadro = 0, tentativas = 0;
    const procurar = () => {
      const linha = [...(corpo.current?.querySelectorAll<HTMLElement>('[role="row"]') ?? [])].find((r) => r.getAttribute("data-key") === alvo);
      if (linha) { ultimoAberto = null; linha.focus(); return; }
      if (++tentativas < 30) quadro = requestAnimationFrame(procurar);
      else ultimoAberto = null;
    };
    quadro = requestAnimationFrame(procurar);
    return () => cancelAnimationFrame(quadro);
  }, [pronto]);

  // Outra busca: sai da lista dos procedimentos ligados a um item de apoio.
  useEffect(() => { setApoio(null); }, [texto]);

  // Página nova: a lista volta ao topo.
  useEffect(() => { corpo.current?.scrollTo?.({ top: 0 }); }, [pagina]);

  const buscando = busca.isFetching;
  if (busca.isError && !dados) return <EstadoErro mensagem={mensagemDe(busca.error)} aoTentar={() => void busca.refetch()} />;
  if (!dados) return <Carregando rotulo="Buscando" />;

  const limparTudo = () => aoMudarFiltros(FILTROS_NA_ROTA_VAZIOS);
  const removerChip = (grupo: "tipo" | "complexidade" | "instrumento" | "grupo" | "forma" | "fav", valor: string) =>
    aoMudarFiltros(grupo === "fav" ? { ...filtros, fav: false } : { ...filtros, [grupo]: filtros[grupo].filter((v) => v !== valor) });
  const comFiltro = filtros.tipo.length + filtros.complexidade.length + filtros.instrumento.length + filtros.grupo.length + filtros.forma.length > 0 || filtros.fav;
  const incluiProcedimentos = filtros.tipo.length === 0 || filtros.tipo.includes("procedimento");

  const cabecalho = (
    <div className="consultar__cabeca">
      <h2>Procedimentos</h2>
      <span className="consultar__contagem">
        {dados.total_filtrado === dados.total ? plural(dados.total, "procedimento", "procedimentos") : `${inteiro(dados.total_filtrado)} de ${plural(dados.total, "procedimento", "procedimentos")}`}
      </span>
      {buscando && <span role="status" className="consultar__buscando">Buscando…</span>}
      <div className="consultar__visao">
        <GrupoOpcoes rotulo="Visão" orientation="horizontal" value={visao} onChange={setVisao}
          opcoes={[{ valor: "lista", rotulo: "Lista" }, { valor: "forma", rotulo: "Por forma" }, { valor: "grupo", rotulo: "Por grupo" }]} />
      </div>
      <Exportar nome={`Procedimentos ${dados.consulta}`}
        montar={async () => {
          // A tela mostra uma página; a planilha leva todos os que passam nos filtros.
          const todos = dados.paginas > 1 ? (await buscarExportar(dados.consulta, doBackend, dados.competencia)).procedimentos : dados.procedimentos;
          return planilhaDeProcedimentos(todos, `Busca: ${dados.consulta}`);
        }}
        mensagemOk={(p) => `Planilha salva com ${plural(p.abas[0]?.linhas.length ?? 0, "procedimento", "procedimentos")}.`} />
    </div>
  );

  let lista;
  if (dados.procedimentos.length === 0) lista = null;
  else if (visao === "forma") {
    lista = <Agrupada itens={dados.procedimentos} chave={(i) => i.forma} aoAbrir={aoAbrir}
      titulo={(k, l) => ({ codigo: mascararForma(k), nome: l[0]?.forma_nome ?? "Forma sem nome nesta competência" })} />;
  } else if (visao === "grupo") {
    const nomes = new Map(dados.facetas.grupo.map((g) => [g.valor, g.rotulo]));
    lista = <Agrupada itens={dados.procedimentos} chave={(i) => i.codigo.slice(0, 2)} aoAbrir={aoAbrir}
      titulo={(k) => ({ codigo: k, nome: nomes.get(k) ?? "Grupo sem nome nesta competência" })} />;
  } else {
    lista = <TabelaDeProcedimentos rotulo="Procedimentos" itens={dados.procedimentos} aoAbrir={aoAbrir} altura="100%" />;
  }

  let centro;
  if (apoio) {
    centro = <Ligados item={apoio} aoVoltar={() => setApoio(null)} aoAbrir={aoAbrir} />;
  } else if (dados.total === 0 && dados.apoio.length === 0) {
    centro = (
      <section className="consultar__vazio">
        <h2>Nada encontrado para “{dados.consulta}” em {rotuloCompetencia(dados.competencia)}.</h2>
        <p>Tente o código, parte do nome ou um CID.</p>
      </section>
    );
  } else {
    centro = (
      <>
        <ApoioRecolhido itens={[...dados.apoio].sort((x, y) => y.procedimentos - x.procedimentos)} inicialmenteAberto={dados.procedimentos.length === 0}>
          <TabelaDeDados rotulo="Apoio" colunas={COLUNAS_APOIO} linhas={[...dados.apoio].sort((x, y) => y.procedimentos - x.procedimentos).map((a) => ({ ...a, id: idDeApoio(a) }))}
            altura={alturaDa(dados.apoio.length)} aoAbrir={(l) => setApoio(l)} />
        </ApoioRecolhido>
        {incluiProcedimentos && dados.total > 0 && (
          <section className="consultar__secao resultados__lista">
            {cabecalho}
            {dados.total_filtrado === 0 ? (
              <div className="consultar__vazio">
                <p>Nenhum procedimento com estes filtros.</p>
                {comFiltro && <Botao onPress={limparTudo}>Limpar filtros</Botao>}
              </div>
            ) : (
              <>
                <div className="resultados__tabela" ref={corpo} data-principal>{lista}</div>
                <Paginacao pagina={dados.pagina} paginas={dados.paginas} total={dados.total_filtrado} aoIr={aoIrParaPagina} />
              </>
            )}
          </section>
        )}
      </>
    );
  }

  // Nada achado (nem apoio) e sem filtro aplicado: não há o que filtrar.
  if (dados.total === 0 && dados.apoio.length === 0 && !comFiltro) return <div className="resultados__principal">{centro}</div>;

  return (
    <div className="resultados">
      <FiltrosDaBusca facetas={dados.facetas} filtros={filtros} aoMudar={aoMudarFiltros} favoritosDisponiveis={favoritos.length > 0 || filtros.fav}
        total={dados.total_filtrado} aoLimpar={limparTudo} />
      <div className={`resultados__principal${busca.isPlaceholderData ? " consultar__resultados--esmaecido" : ""}`} aria-busy={buscando}>
        <ChipsDeFiltro facetas={dados.facetas} filtros={filtros} aoRemover={removerChip} aoLimparTudo={limparTudo} />
        {centro}
      </div>
    </div>
  );
}
