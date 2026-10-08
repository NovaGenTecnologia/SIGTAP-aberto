import { useEffect, useRef, useState, type RefObject } from "react";
import type { Ficha } from "../../api/tipos";
import { Botao } from "../../componentes/base/Botao";
import { ir } from "../../shell/rotas";
import { mascararProcedimento } from "../../util/campos";
import { AcoesDaFicha, NotaDaFicha } from "./FichaMarcas";
import type { Resumo } from "./modelo/resumo";

function useCopiado() {
  const [aviso, setAviso] = useState("");
  const relogio = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(relogio.current), []);
  const copiar = (texto: string, mensagem: string) => {
    void navigator.clipboard?.writeText(texto).catch(() => {});
    setAviso(mensagem);
    window.clearTimeout(relogio.current);
    relogio.current = window.setTimeout(() => setAviso(""), 1500);
  };
  return { aviso, copiar };
}

export function CaixasDoCodigo({ codigo }: { codigo: string }) {
  const partes: [string, string][] = [["grupo", codigo.slice(0, 2)], ["subgrupo", codigo.slice(2, 4)], ["forma", codigo.slice(4, 6)], ["procedimento", codigo.slice(6, 9)], ["dígito", codigo.slice(9)]];
  return (
    <div className="ficha__caixas">
      {partes.map(([rotulo, valor]) => (
        <span key={rotulo} role="img" aria-label={`${rotulo} ${valor}`} className="ficha__parte">
          <span className="ficha__caixa num" aria-hidden="true">{valor}</span>
          <span className="ficha__legenda" aria-hidden="true">{rotulo}</span>
        </span>
      ))}
    </div>
  );
}

export function FaixaDaFicha({ ficha, resumo, refTitulo }: { ficha: Ficha; resumo: Resumo; refTitulo: RefObject<HTMLHeadingElement | null> }) {
  const { aviso, copiar } = useCopiado();
  const [anotando, setAnotando] = useState(false);
  // A faixa fica fixa no alto: o que recebe foco ou rolagem precisa saber quanto dela cobre a tela.
  const topo = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const no = topo.current;
    if (!no || typeof ResizeObserver === "undefined") return;
    const medir = () => no.parentElement?.style.setProperty("--altura-topo", `${no.offsetHeight}px`);
    medir();
    const o = new ResizeObserver(medir);
    o.observe(no);
    return () => o.disconnect();
  }, []);
  // Ao rolar, a faixa encolhe (nome, código, valor e ações); com histerese, para a altura não oscilar.
  const [compacta, setCompacta] = useState(false);
  useEffect(() => {
    const area = topo.current?.closest<HTMLElement>(".shell__conteudo");
    if (!area) return;
    const ver = () => setCompacta((c) => (c ? area.scrollTop > 24 : area.scrollTop > 140));
    ver();
    area.addEventListener("scroll", ver, { passive: true });
    return () => area.removeEventListener("scroll", ver);
  }, []);
  const voltar = window.history.length > 1 && <span className="ficha__voltar"><Botao variante="discreto" onPress={() => window.history.back()}>Voltar</Botao></span>;
  const principais: [string, string][] = [
    ["Valor total", resumo.valorTotal], ["Instrumento", resumo.instrumento], ["Complexidade", resumo.complexidade],
    ["Modalidade", resumo.modalidade], ["Financiamento", resumo.financiamentoCurto],
  ];
  return (
    <div className={`ficha__topo${compacta ? " ficha__topo--compacta" : ""}`} ref={topo}>
      <div className="ficha__navegacao">
      {voltar}
      <nav aria-label="Onde está" className="ficha__trilha">
        {ficha.estrutura.map((n, i) => (
          <span key={n.codigo} className="ficha__trilha-item">
            {i > 0 && <span aria-hidden="true" className="ficha__separador">›</span>}
            <Botao variante="discreto" onPress={() => ir("consultar", "explorar", "procedimentos", n.codigo)}>{`${n.codigo} ${n.nome ?? ""}`.trim()}</Botao>
          </span>
        ))}
      </nav>
      </div>
      <div className="ficha__identidade">
        {compacta && voltar}
        <button type="button" className="ficha__copiavel ficha__codigo" aria-label={`Copiar o código ${ficha.codigo}; com Ctrl, com pontos`}
          title="Clique: copia sem pontos. Ctrl + clique: copia com pontos."
          onClick={(e) => copiar(e.ctrlKey || e.metaKey ? mascararProcedimento(ficha.codigo) : ficha.codigo, "Código copiado")}>
          <CaixasDoCodigo codigo={ficha.codigo} />
        </button>
        <div className="ficha__nome">
          <h1 ref={refTitulo} tabIndex={-1}>
            <button type="button" className="ficha__copiavel" title="Clique para copiar o nome completo" onClick={() => copiar(resumo.nome, "Nome copiado")}>{resumo.nome}</button>
          </h1>
        </div>
        {compacta && <span className="ficha__mini num">{mascararProcedimento(ficha.codigo)}<span className="ficha__mini-total">{resumo.valorTotal}</span></span>}
        <span role="status" className="ficha__copiado">{aviso}</span>
        <AcoesDaFicha codigo={ficha.codigo} anotando={anotando} aoAnotar={() => setAnotando((a) => !a)} />
      </div>
      <NotaDaFicha codigo={ficha.codigo} aberta={anotando} aoAbrir={() => setAnotando(true)} aoFechar={() => setAnotando(false)} />
      {resumo.linhasDuplicadas > 0 && <p role="note" className="ficha__aviso">{resumo.linhasDuplicadas} linhas para este código no arquivo oficial.</p>}
      <div role="group" aria-label="Dados principais" className="ficha__principais">
        {principais.map(([rotulo, valor], i) => (
          <dl key={rotulo} className={`ficha__principal${i === 0 ? " ficha__principal--total" : ""}`}>
            <dt>{rotulo}</dt>
            <dd className="num">{valor}</dd>
          </dl>
        ))}
      </div>
    </div>
  );
}
