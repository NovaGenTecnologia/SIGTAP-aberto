import type { ItemProcedimento, Planilha } from "../../../api/tipos";
import type { TabelaDaRelacao } from "./tabelaRelacao";

const mascararForma = (f: string) => (f.length === 6 ? `${f.slice(0, 2)}.${f.slice(2, 4)}.${f.slice(4, 6)}` : f);
// O Excel limita o nome da aba a 31 caracteres e barra alguns símbolos.
const nomeDeAba = (t: string) => t.replace(/[\/?*[\]:]/g, " ").trim().slice(0, 31) || "Planilha";

/** Todas as linhas recebidas, não só as que cabem na tela. Valor em reais, código como texto. */
export function planilhaDeProcedimentos(itens: ItemProcedimento[], titulo: string): Planilha {
  return {
    titulo,
    abas: [{
      nome: "Procedimentos",
      colunas: ["Código", "Nome", "Complexidade", "Valor total (R$)", "Instrumentos", "Forma"],
      linhas: itens.map((i) => [
        i.codigo_mascarado, i.nome, i.complexidade ?? i.tp_complexidade, i.valor_total_centavos / 100, i.instrumentos.join(", "),
        `${mascararForma(i.forma)}${i.forma_nome ? ` ${i.forma_nome}` : ""}`,
      ]),
    }],
  };
}

/** Uma relação oficial inteira (sem o filtro da tela): código e nome em colunas separadas. */
export function planilhaDaRelacao(nome: string, tabela: TabelaDaRelacao): Planilha {
  const colunas: string[] = [];
  for (const c of tabela.colunas) colunas.push(`${c.rotulo} (código)`, `${c.rotulo} (nome)`);
  if (tabela.temRepeticoes) colunas.push("Repetições no arquivo");
  const linhas = tabela.linhas.map((l) => {
    const cel: (string | number)[] = [];
    for (const c of tabela.colunas) { const x = l.celulas[c.id]; cel.push(x?.codigo ?? "", x?.nome ?? ""); }
    if (tabela.temRepeticoes) cel.push(l.repeticoes);
    return cel;
  });
  return { titulo: nome, abas: [{ nome: nomeDeAba(nome), colunas, linhas }] };
}
