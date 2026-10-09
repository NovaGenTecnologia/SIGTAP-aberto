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
  zips?: ZipsGuardados;         // ZIPs que ficam guardados na pasta de dados
  tarefas?: TarefaNaSituacao[]; // tarefas em andamento ou na fila, por fonte
}
export interface UnidadeRef { uf: string; cnes: string; nome: string }
export interface SituacaoCnes {
  minha: UnidadeRef | null;
  unidades: UnidadeRef[];
  ufs_disponiveis: string[];
}
export interface Progresso { resumo: string; mensagem: string; fracao: number; indeterminado: boolean }
export interface FimTarefa { ok: boolean; cancelada: boolean; mensagem: string }
export type Fonte = "sigtap" | "cnes" | "producao";
export type Fase = "baixando" | "carregando" | "verificando";
export interface ProgressoDeTarefa extends Progresso { fonte: Fonte; tarefa: number; rotulo: string; fase: Fase }
export interface FimDeTarefa extends FimTarefa { fonte: Fonte; tarefa: number }
export interface TarefaNaSituacao { fonte: Fonte; tarefa: number; rotulo: string; na_fila: boolean }
export type Quando = "agora" | "depois";
export interface ItemProcedimento {
  codigo: string; codigo_mascarado: string; nome: string;
  tp_complexidade: string; complexidade: string | null;
  valor_total_centavos: number; instrumentos: string[];
  forma: string; forma_nome: string | null;
}
export interface Busca {
  consulta: string; competencia: string; modo: "codigo" | "texto";
  total_procedimentos: number; procedimentos: ItemProcedimento[]; apoio: ItemDeApoio[];
}
/** Favorito e anotação de um item (formas conferidas contra `crates/packs/src/usuario.rs` e `unidade::marcados_com_nome`). */
export interface Marcado { tipo: string; codigo: string; favorito: boolean; favorito_desde: string | null; anotacao: string | null; anotacao_de: string | null }
export interface ItemMarcado extends Marcado { existe: boolean; nome: string }
export type CelulaDePlanilha = string | number | boolean | null;
export interface AbaDePlanilha { nome: string; colunas: string[]; linhas: CelulaDePlanilha[][] }
export interface Planilha { titulo: string; abas: AbaDePlanilha[] }
export interface InfoPrograma { versao?: string; repositorio?: string; site_sigtap?: string; [chave: string]: unknown }
export interface AtualizacaoDoPrograma { atual: string; nova: { versao: string; pagina: string } | null; automatica: boolean }

// ---- Dados e primeira execução (formas conferidas contra o backend em 07/10/2026) ----
export interface OfertaSigtap { competencia: string; tamanho: number; guardado: boolean; carregado: boolean }
export interface Ofertas { servidor: string; competencias: OfertaSigtap[] }
export interface ZipsGuardados { arquivos: number; bytes: number; apagaveis: number; bytes_apagaveis: number; mantida: string | null }
export type EscopoSigtap = "nenhum" | "vigente" | "6" | "12" | "24" | "tudo";
export interface PedidoDownload { sigtap: EscopoSigtap; territorio: boolean }
export interface ArquivoCnes { tipo: string; uf: string; competencia: string; arquivo: string; bytes: number; registros_gravados: number; carregado_em: string }
export interface UfCnes { uf: string; bytes?: number; resumo?: { arquivos: ArquivoCnes[] }; erro?: string }
export interface SituacaoCnesCompleta extends SituacaoCnes { ufs: UfCnes[] }
export interface Estabelecimento { cnes: string; nome: string; municipio: string; municipio_nome: string; tipo: string; tipo_nome: string }
export interface ArquivoProducao { arquivo: string; tipo: string; uf: string; bytes: number; carregado_em: string; competencias: string[] }
export interface DefasagemProducao { sia_ate: string | null; sih_ate: string | null; sia_incompleto: string | null; sih_incompleto: string | null }
export interface UfProducao {
  uf: string; arquivos?: ArquivoProducao[]; guardados?: { arquivos: number; bytes: number };
  defasagem?: DefasagemProducao; bytes_banco?: number; erro?: string;
}
export interface SituacaoProducao { ufs: UfProducao[]; manter_brutos: boolean }
export interface ItemPlano { arquivo: string; bytes: number; competencia: string; tipo: string }
export interface PlanoProducao { uf: string; itens: ItemPlano[]; total_bytes: number; precisa_confirmar: boolean }
export interface PedidoProducao { uf: string; meses: number; confirmado: boolean }

// ---- Consultar (formas conferidas contra crates/query/src/{busca,ficha,historico,arvore,cid}.rs em 07/10/2026) ----
export interface ItemDeApoio { tabela: string; colunas: string[]; codigo: string[]; nome: string; procedimentos: number }
export interface CampoOficial {
  coluna: string; coluna_origem: string; valor: string | number | null;
  descricao?: string; situacao?: "oficial" | "sem_descricao" | "desconhecido";
  sentinela?: string; sentinela_inferida?: boolean;
  unidade?: "centavos" | "centesimos_de_percentual" | "meses";
}
export interface NomeDeCodigo { tabela: string; colunas: string[]; tabela_presente: boolean; encontrados: Record<string, string>[] }
export interface LinhaOficial { quantidade: number; campos: CampoOficial[]; nomes: NomeDeCodigo[] }
export interface RelacaoOficial { tabela: string; coluna: string; linhas: LinhaOficial[] }
export interface NivelEstrutura { nivel: "grupo" | "subgrupo" | "forma"; codigo: string; nome: string | null }
export interface Ficha {
  competencia: string; rotulo: string; codigo: string; codigo_mascarado: string;
  estrutura: NivelEstrutura[]; procedimento: LinhaOficial[]; relacoes: RelacaoOficial[];
}
export interface EventoDeHistorico {
  competencia: string; rotulo: string; tabela: string; coluna: string;
  tipo: "incluido" | "excluido" | "alterado"; chave: Record<string, string>;
  antes: LinhaOficial | null; depois: LinhaOficial | null; campos_alterados: string[];
  tabela_ausente?: boolean; tabela_voltou?: boolean;
}
export interface Historico {
  codigo: string; codigo_mascarado: string; primeira_carregada: string; ultima_carregada: string;
  competencias_carregadas: number; competencias_com_mudanca: string[]; eventos: EventoDeHistorico[];
}
export interface NoDeArvore { nivel: "grupo" | "subgrupo" | "forma" | "procedimento"; codigo: string; codigo_mascarado: string; nome: string | null; procedimentos: number }
export interface NoDeCid { nivel: "letra" | "categoria" | "subcategoria"; codigo: string; codigo_mascarado: string; nome: string | null; codigos: number; procedimentos: number }

// ---- Painel e Mudanças (sub-projeto D) ----
export interface PendenciaItem { codigo: string; nome: string | null; valor_centavos: number }
export interface Pendencia {
  id: string;
  tipo: string;
  gravidade: "atencao" | "info";
  titulo: string;
  texto: string;
  valor_envolvido_centavos: number | null;
  perda_estimada: { centavos: number; horizonte_meses: number; premissa: string } | null;
  origem: { fonte: string; competencias: string[]; conta: string; nao_prova: string };
  acao: { rotulo: string; destino: "itens" | "origem" };
  itens: PendenciaItem[];
}
export interface ResumoDeSistema {
  competencia: string; valor_centavos: number; quantidade: number;
  variacao_mes_anterior: number | null; variacao_media_3_meses: number | null;
}
export interface Oportunidade {
  codigo: string; nome: string; estado: string; uf: { valor_centavos: number };
}
export type Painel =
  | { disponivel: false; mensagem: string }
  | {
      disponivel: true; uf: string; cnes: string; aviso: string;
      sia: ResumoDeSistema | null; sih: ResumoDeSistema | null;
      rejeicoes: { por_100_aih: number | null; janela_rejeicoes: number; janela_aih: number };
      pares?: { taxa_da_unidade?: number | null; taxa_mediana_dos_pares?: number | null };
      oportunidades: { total: number; itens: Oportunidade[] | null } | null;
      pendencias: Pendencia[];
      fontes: { producao_sia_ate: string | null; producao_sih_ate: string | null; sigtap: string };
    };
export interface ValorDoProcedimento { sa: number; sh: number; sp: number; financiamento?: string | null }
export interface ValorAlterado {
  procedimento: string; nome: string | null;
  antes: ValorDoProcedimento; depois: ValorDoProcedimento;
  impacto_uf_anual_centavos: number; impacto_unidade_anual_centavos: number;
  unidade_produz: boolean; unidade_apta: boolean | null; afeta: boolean;
}
export type Impacto =
  | { disponivel: false; mensagem: string }
  | {
      disponivel: true; uf: string; cnes: string | null; de: string; para: string;
      mudancas_de_valor: number; mudancas_com_producao: number;
      impacto_uf_anual_centavos: number; impacto_unidade_anual_centavos: number;
      valores: ValorAlterado[]; aviso: string;
      excluidos_com_producao: { procedimento: string; nome: string | null; unidade_produz: boolean }[];
      exigencias_novas_com_producao: { procedimento: string; nome: string | null; unidade_produz: boolean; estado_da_unidade: string | null }[];
    };
export interface ItemDeMudanca {
  tipo: "incluido" | "excluido" | "alterado"; chave: Record<string, string>;
  antes: LinhaOficial | null; depois: LinhaOficial | null; campos_alterados: string[]; afeta?: boolean;
}
export interface TabelaDeMudanca {
  tabela: string; presente_antes: boolean; presente_depois: boolean;
  incluidos: number; excluidos: number; alterados: number;
  itens: ItemDeMudanca[]; desde: number; itens_omitidos: number; afetam?: number;
}
export interface Mudancas { de: string; para: string; tabelas: TabelaDeMudanca[]; unidade?: boolean; unidade_com_cadastro?: boolean }
