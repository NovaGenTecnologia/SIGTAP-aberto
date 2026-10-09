import { Botao } from "../../componentes/base/Botao";
import { useSituacao, useUnidades } from "../../dados/consultas";
import { rotuloCompetencia } from "../../util/formatos";
import { ir } from "../../shell/rotas";

type Estado = "feito" | "falta" | "opcional";
const ROTULO: Record<Estado, string> = { feito: "Feito", falta: "Falta", opcional: "Opcional" };

/** O que falta, em ordem, para o Painel mostrar a unidade. */
export function FaltaParaOPainel() {
  const sit = useSituacao().data;
  const cnes = useUnidades().data;
  const ultima = sit?.competencias.map((c) => c.competencia).sort().at(-1);
  const ufs = cnes?.ufs.map((u) => u.uf) ?? [];
  const linhas: { id: string; estado: Estado; titulo: string; texto: string }[] = [
    { id: "sigtap", estado: ultima ? "feito" : "falta", titulo: "Tabela SIGTAP", texto: ultima ? `SIGTAP ${rotuloCompetencia(ultima)} carregada.` : "Nenhuma competência carregada." },
    { id: "cnes", estado: ufs.length ? "feito" : "falta", titulo: "Cadastro do CNES", texto: ufs.length ? `UF carregada: ${ufs.join(", ")}.` : "Nenhuma UF carregada." },
    { id: "unidade", estado: cnes?.minha ? "feito" : "falta", titulo: "Unidade", texto: cnes?.minha ? "Escolhida." : "Escolha depois do cadastro." },
    { id: "producao", estado: "opcional", titulo: "Produção SIA e SIH", texto: "Valores aprovados, rejeições e pendências por valor." },
  ];
  return (
    <section className="falta" aria-labelledby="painel-falta">
      <h2 id="painel-falta" className="falta__titulo">O que falta para ter o Painel</h2>
      <ul className="falta__lista">
        {linhas.map((l) => (
          <li key={l.id} className="falta__linha">
            <span className={`painel__selo painel__selo--${l.estado}`}>{ROTULO[l.estado]}</span>
            <strong className="falta__nome">{l.titulo}</strong>
            <span className="falta__texto">{l.texto}</span>
            {l.estado !== "feito" ? <Botao onPress={() => ir("dados")} aria-label={`Abrir em Dados: ${l.titulo}`}>Abrir em Dados</Botao> : <span />}
          </li>
        ))}
      </ul>
    </section>
  );
}
