import { ARCO_BAIXO, ARCO_CIMA, CEL, CEL_R, CELULAS, GUIA, HORIZONTAL, NO, PEQUENO, RAIO, VERTICAL } from "./marcaCaminhos";
import "./marca.css";

export type VarianteDaMarca = "horizontal" | "vertical" | "simbolo";
export type TemaDaMarca = "padrao" | "negativo";
export type AnimacaoDaMarca = "nenhuma" | "sutil" | "inicial" | "carregando";

interface Props {
  variante?: VarianteDaMarca;
  tema?: TemaDaMarca;
  animacao?: AnimacaoDaMarca;
  /** Altura em pixels; a largura segue a proporção. Até 32 px entra o desenho pequeno. */
  altura?: number;
  /** Quando o nome já está escrito ao lado, a marca não precisa ser lida de novo. */
  decorativa?: boolean;
}

interface Desenho {
  celulas: readonly (readonly [number, number])[]; cel: number; celR: number;
  guia: string; no: { x: number; y: number; r: number; traco: number }; arcoCima: string; arcoBaixo: string;
}

const NORMAL: Desenho = { celulas: CELULAS, cel: CEL, celR: CEL_R, guia: GUIA, no: NO, arcoCima: ARCO_CIMA, arcoBaixo: ARCO_BAIXO };
const ALTURA_MAXIMA_PEQUENA = 32;

// Desenho único da marca (gerado por marca/gerar_marca.py). O nome vai em contorno: não depende de fonte.
export function Marca({ variante = "horizontal", tema = "padrao", animacao = "nenhuma", altura = 32, decorativa = false }: Props) {
  const pequena = altura <= ALTURA_MAXIMA_PEQUENA;
  const d: Desenho = pequena ? PEQUENO : NORMAL;
  const medida = variante === "horizontal" ? HORIZONTAL : variante === "vertical" ? VERTICAL : { largura: 64, altura: 64 };
  const dx = variante === "vertical" ? VERTICAL.x : 0;
  const escala = variante === "vertical" ? VERTICAL.escala : 1;
  const nome = variante === "horizontal" ? HORIZONTAL : VERTICAL;
  const brilho = animacao === "carregando" || animacao === "sutil";
  const classe = ["marca", `marca--${tema}`, pequena && "marca--pequena", animacao !== "nenhuma" && `marca--${animacao}`].filter(Boolean).join(" ");
  const acessibilidade = decorativa ? { "aria-hidden": true as const } : { role: "img", "aria-label": "SIGTAP Aberto" };
  return (
    <svg className={classe} viewBox={`0 0 ${medida.largura} ${medida.altura}`} height={altura}
      width={(altura * medida.largura) / medida.altura} focusable="false" {...acessibilidade}>
      <g transform={`translate(${dx} 0) scale(${escala})`}>
        <rect className="marca__casco" width="64" height="64" rx={RAIO} />
        {/* A linha e o brilho ficam por baixo das células: a ponta arredondada não aparece sobre o quadrado. */}
        <path className="marca__guia" d={d.guia} pathLength={1} />
        {brilho && <path className="marca__trilha" d={d.guia} pathLength={1} />}
        {d.celulas.map(([x, y], i) => (
          <rect key={i} className={`marca__cel marca__c${i + 1}`} x={x} y={y} width={d.cel} height={d.cel} rx={d.celR} />
        ))}
        {/* Anel: o círculo e os dois arcos de brilho formam um grupo, para pulsar juntos a partir do centro. */}
        <g className="marca__anel">
          <circle className="marca__no" cx={d.no.x} cy={d.no.y} r={d.no.r} strokeWidth={d.no.traco} />
          {(brilho || animacao === "inicial") && (
            <>
              <path className="marca__arco" d={d.arcoCima} pathLength={1} strokeWidth={d.no.traco + 0.2} />
              <path className="marca__arco" d={d.arcoBaixo} pathLength={1} strokeWidth={d.no.traco + 0.2} />
            </>
          )}
        </g>
      </g>
      {variante !== "simbolo" && (
        <g className="marca__nomes">
          <path className="marca__nome marca__sigtap" d={nome.sigtap} />
          <path className="marca__nome marca__aberto" d={nome.aberto} />
        </g>
      )}
    </svg>
  );
}
