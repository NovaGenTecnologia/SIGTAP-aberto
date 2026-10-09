import type { FaturamentoUnidade, ItemDeProducao, Painel, Pendencia, ProcedimentosDaUnidade } from "../../api/tipos";

/** Dados inventados (unidade de exemplo, CNES 0000000): nenhum nome de pessoa real, nenhum CPF. */
const COMPETENCIAS = ["202508", "202509", "202510", "202511", "202512", "202601", "202602", "202603", "202604", "202605", "202606", "202607"];
const SIA_VALOR = [8_600, 8_900, 9_100, 8_800, 9_000, 9_300, 9_500, 9_400, 9_700, 9_900, 10_100, 4_000];
const SIH_VALOR = [3_100, 3_300, 3_200, 3_400, 3_500, 3_600, 3_500, 3_700, 3_800, 3_900, 4_000, 4_100];
const AIH = [4_900, 5_000, 5_100, 5_000, 5_200, 5_100, 5_300, 5_200, 5_100, 5_200, 5_300, 5_300];
const REJEICOES = [88, 80, 83, 90, 78, 84, 88, 74, 82, 92, 96, 82];

export const faturamentoExemplo = (over: Partial<FaturamentoUnidade> = {}): FaturamentoUnidade => ({
  disponivel: true, uf: "SP", cnes: "0000000",
  aviso: "Números da produção apresentada e aprovada no SIA e das AIH aprovadas no SIH (DATASUS), com atraso de publicação.",
  cobertura: {
    sia: COMPETENCIAS.map((c, i) => ({ competencia: c, completo: i < 11, estabelecimentos: i < 11 ? 21_000 : 7_241, sem_base: i === 0 })),
    sih: COMPETENCIAS.map((c, i) => ({ competencia: c, completo: true, estabelecimentos: 1_900, sem_base: i === 0 })),
  },
  janela: { sia: COMPETENCIAS.slice(0, 11), sih: COMPETENCIAS },
  janela_longa: { sia: COMPETENCIAS.slice(0, 11), sih: COMPETENCIAS },
  meses_completos: { sia: COMPETENCIAS.slice(0, 11), sih: COMPETENCIAS },
  meses: COMPETENCIAS.map((c, i) => ({
    competencia: c, rejeicoes: REJEICOES[i] ?? 0, sia_apresentado_centavos: (SIA_VALOR[i] ?? 0) * 100_000 + 5_000_000,
    sia_quantidade: 90_000, sia_valor_centavos: (SIA_VALOR[i] ?? 0) * 100_000, sih_aih: AIH[i] ?? 0, sih_dias: 21_000,
    sih_valor_centavos: (SIH_VALOR[i] ?? 0) * 100_000,
  })),
  sem_campos_novos: [], tem_rejeicoes: true,
  ano_anterior: { sia: null, sih: null },
  tendencia: {
    sia_valor: { media_anterior: 9_033_333, media_recente: 9_760_000, sentido: "sobe", variacao_percentual: 8.0 },
    sih_valor: { media_anterior: 3_533_333, media_recente: 3_933_333, sentido: "sobe", variacao_percentual: 10.9 },
    criterio: "média dos 3 últimos meses completos contra a dos 3 anteriores",
  },
  rejeicoes: {
    janela_rejeicoes: 1_017, janela_aih: 61_100, por_100_aih: 1.66,
    por_mes: COMPETENCIAS.map((c, i) => ({ competencia: c, rejeicoes: REJEICOES[i] ?? 0, aih: AIH[i] ?? 0, por_100_aih: ((REJEICOES[i] ?? 0) * 100) / (AIH[i] ?? 1), completo: true })),
    motivos: [
      { motivo: "020069", descricao: "AIH BLOQUEADA PARA AUDITORIA NO PRONTUÁRIO", total: 391, bloqueio: true, encerrado: false, vigencia: ["200701", "999999"], por_mes: [["202508", 53], ["202509", 40], ["202510", 31]] },
      { motivo: "020081", descricao: "AIH BLOQUEADA POR PERÍODOS DE INTERNAÇÃO SOBREPOSTOS NO MOVIMENTO", total: 307, bloqueio: true, encerrado: false, vigencia: ["200701", "999999"], por_mes: [["202508", 20], ["202509", 22]] },
      { motivo: "020001", descricao: "AIH BLOQUEADA POR DUPLICIDADE", total: 47, bloqueio: true, encerrado: false, vigencia: null, por_mes: [["202508", 4]] },
      { motivo: "060110", descricao: "PROFISSIONAL VINCULADO NÃO CADASTRADO", total: 34, bloqueio: false, encerrado: false, vigencia: null, por_mes: [["202508", 1], ["202509", 2]] },
      { motivo: "060072", descricao: "HOSPITAL NÃO POSSUI O SERVICO/CLASSIFICACAO EXIGIDOS", total: 33, bloqueio: false, encerrado: false, vigencia: null, por_mes: [["202509", 1]] },
      { motivo: "060225", descricao: null, total: 8, bloqueio: false, encerrado: false, vigencia: null, por_mes: [["202509", 1]] },
      { motivo: "030001", descricao: "ERRO DE CONSISTÊNCIA ANTIGO", total: 5, bloqueio: false, encerrado: true, vigencia: ["200701", "202512"], por_mes: [["202508", 5]] },
    ],
    motivos_total: 7,
    aviso: "Rejeições por 100 AIH aprovadas. O arquivo de rejeições traz uma linha por erro.",
  },
  abc: {
    sia: {
      unidade_quantidade: "quantidade aprovada", total_procedimentos: 991, omitidos: 951,
      resumo: { A: { procedimentos: 110, valor_centavos: 8_568_552_561 }, B: { procedimentos: 240, valor_centavos: 1_700_000_000 }, C: { procedimentos: 641, valor_centavos: 400_000_000 } },
      itens: [
        { procedimento: "0301060029", nome: "ATENDIMENTO DE URGÊNCIA EM ATENÇÃO ESPECIALIZADA", classe: "A", quantidade: 41_220, valor_centavos: 124_000_000, percentual: 19, acumulado: 19 },
      ],
    },
    sih: {
      unidade_quantidade: "AIH", total_procedimentos: 997, omitidos: 957,
      resumo: { A: { procedimentos: 48, valor_centavos: 1_977_407_123 }, B: { procedimentos: 200, valor_centavos: 300_000_000 }, C: { procedimentos: 749, valor_centavos: 60_000_000 } },
      itens: [
        { procedimento: "0303010037", nome: "TRATAMENTO DE OUTRAS DOENÇAS BACTERIANAS", classe: "A", quantidade: 4_100, valor_centavos: 90_000_000, percentual: 12, acumulado: 12 },
      ],
    },
  },
  apresentado: {
    competencias: COMPETENCIAS.slice(0, 11), valor_apresentado_centavos: 10_688_000_000, valor_aprovado_centavos: 10_693_000_000,
    maiores: [], motivos: [],
    atipicas: [
      { procedimento: "0211060020", nome: "MAPEAMENTO DE RETINA", competencia: "202606", quantidade_apresentada: 900, valor_apresentado_centavos: 10_960_000, mediana_propria: 400, mediana_uf: 300, meses_base: 6 },
    ],
    limiares_atipica: { razao: 2, meses_base: 6, excesso_minimo: 100 },
    aviso: "Diferença entre o que foi apresentado e o que o SIA aprovou.",
  },
  financiamento: {
    sia: [{ codigo: "04", nome: "Média e alta complexidade (MAC)", quantidade: 800_000, valor_centavos: 7_700_000_000 }, { codigo: "06", nome: "Fundo de ações estratégicas (FAEC)", quantidade: 20_000, valor_centavos: 1_900_000_000 }],
    sih: [{ codigo: "04", nome: "Média e alta complexidade (MAC)", quantidade: 61_000, valor_centavos: 3_900_000_000 }],
  },
  permanencia: {
    aviso: "Dias de permanência informados nas AIH aprovadas ÷ número de AIH, por procedimento.", analisados: 409, fora_do_previsto: 106,
    limiares: { min_aih: 5, razao: 1.5, razao_uf: 1.3 },
    itens: [{ procedimento: "0407020039", nome: "COLECISTECTOMIA", aih: 40, dias: 480, media_real: 12, media_uf: 4, previsto: 3, razao: 4 }],
  },
  leitos: {
    aviso: "Ocupação aproximada: dias de permanência ÷ (leitos SUS × dias do mês). Não é o censo hospitalar.", leitos_sus: 120, leitos_existentes: 150,
    por_mes: COMPETENCIAS.map((c) => ({ competencia: c, aih: 5_000, dias_de_permanencia: 21_000, aih_por_leito_sus: 41.6, ocupacao_percentual: 58 })),
  },
  pares: {
    aviso: "Comparação com os estabelecimentos do mesmo tipo (CNES) na UF.", tipo: "05", nome_tipo: "HOSPITAL GERAL",
    pares_com_producao: 23, pares_com_taxa: 19, minimo_aih_para_taxa: 50, taxa_da_unidade: 1.66, taxa_mediana_dos_pares: 1.32,
    valor_sia_da_unidade_centavos: 10_693_000_000, valor_sia_percentil: 82, valor_sih_da_unidade_centavos: 3_900_000_000, valor_sih_percentil: 75,
    grupos: [{
      criterio: "tipo_e_natureza_juridica", rotulo: "Hospital geral com natureza jurídica 3069", pares_com_producao: 9, pares_com_taxa: 7, minimo_aih_para_taxa: 50,
      taxa_da_unidade: 1.66, taxa_mediana_dos_pares: 1.32, valor_sia_da_unidade_centavos: 10_693_000_000, valor_sia_percentil: 80,
      valor_sih_da_unidade_centavos: 3_900_000_000, valor_sih_percentil: 70,
    }],
  },
  instrumentos: {
    aviso: "Valor por instrumento de registro.",
    da_unidade: [{ codigo: "1", descricao: "BPA consolidado", quantidade: 1_000, valor_centavos: 100_000_000 }],
    divergencias_da_uf: { procedimentos: 1, valor_centavos: 5_000_000, itens: [{ instrumento: "2", nome: "BPA individualizado", procedimento: "0301010072", quantidade: 10, registros_do_sigtap: ["01"], valor_centavos: 5_000_000 }] },
  },
  composicao_aih: {
    aviso: "Composição do valor das AIH aprovadas.", total_centavos: 3_900_000_000, total_uf_centavos: 900_000_000_000,
    faec_centavos: 100_000_000, faec_uf_centavos: 20_000_000_000, opm_centavos: 50_000_000, opm_uf_centavos: 10_000_000_000, uti_centavos: 300_000_000,
    tipos: [
      { fin: "04", nome: "Média e alta complexidade (MAC)", valor_centavos: 3_700_000_000, valor_uf_centavos: 700_000_000_000 },
      { fin: "06", nome: "Fundo de ações estratégicas (FAEC)", valor_centavos: 200_000_000, valor_uf_centavos: 200_000_000_000 },
    ],
  },
  reapresentacao: {
    aviso: "Parte do valor apresentado que vem de meses anteriores.", total_centavos: 10_000_000_000, anteriores_centavos: 3_800_000_000,
    uf_total_centavos: 900_000_000_000, uf_anteriores_centavos: 90_000_000_000,
    meses: [{ competencia: "202606", do_mes_centavos: 9_000_000, anteriores_centavos: 4_000_000, uf_do_mes_centavos: 100_000_000, uf_anteriores_centavos: 10_000_000 }],
    origem_dos_atrasos: [{ competencia: "202603", valor_centavos: 2_000_000 }],
  },
  perfil: {
    aviso: "Marcas e regras do CNES. Regra de não geração de crédito não é erro.",
    marcas: [{ tipo: "GM", codigo: "0001", descricao: "Gestão plena" }],
    regras: [{ codigo: "0000", descricao: null, origem: "SIH", quantidade: 100, valor_centavos: 200_000_000 }],
    complementos: [{ campo: "SH", origem: "SIH", valor_centavos: 2_400_000_000 }],
  },
  servicos: {
    aviso: "Serviços do cadastro contra o que a unidade produziu.", fora_do_cadastro_centavos: 1_200_000, sem_marca_sus_centavos: 0, sem_servico_centavos: 0,
    itens: [{ codigo: "125/001", nome: "SERVIÇO DE DIAGNÓSTICO POR IMAGEM", quantidade: 20, situacao: "fora_do_cadastro", valor_centavos: 1_200_000 }],
  },
  ...over,
});

const NOMES = ["ATENDIMENTO DE URGÊNCIA EM ATENÇÃO ESPECIALIZADA", "MAPEAMENTO DE RETINA", "MAMOGRAFIA BILATERAL PARA RASTREAMENTO", "ULTRASSONOGRAFIA DE ABDOME TOTAL", "CONSULTA MEDICA EM ATENÇÃO ESPECIALIZADA"];

/** `quantos` procedimentos de exemplo, do de maior valor para o de menor. */
export const itensDeProducao = (quantos: number, desde = 0): ItemDeProducao[] =>
  Array.from({ length: quantos }, (_, i) => {
    const n = desde + i;
    return {
      procedimento: `03010${String(n).padStart(5, "0")}`, nome: `${NOMES[n % NOMES.length]} ${n + 1}`,
      classe: n < 3 ? "A" : n < 8 ? "B" : "C", quantidade: 1_000 - n, valor_centavos: 10_000_000 - n * 1_000, percentual: Math.max(0.1, 20 - n), acumulado: Math.min(100, 20 + n * 2),
    };
  });

export const procedimentosExemplo = (over: Partial<ProcedimentosDaUnidade> = {}): ProcedimentosDaUnidade => ({
  disponivel: true, uf: "SP", cnes: "0000000", origem: "sia", unidade_quantidade: "quantidade aprovada", janela: COMPETENCIAS.slice(0, 11),
  total_geral: 991, total: 991,
  resumo: { A: { procedimentos: 110, valor_centavos: 8_568_552_561 }, B: { procedimentos: 240, valor_centavos: 1_700_000_000 }, C: { procedimentos: 641, valor_centavos: 400_000_000 } },
  valor_total_centavos: 10_668_552_561, itens: itensDeProducao(50), desde: 0, itens_omitidos: 941, ...over,
});

const pendencia = (tipo: string, titulo: string, texto: string, gravidade: Pendencia["gravidade"], valor: number | null): Pendencia => ({
  id: tipo, tipo, gravidade, titulo, texto, valor_envolvido_centavos: valor, perda_estimada: null,
  origem: { fonte: "SIH", competencias: ["202607"], conta: "", nao_prova: "" }, acao: { rotulo: "Ver itens", destino: "origem" }, itens: [],
});

/** As pendências de produção do Painel para a unidade de exemplo. */
export const pendenciasDeProducao: Pendencia[] = [
  pendencia("rejeicao_acima_dos_pares", "Rejeições acima dos pares", "1,66 por 100 AIH, mediana dos pares 1,32", "atencao", 800_000),
  pendencia("quantidade_atipica", "Quantidade atípica em 4 procedimentos", "MAPEAMENTO DE RETINA e outros 3", "atencao", 500_000),
  pendencia("permanencia_fora_do_previsto", "Permanência fora do previsto", "106 de 409 procedimentos de internação analisados", "info", null),
];

export const painelDaUnidade = (pendencias: Pendencia[] = pendenciasDeProducao): Painel => ({
  disponivel: true, uf: "SP", cnes: "0000000", aviso: "", sia: null, sih: null,
  rejeicoes: { por_100_aih: 1.66, janela_rejeicoes: 1_017, janela_aih: 61_100 }, oportunidades: null, pendencias,
  fontes: { producao_sia_ate: "202606", producao_sih_ate: "202607", sigtap: "202609" },
});
