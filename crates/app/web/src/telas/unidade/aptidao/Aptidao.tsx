import { useEffect, useMemo, useState } from "react";
import type { GrupoDeAptidao, ItemDeAptidao, Planilha, ResumoDeAptidao, UnidadeCompleta } from "../../../api/tipos";
import { Botao } from "../../../componentes/base/Botao";
import { CampoBusca } from "../../../componentes/base/CampoBusca";
import { Carregando, EstadoErro } from "../../../componentes/dominio/Estados";
import { SeloDeConfianca } from "../../../componentes/dominio/SeloDeConfianca";
import { useAptidao, useAptidaoResumo } from "../../../dados/unidade";
import { caminhoUnidade, ir, substituir, type TelaDaUnidade } from "../../../shell/rotas";
import { useDebounce } from "../../../shell/useDebounce";
import { inteiro } from "../../../util/formatos";
import { DeOndeVem } from "../../painel/DeOndeVem";
import { Exportar } from "../../consultar/Exportar";
import { CabecalhoDaUnidade } from "../CabecalhoDaUnidade";
import { FaixaDePrioridade } from "./FaixaDePrioridade";
import { colunasDe, ListaDeAptidao } from "./ListaDeAptidao";

const texto = (e: unknown) => (typeof e === "string" ? e : e instanceof Error ? e.message : "Não foi possível ler a aptidão.");

const NOME: Record<GrupoDeAptidao, string> = { risco: "em risco", oportunidade: "em oportunidade", ordem: "em ordem" };
const VAZIO: Record<GrupoDeAptidao, string> = {
  risco: "Nenhum procedimento em risco", oportunidade: "Nenhum procedimento apto para mostrar", ordem: "Nenhum procedimento em ordem",
};

/** O primeiro grupo com procedimentos, na ordem Risco, Oportunidade, Em ordem; sem produção, só a Oportunidade. */
function grupoInicial(r: ResumoDeAptidao, semProducao: boolean): GrupoDeAptidao {
  if (semProducao) return "oportunidade";
  if ((r.risco?.procedimentos ?? 0) > 0) return "risco";
  if (r.oportunidade.procedimentos > 0) return "oportunidade";
  if ((r.ordem?.procedimentos ?? 0) > 0) return "ordem";
  return "risco";
}

function planilhaDe(grupo: GrupoDeAptidao, itens: ItemDeAptidao[]): Planilha {
  const colunas = colunasDe(grupo, itens);
  return {
    titulo: `Aptidão: procedimentos ${NOME[grupo]}`,
    abas: [{ nome: "Aptidão", colunas: ["Nome", ...colunas.map((c) => c.rotulo)], linhas: itens.map((i) => [i.nome, ...colunas.map((c) => c.texto(i))]) }],
  };
}

/** Aptidão da unidade por prioridade: Risco, Oportunidade e Em ordem. O grupo, a busca e a habilitação moram na rota. */
export function Aptidao({ unidade, rota, competencia }: { unidade: UnidadeCompleta; rota: Extract<TelaDaUnidade, { tela: "aptidao" }>; competencia?: string }) {
  const idUnidade = `${unidade.uf}:${unidade.cnes}`;
  const resumo = useAptidaoResumo(competencia, idUnidade);
  const semProducao = resumo.data?.sem_producao ?? false;
  const alvo: GrupoDeAptidao | null = resumo.data
    ? (rota.grupo === null || (semProducao && rota.grupo !== "oportunidade") ? grupoInicial(resumo.data.resumo, semProducao) : rota.grupo)
    : null;
  const [todos, setTodos] = useState(false);
  const [digitado, setDigitado] = useState(rota.q);
  const q = useDebounce(digitado, 300);

  useEffect(() => {
    if (alvo && alvo !== rota.grupo) substituir("painel", ...caminhoUnidade({ tela: "aptidao", grupo: alvo, q: rota.q, hab: rota.hab }));
  }, [alvo, rota.grupo, rota.q, rota.hab]);
  useEffect(() => {
    // Voltar/avançar muda a rota por fora: o campo acompanha (o eco da própria digitação já é igual a `q`).
    if (rota.q !== q) setDigitado(rota.q);
    // só a rota manda aqui
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rota.q]);
  useEffect(() => {
    if (q !== rota.q && alvo) substituir("painel", ...caminhoUnidade({ tela: "aptidao", grupo: alvo, q, hab: rota.hab }));
    // só a pausa de digitação mexe na rota
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  const lista = useAptidao(alvo, { q: rota.q, hab: rota.hab, soProduzidosNaUf: alvo === "oportunidade" && !todos && !semProducao, competencia, unidade: idUnidade });
  const paginas = lista.data?.pages ?? [];
  const itens = useMemo(() => {
    const vistos = new Map<string, ItemDeAptidao>();
    for (const p of paginas) for (const i of p.grupo?.itens ?? []) if (!vistos.has(i.codigo)) vistos.set(i.codigo, i);
    return [...vistos.values()];
  }, [paginas]);
  const ultima = paginas.at(-1)?.grupo ?? null;
  const total = ultima?.total ?? 0;
  const dados = resumo.data;

  const cabeca = (acoes?: React.ReactNode) => <CabecalhoDaUnidade tela="aptidao" unidade={unidade} acoes={acoes} />;
  if (resumo.isPending) return <div className="un">{cabeca()}<Carregando rotulo="Lendo a aptidão da unidade" /></div>;
  if (resumo.isError || !dados || !alvo) {
    return <div className="un">{cabeca()}<EstadoErro mensagem={texto(resumo.error)} aoTentar={() => void resumo.refetch()} /></div>;
  }

  const colunas = colunasDe(alvo, itens);
  return (
    <div className="un">
      {cabeca()}
      {semProducao && (
        <p className="un__aviso" role="note">
          <span>Sem produção carregada para {dados.uf}: mostrando só o cadastro</span>
          <Botao onPress={() => ir("dados")}>Baixar produção</Botao>
        </p>
      )}
      <FaixaDePrioridade resumo={dados.resumo} semProducao={semProducao} ativo={alvo} q={rota.q} hab={rota.hab} />

      <div className="un__bloco">
        <div className="un__barra">
          <CampoBusca rotulo="Buscar por código ou nome" value={digitado} onChange={setDigitado} />
          <span className="un__contagem">{lista.data ? `${inteiro(total)} ${total === 1 ? "procedimento" : "procedimentos"}` : ""}</span>
          {rota.hab && (
            <button type="button" className="un__filtro" aria-label={`Remover filtro da habilitação ${rota.hab}`}
              onClick={() => substituir("painel", ...caminhoUnidade({ tela: "aptidao", grupo: alvo, q: rota.q, hab: null }))}>
              Habilitação {rota.hab} <span aria-hidden="true">×</span>
            </button>
          )}
          <span className="un__barra-fim">
            <Exportar montar={() => planilhaDe(alvo, itens)} nome={`aptidao-${alvo}`}
              mensagemOk={(p) => {
                const n = p.abas[0]?.linhas.length ?? 0;
                return n < total ? `${inteiro(n)} de ${inteiro(total)} linhas exportadas; use Ver mais para incluir as outras.` : `${inteiro(n)} linhas exportadas.`;
              }} />
          </span>
        </div>

        {lista.isPending && <Carregando rotulo="Lendo os procedimentos" />}
        {lista.isError && <EstadoErro mensagem={texto(lista.error)} aoTentar={() => void lista.refetch()} />}
        {lista.data && (
          <div className="un__cartao">
            {itens.length > 0 && <ListaDeAptidao rotulo={`Procedimentos ${NOME[alvo]}`} colunas={colunas} itens={itens} />}
            {itens.length === 0 && (
              <p className="un__vazio">
                {rota.q.trim() ? `Nenhum resultado para «${rota.q.trim()}»` : rota.hab ? `Nenhum procedimento ${NOME[alvo]} para a habilitação ${rota.hab}` : VAZIO[alvo]}
              </p>
            )}
          </div>
        )}
        {lista.hasNextPage && (
          <button type="button" className="un__mais" disabled={lista.isFetchingNextPage} onClick={() => void lista.fetchNextPage()}>
            {lista.isFetchingNextPage ? "Carregando…" : `Ver mais (${inteiro(ultima?.itens_omitidos ?? 0)} restantes)`}
          </button>
        )}
        {alvo === "oportunidade" && !semProducao && !todos && (ultima?.ninguem_produziu ?? 0) > 0 && (
          <button type="button" className="un__mais" onClick={() => setTodos(true)}>
            Mostrar também os {inteiro(ultima?.ninguem_produziu ?? 0)} que ninguém produziu
          </button>
        )}
        {alvo === "oportunidade" && todos && (
          <button type="button" className="un__mais" onClick={() => setTodos(false)}>Mostrar só os que a UF produziu</button>
        )}
      </div>

      <p className="un__limites">
        <SeloDeConfianca estado="nao-confirmada" texto="Regra não confirmada" />
        <span>{dados.avisos.terceirizados}</span>
        <DeOndeVem titulo="Aptidão da unidade" linhas={[
          { rotulo: "Fonte", texto: "SIA e SIH da unidade, só meses completos, e o CNES da unidade" },
          { rotulo: "Oportunidade", texto: dados.avisos.oportunidade },
          { rotulo: "Habilitações", texto: dados.avisos.habilitacoes },
          { rotulo: "Programa 38", texto: dados.avisos.programa_38 },
          { rotulo: "Terceirizados", texto: dados.avisos.terceirizados },
        ]} />
      </p>
    </div>
  );
}
