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
  /** Terceiros contratados da unidade ativa, com o nome. */
  terceiros?: UnidadeRef[];
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
export interface Estabelecimento { cnes: string; nome: string; municipio: string; municipio_nome: string; tipo: string; tipo_nome: string | null }
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

// ---- Cadastro e Aptidão da unidade (sub-projeto E1; formas conferidas contra a CLI `unidade` e `aptidao-unidade`) ----
export interface CodigoENome { codigo: string; nome: string | null }
export interface HabilitacaoCadastrada {
  codigo: string; nome: string | null; inicio: string; fim: string; vigente: boolean;
  portaria: string; data_portaria: string; leitos: number | null;
}
export interface ServicoCadastrado {
  servico: CodigoENome; classificacao: CodigoENome; ambulatorial_sus: boolean; hospitalar_sus: boolean; terceiro: string;
}
export interface LeitoCadastrado { tipo: CodigoENome; especialidade: CodigoENome; existentes: number; sus: number; nao_sus: number }
export interface EquipamentoCadastrado { equipamento: CodigoENome; existentes: number; em_uso: number; disponivel_sus: boolean }
export interface OcupacaoCadastrada { cbo: CodigoENome; profissionais: number; atendem_sus: number }
export interface ProfissionalCadastrado {
  nome: string; cbo: CodigoENome; vinculo: CodigoENome; atende_sus: boolean;
  horas_ambulatorio: number; horas_hospital: number; horas_outros: number;
}
export interface UnidadeCompleta {
  uf: string; cnes: string; nome: string; razao_social: string; municipio: string; municipio_nome: string | null;
  pessoa_fisica: boolean; competencia_cnes: string; competencia_sigtap: string;
  ativa: boolean; guardada: boolean;
  gerais: [string, CodigoENome][];
  habilitacoes: HabilitacaoCadastrada[]; servicos: ServicoCadastrado[]; leitos: LeitoCadastrado[]; equipamentos: EquipamentoCadastrado[];
  ocupacoes: OcupacaoCadastrada[] | null; profissionais: ProfissionalCadastrado[] | null;
  tem_arquivo_de_profissionais: boolean;
}
export interface UnidadeComNome { uf: string; cnes: string; nome: string }

export type GrupoDeAptidao = "risco" | "oportunidade" | "ordem";
export type SituacaoDoItem = "nao_apta" | "servico_a_confirmar" | "fora_da_tabela" | "apta_ressalva_servico" | "apta" | "sem_exigencia";
export interface Falta { tipo: "habilitacao" | "servico" | "leito"; codigo: string; nome: string | null }
export interface ItemDeAptidao {
  codigo: string; nome: string | null; classe: string; motivo: string | null; estado: string | null;
  situacao: SituacaoDoItem; falta: Falta[];
  sia: { quantidade: number; valor_centavos: number };
  sih: { aih: number; valor_centavos: number };
  uf: { produtores_sia: number; produtores_sih: number; valor_centavos: number };
}
export interface PaginaDeAptidao {
  id: GrupoDeAptidao; itens: ItemDeAptidao[]; desde: number; itens_omitidos: number; total: number;
  /** Só na Oportunidade com "só os que a UF produz": quantos ficaram de fora porque ninguém produziu. */
  ninguem_produziu: number | null;
}
export interface ResumoDeAptidao {
  risco: { procedimentos: number; valor_da_unidade_centavos: number } | null;
  oportunidade: { procedimentos: number; com_producao_na_uf: number; valor_da_uf_centavos: number };
  ordem: { procedimentos: number; valor_da_unidade_centavos: number } | null;
}
export interface HabilitacaoComProducao {
  codigo: string; nome: string | null; vigente: boolean; inicio: string; fim: string; portaria: string; data_portaria: string;
  programa_38: boolean; procedimentos_que_citam: number; procedimentos_produzidos: number; valor_centavos: number;
}
export interface AptidaoUnidade {
  disponivel: true; uf: string; cnes: string; sem_producao: boolean;
  resumo: ResumoDeAptidao; grupo: PaginaDeAptidao | null; habilitacoes: HabilitacaoComProducao[] | null;
  avisos: { producao: string; terceirizados: string; programa_38: string; oportunidade: string; habilitacoes: string };
  /** Janela da produção usada (ausente sem produção). */
  janela?: unknown;
}

// ---- Produção da unidade (faturamento_unidade e producao_procedimentos) ----
/** Bloco opcional que não pôde ser lido: `sem_campo` (a coluna não veio nos meses carregados), `sem_dado` ou `sem_cadastro`. */
export interface Ausente { ausente: true; motivo: "sem_campo" | "sem_dado" | "sem_cadastro"; campo?: string; meses?: string[] }
export const ehAusente = (x: unknown): x is Ausente => typeof x === "object" && x !== null && (x as { ausente?: unknown }).ausente === true;
export interface MesDeCobertura { competencia: string; completo: boolean; estabelecimentos: number; sem_base: boolean }
export interface MesDaUnidade {
  competencia: string; rejeicoes: number; sia_apresentado_centavos: number | null; sia_quantidade: number; sia_valor_centavos: number;
  sih_aih: number; sih_dias: number | null; sih_valor_centavos: number;
}
export interface TendenciaDoValor { media_anterior: number; media_recente: number; sentido: "sobe" | "cai" | "estavel"; variacao_percentual: number | null }
export interface MotivoDeRejeicao {
  motivo: string; descricao: string | null; total: number; bloqueio: boolean; encerrado: boolean;
  vigencia: [string, string] | null; por_mes: [string, number][];
}
export interface MesDeRejeicao { competencia: string; rejeicoes: number; aih: number; por_100_aih: number | null; completo: boolean }
export interface ClasseDaCurva { procedimentos: number; valor_centavos: number }
export type ResumoDaCurva = Record<"A" | "B" | "C", ClasseDaCurva>;
export interface ItemDaCurva { procedimento: string; nome: string | null; classe: "A" | "B" | "C"; quantidade: number; valor_centavos: number; percentual: number; acumulado: number }
export interface CurvaDoSistema { unidade_quantidade: string; total_procedimentos: number; resumo: ResumoDaCurva; itens: ItemDaCurva[]; omitidos: number }
export interface DiferencaDeApresentado {
  procedimento: string; nome: string | null; quantidade_apresentada: number; quantidade_aprovada: number;
  valor_apresentado_centavos: number; valor_aprovado_centavos: number;
}
export interface MotivoDaDiferenca {
  codigo: string; descricao: string | null; quantidade_apresentada: number; quantidade_aprovada: number;
  valor_apresentado_centavos: number; valor_aprovado_centavos: number;
}
export interface QuantidadeAtipica {
  procedimento: string; nome: string | null; competencia: string; quantidade_apresentada: number;
  valor_apresentado_centavos: number; mediana_propria: number; mediana_uf: number | null; meses_base: number;
}
export interface Apresentado {
  competencias: string[]; valor_apresentado_centavos: number; valor_aprovado_centavos: number;
  maiores: DiferencaDeApresentado[]; motivos: MotivoDaDiferenca[] | Ausente; atipicas: QuantidadeAtipica[];
  limiares_atipica: { razao: number; meses_base: number; excesso_minimo: number }; aviso: string;
}
export interface ValorPorFinanciamento { codigo: string; nome: string | null; quantidade: number; valor_centavos: number }
export interface Instrumentos {
  aviso: string;
  da_unidade: { codigo: string; descricao: string | null; quantidade: number; valor_centavos: number }[];
  divergencias_da_uf: {
    procedimentos: number; valor_centavos: number;
    itens: { instrumento: string; nome: string | null; procedimento: string; quantidade: number; registros_do_sigtap: string[]; valor_centavos: number }[];
  };
}
export interface ComposicaoDaAih {
  aviso: string; total_centavos: number; total_uf_centavos: number; faec_centavos: number; faec_uf_centavos: number;
  opm_centavos: number; opm_uf_centavos: number; uti_centavos: number;
  tipos: { fin: string; nome: string | null; valor_centavos: number; valor_uf_centavos: number }[];
}
export interface Reapresentacao {
  aviso: string; total_centavos: number; anteriores_centavos: number; uf_total_centavos: number; uf_anteriores_centavos: number;
  meses: { competencia: string; do_mes_centavos: number; anteriores_centavos: number; uf_do_mes_centavos: number; uf_anteriores_centavos: number }[];
  origem_dos_atrasos: { competencia: string; valor_centavos: number }[];
}
export interface PerfilFinanceiro {
  aviso: string;
  marcas: { tipo: string; codigo: string; descricao: string | null }[];
  regras: { codigo: string; descricao: string | null; origem: string; quantidade: number; valor_centavos: number }[];
  complementos: { campo: string; origem: string; valor_centavos: number }[];
}
export interface ItemDeServico { codigo: string; nome: string | null; quantidade: number; situacao: string; valor_centavos: number }
export interface Servicos { aviso: string; fora_do_cadastro_centavos: number; sem_marca_sus_centavos: number; sem_servico_centavos: number; itens: ItemDeServico[] }
export interface Permanencia {
  aviso: string; analisados: number; fora_do_previsto: number; limiares: { min_aih: number; razao: number; razao_uf: number };
  itens: { procedimento: string; nome: string | null; aih: number; dias: number; media_real: number; media_uf: number; previsto: number; razao: number }[];
}
export interface LeitosEOcupacao {
  aviso: string; leitos_sus: number; leitos_existentes: number;
  por_mes: { competencia: string; aih: number; dias_de_permanencia: number | null; aih_por_leito_sus: number | null; ocupacao_percentual: number | null }[];
}
export interface ComparacaoComPares {
  pares_com_producao: number; pares_com_taxa: number; minimo_aih_para_taxa: number;
  taxa_da_unidade: number | null; taxa_mediana_dos_pares: number | null;
  valor_sia_da_unidade_centavos: number; valor_sia_percentil: number | null;
  valor_sih_da_unidade_centavos: number; valor_sih_percentil: number | null;
}
export interface GrupoDePares extends ComparacaoComPares { criterio: string; rotulo: string }
export interface Pares extends ComparacaoComPares { aviso: string; tipo: string; nome_tipo: string | null; grupos: GrupoDePares[] }
export interface FaturamentoUnidade {
  disponivel: true; uf: string; cnes: string; aviso: string;
  cobertura: { sia: MesDeCobertura[]; sih: MesDeCobertura[] };
  janela: { sia: string[]; sih: string[] }; janela_longa: { sia: string[]; sih: string[] };
  meses_completos: { sia: string[]; sih: string[] };
  meses: MesDaUnidade[];
  sem_campos_novos: string[]; tem_rejeicoes: boolean;
  ano_anterior: { sia: unknown; sih: unknown };
  tendencia: { sia_valor: TendenciaDoValor | null; sih_valor: TendenciaDoValor | null; criterio: string };
  rejeicoes: {
    janela_rejeicoes: number; janela_aih: number; por_100_aih: number | null; por_mes: MesDeRejeicao[];
    motivos: MotivoDeRejeicao[]; motivos_total: number; aviso: string;
  };
  abc: { sia: CurvaDoSistema; sih: CurvaDoSistema };
  apresentado: Apresentado | null;
  financiamento: { sia: ValorPorFinanciamento[]; sih: ValorPorFinanciamento[] };
  permanencia: Permanencia | Ausente | null;
  leitos: LeitosEOcupacao | null;
  pares: Pares | null;
  instrumentos: Instrumentos | Ausente | null;
  composicao_aih: ComposicaoDaAih | Ausente | null;
  reapresentacao: Reapresentacao | Ausente | null;
  perfil: PerfilFinanceiro | Ausente | null;
  servicos: Servicos | Ausente | null;
}
export interface FaturamentoIndisponivel { disponivel: false; uf: string; mensagem: string }
export interface ItemDeProducao {
  procedimento: string; nome: string | null; classe: "A" | "B" | "C"; quantidade: number; valor_centavos: number; percentual: number; acumulado: number;
}
export interface ProcedimentosDaUnidade {
  disponivel: true; uf: string; cnes: string; origem: "sia" | "sih"; unidade_quantidade: string; janela: string[];
  total_geral: number; total: number; resumo: ResumoDaCurva; valor_total_centavos: number;
  itens: ItemDeProducao[]; desde: number; itens_omitidos: number;
}
