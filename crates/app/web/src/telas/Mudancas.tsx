import { mudou } from "../api/comandos";
import type { AbaDePlanilha, ItemDeMudanca, Planilha, TabelaDeMudanca, ValorAlterado } from "../api/tipos";
import { Carregando, EstadoErro, EstadoVazio } from "../componentes/dominio/Estados";
import { useSituacao, useUnidades } from "../dados/consultas";
import { useImpacto, useMudancas } from "../dados/painel";
import { caminhoMudancas, ir, lerMudancas, substituir, useRota } from "../shell/rotas";
import { useSessao } from "../shell/sessao";
import { inteiro, ordenarCompetencias, rotuloCompetencia } from "../util/formatos";
import { Exportar } from "./consultar/Exportar";
import { Filtros } from "./mudancas/Filtros";
import { descreverItem, nomeDoProcedimento, ROTULO_DA_MUDANCA, totalDoValor, variacaoDoValor } from "./mudancas/modelo";
import { ResumoMudancas } from "./mudancas/ResumoMudancas";
import { SecoesTecnicas } from "./mudancas/SecoesTecnicas";
import { TabelaDeValores } from "./mudancas/TabelaDeValores";
import "./mudancas/mudancas.css";

const texto = (e: unknown) => (typeof e === "string" ? e : e instanceof Error ? e.message : "Não foi possível ler as mudanças.");
const reaisNumero = (centavos: number) => centavos / 100;

/** Todas as páginas de uma tabela de mudanças (o Rust devolve em blocos). */
async function todosOsItens(de: string, para: string, t: TabelaDeMudanca, soAfeta: boolean): Promise<ItemDeMudanca[]> {
  const itens = [...t.itens];
  let atual = t;
  while (atual.itens_omitidos > 0) {
    const desde = atual.desde + (atual.incluidos + atual.excluidos + atual.alterados - atual.desde - atual.itens_omitidos);
    const proxima = (await mudou(de, para, { tabela: t.tabela, desde, soAfeta })).tabelas[0];
    if (!proxima || proxima.itens.length + proxima.itens_omitidos === 0) break;
    itens.push(...proxima.itens);
    atual = proxima;
  }
  return itens;
}

function abaDeValores(valores: ValorAlterado[]): AbaDePlanilha {
  return {
    nome: "Valores alterados",
    colunas: ["Procedimento", "Nome", "Antes (R$)", "Depois (R$)", "Variação (%)", "Impacto na unidade (R$/ano)", "Impacto na UF (R$/ano)", "Produz", "Apta"],
    linhas: valores.map((v) => {
      const p = variacaoDoValor(v.antes, v.depois);
      return [v.procedimento, v.nome, reaisNumero(totalDoValor(v.antes)), reaisNumero(totalDoValor(v.depois)), p === null ? null : Math.round(p * 10) / 10,
        reaisNumero(v.impacto_unidade_anual_centavos), reaisNumero(v.impacto_uf_anual_centavos), v.unidade_produz ? "sim" : "não", v.unidade_apta === null ? null : v.unidade_apta ? "sim" : "não"];
    }),
  };
}

export function Mudancas() {
  const { resto } = useRota();
  const rota = lerMudancas(resto);
  const { competencia } = useSessao();
  const situacao = useSituacao();
  const unidades = useUnidades();
  const temUnidade = !!unidades.data?.minha;

  const competencias = ordenarCompetencias(situacao.data?.competencias ?? []);
  const carregadas = competencias.map((c) => c.competencia);
  const maisRecente = carregadas.at(-1) ?? null;
  const para = rota.para && carregadas.includes(rota.para) ? rota.para : competencia && carregadas.includes(competencia) ? competencia : maisRecente;
  const anterior = para ? carregadas.filter((c) => c < para).at(-1) ?? null : null;
  const de = rota.de && para && rota.de < para && carregadas.includes(rota.de) ? rota.de : anterior;
  const soAfeta = rota.soAfeta && temUnidade;
  const pronto = de !== null && para !== null;

  const impacto = useImpacto(de ?? undefined, para ?? undefined, pronto);
  const mud = useMudancas(de ?? undefined, para ?? undefined, soAfeta, pronto);

  const cabeca = <h1>Mudanças</h1>;
  if (situacao.isPending) return <div className="mud">{cabeca}<Carregando rotulo="Lendo as competências carregadas" /></div>;
  if (situacao.isError) return <div className="mud">{cabeca}<EstadoErro mensagem={texto(situacao.error)} aoTentar={() => void situacao.refetch()} /></div>;
  if (!pronto) {
    const so1 = carregadas.length <= 1;
    return (
      <div className="mud">
        {cabeca}
        <div className="mud__cartao">
          <EstadoVazio titulo={so1 ? "Só há uma competência carregada" : "Não há competência anterior"}
            descricao={so1 ? para ? `Para comparar, baixe pelo menos uma competência anterior a ${rotuloCompetencia(para)}.` : "Baixe pelo menos duas competências para comparar." : `Escolha uma competência mais recente que ${rotuloCompetencia(carregadas[0] ?? "")}.`}
            acao={{ rotulo: "Baixar competências em Dados", aoAcionar: () => ir("dados") }} />
        </div>
      </div>
    );
  }

  const valores = impacto.data?.disponivel ? impacto.data.valores : [];
  const mostrados = soAfeta ? valores.filter((v) => v.afeta) : valores;
  const afetam = valores.filter((v) => v.afeta).length;
  const resumo = impacto.data?.disponivel
    ? `${inteiro(impacto.data.mudancas_de_valor)} mudanças de valor${temUnidade ? ` · ${afetam === 1 ? "1 afeta" : `${inteiro(afetam)} afetam`} a unidade` : ""}`
    : undefined;
  const mudarFiltros = (v: { de: string; para: string; soAfeta: boolean }) => substituir("mudancas", ...caminhoMudancas(v));

  const montarPlanilha = async (): Promise<Planilha> => {
    const abas: AbaDePlanilha[] = [abaDeValores(mostrados)];
    for (const t of mud.data?.tabelas ?? []) {
      if (t.incluidos + t.excluidos + t.alterados === 0) continue;
      const itens = await todosOsItens(de, para, t, soAfeta);
      abas.push({
        nome: t.tabela.slice(0, 31), colunas: ["Procedimento", "Nome", "Detalhe", "Mudança", "Afeta"],
        linhas: itens.map((i) => [i.chave.co_procedimento ?? null, nomeDoProcedimento(i), descreverItem(i) || Object.values(i.chave).join(" · "), ROTULO_DA_MUDANCA[i.tipo], i.afeta === undefined ? null : i.afeta ? "sim" : "não"]),
      });
    }
    return { titulo: `Mudanças ${rotuloCompetencia(de)} para ${rotuloCompetencia(para)}`, abas };
  };

  return (
    <div className="mud">
      <header className="mud__cabeca">
        {cabeca}
        <div className="mud__exportar">
          <Exportar montar={montarPlanilha} nome="mudancas" mensagemOk={(p) => `${inteiro(p.abas.reduce((s, a) => s + a.linhas.length, 0))} linhas exportadas.`} />
        </div>
      </header>
      <Filtros competencias={competencias} de={de} para={para} soAfeta={soAfeta} temUnidade={temUnidade} resumo={resumo} aoMudar={mudarFiltros} />

      {temUnidade && mud.data?.unidade_com_cadastro === false && <p className="mud__aviso">Sem o cadastro do CNES desta unidade, o filtro considera só o que ela produz.</p>}
      {impacto.isPending && <Carregando rotulo="Calculando o impacto das mudanças" />}
      {impacto.isError && <EstadoErro mensagem={texto(impacto.error)} aoTentar={() => void impacto.refetch()} />}
      {impacto.data && !impacto.data.disponivel && (
        <div className="mud__cartao">
          <EstadoVazio titulo="Sem impacto calculado" descricao={impacto.data.mensagem} acao={{ rotulo: "Abrir em Dados", aoAcionar: () => ir("dados") }} />
        </div>
      )}
      {impacto.data?.disponivel && (
        <>
          <ResumoMudancas impacto={impacto.data} mudancas={mud.data} />
          <p className="mud__aviso">{impacto.data.aviso}</p>
          <section aria-labelledby="mud-valores" className="mud__bloco">
            <h2 id="mud-valores" className="mud__secao-grupo">Valores alterados <span className="mud__dica">ordenados pelo impacto na UF</span></h2>
            <TabelaDeValores valores={mostrados} soAfeta={soAfeta} />
          </section>
        </>
      )}
      {mud.isError && <EstadoErro mensagem={texto(mud.error)} aoTentar={() => void mud.refetch()} />}
      {mud.data && <SecoesTecnicas key={`${de}-${para}-${soAfeta}`} mudancas={mud.data} de={de} para={para} soAfeta={soAfeta} />}
    </div>
  );
}
