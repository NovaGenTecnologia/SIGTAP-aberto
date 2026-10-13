import type { ItemDeApoio } from "../../../api/tipos";

// Nome curto da tabela de apoio, como o faturista a conhece (apresentação, não dado).
const NOME_TABELA: Record<string, string> = {
  tb_cid: "CID", tb_ocupacao: "CBO", tb_habilitacao: "Habilitação", tb_grupo_habilitacao: "Grupo de habilitação",
  tb_servico: "Serviço", tb_servico_classificacao: "Classificação de serviço", tb_regra_condicionada: "Regra condicionada",
  tb_modalidade: "Modalidade", tb_registro: "Instrumento", tb_tipo_leito: "Leito", tb_renases: "RENASES", tb_tuss: "TUSS",
  tb_componente_rede: "Rede", tb_rede_atencao: "Rede de atenção", tb_detalhe: "Atributo", tb_financiamento: "Financiamento",
  tb_rubrica: "Rubrica", tb_sia_sih: "SIA/SIH",
  tb_descricao: "Descrição oficial", tb_descricao_detalhe: "Descrição oficial", tb_forma_organizacao: "Forma de organização",
  tb_grupo: "Grupo", tb_sub_grupo: "Subgrupo",
};

export const rotuloDaTabela = (tabela: string): string => NOME_TABELA[tabela] ?? tabela;
export const codigoDeApoio = (i: ItemDeApoio): string => i.codigo.join(" · ");
export const idDeApoio = (i: ItemDeApoio): string => `${i.tabela}:${i.codigo.join("|")}`;
