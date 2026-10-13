import { useState } from "react";
import type { ServicoCadastrado } from "../../../api/tipos";
import { inteiro } from "../../../util/formatos";
import { TabelaDoCadastro, type ColunaDoCadastro } from "../TabelaDoCadastro";

type Linha = ServicoCadastrado & { id: string };
const simNao = (v: boolean) => (v ? "Sim" : "Não");
const plural = (n: number, um: string, varios: string) => `${inteiro(n)} ${n === 1 ? um : varios}`;

interface Grupo { codigo: string; nome: string | null; itens: Linha[] }

function agrupar(linhas: Linha[]): Grupo[] {
  const por = new Map<string, Grupo>();
  for (const l of linhas) {
    const g = por.get(l.servico.codigo) ?? { codigo: l.servico.codigo, nome: l.servico.nome, itens: [] };
    g.itens.push(l);
    por.set(l.servico.codigo, g);
  }
  return [...por.values()];
}

const COLUNAS: ColunaDoCadastro<Linha>[] = ["Serviço", "Classificações", "Ambulatorial SUS", "Hospitalar SUS", "Terceiro"]
  .map((rotulo) => ({ id: rotulo, rotulo, celula: () => null }));

/** Serviços da unidade agrupados por serviço, com as classificações dentro; recolhidos, exceto quando o filtro de texto está ativo. */
export function Servicos({ servicos, busca, aoBuscar }: { servicos: ServicoCadastrado[]; busca: string; aoBuscar: (t: string) => void }) {
  const [abertos, setAbertos] = useState<ReadonlySet<string>>(new Set());
  const linhas: Linha[] = servicos.map((s, i) => ({ ...s, id: `${s.servico.codigo}/${s.classificacao.codigo}/${s.terceiro}/${i}` }));
  const alternar = (codigo: string) => setAbertos((a) => { const n = new Set(a); if (n.has(codigo)) n.delete(codigo); else n.add(codigo); return n; });

  const corpo = (mostradas: Linha[], filtrando: boolean) => agrupar(mostradas).flatMap((g) => {
    const aberto = filtrando || abertos.has(g.codigo);
    const amb = g.itens.filter((i) => i.ambulatorial_sus).length;
    const hosp = g.itens.filter((i) => i.hospitalar_sus).length;
    const terceiros = [...new Set(g.itens.map((i) => i.terceiro).filter(Boolean))].join(", ");
    const grupo = (
      <tr key={g.codigo} className="un__grupo">
        <td>
          <button type="button" className="un__grupo-botao" aria-expanded={aberto} onClick={() => alternar(g.codigo)}>
            <span aria-hidden="true">{aberto ? "▾" : "▸"}</span>
            <span className="un__codigo">{g.codigo}</span>{g.nome && <span className="un__nome">{g.nome}</span>}
          </button>
        </td>
        <td>{g.itens.length}</td>
        <td>{amb} de {g.itens.length}</td>
        <td>{hosp} de {g.itens.length}</td>
        <td>{terceiros || "—"}</td>
      </tr>
    );
    if (!aberto) return [grupo];
    return [grupo, ...g.itens.map((l) => (
      <tr key={l.id} className="un__filho">
        <td><span className="un__codigo">{l.classificacao.codigo}</span>{l.classificacao.nome && <span className="un__nome">{l.classificacao.nome}</span>}</td>
        <td />
        <td>{simNao(l.ambulatorial_sus)}</td>
        <td>{simNao(l.hospitalar_sus)}</td>
        <td>{l.terceiro || "—"}</td>
      </tr>
    ))];
  });

  return (
    <TabelaDoCadastro rotulo="Serviços" colunas={COLUNAS} linhas={linhas} busca={busca} aoBuscar={aoBuscar} nomeDoArquivo="servicos" corpo={corpo}
      texto={(l) => `${l.servico.codigo} ${l.servico.nome ?? ""} ${l.classificacao.codigo} ${l.classificacao.nome ?? ""} ${l.terceiro}`}
      contagem={(ls) => `${plural(agrupar(ls).length, "serviço", "serviços")} · ${plural(ls.length, "classificação", "classificações")}`}
      planilha={(ls) => ({
        titulo: "Serviços da unidade",
        abas: [{ nome: "Serviços", colunas: ["Serviço", "Nome do serviço", "Classificação", "Nome da classificação", "Ambulatorial SUS", "Hospitalar SUS", "Terceiro"],
          linhas: ls.map((l) => [l.servico.codigo, l.servico.nome, l.classificacao.codigo, l.classificacao.nome, simNao(l.ambulatorial_sus), simNao(l.hospitalar_sus), l.terceiro || null]) }],
      })} />
  );
}
