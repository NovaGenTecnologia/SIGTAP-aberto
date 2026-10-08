import type { CampoOficial, Ficha, LinhaOficial, RelacaoOficial } from "../../../api/tipos";
import { campoDe, textoDoCampo, valorTotalCentavos } from "../../../util/campos";
import { inteiro, reais } from "../../../util/formatos";
import { complexidadeCurta, instrumentosCurtos } from "./procedimento";

export interface LinhaDoResumo {
  rotulo: string;
  valor: string;
  /** Linha de apoio sob o valor: origem no arquivo oficial ou prévia dos itens. */
  nota?: string;
  /** Tabela da relação que detalha o item (leva à seção em Exigências). */
  ver?: string;
  /** O valor sai do arquivo oficial e tem "De onde vem". */
  origem?: boolean;
}

export interface ItemDoResumo { codigo: string; nome: string | null; texto: string | null }

export interface Resumo {
  nome: string;
  descricao: string | null;
  valorTotal: string;
  instrumento: string;
  complexidade: string;
  modalidade: string;
  financiamentoCurto: string;
  cobrar: LinhaDoResumo[];
  valores: LinhaDoResumo[];
  incremento: string[];
  regras: number;
  atributos: number;
  regrasItens: ItemDoResumo[];
  atributosItens: ItemDoResumo[];
  linhasDuplicadas: number;
  cids: ListaCurta;
  cbos: ListaCurta;
}

const relacaoDe = (f: Ficha, tabela: string): RelacaoOficial | undefined => f.relacoes.find((r) => r.tabela === tabela);
const quantas = (f: Ficha, tabela: string): number => relacaoDe(f, tabela)?.linhas.length ?? 0;

/** Primeiro texto de nome encontrado para o código da coluna. */
function nomeDe(l: LinhaOficial | undefined, tabela: string): string | null {
  const achado = l?.nomes.find((n) => n.tabela === tabela)?.encontrados[0];
  return achado ? Object.values(achado)[0] ?? null : null;
}

function nomesDe(r: RelacaoOficial | undefined, tabela: string): string[] {
  return (r?.linhas ?? []).map((l) => nomeDe(l, tabela)).filter((n): n is string => !!n);
}

const plural = (n: number, um: string, varios: string) => `${n} ${n === 1 ? um : varios}`;
const aceitos = (n: number) => (n ? plural(n, "aceito", "aceitos") : "Sem exigência");

/** Nome curto (no_*) e textos oficiais (demais) dos nomes cuja última coluna é a pedida. */
function nomesDaColuna(l: LinhaOficial, coluna: string): { curto: string | null; textos: string[] } {
  let curto: string | null = null;
  const textos: string[] = [];
  for (const n of l.nomes.filter((x) => x.colunas[x.colunas.length - 1] === coluna)) {
    for (const m of n.encontrados) {
      const [chave, valor] = Object.entries(m).find(([, v]) => v) ?? [];
      if (!chave || !valor) continue;
      if (chave.startsWith("no_") && curto === null) curto = valor;
      else textos.push(valor);
    }
  }
  return { curto, textos };
}

function itensDe(r: RelacaoOficial | undefined, coluna: string): ItemDoResumo[] {
  return (r?.linhas ?? []).map((l) => {
    const { curto, textos } = nomesDaColuna(l, coluna);
    return { codigo: String(campoDe(l, coluna)?.valor ?? ""), nome: curto, texto: textos[0] ?? null };
  });
}

/** Códigos distintos de uma relação, os primeiros com nome: "I10 Hipertensão", e quantos ficaram de fora. */
export interface ListaCurta { aceitos: number; itens: string[]; mais: number; todos: string[] }

function listaCurta(r: RelacaoOficial | undefined, coluna: string, max = 3): ListaCurta {
  const vistos = new Map<string, string>();
  for (const l of r?.linhas ?? []) {
    const cod = String(campoDe(l, coluna)?.valor ?? "");
    if (cod && !vistos.has(cod)) vistos.set(cod, `${cod} ${nomesDaColuna(l, coluna).curto ?? ""}`.trim());
  }
  const itens = [...vistos.values()];
  return { aceitos: r?.linhas.length ?? 0, itens: itens.slice(0, max), mais: Math.max(0, itens.length - max), todos: itens };
}

/** "I10 Hipertensão; I11 …; e mais 4" */
function previa(r: RelacaoOficial | undefined, coluna: string, max = 3): string | undefined {
  if (!r?.linhas.length) return undefined;
  const l = listaCurta(r, coluna, max);
  return l.itens.join("; ") + (l.mais ? `; e mais ${l.mais}` : "");
}

const notaDoArquivo = (c: CampoOficial | undefined): string | undefined =>
  c?.sentinela ? `${c.valor} no arquivo oficial${c.sentinela_inferida ? " (significado inferido)" : ""}` : undefined;

function idadeDe(p: LinhaOficial | undefined): string {
  const min = campoDe(p, "vl_idade_minima"), max = campoDe(p, "vl_idade_maxima");
  if (!min || !max) return "—";
  if (min.sentinela || max.sentinela) return "Não se aplica";
  return `${min.valor === 0 ? "0" : textoDoCampo(min)} a ${textoDoCampo(max)}`;
}

function incrementoDe(f: Ficha): string[] {
  const tipos: [string, string][] = [["vl_percentual_sh", "serviço hospitalar"], ["vl_percentual_sa", "serviço ambulatorial"], ["vl_percentual_sp", "serviço profissional"]];
  return (relacaoDe(f, "rl_procedimento_incremento")?.linhas ?? []).map((l) => {
    const partes = tipos.flatMap(([col, rotulo]) => {
      const c = campoDe(l, col);
      return c && Number(c.valor) ? [`+${textoDoCampo(c)} no ${rotulo}`] : [];
    });
    const hab = campoDe(l, "co_habilitacao")?.valor;
    const nome = nomeDe(l, "tb_habilitacao");
    return `${[hab, nome].filter(Boolean).join(" ")}: ${partes.join("; ")}`;
  });
}

function notaIdade(p: LinhaOficial | undefined): string | undefined {
  const min = campoDe(p, "vl_idade_minima"), max = campoDe(p, "vl_idade_maxima");
  if (!min || !max || min.sentinela || max.sentinela || min.unidade !== "meses") return notaDoArquivo(max) ?? notaDoArquivo(min);
  return `${inteiro(Number(min.valor))} a ${inteiro(Number(max.valor))} meses no arquivo oficial`;
}

function notaCid(r: RelacaoOficial | undefined): string | undefined {
  if (!r?.linhas.length) return undefined;
  const principais = r.linhas.filter((l) => campoDe(l, "st_principal")?.valor === "S").length;
  return `${principais} como principal · ${previa(r, "co_cid")}`;
}

function notaHabilitacao(r: RelacaoOficial | undefined): string | undefined {
  if (!r?.linhas.length) return undefined;
  const grupos = new Set(r.linhas.map((l) => campoDe(l, "nu_grupo_habilitacao")?.valor).filter((g) => g !== undefined && g !== null && g !== "")).size;
  return `${grupos ? `${plural(grupos, "grupo", "grupos")} · ` : ""}${previa(r, "co_habilitacao")}`;
}

function notaServico(r: RelacaoOficial | undefined): string | undefined {
  if (!r?.linhas.length) return undefined;
  return r.linhas.slice(0, 3).map((l) => `${campoDe(l, "co_servico")?.valor}/${campoDe(l, "co_classificacao")?.valor} ${nomesDaColuna(l, "co_classificacao").curto ?? ""}`.trim()).join("; ");
}

export function montarResumo(f: Ficha): Resumo {
  const p = f.procedimento[0];
  const texto = (col: string) => { const c = campoDe(p, col); return c ? textoDoCampo(c) : "—"; };
  const sigla = (nome: string | null) => nome?.match(/\(([^)]+)\)\s*$/)?.[1] ?? nome;
  const financiamento = nomeDe(p, "tb_financiamento");
  const codigoFin = String(campoDe(p, "co_financiamento")?.valor ?? "");
  const rubrica = String(campoDe(p, "co_rubrica")?.valor ?? "");
  const modalidades = nomesDe(relacaoDe(f, "rl_procedimento_modalidade"), "tb_modalidade");
  const instrumentos = nomesDe(relacaoDe(f, "rl_procedimento_registro"), "tb_registro");
  const total = p ? valorTotalCentavos(p) : 0;
  const descricao = campoDe(relacaoDe(f, "tb_descricao")?.linhas[0], "ds_procedimento")?.valor;

  const exigencia = (rotulo: string, tabela: string, um: string, varios: string): LinhaDoResumo => {
    const n = quantas(f, tabela);
    return n ? { rotulo, valor: plural(n, um, varios), ver: tabela } : { rotulo, valor: "Sem exigência" };
  };

  return {
    nome: String(campoDe(p, "no_procedimento")?.valor ?? f.codigo_mascarado),
    descricao: descricao ? String(descricao) : null,
    valorTotal: reais(total),
    instrumento: instrumentosCurtos(instrumentos),
    complexidade: complexidadeCurta(campoDe(p, "tp_complexidade")?.descricao ?? null),
    modalidade: modalidades.length ? modalidades.join(" · ") : "—",
    financiamentoCurto: [sigla(financiamento), codigoFin].filter(Boolean).join(" · ") || "—",
    cobrar: [
      { rotulo: "Sexo", valor: campoDe(p, "tp_sexo")?.descricao ?? texto("tp_sexo") },
      { rotulo: "Idade", valor: idadeDe(p), nota: notaIdade(p) },
      { rotulo: "Quantidade máxima", valor: texto("qt_maxima_execucao"), nota: notaDoArquivo(campoDe(p, "qt_maxima_execucao")) },
      { rotulo: "Permanência", valor: texto("qt_dias_permanencia"), nota: notaDoArquivo(campoDe(p, "qt_dias_permanencia")) },
      ...(campoDe(p, "qt_tempo_permanencia") ? [{ rotulo: "Tempo de permanência", valor: texto("qt_tempo_permanencia"), nota: notaDoArquivo(campoDe(p, "qt_tempo_permanencia")) }] : []),
      { rotulo: "Pontos", valor: texto("qt_pontos") },
      { rotulo: "CID", valor: aceitos(quantas(f, "rl_procedimento_cid")), ver: quantas(f, "rl_procedimento_cid") ? "rl_procedimento_cid" : undefined, nota: notaCid(relacaoDe(f, "rl_procedimento_cid")) },
      { rotulo: "CBO", valor: aceitos(quantas(f, "rl_procedimento_ocupacao")), ver: quantas(f, "rl_procedimento_ocupacao") ? "rl_procedimento_ocupacao" : undefined, nota: previa(relacaoDe(f, "rl_procedimento_ocupacao"), "co_ocupacao") },
      { ...exigencia("Habilitação", "rl_procedimento_habilitacao", "habilitação", "habilitações"), nota: notaHabilitacao(relacaoDe(f, "rl_procedimento_habilitacao")) },
      { ...exigencia("Serviço", "rl_procedimento_servico", "combinação", "combinações"), nota: notaServico(relacaoDe(f, "rl_procedimento_servico")) },
      { ...exigencia("Leito", "rl_procedimento_leito", "tipo", "tipos"), nota: previa(relacaoDe(f, "rl_procedimento_leito"), "co_tipo_leito", 4) },
    ],
    valores: [
      { rotulo: "Serviço hospitalar", valor: texto("vl_sh"), origem: true },
      { rotulo: "Serviço profissional", valor: texto("vl_sp"), origem: true },
      { rotulo: "Serviço ambulatorial", valor: texto("vl_sa"), origem: true },
      { rotulo: "Total", valor: reais(total), origem: true, nota: "SH + SP + SA" },
      { rotulo: "Financiamento", valor: [financiamento, codigoFin].filter(Boolean).join(" · ") || "—" },
      { rotulo: "Rubrica", valor: rubrica ? nomeDe(p, "tb_rubrica") ?? rubrica : "Sem rubrica", nota: rubrica ? `código ${rubrica}` : undefined },
    ],
    incremento: incrementoDe(f),
    regras: quantas(f, "rl_procedimento_regra_cond"),
    atributos: quantas(f, "rl_procedimento_detalhe"),
    regrasItens: itensDe(relacaoDe(f, "rl_procedimento_regra_cond"), "co_regra_condicionada"),
    atributosItens: itensDe(relacaoDe(f, "rl_procedimento_detalhe"), "co_detalhe"),
    linhasDuplicadas: f.procedimento.length > 1 ? f.procedimento.length : 0,
    cids: listaCurta(relacaoDe(f, "rl_procedimento_cid"), "co_cid"),
    cbos: listaCurta(relacaoDe(f, "rl_procedimento_ocupacao"), "co_ocupacao"),
  };
}
