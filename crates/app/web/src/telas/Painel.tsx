import { EstadoErro, EstadoVazio, Carregando } from "../componentes/dominio/Estados";
import { useUnidades } from "../dados/consultas";
import { useImpacto, usePainel } from "../dados/painel";
import { useSessao } from "../shell/sessao";
import { ir } from "../shell/rotas";
import { rotuloCompetencia } from "../util/formatos";
import { DeOndeVem } from "./painel/DeOndeVem";
import { FaltaParaOPainel } from "./painel/FaltaParaOPainel";
import { AptosQueNaoProduzem, CartaoDaUnidade } from "./painel/Lateral";
import { Pendencias } from "./painel/Pendencias";
import { Resumo } from "./painel/Resumo";
import "./painel/painel.css";

const texto = (e: unknown) => (typeof e === "string" ? e : e instanceof Error ? e.message : "Não foi possível ler o painel.");

export function Painel() {
  const { competencia } = useSessao();
  const unidades = useUnidades();
  const minha = unidades.data?.minha ?? null;
  const painel = usePainel(competencia ?? undefined);
  const dados = painel.data?.disponivel ? painel.data : null;
  const impacto = useImpacto(undefined, competencia ?? undefined, dados !== null);

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

      {!semUnidade && painel.isPending && <Carregando rotulo="Lendo o painel da unidade" />}
      {!semUnidade && painel.isError && <EstadoErro mensagem={texto(painel.error)} aoTentar={() => void painel.refetch()} />}
      {!semUnidade && painel.data && !painel.data.disponivel && (
        <>
          <div className="painel__cartao">
            <EstadoVazio titulo="Sem produção, não há valores nem pendências" descricao={painel.data.mensagem}
              acao={{ rotulo: "Baixar produção", aoAcionar: () => ir("dados") }} />
          </div>
          <div className="painel__corpo painel__corpo--sozinho"><CartaoDaUnidade /></div>
        </>
      )}
      {!semUnidade && dados && (
        <>
          <Resumo painel={dados} impacto={impacto.data} />
          <div className="painel__corpo">
            <section className="painel__principal" aria-labelledby="painel-pendencias">
              <h2 id="painel-pendencias" className="painel__secao">
                Pendências <span className="painel__secao-sub">ordenadas pelo valor envolvido</span>
              </h2>
              <Pendencias itens={dados.pendencias} />
            </section>
            <aside className="painel__lateral" aria-label="Unidade">
              <AptosQueNaoProduzem painel={dados} />
              <CartaoDaUnidade />
            </aside>
          </div>
        </>
      )}
    </div>
  );
}
