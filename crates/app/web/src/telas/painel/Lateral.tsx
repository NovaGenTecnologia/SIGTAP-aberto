import type { Painel } from "../../api/tipos";
import { inteiro, reaisCompacto } from "../../util/formatos";
import { ir } from "../../shell/rotas";

type Dados = Extract<Painel, { disponivel: true }>;

export function AptosQueNaoProduzem({ painel }: { painel: Dados }) {
  const o = painel.oportunidades;
  const itens = o?.itens ?? [];
  if (!o || itens.length === 0) return null;
  return (
    <section className="lateral" aria-labelledby="painel-aptos">
      <h2 id="painel-aptos" className="lateral__titulo">Aptos que não produzem</h2>
      <p className="lateral__sub">Maior valor produzido na UF · {inteiro(o.total)} procedimentos</p>
      <ul className="lateral__lista">
        {itens.map((i) => (
          <li key={i.codigo} className="lateral__item">
            <div>
              <a className="painel__codigo" href={`#/consultar/${i.codigo}`} onClick={(e) => { e.preventDefault(); ir("consultar", i.codigo); }}>{i.codigo}</a>
              <span className="painel__nome painel__nome--bloco">{i.nome}</span>
            </div>
            <span className="num lateral__valor">{reaisCompacto(i.uf.valor_centavos)}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

const EM_BREVE = [
  { id: "producao", titulo: "Produção", texto: "SIA, SIH, rejeições e série mensal" },
  { id: "cadastro", titulo: "Cadastro", texto: "Habilitações, serviços, leitos e profissionais" },
  { id: "aptidao", titulo: "Aptidão", texto: "Apta e produz, apta e não produz" },
];

/** O que o sub-projeto E traz; sem botão, para ninguém procurar o que ainda não existe. */
export function CartaoDaUnidade() {
  return (
    <section className="lateral" aria-labelledby="painel-unidade">
      <h2 id="painel-unidade" className="lateral__titulo">Unidade</h2>
      <ul className="lateral__lista">
        {EM_BREVE.map((e) => (
          <li key={e.id} className="lateral__item lateral__item--breve">
            <div><span className="lateral__breve-titulo">{e.titulo}</span><span className="painel__nome painel__nome--bloco">{e.texto}</span></div>
            <span className="painel__selo painel__selo--neutro">Em breve</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
