import { useEffect, useId, useRef, useState } from "react";
import { Dialog, Heading, Modal, ModalOverlay } from "react-aria-components";
import type { Faceta, Facetas } from "../../api/tipos";
import { Botao } from "../../componentes/base/Botao";
import { CaixaMarcacao } from "../../componentes/base/CaixaMarcacao";
import { Interruptor } from "../../componentes/base/Interruptor";
import type { FiltrosNaRota } from "../../shell/rotas";
import { inteiro } from "../../util/formatos";
import { rotuloDaTabela } from "./modelo/apoio";
import { complexidadeCurta } from "./modelo/procedimento";

type GrupoDeLista = "tipo" | "complexidade" | "instrumento" | "grupo" | "forma";

const mascararForma = (f: string) => (f.length === 6 ? `${f.slice(0, 2)}.${f.slice(2, 4)}.${f.slice(4, 6)}` : f);

/** Texto de uma opção na lista de filtros. */
function rotuloDaOpcao(grupo: GrupoDeLista, f: Faceta): string {
  switch (grupo) {
    case "tipo": return f.rotulo ?? rotuloDaTabela(f.valor);
    case "complexidade": return complexidadeCurta(f.rotulo ?? f.valor);
    case "grupo": return f.rotulo ? `${f.valor} ${f.rotulo}` : f.valor;
    case "forma": return f.rotulo ? `${mascararForma(f.valor)} ${f.rotulo}` : mascararForma(f.valor);
    default: return f.rotulo ?? f.valor;
  }
}

/** Texto do chip de uma opção marcada: o nome sem o código (o valor, se a opção não existe mais nas contagens). */
function rotuloDoChip(grupo: GrupoDeLista, valor: string, facetas: Facetas): string {
  const f = facetas[grupo].find((x) => x.valor === valor);
  if (!f) return grupo === "tipo" ? rotuloDaTabela(valor) : valor;
  if (grupo === "complexidade") return complexidadeCurta(f.rotulo ?? f.valor);
  if (grupo === "tipo") return f.rotulo ?? rotuloDaTabela(f.valor);
  return f.rotulo ?? f.valor;
}

const TITULOS: Record<GrupoDeLista, string> = {
  tipo: "Tipo", complexidade: "Complexidade", instrumento: "Instrumento", grupo: "Grupo", forma: "Forma de organização",
};

export const quantosFiltros = (f: FiltrosNaRota): number =>
  f.tipo.length + f.complexidade.length + f.instrumento.length + f.grupo.length + f.forma.length + (f.fav ? 1 : 0);

const trocar = (lista: string[], valor: string, marcado: boolean): string[] =>
  marcado ? (lista.includes(valor) ? lista : [...lista, valor]) : lista.filter((v) => v !== valor);

function Opcoes({ grupo, facetas, filtros, aoMudar }: { grupo: GrupoDeLista; facetas: Facetas; filtros: FiltrosNaRota; aoMudar: (f: FiltrosNaRota) => void }) {
  return (
    <ul className="filtros__opcoes">
      {facetas[grupo].map((f) => {
        const rotulo = rotuloDaOpcao(grupo, f);
        const destaque = grupo === "complexidade" && /m[ée]dia/i.test(rotulo);
        return (
          <li key={f.valor}>
            <CaixaMarcacao isSelected={filtros[grupo].includes(f.valor)} onChange={(m) => aoMudar({ ...filtros, [grupo]: trocar(filtros[grupo], f.valor, m) })}>
              <span className={destaque ? "filtros__rotulo filtros__rotulo--destaque" : "filtros__rotulo"}>{rotulo}</span>{" "}
              <span className="num filtros__n">{inteiro(f.n)}</span>
            </CaixaMarcacao>
          </li>
        );
      })}
    </ul>
  );
}

/** Grupo de opções que abre e fecha (Grupo e Forma têm muitas); começa aberto se há opção marcada. */
function Recolhivel({ grupo, facetas, filtros, aoMudar }: { grupo: "grupo" | "forma"; facetas: Facetas; filtros: FiltrosNaRota; aoMudar: (f: FiltrosNaRota) => void }) {
  const [aberto, setAberto] = useState(filtros[grupo].length > 0);
  const id = useId();
  if (facetas[grupo].length === 0 && filtros[grupo].length === 0) return null;
  return (
    <div className="filtros__grupo" role="group" aria-labelledby={`${id}-t`}>
      <button type="button" id={`${id}-t`} className="filtros__titulo filtros__titulo--botao" aria-expanded={aberto} aria-controls={`${id}-c`}
        onClick={() => setAberto((a) => !a)}>
        <span>{TITULOS[grupo]}</span>
        {filtros[grupo].length > 0 && <span className="num filtros__selecionados">{filtros[grupo].length}</span>}
        <span className="filtros__seta" aria-hidden="true">{aberto ? "▾" : "▸"}</span>
      </button>
      {aberto && <div id={`${id}-c`} className="filtros__conteudo"><Opcoes grupo={grupo} facetas={facetas} filtros={filtros} aoMudar={aoMudar} /></div>}
    </div>
  );
}

function Fixo({ grupo, facetas, filtros, aoMudar }: { grupo: "tipo" | "complexidade" | "instrumento"; facetas: Facetas; filtros: FiltrosNaRota; aoMudar: (f: FiltrosNaRota) => void }) {
  const id = useId();
  if (facetas[grupo].length === 0) return null;
  return (
    <div className="filtros__grupo" role="group" aria-labelledby={id}>
      <p id={id} className="filtros__titulo">{TITULOS[grupo]}</p>
      <Opcoes grupo={grupo} facetas={facetas} filtros={filtros} aoMudar={aoMudar} />
    </div>
  );
}

interface GruposProps { facetas: Facetas; filtros: FiltrosNaRota; aoMudar: (f: FiltrosNaRota) => void; favoritosDisponiveis: boolean }

function Grupos({ facetas, filtros, aoMudar, favoritosDisponiveis }: GruposProps) {
  return (
    <>
      <Fixo grupo="tipo" facetas={facetas} filtros={filtros} aoMudar={aoMudar} />
      <Fixo grupo="complexidade" facetas={facetas} filtros={filtros} aoMudar={aoMudar} />
      <Fixo grupo="instrumento" facetas={facetas} filtros={filtros} aoMudar={aoMudar} />
      <Recolhivel grupo="grupo" facetas={facetas} filtros={filtros} aoMudar={aoMudar} />
      <Recolhivel grupo="forma" facetas={facetas} filtros={filtros} aoMudar={aoMudar} />
      {favoritosDisponiveis && (
        <div className="filtros__grupo filtros__favoritos">
          <Interruptor isSelected={filtros.fav} onChange={(fav) => aoMudar({ ...filtros, fav })}>Só favoritos</Interruptor>
        </div>
      )}
    </>
  );
}

export interface FiltrosDaBuscaProps extends GruposProps {
  /** Procedimentos que passam nos filtros, para o botão "Ver N resultados" do painel. */
  total: number;
  /** Zera os filtros (padrão: troca por filtros vazios). */
  aoLimpar?: () => void;
}

const VAZIOS: FiltrosNaRota = { tipo: [], complexidade: [], instrumento: [], grupo: [], forma: [], fav: false };

/**
 * Filtros da busca. Em tela larga é uma coluna à esquerda; abaixo de 900 px (container query da página)
 * a coluna some e o botão "Filtros N" abre o mesmo conteúdo num painel lateral.
 */
export function FiltrosDaBusca({ facetas, filtros, aoMudar, favoritosDisponiveis, total, aoLimpar }: FiltrosDaBuscaProps) {
  const [painel, setPainel] = useState(false);
  const botao = useRef<HTMLButtonElement>(null);
  const jaAbriu = useRef(false);
  // Ao fechar o painel (Esc, Ver N resultados, clique fora) o foco volta ao botão que o abriu.
  useEffect(() => {
    if (painel) jaAbriu.current = true;
    else if (jaAbriu.current) botao.current?.focus();
  }, [painel]);
  const n = quantosFiltros(filtros);
  const limpar = () => (aoLimpar ? aoLimpar() : aoMudar(VAZIOS));
  return (
    <>
      <button ref={botao} type="button" className="botao botao--secundario filtros__botao" aria-haspopup="dialog" onClick={() => setPainel(true)}>
        {n > 0 ? `Filtros ${n}` : "Filtros"}
      </button>
      <aside className="filtros" aria-label="Filtros da busca">
        {n > 0 && (
          <div className="filtros__cabeca">
            <button type="button" className="filtros__limpar" onClick={limpar}>{`Limpar (${n})`}</button>
          </div>
        )}
        <Grupos facetas={facetas} filtros={filtros} aoMudar={aoMudar} favoritosDisponiveis={favoritosDisponiveis} />
      </aside>
      <ModalOverlay isOpen={painel} onOpenChange={setPainel} isDismissable className="filtros-painel__fundo">
        <Modal className="filtros-painel">
          <Dialog aria-label="Filtros" className="filtros-painel__corpo">
            <Heading slot="title" className="filtros-painel__titulo">Filtros</Heading>
            <div className="filtros-painel__conteudo">
              <Grupos facetas={facetas} filtros={filtros} aoMudar={aoMudar} favoritosDisponiveis={favoritosDisponiveis} />
            </div>
            <div className="filtros-painel__acoes">
              <Botao variante="secundario" onPress={limpar}>Limpar</Botao>
              <Botao variante="primario" onPress={() => setPainel(false)}>{`Ver ${inteiro(total)} resultados`}</Botao>
            </div>
          </Dialog>
        </Modal>
      </ModalOverlay>
    </>
  );
}

export interface ChipsDeFiltroProps {
  facetas: Facetas;
  filtros: FiltrosNaRota;
  /** `grupo` é a lista de onde sair; `"fav"` (com valor vazio) desliga Só favoritos. */
  aoRemover: (grupo: GrupoDeLista | "fav", valor: string) => void;
  aoLimparTudo: () => void;
}

/** Uma etiqueta por opção marcada, com × para tirar só ela, e "Limpar filtros". */
export function ChipsDeFiltro({ facetas, filtros, aoRemover, aoLimparTudo }: ChipsDeFiltroProps) {
  if (quantosFiltros(filtros) === 0) return null;
  const grupos: GrupoDeLista[] = ["tipo", "complexidade", "instrumento", "grupo", "forma"];
  return (
    <div className="chips-filtro" role="group" aria-label="Filtros aplicados">
      {grupos.flatMap((g) => filtros[g].map((valor) => {
        const rotulo = rotuloDoChip(g, valor, facetas);
        return (
          <button key={`${g}:${valor}`} type="button" className="chips-filtro__chip" aria-label={`Remover filtro ${rotulo}`} onClick={() => aoRemover(g, valor)}>
            {rotulo} <span aria-hidden="true">×</span>
          </button>
        );
      }))}
      {filtros.fav && (
        <button type="button" className="chips-filtro__chip" aria-label="Remover filtro Só favoritos" onClick={() => aoRemover("fav", "")}>
          Só favoritos <span aria-hidden="true">×</span>
        </button>
      )}
      <button type="button" className="chips-filtro__limpar" onClick={aoLimparTudo}>Limpar filtros</button>
    </div>
  );
}
