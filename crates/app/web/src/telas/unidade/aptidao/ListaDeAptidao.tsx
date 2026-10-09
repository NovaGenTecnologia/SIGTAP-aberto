import type { GrupoDeAptidao, ItemDeAptidao, SituacaoDoItem } from "../../../api/tipos";
import { ir } from "../../../shell/rotas";
import { inteiro, reais } from "../../../util/formatos";
import { ChipsDeFalta } from "./ChipsDeFalta";

const SITUACAO: Record<SituacaoDoItem, { texto: string; tom: string }> = {
  nao_apta: { texto: "Não apta", tom: "rejeicao" },
  servico_a_confirmar: { texto: "Serviço a confirmar", tom: "atencao" },
  fora_da_tabela: { texto: "Fora da tabela", tom: "neutro" },
  apta_ressalva_servico: { texto: "Apta com ressalva de serviço", tom: "atencao" },
  apta: { texto: "Apta", tom: "ok" },
  sem_exigencia: { texto: "Sem exigência", tom: "neutro" },
};

export interface ColunaDeAptidao { id: string; rotulo: string; numerica?: boolean; celula: (i: ItemDeAptidao) => React.ReactNode; texto: (i: ItemDeAptidao) => string | number }

const produzidoPelaUnidade = (i: ItemDeAptidao) => i.sia.valor_centavos + i.sih.valor_centavos;
const produtoresNaUf = (i: ItemDeAptidao) => i.uf.produtores_sia + i.uf.produtores_sih;

/** Colunas de cada grupo; coluna numérica que só traz zeros não aparece. */
export function colunasDe(grupo: GrupoDeAptidao, itens: ItemDeAptidao[]): ColunaDeAptidao[] {
  const procedimento: ColunaDeAptidao = {
    id: "proc", rotulo: "Procedimento", texto: (i) => i.codigo,
    celula: (i) => (
      <>
        <a className="un__codigo" href={`#/consultar/${i.codigo}`} onClick={(e) => { e.preventDefault(); ir("consultar", i.codigo); }}>{i.codigo}</a>
        {i.nome && <span className="un__nome">{i.nome}</span>}
      </>
    ),
  };
  const situacao: ColunaDeAptidao = {
    id: "sit", rotulo: "Situação", texto: (i) => SITUACAO[i.situacao].texto,
    celula: (i) => (
      <span className="un__situacao"><span className={`un__ponto un__ponto--${SITUACAO[i.situacao].tom}`} aria-hidden="true" />{SITUACAO[i.situacao].texto}</span>
    ),
  };
  const produzido: ColunaDeAptidao = { id: "prod", rotulo: "Produzido pela unidade", numerica: true, texto: (i) => produzidoPelaUnidade(i) / 100, celula: (i) => reais(produzidoPelaUnidade(i)) };
  const lista: ColunaDeAptidao[] =
    grupo === "risco"
      ? [procedimento, situacao, { id: "falta", rotulo: "O que falta", texto: (i) => i.falta.map((f) => `${f.tipo} ${f.codigo}`).join("; "), celula: (i) => <ChipsDeFalta falta={i.falta} /> }, produzido]
      : grupo === "oportunidade"
        ? [procedimento, situacao,
          { id: "uf", rotulo: "Unidades da UF", numerica: true, texto: produtoresNaUf, celula: (i) => inteiro(produtoresNaUf(i)) },
          { id: "valor", rotulo: "Valor na UF", numerica: true, texto: (i) => i.uf.valor_centavos / 100, celula: (i) => reais(i.uf.valor_centavos) }]
        : [procedimento, situacao, produzido];
  const numericaCom = (c: ColunaDeAptidao) => c.numerica && itens.length > 0 && itens.every((i) => Number(c.texto(i)) === 0);
  return lista.filter((c) => !numericaCom(c));
}

/** A página de um grupo da Aptidão. A situação é sempre texto: o ponto de cor só reforça. */
export function ListaDeAptidao({ rotulo, colunas, itens }: { rotulo: string; colunas: ColunaDeAptidao[]; itens: ItemDeAptidao[] }) {
  return (
    <div className="un__rolagem" role="region" aria-label={`Rolagem: ${rotulo}`} tabIndex={0}>
      <table className="un__tabela" aria-label={rotulo}>
        <thead><tr>{colunas.map((c) => <th key={c.id} scope="col" className={c.numerica ? "un__direita" : undefined}>{c.rotulo}</th>)}</tr></thead>
        <tbody>
          {itens.map((i) => (
            <tr key={i.codigo}>{colunas.map((c) => <td key={c.id} className={c.numerica ? "un__direita num" : undefined}>{c.celula(i)}</td>)}</tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
