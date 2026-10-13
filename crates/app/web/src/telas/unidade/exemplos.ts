import type {
  AptidaoUnidade, HabilitacaoComProducao, ItemDeAptidao, PaginaDeAptidao, UnidadeCompleta,
} from "../../api/tipos";

/** Dados inventados (unidade de exemplo, CNES 0000000): nenhum nome de pessoa real, nenhum CPF. */
export const unidadeExemplo: UnidadeCompleta = {
  uf: "SP", cnes: "0000000", nome: "UNIDADE DE EXEMPLO DE SAUDE", razao_social: "FUNDACAO EXEMPLO", municipio: "000000",
  municipio_nome: "Cidade de Exemplo", pessoa_fisica: false, competencia_cnes: "202608", competencia_sigtap: "202609",
  ativa: true, guardada: true,
  gerais: [["Tipo de estabelecimento", { codigo: "05", nome: null }], ["Esfera administrativa", { codigo: "M", nome: "Municipal" }]],
  habilitacoes: [
    { codigo: "0203", nome: "Assistência em Alta Complexidade ao indivíduo com Obesidade", inicio: "201610", fim: "999999", vigente: true, portaria: "PT GM 2133", data_portaria: "24/10/2016", leitos: 0 },
    { codigo: "0602", nome: "Unidade de Terapia Intensiva Adulto, tipo II", inicio: "201203", fim: "999999", vigente: true, portaria: "PT GM 3432", data_portaria: "01/03/2012", leitos: 10 },
    { codigo: "3801", nome: "Programa Mais Acesso a Especialistas", inicio: "202505", fim: "999999", vigente: true, portaria: "PT GM 7012", data_portaria: "05/05/2025", leitos: null },
    { codigo: "2601", nome: "Oncologia: serviço de radioterapia", inicio: "201801", fim: "202312", vigente: false, portaria: "PT GM 140", data_portaria: "10/01/2018", leitos: null },
  ],
  servicos: [
    { servico: { codigo: "104", nome: "Regulação Assistencial dos Serviços de Saúde" }, classificacao: { codigo: "001", nome: "Central de Regulação de Internações" }, ambulatorial_sus: true, hospitalar_sus: true, terceiro: "" },
    { servico: { codigo: "153", nome: "Serviço de Diagnóstico por Imagem" }, classificacao: { codigo: "003", nome: "Ecocardiografia" }, ambulatorial_sus: true, hospitalar_sus: false, terceiro: "0000999" },
    { servico: { codigo: "118", nome: "Serviço de Densitometria" }, classificacao: { codigo: "004", nome: "Densitometria óssea" }, ambulatorial_sus: true, hospitalar_sus: false, terceiro: "" },
  ],
  leitos: [
    { tipo: { codigo: "1", nome: null }, especialidade: { codigo: "03", nome: "Clínico" }, existentes: 324, sus: 238, nao_sus: 86 },
    { tipo: { codigo: "2", nome: "Complementar" }, especialidade: { codigo: "81", nome: null }, existentes: 12, sus: 12, nao_sus: 0 },
  ],
  equipamentos: [
    { equipamento: { codigo: "0101", nome: null }, existentes: 3, em_uso: 3, disponivel_sus: true },
    { equipamento: { codigo: "1105", nome: "Tomógrafo computadorizado" }, existentes: 1, em_uso: 1, disponivel_sus: false },
  ],
  ocupacoes: null, profissionais: null, tem_arquivo_de_profissionais: false,
};

/** Com arquivo de pessoas: nomes inventados. */
export const unidadeComProfissionais: UnidadeCompleta = {
  ...unidadeExemplo,
  tem_arquivo_de_profissionais: true,
  ocupacoes: [{ cbo: { codigo: "225125", nome: "Médico clínico" }, profissionais: 2, atendem_sus: 2 }],
  profissionais: [
    { nome: "FULANA DE TAL EXEMPLO", cbo: { codigo: "225125", nome: "Médico clínico" }, vinculo: { codigo: "010101", nome: null }, atende_sus: true, horas_ambulatorio: 20, horas_hospital: 0, horas_outros: 0 },
    { nome: "BELTRANO EXEMPLO DA SILVA", cbo: { codigo: "225125", nome: "Médico clínico" }, vinculo: { codigo: "010101", nome: null }, atende_sus: true, horas_ambulatorio: 0, horas_hospital: 20, horas_outros: 0 },
  ],
};

export const habilitacoesComProducao: HabilitacaoComProducao[] = [
  { codigo: "0203", nome: "Assistência em Alta Complexidade ao indivíduo com Obesidade", vigente: true, inicio: "201610", fim: "999999", portaria: "PT GM 2133", data_portaria: "24/10/2016", programa_38: false, procedimentos_que_citam: 15, procedimentos_produzidos: 10, valor_centavos: 45_680_849 },
  { codigo: "0602", nome: "Unidade de Terapia Intensiva Adulto, tipo II", vigente: true, inicio: "201203", fim: "999999", portaria: "PT GM 3432", data_portaria: "01/03/2012", programa_38: false, procedimentos_que_citam: 12, procedimentos_produzidos: 9, valor_centavos: 120_433_010 },
  { codigo: "3801", nome: "Programa Mais Acesso a Especialistas", vigente: true, inicio: "202505", fim: "999999", portaria: "PT GM 7012", data_portaria: "05/05/2025", programa_38: true, procedimentos_que_citam: 38, procedimentos_produzidos: 0, valor_centavos: 0 },
  { codigo: "2601", nome: "Oncologia: serviço de radioterapia", vigente: false, inicio: "201801", fim: "202312", portaria: "PT GM 140", data_portaria: "10/01/2018", programa_38: false, procedimentos_que_citam: 9, procedimentos_produzidos: 0, valor_centavos: 0 },
];

const item = (codigo: string, nome: string, situacao: ItemDeAptidao["situacao"], classe: string, over: Partial<ItemDeAptidao> = {}): ItemDeAptidao => ({
  codigo, nome, classe, motivo: null, estado: null, situacao, falta: [],
  sia: { quantidade: 0, valor_centavos: 0 }, sih: { aih: 0, valor_centavos: 0 },
  uf: { produtores_sia: 0, produtores_sih: 0, valor_centavos: 0 }, ...over,
});

export const itensDeRisco: ItemDeAptidao[] = [
  item("0205010032", "ECOCARDIOGRAFIA TRANSTORÁCICA", "nao_apta", "produz_sem_aptidao", {
    sia: { quantidade: 120, valor_centavos: 855_036 },
    falta: [{ tipo: "habilitacao", codigo: "0203", nome: "Obesidade" }, { tipo: "servico", codigo: "153/003", nome: "Diagnóstico por imagem · Ecocardiografia" }],
  }),
  item("0204060028", "DENSITOMETRIA ÓSSEA", "servico_a_confirmar", "produz_com_ressalva", {
    sia: { quantidade: 40, valor_centavos: 694_260 }, falta: [{ tipo: "servico", codigo: "118/004", nome: "Densitometria · Densitometria óssea" }],
  }),
  item("0201010127", "BIOPSIA DE ESCLERA", "nao_apta", "produz_sem_aptidao", {
    sia: { quantidade: 2, valor_centavos: 12_600 }, falta: [{ tipo: "leito", codigo: "03", nome: null }],
  }),
  item("0202030970", "EXAME DE EXEMPLO FORA DA TABELA", "fora_da_tabela", "produz_fora_da_tabela", { sia: { quantidade: 3, valor_centavos: 20_405 } }),
];

export const itensDeOportunidade: ItemDeAptidao[] = [
  item("0416050123", "COLECTOMIA VIDEOLAPAROSCÓPICA EM ONCOLOGIA", "apta", "apta_nao_produz", { uf: { produtores_sia: 0, produtores_sih: 26, valor_centavos: 423_229_368 } }),
  item("0405050380", "FACECTOMIA COM IMPLANTE DE LENTE", "apta_ressalva_servico", "apta_nao_produz", { motivo: "com_ressalva_de_servico", uf: { produtores_sia: 8, produtores_sih: 0, valor_centavos: 1_200_000 } }),
];

export const itensEmOrdem: ItemDeAptidao[] = [
  item("0301010072", "CONSULTA MÉDICA EM ATENÇÃO ESPECIALIZADA", "apta", "produz_apta", { sia: { quantidade: 900, valor_centavos: 1_080_000 } }),
  item("0301040010", "ATENDIMENTO DE URGÊNCIA", "sem_exigencia", "produz_sem_exigencia", { sia: { quantidade: 50, valor_centavos: 120_000 } }),
];

export const pagina = (id: PaginaDeAptidao["id"], itens: ItemDeAptidao[], over: Partial<PaginaDeAptidao> = {}): PaginaDeAptidao => ({
  id, itens, desde: 0, itens_omitidos: 0, total: itens.length, ninguem_produziu: null, ...over,
});

export const avisos: AptidaoUnidade["avisos"] = {
  producao: "Números da produção aprovada.", terceirizados: "O cadastro público não lista serviço terceirizado.",
  programa_38: "Habilitações 38.xx não foram condição para a aprovação.", oportunidade: "O valor é o produzido por todos na UF.",
  habilitacoes: "Procedimentos que citam a habilitação como exigência.",
};

export const resumoCompleto: NonNullable<AptidaoUnidade["resumo"]> = {
  risco: { procedimentos: 4, valor_da_unidade_centavos: 1_582_301 },
  oportunidade: { procedimentos: 2076, com_producao_na_uf: 1280, valor_da_uf_centavos: 230_000_000_000 },
  ordem: { procedimentos: 1952, valor_da_unidade_centavos: 35_160_000_000 },
};

export const aptidaoExemplo = (over: Partial<AptidaoUnidade> = {}): AptidaoUnidade => ({
  disponivel: true, uf: "SP", cnes: "0000000", sem_producao: false,
  resumo: resumoCompleto, grupo: null, habilitacoes: habilitacoesComProducao, avisos, ...over,
});
