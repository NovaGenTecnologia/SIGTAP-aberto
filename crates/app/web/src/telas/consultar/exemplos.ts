// Fichas de exemplo para os testes de Consultar (formas conferidas contra a saída real do CLI, procedimento 0301010072).
import type { CampoOficial, Ficha, LinhaOficial, NomeDeCodigo, RelacaoOficial } from "../../api/tipos";

export const campo = (coluna: string, valor: string | number | null, extra: Partial<CampoOficial> = {}): CampoOficial =>
  ({ coluna, coluna_origem: coluna.toUpperCase(), valor, ...extra });

export const nome = (tabela: string, coluna: string, texto: Record<string, string>): NomeDeCodigo =>
  ({ tabela, colunas: [coluna], tabela_presente: true, encontrados: [texto] });

export const linha = (campos: CampoOficial[], nomes: NomeDeCodigo[] = [], quantidade = 1): LinhaOficial => ({ quantidade, campos, nomes });

export const relacao = (tabela: string, coluna: string, linhas: LinhaOficial[] = []): RelacaoOficial => ({ tabela, coluna, linhas });

export const DESCRICAO_LONGA = "CONSULTA CLÍNICA DO PROFISSIONAL MÉDICO NA ATENÇÃO ESPECIALIZADA, REALIZADA EM AMBULATÓRIO, COM REGISTRO DO ATENDIMENTO E DA CONDUTA NO PRONTUÁRIO DO USUÁRIO.";

export function procedimento(extra: { sh?: number; sa?: number; sp?: number } = {}): LinhaOficial {
  return linha([
    campo("co_procedimento", "0301010072"),
    campo("no_procedimento", "CONSULTA MEDICA EM ATENÇÃO ESPECIALIZADA"),
    campo("tp_complexidade", "2", { descricao: "Média Complexidade", situacao: "oficial" }),
    campo("tp_sexo", "I", { descricao: "Indiferente/Ambos", situacao: "oficial" }),
    campo("qt_maxima_execucao", 9999, { sentinela: "Não se aplica" }),
    campo("qt_dias_permanencia", 9999, { sentinela: "Não se aplica" }),
    campo("qt_pontos", 0),
    campo("vl_idade_minima", 0, { unidade: "meses" }),
    campo("vl_idade_maxima", 1571, { unidade: "meses" }),
    campo("vl_sh", extra.sh ?? 0, { unidade: "centavos" }),
    campo("vl_sa", extra.sa ?? 1000, { unidade: "centavos" }),
    campo("vl_sp", extra.sp ?? 0, { unidade: "centavos" }),
    campo("co_financiamento", "06"),
    campo("co_rubrica", ""),
  ], [nome("tb_financiamento", "co_financiamento", { no_financiamento: "Média e Alta Complexidade (MAC)" })]);
}

const registro = (cod: string, texto: string) => linha([campo("co_procedimento", "0301010072"), campo("co_registro", cod)], [nome("tb_registro", "co_registro", { no_registro: texto })]);

export function fichaDeExemplo(opcoes: { procedimento?: LinhaOficial[]; cbos?: number; cids?: number; incremento?: LinhaOficial[]; descricao?: string } = {}): Ficha {
  const cbos = Array.from({ length: opcoes.cbos ?? 69 }, (_, i) => linha([campo("co_procedimento", "0301010072"), campo("co_ocupacao", String(223100 + i))], [nome("tb_ocupacao", "co_ocupacao", { no_ocupacao: `Ocupação ${i}` })]));
  const cids = Array.from({ length: opcoes.cids ?? 0 }, (_, i) => linha([campo("co_procedimento", "0301010072"), campo("co_cid", `I${10 + i}`), campo("st_principal", "S")]));
  return {
    competencia: "202609", rotulo: "09/2026", codigo: "0301010072", codigo_mascarado: "03.01.01.007-2",
    estrutura: [
      { nivel: "grupo", codigo: "03", nome: "Procedimentos clínicos" },
      { nivel: "subgrupo", codigo: "0301", nome: "Consultas / Atendimentos / Acompanhamentos" },
      { nivel: "forma", codigo: "030101", nome: "Consultas médicas/outros profissionais de nível superior" },
    ],
    procedimento: opcoes.procedimento ?? [procedimento()],
    relacoes: [
      relacao("rl_procedimento_cid", "co_procedimento", cids),
      relacao("rl_procedimento_ocupacao", "co_procedimento", cbos),
      relacao("rl_procedimento_habilitacao", "co_procedimento"),
      relacao("rl_procedimento_servico", "co_procedimento"),
      relacao("rl_procedimento_leito", "co_procedimento"),
      relacao("rl_procedimento_incremento", "co_procedimento", opcoes.incremento ?? []),
      relacao("rl_procedimento_modalidade", "co_procedimento", [linha([campo("co_procedimento", "0301010072"), campo("co_modalidade", "01")], [nome("tb_modalidade", "co_modalidade", { no_modalidade: "Ambulatorial" })])]),
      relacao("rl_procedimento_registro", "co_procedimento", [registro("01", "BPA (Consolidado)"), registro("02", "BPA (Individualizado)"), registro("06", "APAC (Proc. Principal)")]),
      relacao("rl_procedimento_regra_cond", "co_procedimento", [linha([campo("co_regra_condicionada", "0012")]), linha([campo("co_regra_condicionada", "0013")])]),
      relacao("rl_procedimento_detalhe", "co_procedimento", [1, 2, 3, 4].map((n) => linha([campo("co_detalhe", `00${n}`)]))),
      relacao("tb_descricao", "co_procedimento", [linha([campo("co_procedimento", "0301010072"), campo("ds_procedimento", opcoes.descricao ?? DESCRICAO_LONGA)])]),
    ],
  };
}
