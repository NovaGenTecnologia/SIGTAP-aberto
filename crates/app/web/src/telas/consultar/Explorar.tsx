import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type ReactNode } from "react";
import { Botao } from "../../componentes/base/Botao";
import { GrupoOpcoes } from "../../componentes/base/GrupoOpcoes";
import { Menu } from "../../componentes/base/Menu";
import { caminhoConsultar, ir, lerConsultar, substituir, useRota } from "../../shell/rotas";
import { inteiro } from "../../util/formatos";
import { achatar, cadeiaDe, segmentoDoCaminho, type Linha, type No, type TipoDeArvore } from "./modelo/arvore";
import { MarcasDaLinha, useMapaDeMarcas } from "./MarcasDaLinha";
import { Previa } from "./Previa";
import { usarArvore } from "./usarArvore";
import "./explorar.css";

/** Detalhe sob a linha: mantém-se à vista enquanto carrega e cresce, dentro da área rolável da árvore. */
function Detalhe({ rotulo, nivel, recuo, children }: { rotulo: string; nivel: number; recuo: CSSProperties; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const mostrar = () => el.scrollIntoView?.({ block: "nearest" });
    mostrar();
    if (typeof ResizeObserver === "undefined") return;
    const o = new ResizeObserver(mostrar);
    o.observe(el);
    return () => o.disconnect();
  }, []);
  return <div ref={ref} role="treeitem" aria-level={nivel} aria-label={rotulo} className="arvc__detalhe" style={recuo}>{children}</div>;
}

const LARGURA_DA_PREVIA = "(min-width: 1100px)";
const LIMITE_DO_FILTRO = 200;
const OPCOES = [{ valor: "procedimentos", rotulo: "Procedimentos" }, { valor: "cid", rotulo: "CID" }];
const NIVEIS: Record<TipoDeArvore, { id: string; rotulo: string }[]> = {
  procedimentos: [{ id: "1", rotulo: "Até os subgrupos" }, { id: "2", rotulo: "Até as formas" }],
  cid: [{ id: "1", rotulo: "Até as categorias" }],
};

function useLarga(): boolean {
  const consulta = () => (typeof window.matchMedia === "function" ? window.matchMedia(LARGURA_DA_PREVIA) : null);
  const [larga, setLarga] = useState(() => consulta()?.matches ?? true);
  useEffect(() => {
    const mq = consulta();
    if (!mq) return;
    const aoMudar = () => setLarga(mq.matches);
    mq.addEventListener?.("change", aoMudar);
    return () => mq.removeEventListener?.("change", aoMudar);
  }, []);
  return larga;
}

function useAtraso<T>(valor: T, ms: number): T {
  const [v, setV] = useState(valor);
  useEffect(() => { const t = setTimeout(() => setV(valor), ms); return () => clearTimeout(t); }, [valor, ms]);
  return v;
}

const semAcento = (s: string) => s.toLocaleLowerCase("pt-BR").normalize("NFD").replace(/[̀-ͯ]/g, "");

function ArvoreExplorar({ tipo, noDaRota }: { tipo: TipoDeArvore; noDaRota: string | null }) {
  const arv = usarArvore(tipo);
  const larga = useLarga();
  const [selecionado, setSelecionado] = useState<string | null>(noDaRota);
  const [foco, setFoco] = useState<string | null>(noDaRota);
  const marcasDe = useMapaDeMarcas(tipo === "cid" ? "cid" : "procedimento");
  const escrito = useRef<string | null>(noDaRota);
  const paraFocar = useRef<string | null>(null);
  const refs = useRef(new Map<string, HTMLElement>());
  const digitado = useRef({ texto: "", fim: 0 });

  const acharNo = (id: string): No | null => {
    for (const e of arv.filhos.values()) if (e.estado === "ok") { const n = e.nos.find((x) => x.id === id); if (n) return n; }
    return null;
  };

  const linhas: Linha[] = achatar(arv.filhos, arv.abertos, arv.limites);
  const nos = linhas.filter((l): l is Extract<Linha, { tipo: "no" }> => l.tipo === "no");
  const noPor = (id: string): No | null => nos.find((l) => l.no.id === id)?.no ?? acharNo(id);
  const focoEfetivo = foco && nos.some((l) => l.no.id === foco) ? foco : nos[0]?.no.id ?? null;

  const selecionar = (id: string) => {
    setSelecionado(id);
    setFoco(id);
    escrito.current = id;
    substituir("consultar", ...caminhoConsultar({ tela: "arvore", arvore: tipo, no: id }));
  };
  const mover = (id: string) => { paraFocar.current = id; selecionar(id); };

  // Rota nova (Voltar da ficha, atalho colado): seleciona e abre a cadeia de pais.
  useEffect(() => {
    if (noDaRota && noDaRota !== escrito.current) { escrito.current = noDaRota; setSelecionado(noDaRota); setFoco(noDaRota); }
  }, [noDaRota]);
  const existe = selecionado ? nos.some((l) => l.no.id === selecionado) : false;
  // Só abre a cadeia quando o item escolhido não está à vista: assim fechar um nó à mão não é desfeito.
  useEffect(() => { if (selecionado && !existe) void arv.revelar(selecionado); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [arv.revelar, selecionado]);

  // O foco do teclado vai para a linha escolhida depois que ela existe na tela.
  useEffect(() => {
    const id = paraFocar.current;
    const el = id ? refs.current.get(id) : null;
    if (el) { el.focus(); paraFocar.current = null; }
  });
  useEffect(() => { if (selecionado && existe) refs.current.get(selecionado)?.scrollIntoView?.({ block: "nearest" }); }, [selecionado, existe]);

  const alternar = (l: Extract<Linha, { tipo: "no" }>) => {
    if (!l.expansivel) return;
    if (l.aberto) arv.fechar(l.no.id); else arv.abrir(l.no.id);
  };
  const ativar = (l: Extract<Linha, { tipo: "no" }>) => {
    if (!l.no.folha) { alternar(l); return; }
    if (tipo === "cid") ir("consultar", "q", encodeURIComponent(l.no.mascarado));
    else ir("consultar", l.no.id);
  };

  const aoTeclar = (e: KeyboardEvent<HTMLDivElement>) => {
    const alvo = (e.target as HTMLElement).closest<HTMLElement>('[role="treeitem"]');
    if (!alvo || e.ctrlKey || e.metaKey || e.altKey) return;
    const i = nos.findIndex((l) => l.no.id === alvo.dataset["id"]);
    if (i < 0) return;
    const atual = nos[i]!;
    const ir_ = (k: number) => { const n = nos[Math.max(0, Math.min(nos.length - 1, k))]; if (n) mover(n.no.id); };
    let tratada = true;
    switch (e.key) {
      case "ArrowDown": ir_(i + 1); break;
      case "ArrowUp": ir_(i - 1); break;
      case "Home": ir_(0); break;
      case "End": ir_(nos.length - 1); break;
      case "ArrowRight":
        if (atual.expansivel && !atual.aberto) arv.abrir(atual.no.id);
        else if (atual.aberto && nos[i + 1]?.no.pai === atual.no.id) ir_(i + 1);
        break;
      case "ArrowLeft":
        if (atual.aberto) arv.fechar(atual.no.id);
        else if (atual.no.pai !== null && nos.some((l) => l.no.id === atual.no.pai)) mover(atual.no.pai);
        break;
      case "Enter": ativar(atual); break;
      case "*":
        arv.abrirVarios(nos.filter((l) => l.no.pai === atual.no.pai && l.expansivel).map((l) => l.no.id));
        break;
      default: {
        if (e.key.length !== 1 || e.key === " ") { tratada = false; break; }
        const agora = Date.now();
        const buffer = (agora - digitado.current.fim < 700 ? digitado.current.texto : "") + semAcento(e.key);
        digitado.current = { texto: buffer, fim: agora };
        const chave = (l: Extract<Linha, { tipo: "no" }>) => semAcento(`${l.no.mascarado.replace(/[.-]/g, "")} ${l.no.nome ?? ""}`);
        const inicio = buffer.length > 1 ? i : i + 1;
        for (let k = 0; k < nos.length; k++) {
          const cand = nos[(inicio + k) % nos.length]!;
          if (chave(cand).startsWith(buffer)) { mover(cand.no.id); break; }
        }
      }
    }
    if (tratada) e.preventDefault();
  };

  const caminho = (selecionado ? cadeiaDe(tipo, selecionado) : []).map(noPor).filter((n): n is No => n !== null);
  const noPrevia = useAtraso(selecionado, 150);
  const pronta = noPrevia && noPrevia === selecionado ? noPor(noPrevia) : null;
  // Ao andar pelas setas a prévia anterior fica até a nova estar pronta: sem piscar nem mexer a coluna.
  const ultima = useRef<No | null>(null);
  if (pronta) ultima.current = pronta;
  if (!selecionado) ultima.current = null;
  const previa = pronta ?? ultima.current;

  const renderNo = (l: Extract<Linha, { tipo: "no" }>) => {
    const { no } = l;
    const sel = no.id === selecionado;
    const marcas = marcasDe.get(no.id);
    const marcada = [marcas?.favorito && "favorito", marcas?.anotacao && "com anotação"].filter(Boolean).join(", ");
    return (
      <div
        key={no.id} role="treeitem" data-id={no.id} aria-label={`${no.mascarado} ${no.nome ?? "sem nome nesta competência"}${no.contagem !== null ? `, ${inteiro(no.contagem)} ${no.contagem === 1 ? "procedimento" : "procedimentos"}` : ""}${marcada ? `, ${marcada}` : ""}`} aria-level={l.profundidade + 1}
        aria-expanded={l.expansivel ? l.aberto : undefined} aria-selected={sel}
        tabIndex={no.id === focoEfetivo ? 0 : -1}
        ref={(el) => { if (el) refs.current.set(no.id, el); else refs.current.delete(no.id); }}
        className={`arvc__linha${no.folha ? " arvc__linha--folha" : " arvc__linha--pai"}${sel ? " arvc__linha--sel" : ""}`}
        style={{ "--n": l.profundidade } as CSSProperties}
        onClick={() => { selecionar(no.id); if (l.expansivel && !l.aberto) alternar(l); }}
      >
        <span className="arvc__seta" aria-hidden="true" onClick={(e) => { e.stopPropagation(); selecionar(no.id); alternar(l); }}>{l.expansivel ? (l.aberto ? "▾" : "▸") : no.folha ? "•" : ""}</span>
        <span className="arvc__codigo num" style={{ "--larg": `${no.mascarado.length}ch` } as CSSProperties}>{no.mascarado}</span>
        <span className={no.nome ? "arvc__nome" : "arvc__nome arvc__nome--falta"}>{no.nome ?? "sem nome nesta competência"}</span>
        <MarcasDaLinha marcas={marcas} />
        {no.contagem !== null && <span className="arvc__contagem num">{inteiro(no.contagem)}</span>}
      </div>
    );
  };

  const renderLinha = (l: Linha, i: number) => {
    const recuo = { "--n": l.profundidade } as CSSProperties;
    if (l.tipo === "no") {
      return (
        <div key={l.no.id} className="arvc__bloco">
          {renderNo(l)}
          {!larga && l.no.id === selecionado && l.no.folha && previa?.id === l.no.id && (
            <Detalhe rotulo={`Detalhes de ${l.no.mascarado}`} nivel={l.profundidade + 1} recuo={recuo}><Previa tipo={tipo} no={l.no} compacta /></Detalhe>
          )}
        </div>
      );
    }
    if (l.tipo === "carregando") return <div key={`c-${l.pai}-${i}`} role="treeitem" aria-level={l.profundidade + 1} aria-label="Carregando" className="arvc__espera arvc__espera--esq" style={recuo}>{l.profundidade === 0 ? [0, 1, 2, 3, 4, 5].map((k) => <span key={k} className="esqueleto" style={{ width: `${62 - k * 7}%` }} />) : <span className="esqueleto" style={{ width: "40%" }} />}</div>;
    if (l.tipo === "erro") {
      return (
        <div key={`e-${l.pai}`} role="treeitem" aria-level={l.profundidade + 1} aria-label="Erro" className="arvc__espera arvc__espera--erro" style={recuo}>
          <span>{l.mensagem}</span><Botao variante="secundario" onPress={() => arv.tentarDeNovo(l.pai)}>Tentar de novo</Botao>
        </div>
      );
    }
    return (
      <div key={`m-${l.pai}`} role="treeitem" aria-level={l.profundidade + 1} aria-label="Mais itens" className="arvc__espera" style={recuo}>
        <Botao variante="discreto" onPress={() => arv.maisFilhos(l.pai, LIMITE_DO_FILTRO)}>Mostrar mais {inteiro(l.restantes)}</Botao>
      </div>
    );
  };

  return (
    <div className={larga ? "explorar__corpo explorar__corpo--larga" : "explorar__corpo"}>
      <div className="explorar__arvore">
        <div className="explorar__ferramentas">
          <div className="explorar__acoes">
            <Botao onPress={arv.recolher}>Recolher tudo</Botao>
            <Menu rotulo="Abrir nível" itens={NIVEIS[tipo]} aoEscolher={(id) => void arv.abrirAte(Number(id))}>Abrir nível</Menu>
          </div>
        </div>
        <div className="arvc">
          {caminho.length > 0 && (
            <nav className="arvc__caminho" aria-label="Caminho na árvore">
              {caminho.map((n, i) => (
                <span key={n.id} className="arvc__trecho">
                  {i > 0 && <span aria-hidden="true" className="arvc__sep">›</span>}
                  <button type="button" className="arvc__passo" onClick={() => mover(n.id)}>{segmentoDoCaminho(tipo, n)}</button>
                </span>
              ))}
            </nav>
          )}
          <div role="tree" aria-label={tipo === "cid" ? "CID" : "Procedimentos"} onKeyDown={aoTeclar} className="arvc__arvore">
            {linhas.map(renderLinha)}
          </div>
        </div>
      </div>
      {larga && previa && (
        <aside className="previa" aria-label="Prévia"><Previa tipo={tipo} no={previa} /></aside>
      )}
    </div>
  );
}

export function Explorar() {
  const { resto } = useRota();
  const rota = lerConsultar(resto);
  const tipo: TipoDeArvore = rota.tela === "arvore" ? rota.arvore : "procedimentos";
  const no = rota.tela === "arvore" ? rota.no : null;
  return (
    <div className="explorar">
      <div className="explorar__tipo consultar__filtro">
        <GrupoOpcoes rotulo="Árvore" opcoes={OPCOES} value={tipo} orientation="horizontal"
          onChange={(v) => ir("consultar", ...caminhoConsultar({ tela: "arvore", arvore: v === "cid" ? "cid" : "procedimentos", no: null }))} />
      </div>
      <ArvoreExplorar key={tipo} tipo={tipo} noDaRota={no} />
    </div>
  );
}
