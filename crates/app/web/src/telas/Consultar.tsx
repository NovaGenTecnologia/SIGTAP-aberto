import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { EstadoVazio } from "../componentes/dominio/Estados";
import { useSituacao } from "../dados/consultas";
import { usePesquisasRecentes } from "../dados/pesquisasRecentes";
import { FILTROS_NA_ROTA_VAZIOS, caminhoConsultar, ir, lerConsultar, substituir, useRota, type FiltrosNaRota, type TelaConsultar } from "../shell/rotas";
import { useDebounce } from "../shell/useDebounce";
import { CampoDeConsulta } from "./consultar/CampoDeConsulta";
import { Explorar } from "./consultar/Explorar";
import { Ficha } from "./consultar/Ficha";
import { Resultados } from "./consultar/Resultados";
import "./consultar/consultar.css";

/** Menor texto que vira busca; abaixo disso a tela segue na árvore. */
const MINIMO_DE_CARACTERES = 2;

const resultadosDe = (texto: string, filtros: FiltrosNaRota, pagina: number) => caminhoConsultar({ tela: "resultados", texto, filtros, pagina });

/**
 * Consultar: um campo só. Vazio, a tela é a árvore (Explorar) com a prévia; com 2 caracteres ou mais, ela passa a ser
 * os resultados (filtros à esquerda, lista de 100 por página). Texto, filtros e página moram na rota.
 */
function Pesquisa({ rota }: { rota: Exclude<TelaConsultar, { tela: "ficha" }> }) {
  const emResultados = rota.tela === "resultados";
  const textoDaRota = rota.tela === "resultados" ? rota.texto : "";
  const filtros = rota.tela === "resultados" ? rota.filtros : FILTROS_NA_ROTA_VAZIOS;
  const [texto, setTexto] = useState(textoDaRota);
  const escrito = useRef(textoDaRota);
  const raiz = useRef<HTMLDivElement>(null);
  const situacao = useSituacao();
  const { guardar } = usePesquisasRecentes();

  // A rota mudou por fora (Voltar): o campo acompanha.
  useEffect(() => {
    if (textoDaRota !== escrito.current) { escrito.current = textoDaRota; setTexto(textoDaRota); }
  }, [textoDaRota]);

  // Digitação: só depois da pausa o texto vai para a rota (sem empilhar histórico). Campo vazio não espera a pausa.
  const pausa = useDebounce(texto, 350);
  const vazio = texto.trim() === "";
  useEffect(() => {
    const t = (vazio ? "" : pausa).trim();
    const alvo = t.length >= MINIMO_DE_CARACTERES ? t : "";
    if (alvo === escrito.current) return;
    escrito.current = alvo;
    substituir("consultar", ...resultadosDe(alvo, filtros, 1));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pausa, vazio]);

  const buscarAgora = (t: string) => {
    guardar(t);
    const alvo = t.trim().length >= MINIMO_DE_CARACTERES ? t.trim() : "";
    escrito.current = alvo;
    substituir("consultar", ...resultadosDe(alvo, filtros, 1));
  };

  const abrirProcedimento = (codigo: string) => {
    guardar(textoDaRota);
    ir("consultar", codigo);
  };

  // Seta para baixo no campo (com texto) entra na lista de resultados.
  const descer = (e: KeyboardEvent) => {
    if (e.key !== "ArrowDown" || e.defaultPrevented) return;
    if ((e.target as HTMLElement).getAttribute("role") !== "combobox") return;
    const primeira = raiz.current?.querySelector("[data-principal]")?.querySelectorAll<HTMLElement>('[role="row"]')[1];
    if (!primeira) return;
    e.preventDefault();
    primeira.focus();
  };

  if (situacao.data && situacao.data.competencias.length === 0) {
    return <EstadoVazio titulo="Carregue a Tabela SIGTAP" descricao="Sem uma competência carregada não há o que consultar." acao={{ rotulo: "Abrir Dados", aoAcionar: () => ir("dados") }} />;
  }

  return (
    <div ref={raiz} className="consultar__pesquisa" onKeyDown={descer}>
      <CampoDeConsulta valor={texto} aoMudar={setTexto} autoFoco
        aoEscolherRecente={(t) => { setTexto(t); buscarAgora(t); }}
        aoAbrirFavorito={(codigo) => ir("consultar", codigo)}
        aoEnviar={(t) => buscarAgora(t)} />
      {emResultados && rota.tela === "resultados" ? (
        <Resultados texto={rota.texto} filtros={rota.filtros} pagina={rota.pagina}
          aoMudarFiltros={(f) => substituir("consultar", ...resultadosDe(rota.texto, f, 1))}
          aoIrParaPagina={(p) => substituir("consultar", ...resultadosDe(rota.texto, rota.filtros, p))}
          aoAbrir={abrirProcedimento} />
      ) : (
        <Explorar />
      )}
    </div>
  );
}

export function Consultar() {
  const { resto } = useRota();
  const rota = lerConsultar(resto);

  // A ficha ocupa a tela inteira (sem o campo de consulta).
  if (rota.tela === "ficha") return <Ficha />;

  return (
    <div className={`consultar${rota.tela === "resultados" ? " consultar--resultados" : ""}`}>
      <header className="consultar__titulo"><h1>Consultar</h1></header>
      <Pesquisa rota={rota} />
    </div>
  );
}
