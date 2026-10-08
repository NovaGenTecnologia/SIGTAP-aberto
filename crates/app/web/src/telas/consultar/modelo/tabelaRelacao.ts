import type { LinhaOficial, RelacaoOficial } from "../../../api/tipos";
import { textoDoCampo } from "../../../util/campos";

// Rótulos de apresentação (não são dados): portados de crates/app/ui/app.js (NOME_COLUNA).
const ROTULOS: Record<string, string> = {
  co_cid: "CID", st_principal: "Principal", co_ocupacao: "CBO", co_habilitacao: "Habilitação",
  nu_grupo_habilitacao: "Grupo", co_servico: "Serviço", co_classificacao: "Classificação", co_tipo_leito: "Leito",
  co_registro: "Instrumento", co_modalidade: "Modalidade", co_detalhe: "Atributo", co_regra_condicionada: "Regra",
  co_renases: "RENASES", co_tuss: "TUSS", co_procedimento_sia_sih: "Código SIA/SIH", tp_procedimento: "Tipo",
  co_procedimento: "Procedimento", co_procedimento_compativel: "Procedimento compatível",
  co_registro_compativel: "Instrumento do compatível", tp_compatibilidade: "Compatibilidade", qt_permitida: "Quantidade permitida",
  co_procedimento_principal: "Procedimento principal", co_registro_principal: "Instrumento do principal",
  co_procedimento_restricao: "Procedimento de restrição", co_procedimento_origem: "Procedimento de origem",
  vl_sh: "Valor do serviço hospitalar", vl_sa: "Valor do serviço ambulatorial", vl_sp: "Valor do serviço profissional",
  no_procedimento: "Nome", tp_complexidade: "Complexidade", tp_sexo: "Sexo", qt_maxima_execucao: "Quantidade máxima",
  qt_dias_permanencia: "Permanência (dias)", qt_pontos: "Pontos", vl_idade_minima: "Idade mínima", vl_idade_maxima: "Idade máxima",
  co_financiamento: "Financiamento", co_rubrica: "Rubrica", qt_tempo_permanencia: "Tempo de permanência",
  co_componente_rede: "Componente da rede", vl_percentual_sh: "% SH", vl_percentual_sa: "% SA", vl_percentual_sp: "% SP",
};

export const rotuloDaColuna = (coluna: string): string => ROTULOS[coluna] ?? coluna;

export interface CelulaDaRelacao {
  /** Valor do campo como o faturista lê (descrição do código, unidade, valor cru). */
  codigo: string;
  nome: string | null;
  /** Nomes além do primeiro (descrições longas). */
  textos: string[];
  /** Por que o nome não aparece, quando deveria. */
  falta: string | null;
  /** Código de outro procedimento: a célula leva à ficha dele. */
  procedimento: string | null;
}

export interface ColunaDaRelacao { id: string; rotulo: string }
export interface LinhaDaRelacao { id: string; celulas: Record<string, CelulaDaRelacao>; repeticoes: number; busca: string }
export interface TabelaDaRelacao { colunas: ColunaDaRelacao[]; linhas: LinhaDaRelacao[]; temRepeticoes: boolean }

const normalizar = (s: string) => s.toLocaleLowerCase("pt-BR").normalize("NFD").replace(/[̀-ͯ]/g, "");

function celulaDe(l: LinhaOficial, coluna: string): CelulaDaRelacao {
  const c = l.campos.find((x) => x.coluna === coluna);
  const nomes = l.nomes.filter((n) => n.colunas[n.colunas.length - 1] === coluna);
  let nome: string | null = null;
  const textos: string[] = [];
  for (const n of nomes) {
    for (const m of n.encontrados) {
      const [chave, valor] = Object.entries(m).find(([, v]) => v) ?? [];
      if (!chave || !valor) continue;
      if (chave.startsWith("no_") && nome === null) nome = valor;
      else textos.push(valor);
    }
  }
  let falta: string | null = null;
  if (nome === null && nomes.length > 0) {
    if (nomes.some((n) => !n.tabela_presente)) falta = "tabela não veio no ZIP desta competência";
    else if (textos.length === 0) falta = "sem nome nesta competência";
  }
  const valor = c ? String(c.valor ?? "") : "";
  return { codigo: c ? textoDoCampo(c) : "", nome, textos, falta, procedimento: /^co_procedimento/.test(coluna) && /^\d{10}$/.test(valor) ? valor : null };
}

/** Uma relação oficial como tabela: colunas dos campos (menos a chave e a competência), nomes vindos das tabelas de destino. */
export function montarTabela(r: RelacaoOficial): TabelaDaRelacao {
  const primeira = r.linhas[0];
  const colunas = (primeira?.campos ?? []).filter((c) => c.coluna !== r.coluna && c.coluna !== "dt_competencia").map((c) => ({ id: c.coluna, rotulo: rotuloDaColuna(c.coluna) }));
  const linhas = r.linhas.map((l, i) => {
    const celulas = Object.fromEntries(colunas.map((c) => [c.id, celulaDe(l, c.id)]));
    const busca = normalizar(Object.values(celulas).map((x) => [x.codigo, x.nome, ...x.textos].filter(Boolean).join(" ")).join(" "));
    return { id: String(i), celulas, repeticoes: l.quantidade, busca };
  });
  return { colunas, linhas, temRepeticoes: r.linhas.some((l) => l.quantidade > 1) };
}
