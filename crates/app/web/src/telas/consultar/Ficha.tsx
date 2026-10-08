import { useEffect, useRef } from "react";
import { Abas } from "../../componentes/base/Abas";
import { Carregando, EstadoErro } from "../../componentes/dominio/Estados";
import { useFicha } from "../../dados/consultar";
import { ir, lerConsultar, useRota, type AbaFicha } from "../../shell/rotas";
import { FaixaDaFicha } from "./FaixaDaFicha";
import { FichaInexistente } from "./FichaInexistente";
import { FichaExigencias } from "./FichaExigencias";
import { FichaHistorico } from "./FichaHistorico";
import { FichaResumo } from "./FichaResumo";
import { montarResumo } from "./modelo/resumo";
import "./ficha.css";

export function Ficha() {
  const { resto } = useRota();
  const rota = lerConsultar(resto);
  const codigo = rota.tela === "ficha" ? rota.codigo : "";
  const aba: AbaFicha = rota.tela === "ficha" ? rota.aba : "resumo";
  const secao = rota.tela === "ficha" ? rota.secao : undefined;
  const q = useFicha(codigo);
  const refTitulo = useRef<HTMLHeadingElement>(null);
  const focado = useRef("");

  // Ao abrir uma ficha, o foco vai para o título (a aba trocada depois não rouba o foco).
  const carregada = q.data !== undefined;
  useEffect(() => {
    if (!carregada || focado.current === codigo) return;
    focado.current = codigo;
    refTitulo.current?.focus();
  }, [carregada, codigo]);

  // Trocar de aba pelo clique, por Enter ou por um "ver" leva o foco ao painel; as setas entre as abas deixam o foco na aba.
  const raiz = useRef<HTMLDivElement>(null);
  const porSetas = useRef(false);
  const abaAnterior = useRef<{ codigo: string; aba: AbaFicha } | null>(null);
  useEffect(() => {
    const antes = abaAnterior.current;
    abaAnterior.current = carregada ? { codigo, aba } : null;
    if (!antes || antes.codigo !== codigo || antes.aba === aba || porSetas.current || secao) return;
    const painel = raiz.current?.querySelector<HTMLElement>('[role="tabpanel"]');
    if (!painel) return;
    painel.tabIndex = -1;
    painel.focus({ preventScroll: true });
  }, [carregada, codigo, aba, secao]);

  if (!codigo) return null;
  if (q.isError) return <EstadoErro mensagem={q.error instanceof Error ? q.error.message : String(q.error)} aoTentar={() => void q.refetch()} />;
  if (q.data === undefined) return <Carregando rotulo="Abrindo a ficha" />;
  if (q.data === null) return <FichaInexistente codigo={codigo} refTitulo={refTitulo} />;

  const ficha = q.data;
  const resumo = montarResumo(ficha);
  return (
    <div className="ficha" ref={raiz}
      onKeyDownCapture={(e) => { porSetas.current = ["ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key) && (e.target as HTMLElement).getAttribute("role") === "tab"; }}
      onPointerDownCapture={() => { porSetas.current = false; }}>
      <FaixaDaFicha ficha={ficha} resumo={resumo} refTitulo={refTitulo} />
      <Abas
        rotulo="Partes da ficha"
        selectedKey={aba}
        onSelectionChange={(k) => ir("consultar", codigo, ...(k === "resumo" ? [] : [String(k)]))}
        abas={[
          { id: "resumo", rotulo: "Resumo", conteudo: <FichaResumo ficha={ficha} /> },
          { id: "exigencias", rotulo: "Exigências", conteudo: aba === "exigencias" ? <FichaExigencias ficha={ficha} secao={secao} /> : null },
          { id: "historico", rotulo: "Histórico", conteudo: <FichaHistorico codigo={codigo} /> },
        ]}
      />
    </div>
  );
}
