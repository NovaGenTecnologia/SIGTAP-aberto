import { chamar } from "./tauri";
import type {
  AtualizacaoDoPrograma, Busca, ItemMarcado, Marcado, Planilha, Ficha, Historico, ItemProcedimento, NoDeArvore, NoDeCid, Estabelecimento, Fonte, InfoPrograma, Ofertas, Quando, PedidoDownload, PedidoProducao, PlanoProducao,
  Situacao, SituacaoCnesCompleta, SituacaoProducao,
} from "./tipos";

export const situacao = () => chamar<Situacao>("situacao");
export const cnesSituacao = () => chamar<SituacaoCnesCompleta>("cnes_situacao");
export const unidadeDefinir = (uf: string, cnes: string) => chamar<unknown>("unidade_definir", { uf, cnes });
export const buscar = (texto: string, competencia?: string) =>
  chamar<Busca>("buscar", { competencia: competencia ?? null, texto });
/** A mesma busca, com todos os procedimentos encontrados (a lista da tela pára em 200). */
export const buscarTodos = (texto: string, competencia?: string) =>
  chamar<Busca>("buscar_todos", { competencia: competencia ?? null, texto });
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
