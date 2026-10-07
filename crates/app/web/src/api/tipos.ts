export interface CompetenciaInfo {
  competencia: string;          // AAAAMM
  rotulo: string;               // MM/AAAA
  arquivo: string;
  versao: string | null;
  publicado_em: string | null;  // DD/MM/AAAA hh:mm
  sha256: string;
}
export interface Situacao {
  primeira_execucao: boolean;
  bloqueio: unknown | null;     // preenchido quando os dados são de uma versão mais nova do programa
  competencias: CompetenciaInfo[];
  territorio: unknown | null;
  pasta_dados: string;
  ocupado: boolean;
  recuperacao: unknown | null;
}
export interface UnidadeRef { uf: string; cnes: string; nome: string }
export interface SituacaoCnes {
  minha: UnidadeRef | null;
  unidades: UnidadeRef[];
  ufs_disponiveis: string[];
}
export interface Progresso { resumo: string; mensagem: string; fracao: number; indeterminado: boolean }
export interface FimTarefa { ok: boolean; cancelada: boolean; mensagem: string }
export interface ItemProcedimento {
  codigo: string; codigo_mascarado: string; nome: string;
  tp_complexidade: string; complexidade: string | null;
  valor_total_centavos: number; instrumentos: string[];
  forma: string; forma_nome: string | null;
}
export interface Busca {
  consulta: string; competencia: string; modo: "codigo" | "texto";
  total_procedimentos: number; procedimentos: ItemProcedimento[]; apoio: unknown[];
}
export interface InfoPrograma { versao?: string; [chave: string]: unknown }
