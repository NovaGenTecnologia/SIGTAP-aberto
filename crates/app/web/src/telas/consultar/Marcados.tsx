import { useState } from "react";
import type { ItemMarcado } from "../../api/tipos";
import { Botao } from "../../componentes/base/Botao";
import { Ligacao } from "../../componentes/base/Ligacao";
import { useMarcados } from "../../dados/marcados";
import { mascararProcedimento } from "../../util/campos";

const LIMITE = 8;

function Estrela() {
  return (
    <svg className="marcados__estrela" width="22" height="22" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 2.8l2.76 5.6 6.18.9-4.47 4.36 1.06 6.15L12 16.9l-5.53 2.91 1.06-6.15L3.06 9.3l6.18-.9z" fill="currentColor" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
    </svg>
  );
}

function Lista({ titulo, itens, aoMostrar }: { titulo: string; itens: ItemMarcado[]; aoMostrar: (i: ItemMarcado) => { estrela: boolean; texto: string } }) {
  const [todos, setTodos] = useState(false);
  if (itens.length === 0) return null;
  const vistos = todos ? itens : itens.slice(0, LIMITE);
  return (
    <section className="marcados__secao" aria-label={titulo}>
      <div className="consultar__cabeca">
        <h2>{titulo}</h2>
        {itens.length > LIMITE && (
          <span className="marcados__todos"><Botao variante="discreto" aria-expanded={todos} onPress={() => setTodos((t) => !t)}>{todos ? "Ver menos" : `Ver todos (${itens.length})`}</Botao></span>
        )}
      </div>
      <ul className="marcados__lista">
        {vistos.map((i) => {
          const { estrela, texto } = aoMostrar(i);
          return (
            <li key={i.codigo} className="marcados__item">
              {estrela && <Estrela />}
              <span className="num marcados__codigo"><Ligacao href={`#/consultar/${i.codigo}`}>{mascararProcedimento(i.codigo)}</Ligacao></span>
              <span className={i.existe ? "marcados__nome" : "marcados__nome marcados__nome--falta"}>{texto}</span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/** Favoritos e anotações do usuário, na Buscar vazia: até 8 de cada, com "Ver todos". */
export function Marcados() {
  const q = useMarcados("procedimento");
  const itens = q.data ?? [];
  const nome = (i: ItemMarcado) => (i.existe ? i.nome : "não existe nesta competência");
  return (
    <div className="marcados">
      <Lista titulo="Favoritos" itens={itens.filter((i) => i.favorito)} aoMostrar={(i) => ({ estrela: true, texto: nome(i) })} />
      <Lista titulo="Anotações" itens={itens.filter((i) => i.anotacao)} aoMostrar={(i) => ({ estrela: false, texto: i.anotacao ?? "" })} />
    </div>
  );
}
