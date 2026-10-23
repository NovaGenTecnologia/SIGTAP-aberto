import type { Falta } from "../../../api/tipos";
import { hrefUnidade, ir, caminhoUnidade, type TelaDaUnidade } from "../../../shell/rotas";

function destinoDe(f: Falta): { rotulo: string; tela: TelaDaUnidade } {
  if (f.tipo === "habilitacao") {
    return {
      rotulo: f.codigo.startsWith("38") ? `programa ${f.codigo}` :`habilitação ${f.codigo}`,
      tela: { tela: "cadastro", aba: "habilitacoes", q: f.codigo },
    };
  }
  if (f.tipo === "servico") return { rotulo: `serviço ${f.codigo}`, tela: { tela: "cadastro", aba: "servicos", q: f.codigo.split("/")[0] ?? f.codigo } };
  return { rotulo: `leito ${f.codigo}`, tela: { tela: "cadastro", aba: "leitos", q: f.codigo } };
}

/** O que falta à unidade para um procedimento: cada chip leva ao item do Cadastro. */
export function ChipsDeFalta({ falta }: { falta: Falta[] }) {
  if (falta.length === 0) return <span className="un__apagado">—</span>;
  return (
    <span className="un__chips">
      {falta.map((f) => {
        const { rotulo, tela } = destinoDe(f);
        return (
          <a key={`${f.tipo}:${f.codigo}`} className="un__chip" href={hrefUnidade(tela)} title={f.nome ?? undefined}
            onClick={(e) => { e.preventDefault(); ir("painel", ...caminhoUnidade(tela)); }}>{rotulo}</a>
        );
      })}
    </span>
  );
}
