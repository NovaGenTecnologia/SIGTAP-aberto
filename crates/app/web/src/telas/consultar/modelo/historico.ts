import type { EventoDeHistorico, Historico, LinhaOficial } from "../../../api/tipos";
import { campoDe, mascararProcedimento, textoDoCampo } from "../../../util/campos";
import { ehExigencia, nomeDaRelacao } from "./relacoes";
import { rotuloDaColuna } from "./tabelaRelacao";

export type TipoDeFiltro = "tudo" | "valores" | "exigencias";
export interface FiltroDoHistorico { tipo: TipoDeFiltro; /** Código da tabela; vazio = todas. */ tabela: string }

export interface LinhaDeMudanca { campo: string; antes: string; depois: string }
export interface CartaoDeEvento {
  id: string;
  tipo: EventoDeHistorico["tipo"];
  /** Tabela oficial do evento (chave do filtro). */
  tabela: string;
  /** Nome da relação como o faturista a conhece. */
  nome: string;
  nota: string | null;
  mudancas: LinhaDeMudanca[];
  itens: string[];
}
export interface GrupoDeCompetencia { competencia: string; rotulo: string; cartoes: CartaoDeEvento[] }

const VALORES = new Set(["vl_sh", "vl_sa", "vl_sp"]);

export function nomeDaTabela(tabela: string, coluna: string): string {
  return tabela === "tb_procedimento" ? "Procedimento" : nomeDaRelacao({ tabela, coluna, linhas: [] });
}

function passa(e: EventoDeHistorico, f: FiltroDoHistorico): boolean {
  if (f.tabela && e.tabela !== f.tabela) return false;
  if (f.tipo === "valores") return e.tabela === "tb_procedimento" && e.tipo === "alterado" && e.campos_alterados.some((c) => VALORES.has(c));
  if (f.tipo === "exigencias") return ehExigencia(e.tabela);
  return true;
}

const nota = (e: EventoDeHistorico): string | null =>
  e.tabela_ausente ? "a tabela não veio no ZIP desta competência" : e.tabela_voltou ? "a tabela voltou a vir no ZIP" : null;

/** "225125 Médico clínico": os campos de código da linha, com o nome vindo da tabela de destino. */
function itemDe(e: EventoDeHistorico): string {
  if (e.tabela === "tb_procedimento") return mascararProcedimento(e.chave["co_procedimento"] ?? "");
  const l: LinhaOficial | null = e.depois ?? e.antes;
  if (!l) return Object.values(e.chave).join(" ");
  return l.campos
    .filter((c) => c.coluna !== e.coluna && c.coluna !== "dt_competencia" && c.coluna !== "co_procedimento" && /^(co_|nu_|tp_|st_)/.test(c.coluna) && c.valor !== "" && c.valor !== null)
    .map((c) => {
      const n = l.nomes.find((x) => x.colunas[x.colunas.length - 1] === c.coluna)?.encontrados[0];
      const curto = n ? Object.entries(n).find(([k, v]) => k.startsWith("no_") && v)?.[1] : undefined;
      const v = /^\d{10}$/.test(String(c.valor)) && c.coluna.startsWith("co_procedimento") ? mascararProcedimento(String(c.valor)) : String(c.valor);
      return `${v}${curto ? ` ${curto}` : c.descricao && c.situacao === "oficial" ? ` ${c.descricao}` : ""}`;
    })
    .join(", ");
}

function mudancasDe(e: EventoDeHistorico): LinhaDeMudanca[] {
  const txt = (l: LinhaOficial | null, col: string) => { const c = campoDe(l ?? undefined, col); return c ? textoDoCampo(c) : "—"; };
  return e.campos_alterados.map((col) => ({ campo: rotuloDaColuna(col), antes: txt(e.antes, col), depois: txt(e.depois, col) }));
}

/** Eventos do histórico por competência (mais recente primeiro), já filtrados e com inclusões/exclusões da mesma tabela juntas. */
export function montarGrupos(h: Historico, f: FiltroDoHistorico): GrupoDeCompetencia[] {
  const porCompetencia = new Map<string, EventoDeHistorico[]>();
  for (const e of h.eventos.filter((x) => passa(x, f))) porCompetencia.set(e.competencia, [...(porCompetencia.get(e.competencia) ?? []), e]);
  return [...porCompetencia.entries()].sort(([a], [b]) => b.localeCompare(a)).map(([competencia, evs]) => {
    const cartoes: CartaoDeEvento[] = [];
    const juntos = new Map<string, CartaoDeEvento>();
    evs.forEach((e, i) => {
      const nomeT = nomeDaTabela(e.tabela, e.coluna);
      if (e.tipo === "alterado") {
        cartoes.push({ id: `${competencia}-${i}`, tipo: e.tipo, tabela: e.tabela, nome: nomeT, nota: nota(e), mudancas: mudancasDe(e), itens: [] });
        return;
      }
      const chave = `${e.tipo}|${e.tabela}|${e.tabela_ausente}|${e.tabela_voltou}`;
      const existente = juntos.get(chave);
      if (existente) { existente.itens.push(itemDe(e)); return; }
      const novo: CartaoDeEvento = { id: `${competencia}-${i}`, tipo: e.tipo, tabela: e.tabela, nome: nomeT, nota: nota(e), mudancas: [], itens: [itemDe(e)] };
      juntos.set(chave, novo);
      cartoes.push(novo);
    });
    return { competencia, rotulo: evs[0]!.rotulo, cartoes };
  });
}

export function contagemPorCompetencia(h: Historico): Record<string, number> {
  const r: Record<string, number> = {};
  for (const e of h.eventos) r[e.competencia] = (r[e.competencia] ?? 0) + 1;
  return r;
}

/** Tabelas que aparecem no histórico, para o seletor "Tabela". */
export function tabelasDoHistorico(h: Historico): { id: string; rotulo: string }[] {
  const vistas = new Map<string, string>();
  for (const e of h.eventos) if (!vistas.has(e.tabela)) vistas.set(e.tabela, nomeDaTabela(e.tabela, e.coluna));
  return [...vistas].map(([id, rotulo]) => ({ id, rotulo }));
}
