import "./dominio.css";

export interface PassoGuia { rotulo: string; detalhe?: string; aoAbrir?: () => void }

export function LinhaGuia({ passos }: { passos: PassoGuia[] }) {
  return (
    <ol className="guia" aria-label="Caminho do alerta até a origem">
      {passos.map((p, i) => (
        <li key={p.rotulo} className="guia__passo" aria-current={i === passos.length - 1 ? "step" : undefined}>
          {p.aoAbrir ? <button type="button" className="guia__rotulo guia__rotulo--acao" onClick={p.aoAbrir}>{p.rotulo}</button> : <span className="guia__rotulo">{p.rotulo}</span>}
          {p.detalhe && <span className="guia__detalhe">{p.detalhe}</span>}
        </li>
      ))}
    </ol>
  );
}
