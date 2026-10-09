import { chamar } from "./tauri";
import type {
  AtualizacaoDoPrograma, Busca, BuscaPaginada, FiltrosDaBusca, ItemMarcado, Marcado, Planilha, Ficha, Historico, ItemProcedimento, NoDeArvore, NoDeCid, Estabelecimento, Fonte, InfoPrograma, Ofertas, Quando, PedidoDownload, PedidoProducao, PlanoProducao,
  Situacao, SituacaoCnesCompleta, SituacaoProducao, Painel, Impacto, Mudancas,
  UnidadeCompleta, AptidaoUnidade, GrupoDeAptidao, UnidadeComNome, FaturamentoUnidade, FaturamentoIndisponivel, ProcedimentosDaUnidade,
} from "./tipos";

export const situacao = () => chamar<Situacao>("situacao");
export const cnesSituacao = () => chamar<SituacaoCnesCompleta>("cnes_situacao");
export const unidadeDefinir = (uf: string, cnes: string) => chamar<unknown>("unidade_definir", { uf, cnes });
export const buscar = (texto: string, competencia?: string) =>
  chamar<Busca>("buscar", { competencia: competencia ?? null, texto });
/** A mesma busca, com todos os procedimentos encontrados (a lista da tela pára em 200). */
export const buscarTodos = (texto: string, competencia?: string) =>
  chamar<Busca>("buscar_todos", { competencia: competencia ?? null, texto });
/** Uma página (100 procedimentos) da busca, com filtros e a contagem das opções de filtro. */
export const buscarPagina = (texto: string, filtros: FiltrosDaBusca, pagina: number, competencia?: string) =>
  chamar<BuscaPaginada>("buscar_pagina", { competencia: competencia ?? null, texto, filtros, pagina });
/** Todos os procedimentos que passam nos filtros, para exportar. */
export const buscarExportar = (texto: string, filtros: FiltrosDaBusca, competencia?: string) =>
  chamar<Busca>("buscar_exportar", { competencia: competencia ?? null, texto, filtros });
export const ficha = (codigo: string, competencia?: string) =>
  chamar<Ficha | null>("ficha", { competencia: competencia ?? null, codigo });
export const historico = (codigo: string) => chamar<Historico>("historico", { codigo });
export const arvore = (pai: string | null, competencia?: string) =>
  chamar<NoDeArvore[]>("arvore", { competencia: competencia ?? null, pai });
export const arvoreCid = (pai: string | null, competencia?: string) =>
  chamar<NoDeCid[]>("arvore_cid", { competencia: competencia ?? null, pai });
export const ligados = (tabela: string, codigo: string[], competencia?: string) =>
  chamar<ItemProcedimento[]>("ligados", { competencia: competencia ?? null, tabela, codigo });
export type TipoMarcado = "procedimento" | "cid";
export const marcado = (tipo: TipoMarcado, codigo: string) => chamar<Marcado>("marcado", { tipo, codigo });
export const marcarFavorito = (tipo: TipoMarcado, codigo: string, favorito: boolean) => chamar<Marcado>("marcar_favorito", { tipo, codigo, favorito });
export const anotar = (tipo: TipoMarcado, codigo: string, texto: string) => chamar<Marcado>("anotar", { tipo, codigo, texto });
export const marcados = (tipo: TipoMarcado, competencia?: string) => chamar<ItemMarcado[]>("marcados", { tipo, competencia: competencia ?? null });
/** Abre o "Salvar como"; devolve o caminho salvo, ou null se a pessoa desistiu. */
export const exportar = (planilha: Planilha, nome: string, aba?: number) =>
  chamar<string | null>("exportar", { planilha, nome, aba: aba ?? null });
export const infoPrograma = () => chamar<InfoPrograma>("info_programa");
export const abrirSite = (url: string) => chamar<void>("abrir_site", { url });
export const consultarAtualizacao = () => chamar<AtualizacaoDoPrograma>("consultar_atualizacao");

export const ofertas = (deNovo = false) => chamar<Ofertas>("ofertas", { deNovo });
export const baixar = (pedido: PedidoDownload, quando?: Quando) => chamar<void>("baixar", { pedido, quando });
export const importar = (pasta: string, quando?: Quando) => chamar<void>("importar", { pasta, quando });
export const fecharPrograma = () => chamar<void>("fechar_programa");
export const cancelar = (fonte?: Fonte) => (fonte ? chamar<void>("cancelar", { fonte }) : chamar<void>("cancelar"));
export const apagarZips = () => chamar<string>("apagar_zips");
export const escolherPasta = () => chamar<string | null>("escolher_pasta");

export type FaseCnes = "tudo" | "busca" | "restante" | "pessoas";
export const cnesBaixar = (uf: string, opcoes: { competencia?: string; fase?: FaseCnes; quando?: Quando } = {}) =>
  chamar<void>("cnes_baixar", { pedido: { uf, competencia: opcoes.competencia ?? "", fase: opcoes.fase ?? "tudo" }, quando: opcoes.quando });
export const cnesImportar = (pasta: string, uf: string, quando?: Quando) => chamar<void>("cnes_importar", { pasta, uf, quando });
export const cnesApagar = (uf: string) => chamar<string>("cnes_apagar", { uf });
export const cnesVerificar = () => chamar<unknown>("cnes_verificar");
export const cnesBuscar = (uf: string, texto: string) => chamar<Estabelecimento[]>("cnes_buscar", { uf, texto });

export const producaoSituacao = () => chamar<SituacaoProducao>("producao_situacao");
export const producaoPlano = (uf: string, meses: number) => chamar<PlanoProducao>("producao_plano", { uf, meses });
export const producaoBaixar = (pedido: PedidoProducao, quando?: Quando) => chamar<void>("producao_baixar", { pedido, quando });
export const producaoImportar = (pasta: string, uf: string, quando?: Quando) => chamar<void>("producao_importar", { pasta, uf, quando });
export const producaoApagar = (uf: string) => chamar<string>("producao_apagar", { uf });
export const producaoReconstruir = (uf: string) => chamar<void>("producao_reconstruir", { uf });
export const producaoApagarGuardados = (uf: string) => chamar<string>("producao_apagar_guardados", { uf });
export const manterBrutosDefinir = (ligada: boolean) => chamar<boolean>("manter_brutos_definir", { ligada });

export const verificarBancos = (completo: boolean) => chamar<unknown>("verificar_bancos", { completo });
export const recriarBanco = (forcar = true) => chamar<void>("recriar_banco", { forcar });

export const faturamentoPainel = (competencia?: string) =>
  chamar<Painel>("faturamento_painel", { competencia: competencia ?? null });
export const faturamentoImpacto = (de?: string, para?: string) =>
  chamar<Impacto>("faturamento_impacto", { de: de ?? null, para: para ?? null });
/** O que mudou entre duas competências, com a marca `afeta` da unidade ativa; `tabela`/`desde` pedem mais itens de uma tabela. */
export const mudou = (de: string | undefined, para: string | undefined, opcoes: { tabela?: string; desde?: number; soAfeta?: boolean } = {}) =>
  chamar<Mudancas>("mudou", { de: de ?? null, para: para ?? null, tabela: opcoes.tabela ?? null, desde: opcoes.desde ?? null, soAfeta: opcoes.soAfeta ?? false });

/** A unidade ativa, ou a indicada, com cadastro completo (sem CPF). */
export const unidadeVer = (competencia?: string, alvo?: { uf: string; cnes: string }) =>
  chamar<UnidadeCompleta>("unidade_ver", { competencia: competencia ?? null, uf: alvo?.uf ?? null, cnes: alvo?.cnes ?? null });
export interface OpcoesDeAptidao { grupo?: GrupoDeAptidao; q?: string; hab?: string; desde?: number; soProduzidosNaUf?: boolean; competencia?: string }
/** Resumo por prioridade; com `grupo`, a página (50 itens) desse grupo. */
export const aptidaoUnidade = (o: OpcoesDeAptidao = {}) =>
  chamar<AptidaoUnidade>("aptidao_unidade", {
    competencia: o.competencia ?? null, grupo: o.grupo ?? null, q: o.q ?? null, hab: o.hab ?? null,
    desde: o.desde ?? null, soProduzidosNaUf: o.soProduzidosNaUf ?? false,
  });
/** Rejeições, tendência, curva ABC, apresentado × aprovado, financiamento, leitos e pares da unidade (a ativa, ou a indicada). */
export const faturamentoUnidade = (competencia?: string, alvo?: { uf: string; cnes: string }) =>
  chamar<FaturamentoUnidade | FaturamentoIndisponivel>("faturamento_unidade", { competencia: competencia ?? null, uf: alvo?.uf ?? null, cnes: alvo?.cnes ?? null });
export interface OpcoesDeProcedimentos {
  origem: "sia" | "sih"; q?: string; classe?: "A" | "B" | "C"; ordem?: "valor" | "quantidade"; desde?: number;
  competencia?: string; alvo?: { uf: string; cnes: string };
}
/** Os procedimentos da unidade por valor (50 por página), com a classe da curva ABC. */
export const producaoProcedimentos = (o: OpcoesDeProcedimentos) =>
  chamar<ProcedimentosDaUnidade | FaturamentoIndisponivel>("producao_procedimentos", {
    competencia: o.competencia ?? null, uf: o.alvo?.uf ?? null, cnes: o.alvo?.cnes ?? null, origem: o.origem,
    q: o.q ?? null, classe: o.classe ?? null, ordem: o.ordem ?? null, desde: o.desde ?? null,
  });
export const terceiroAdicionar = (uf: string, cnes: string, terceiroUf: string, terceiroCnes: string) =>
  chamar<unknown>("terceiro_adicionar", { uf, cnes, terceiroUf, terceiroCnes });
export const terceiroRemover = (uf: string, cnes: string, terceiroUf: string, terceiroCnes: string) =>
  chamar<void>("terceiro_remover", { uf, cnes, terceiroUf, terceiroCnes });
export const unidadesBuscar = (texto: string) => chamar<(UnidadeComNome & { municipio_nome: string; tipo_nome: string | null })[]>("unidades_buscar", { texto });
