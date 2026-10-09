import type { GrupoDeAptidao, ResumoDeAptidao } from "../../../api/tipos";
import { caminhoUnidade, hrefUnidade, ir } from "../../../shell/rotas";
import { inteiro, reais, reaisCompacto } from "../../../util/formatos";

const valorCurto = (centavos: number) => (centavos < 100_000_000 ? reais(centavos) : reaisCompacto(centavos));

interface Passo { id: GrupoDeAptidao; rotulo: string; tom: string; numero: number | null; texto: string }

function passosDe(r: ResumoDeAptidao, semProducao: boolean): Passo[] {
  const { risco, oportunidade } = r;
  return [
    { id: "risco", rotulo: "Risco", tom: "risco", numero: risco?.procedimentos ?? null, texto: risco ? `${valorCurto(risco.valor_da_unidade_centavos)} produzidos pela unidade` : "" },
    { id: "oportunidade", rotulo: "Oportunidade", tom: "oportunidade", numero: oportunidade.procedimentos,
      texto: semProducao ? "pelo cadastro" : `${inteiro(oportunidade.com_producao_na_uf)} com produção na UF · ${valorCurto(oportunidade.valor_da_uf_centavos)} produzidos na UF` },
  ];
}

/** Risco e Oportunidade: contagem e valor, e também o seletor do grupo (navegação, com `aria-current`). "Em ordem" fica recolhido numa barra à parte. */
export function FaixaDePrioridade({ resumo, semProducao, ativo, q, hab }: {
  resumo: ResumoDeAptidao; semProducao: boolean; ativo: GrupoDeAptidao; q: string; hab: string | null;
}) {
  return (
    <nav aria-label="Prioridade" className="un__faixa">
      {passosDe(resumo, semProducao).map((p) => {
        const desligado = semProducao && p.id !== "oportunidade";
        const corpo = (
          <>
            <span className="un__faixa-rotulo"><span className={`un__ponto un__ponto--${p.tom}`} aria-hidden="true" />{p.rotulo}</span>
            <span className="un__faixa-numero num">{desligado || p.numero === null ? "—" : inteiro(p.numero)}</span>
            <span className="un__faixa-texto">{desligado ? "Precisa da produção" : p.texto}</span>
          </>
        );
        if (desligado) return <span key={p.id} className="un__faixa-item un__faixa-item--desligado" aria-disabled="true">{corpo}</span>;
        const tela = { tela: "aptidao", grupo: p.id, q, hab } as const;
        return (
          <a key={p.id} className="un__faixa-item" href={hrefUnidade(tela)} aria-current={ativo === p.id ? "page" : undefined}
            onClick={(e) => { e.preventDefault(); ir("painel", ...caminhoUnidade(tela)); }}>{corpo}</a>
        );
      })}
    </nav>
  );
}
