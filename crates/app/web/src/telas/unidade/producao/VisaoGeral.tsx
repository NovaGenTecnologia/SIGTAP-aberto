import type { FaturamentoUnidade, MesDaUnidade, Pendencia, Planilha } from "../../../api/tipos";
import { usePainel } from "../../../dados/painel";
import { ir } from "../../../shell/rotas";
import { inteiro, rotuloCompetencia } from "../../../util/formatos";
import { DeOndeVem } from "../../painel/DeOndeVem";
import { DESTINO_NA_UNIDADE } from "../../painel/Pendencias";
import { Exportar } from "../../consultar/Exportar";
import { NoCabecalho } from "./AcoesDaProducao";
import { CartaoDeFechamento, type TomDoSentido } from "./CartaoDeFechamento";
import { SerieDoMes } from "./SerieDoMes";
import { faixaDeCobertura, oQueOlhar, sentidoDe, temSia, temSih, ultimoCompleto, valorCompacto } from "./util";

const decimal2 = new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const percentil = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 1 });
const TOM_DO_SENTIDO: Record<"sobe" | "cai" | "estável", TomDoSentido> = { sobe: "ok", cai: "atencao", estável: "neutro" };


function planilhaDosMeses(f: FaturamentoUnidade): Planilha {
  const situacao = (completos: string[], m: MesDaUnidade) => (completos.includes(m.competencia) ? "Completo" : "Incompleto");
  return {
    titulo: "Produção da unidade: visão geral",
    abas: [{
      nome: "Meses",
      colunas: ["Competência", "SIA aprovado", "SIA apresentado", "SIA situação", "SIH aprovado", "AIH", "SIH situação", "Rejeições", "Rejeições por 100 AIH"],
      linhas: f.meses.map((m) => [
        rotuloCompetencia(m.competencia), m.sia_valor_centavos / 100, m.sia_apresentado_centavos === null ? null : m.sia_apresentado_centavos / 100, situacao(f.meses_completos.sia, m),
        m.sih_valor_centavos / 100, m.sih_aih, situacao(f.meses_completos.sih, m), m.rejeicoes,
        m.sih_aih > 0 ? Math.round((m.rejeicoes * 10_000) / m.sih_aih) / 100 : null,
      ]),
    }],
  };
}

function CartaoDeSistema({ sistema, f, mes, valor }: { sistema: "SIA" | "SIH"; f: FaturamentoUnidade; mes: MesDaUnidade | null; valor: number }) {
  const tendencia = sentidoDe(sistema === "SIA" ? f.tendencia.sia_valor : f.tendencia.sih_valor);
  return (
    <CartaoDeFechamento
      rotulo={mes ? `${sistema} aprovado em ${rotuloCompetencia(mes.competencia)}` : `${sistema} aprovado`}
      valor={mes ? valorCompacto(valor) : "—"}
      sentido={tendencia && { texto: `${tendencia.sinal} ${tendencia.texto}`, tom: TOM_DO_SENTIDO[tendencia.rotulo] }}
      referencia={tendencia ? ["contra os 3 meses anteriores"] : [mes ? "poucos meses para comparar" : "nenhum mês completo"]}
    />
  );
}

function CartaoDeRejeicoes({ f }: { f: FaturamentoUnidade }) {
  const { por_100_aih: taxa, janela_aih: aih, janela_rejeicoes: rejeicoes } = f.rejeicoes;
  const minimo = f.pares?.minimo_aih_para_taxa ?? 50;
  const mediana = f.pares?.taxa_mediana_dos_pares ?? null;
  let sentido: { texto: string; tom: TomDoSentido } | null = null;
  const referencia: string[] = [];
  if (taxa !== null && aih < minimo) referencia.push("poucas AIH para comparar");
  else if (taxa !== null && mediana !== null) {
    const acima = taxa > mediana, abaixo = taxa < mediana;
    sentido = { texto: `${acima ? "▲ acima" : abaixo ? "▼ abaixo" : "● igual"} ${acima || abaixo ? "da" : "à"} mediana dos pares`, tom: acima ? "atencao" : abaixo ? "ok" : "neutro" };
    referencia.push(`mediana ${decimal2.format(mediana)} · ${inteiro(rejeicoes)} em ${inteiro(aih)} AIH`);
  }
  if (referencia.length === 0 && taxa !== null) referencia.push(`${inteiro(rejeicoes)} em ${inteiro(aih)} AIH`);
  return <CartaoDeFechamento rotulo="Rejeições por 100 AIH" valor={taxa === null ? "—" : decimal2.format(taxa)} sentido={sentido} referencia={referencia} />;
}

function CartaoDePosicao({ f }: { f: FaturamentoUnidade }) {
  const p = f.pares;
  if (!p) return null;
  const medidas = [
    temSia(f) && p.valor_sia_percentil !== null ? `SIA ${percentil.format(p.valor_sia_percentil)}%` : null,
    temSih(f) && p.valor_sih_percentil !== null ? `SIH ${percentil.format(p.valor_sih_percentil)}%` : null,
  ].filter((x): x is string => x !== null);
  if (medidas.length === 0) return null;
  return (
    <CartaoDeFechamento
      rotulo="Posição entre os pares"
      valor={<span className="pr__medidas">{medidas.map((x) => <span key={x}>{x}</span>)}</span>}
      sentido={{ texto: "dos pares aprovam menos do que esta unidade", tom: "neutro" }}
      referencia={[`${inteiro(p.pares_com_producao)} estabelecimentos do mesmo tipo`]}
    />
  );
}

function OQueOlhar({ competencia }: { competencia?: string }) {
  const painel = usePainel(competencia);
  if (!painel.data?.disponivel) return null;
  const itens = oQueOlhar(painel.data.pendencias);
  return (
    <section className="pr__olhar" aria-labelledby="pr-olhar">
      <h2 className="un__secao" id="pr-olhar">O que olhar agora</h2>
      {itens.length === 0 ? <p className="un__sub">Nada de produção pede atenção nesta competência</p> : (
        <ul className="pr__lista" aria-label="O que olhar agora">
          {itens.map((p: Pendencia) => {
            const destino = DESTINO_NA_UNIDADE[p.tipo];
            return (
              <li key={p.id} className="pr__olhar-item">
                <span className={`un__situacao un__situacao--${p.gravidade}`}><span className={`un__ponto un__ponto--${p.gravidade}`} aria-hidden="true" />{p.gravidade === "atencao" ? "Atenção" : "Info"}</span>
                <h3 className="pr__olhar-titulo">{p.titulo}</h3>
                <span className="pr__olhar-texto">{p.texto}</span>
                {destino && <a className="un__ver" href={`#/painel/${destino.caminho.join("/")}`} onClick={(e) => { e.preventDefault(); ir("painel", ...destino.caminho); }}>{destino.rotulo}</a>}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

/** O fechamento do mês: o que a unidade produziu, o que foi rejeitado, como se compara e o que olhar primeiro. */
export function VisaoGeral({ f, competencia }: { f: FaturamentoUnidade; competencia?: string }) {
  const avisos = faixaDeCobertura(f.cobertura);
  const sia = ultimoCompleto(f.meses, f.meses_completos.sia);
  const sih = ultimoCompleto(f.meses, f.meses_completos.sih);
  const comSia = temSia(f), comSih = temSih(f);
  return (
    <div className="pr">
      <NoCabecalho>
        <Exportar montar={() => planilhaDosMeses(f)} nome="producao-visao-geral" mensagemOk={(p) => `${inteiro(p.abas[0]?.linhas.length ?? 0)} meses exportados.`} />
      </NoCabecalho>
      {avisos.length > 0 && (
        <div className="un__aviso pr__faixa" role="note">
          <span className="un__ponto" aria-hidden="true" />
          <span>{avisos.map((a) => a.texto).join("; ")}</span>
          <DeOndeVem titulo="Mês incompleto" linhas={[
            { rotulo: "Fonte", texto: "Produção do SIA e do SIH publicada pelo DATASUS" },
            { rotulo: "Regra", texto: "O mês fica de fora quando trouxe menos de 90% dos estabelecimentos da mediana dos 3 meses anteriores" },
            { rotulo: "Efeito", texto: "Fora dos cartões, da tendência e dos comparativos; aparece hachurado nos gráficos" },
          ]} />
        </div>
      )}
      <div className="pr__cartoes">
        {comSia && <CartaoDeSistema sistema="SIA" f={f} mes={sia} valor={sia?.sia_valor_centavos ?? 0} />}
        {comSih && <CartaoDeSistema sistema="SIH" f={f} mes={sih} valor={sih?.sih_valor_centavos ?? 0} />}
        {comSih && <CartaoDeRejeicoes f={f} />}
        <CartaoDePosicao f={f} />
      </div>
      {!comSih && <p className="un__sub">Esta unidade não tem internações (SIH): sem cartão de SIH nem de rejeições.</p>}
      <div className="pr__series">
        {comSia && <SerieDoMes rotulo="SIA aprovado por mês" meses={f.meses} completos={f.meses_completos.sia} valor={(m) => m.sia_valor_centavos} />}
        {comSih && <SerieDoMes rotulo="SIH aprovado por mês" meses={f.meses} completos={f.meses_completos.sih} valor={(m) => m.sih_valor_centavos} />}
      </div>
      <OQueOlhar competencia={competencia} />
    </div>
  );
}
