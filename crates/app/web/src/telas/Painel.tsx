import { useEffect } from "react";
import { EstadoErro, EstadoVazio, CarregandoComEspera } from "../componentes/dominio/Estados";
import { useUnidades } from "../dados/consultas";
import { useImpacto, usePainel } from "../dados/painel";
import { useSessao } from "../shell/sessao";
import { ir, lerUnidade, useRota } from "../shell/rotas";
import { rotuloCompetencia } from "../util/formatos";
import { AreasDaUnidade } from "./painel/AreasDaUnidade";
import { AvisoDeMudancas } from "./painel/AvisoDeMudancas";
import { DeOndeVem } from "./painel/DeOndeVem";
import { FaltaParaOPainel } from "./painel/FaltaParaOPainel";
import { definirOrigem } from "./painel/origemDaPendencia";
import { Pendencias } from "./painel/Pendencias";
import { Resumo } from "./painel/Resumo";
import { Unidade } from "./Unidade";
import "./painel/painel.css";

const texto = (e: unknown) => (typeof e === "string" ? e : e instanceof Error ? e.message : "Não foi possível ler o painel.");

/** O Painel e, sob ele, as subtelas da unidade (`#/painel/cadastro`, `#/painel/aptidao`, `#/painel/producao`). */
export function Painel() {
  const { resto } = useRota();
  const tela = lerUnidade(resto);
  return tela.tela === "painel" ? <PainelInicial /> : <Unidade tela={tela} />;
}

function PainelInicial() {
  const { competencia } = useSessao();
  const unidades = useUnidades();
  const minha = unidades.data?.minha ?? null;
  const painel = usePainel(competencia ?? undefined);
  const dados = painel.data?.disponivel ? painel.data : null;
  const impacto = useImpacto(undefined, competencia ?? undefined, dados !== null);

  useEffect(() => definirOrigem(null), []);

  const semUnidade = unidades.data !== undefined && !minha;
  const nomeDaUnidade = minha ? `${minha.nome.trim() || `CNES ${minha.cnes}`} (${minha.uf})` : null;
  return (
    <div className="painel">
      <h1>Painel</h1>
      {semUnidade && (
        <>
          <div className="painel__cartao">
            <EstadoVazio titulo="Nenhuma unidade escolhida" descricao="Escolha a sua unidade para ver pendências, produção e aptidão."
              acao={{ rotulo: "Escolher unidade", aoAcionar: () => ir("dados") }} />
          </div>
          <FaltaParaOPainel />
        </>
      )}
      {!semUnidade && dados && (
        <p className="painel__sub">
          {nomeDaUnidade && <span>{nomeDaUnidade} · </span>}
          Produção completa até SIA {rotuloCompetencia(dados.fontes.producao_sia_ate ?? "")} · SIH {rotuloCompetencia(dados.fontes.producao_sih_ate ?? "")}{" "}
          <DeOndeVem titulo="Produção do painel" linhas={[
            { rotulo: "Produção", texto: "SIA e SIH da unidade, só meses completos" },
            { rotulo: "Tabela", texto: `SIGTAP ${rotuloCompetencia(dados.fontes.sigtap)}` },
            { rotulo: "Cadastro", texto: "CNES da unidade" },
          ]} />
        </p>
      )}
      {!semUnidade && !dados && nomeDaUnidade && <p className="painel__sub">{nomeDaUnidade}</p>}

      {!semUnidade && painel.isPending && <CarregandoComEspera rotulo="Calculando o painel da unidade. A primeira abertura demora; as próximas são imediatas." />}
      {!semUnidade && painel.isError && <EstadoErro mensagem={texto(painel.error)} aoTentar={() => void painel.refetch()} />}
      {!semUnidade && painel.data && !painel.data.disponivel && (
        <>
          <div className="painel__cartao">
            <EstadoVazio titulo="Sem produção, não há valores nem pendências" descricao={painel.data.mensagem}
              acao={{ rotulo: "Baixar produção", aoAcionar: () => ir("dados") }} />
          </div>
        </>
      )}
      {!semUnidade && dados && (
        <>
          <Resumo painel={dados} />
          <AvisoDeMudancas impacto={impacto.data} />
          <section className="painel__areas" aria-labelledby="painel-areas">
            <h2 id="painel-areas" className="painel__secao">Áreas da unidade</h2>
            <AreasDaUnidade painel={dados} competencia={competencia ?? undefined} />
          </section>
          <section className="painel__principal" aria-labelledby="painel-pendencias">
            <h2 id="painel-pendencias" className="painel__secao">
              O que fazer agora <span className="painel__secao-sub">ordenado pelo valor envolvido</span>
            </h2>
            <Pendencias itens={dados.pendencias} />
          </section>
        </>
      )}
    </div>
  );
}
