import { useId, type ReactNode } from "react";
import type {
  Ausente, ComparacaoComPares, ComposicaoDaAih, FaturamentoUnidade, LeitosEOcupacao, Pares, PerfilFinanceiro, Reapresentacao, ValorPorFinanciamento,
} from "../../../api/tipos";
import { ehAusente } from "../../../api/tipos";
import { AvisoDeLimite } from "../../../componentes/dominio/AvisoDeLimite";
import { SeloDeConfianca } from "../../../componentes/dominio/SeloDeConfianca";
import { caminhoUnidade, hrefUnidade, ir } from "../../../shell/rotas";
import { inteiro, reais, rotuloCompetencia } from "../../../util/formatos";
import { DeOndeVem, type LinhaDeOrigem } from "../../painel/DeOndeVem";
import { AvisoDeAusente } from "./AvisoDeAusente";
import { BarraEmpilhada, TONS } from "./BarraEmpilhada";
import { parteDe, parteEmTexto, SEM_SIA, SEM_SIH, temSia, temSih } from "./util";

const decimal1 = new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const decimal2 = new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const percentil = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 1 });
const SEM_DADO = "—";

const TIPO_DE_MARCA: Record<string, string> = { RC: "Regra contratual", IN: "Incentivo", GM: "Gestão e metas", EF: "Filantropia" };
const COMPLEMENTO: Record<string, string> = {
  PA_VL_CL: "Complemento local", PA_VL_CF: "Complemento federal", PA_VL_CRD: "Crédito",
  VAL_SH_FED: "Serviços hospitalares, complemento federal", VAL_SP_FED: "Serviços profissionais, complemento federal",
  VAL_SH_GES: "Serviços hospitalares, complemento do gestor", VAL_SP_GES: "Serviços profissionais, complemento do gestor", VAL_UTI: "UTI",
};
const semRegra = (codigo: string) => codigo.trim() === "" || /^0+$/.test(codigo.trim());

function Bloco({ titulo, origem, children }: { titulo: string; origem: LinhaDeOrigem[]; children: ReactNode }) {
  const id = useId();
  return (
    <section className="bloco" aria-labelledby={id}>
      <header className="bloco__topo">
        <h2 id={id} className="bloco__titulo">{titulo}</h2>
        <div className="bloco__acoes"><DeOndeVem titulo={titulo} linhas={origem} /></div>
      </header>
      {children}
    </section>
  );
}

const Tabela = ({ rotulo, children }: { rotulo: string; children: ReactNode }) => (
  <div className="un__cartao un__rolagem"><table className="un__tabela" aria-label={rotulo}>{children}</table></div>
);

function TabelaDeFinanciamento({ sistema, itens }: { sistema: "SIA" | "SIH"; itens: ValorPorFinanciamento[] }) {
  if (itens.length === 0) return <p className="un__vazio">Sem produção do {sistema} nos meses carregados</p>;
  const total = itens.reduce((s, x) => s + x.valor_centavos, 0);
  const quantidade = itens.reduce((s, x) => s + x.quantidade, 0);
  return (
    <div className="pr__lado">
      <h3 className="pr__rotulo">{sistema}</h3>
      <Tabela rotulo={`Financiamento do ${sistema}`}>
        <thead>
          <tr>
            <th scope="col">Origem do dinheiro</th><th scope="col" className="un__direita">{sistema === "SIH" ? "AIH" : "Quantidade"}</th>
            <th scope="col" className="un__direita">Valor aprovado</th><th scope="col">Parte</th>
          </tr>
        </thead>
        <tbody>
          {itens.map((x) => {
            const parte = parteDe(x.valor_centavos, total);
            return (
              <tr key={x.codigo}>
                <td><span className={x.nome ? "un__forte" : "un__apagado"}>{x.nome ?? `Código ${x.codigo}`}</span>{x.nome && <span className="un__codigo-fraco"> {x.codigo}</span>}</td>
                <td className="un__direita num">{inteiro(x.quantidade)}</td>
                <td className="un__direita num">{reais(x.valor_centavos)}</td>
                <td><span className="pr__parte"><span className="pr__parte-barra" style={{ width: `${Math.max(2, Math.round(parte * 0.9))}px` }} aria-hidden="true" /><span className="num">{parteEmTexto(parte)}</span></span></td>
              </tr>
            );
          })}
        </tbody>
        <tfoot>
          <tr>
            <th scope="row">Total</th>
            <td className="un__direita num">{inteiro(quantidade)}</td><td className="un__direita num">{reais(total)}</td><td className="num">100%</td>
          </tr>
        </tfoot>
      </Tabela>
    </div>
  );
}

function Composicao({ c, f }: { c: ComposicaoDaAih | Ausente | null; f: FaturamentoUnidade }) {
  const origem: LinhaDeOrigem[] = [
    { rotulo: "Fonte", texto: "Arquivo de serviços profissionais do SIH (SP): cada ato da AIH tem um tipo de valor" },
    { rotulo: "Conta", texto: "Valor por tipo ÷ valor total das AIH da unidade; a coluna da UF soma todos os estabelecimentos, inclusive este" },
    { rotulo: "Não prova", texto: c && !ehAusente(c) ? c.aviso : "" },
  ];
  let corpo: ReactNode;
  if (c && ehAusente(c)) corpo = <AvisoDeAusente bloco="Composição das AIH" ausente={c} />;
  else if (!c) corpo = <p className="un__vazio">{temSih(f) ? "Nada a mostrar para esta unidade no período" : SEM_SIH}</p>;
  else {
    const nome = (t: ComposicaoDaAih["tipos"][number]) => t.nome ?? `Tipo ${t.fin}`;
    const dentro = [
      { rotulo: "OPM (órteses, próteses e materiais)", u: c.opm_centavos, uf: c.opm_uf_centavos as number | null },
      { rotulo: "FAEC (código de financiamento)", u: c.faec_centavos, uf: c.faec_uf_centavos as number | null },
      { rotulo: "UTI (dentro do SH)", u: c.uti_centavos, uf: null },
    ];
    corpo = (
      <>
        <div className="pr__barras">
          <div className="pr__barra"><span className="pr__ref" aria-hidden="true">Unidade</span><BarraEmpilhada quem="Unidade" partes={c.tipos.map((t) => ({ rotulo: nome(t), valor: t.valor_centavos }))} /></div>
          <div className="pr__barra"><span className="pr__ref" aria-hidden="true">UF</span><BarraEmpilhada quem="UF" partes={c.tipos.map((t) => ({ rotulo: nome(t), valor: t.valor_uf_centavos }))} /></div>
        </div>
        <Tabela rotulo="Composição do valor das AIH">
          <thead>
            <tr>
              <th scope="col">Tipo de valor</th><th scope="col" className="un__direita">Unidade</th><th scope="col" className="un__direita">% da unidade</th>
              <th scope="col" className="un__direita">UF</th><th scope="col" className="un__direita">% da UF</th>
            </tr>
          </thead>
          <tbody>
            {c.tipos.map((t, i) => (
              <tr key={t.fin}>
                <td><span className="pr__amostra" style={{ background: TONS[i % TONS.length] }} aria-hidden="true" />{nome(t)}</td>
                <td className="un__direita num">{reais(t.valor_centavos)}</td><td className="un__direita num">{parteEmTexto(parteDe(t.valor_centavos, c.total_centavos))}</td>
                <td className="un__direita num">{reais(t.valor_uf_centavos)}</td><td className="un__direita num">{parteEmTexto(parteDe(t.valor_uf_centavos, c.total_uf_centavos))}</td>
              </tr>
            ))}
          </tbody>
        </Tabela>
        <Tabela rotulo="Dentro do valor total">
          <thead>
            <tr>
              <th scope="col">Dentro do total</th><th scope="col" className="un__direita">Unidade</th><th scope="col" className="un__direita">% da unidade</th>
              <th scope="col" className="un__direita">UF</th><th scope="col" className="un__direita">% da UF</th>
            </tr>
          </thead>
          <tbody>
            {dentro.map((d) => (
              <tr key={d.rotulo}>
                <td>{d.rotulo}</td>
                <td className="un__direita num">{reais(d.u)}</td><td className="un__direita num">{parteEmTexto(parteDe(d.u, c.total_centavos))}</td>
                <td className="un__direita num">{d.uf === null ? SEM_DADO : reais(d.uf)}</td><td className="un__direita num">{d.uf === null ? SEM_DADO : parteEmTexto(parteDe(d.uf, c.total_uf_centavos))}</td>
              </tr>
            ))}
          </tbody>
        </Tabela>
        <p className="un__sub">A UTI já está dentro do valor hospitalar (SH); OPM e FAEC também fazem parte do total acima.</p>
      </>
    );
  }
  return <Bloco titulo="Composição das AIH" origem={origem}>{corpo}</Bloco>;
}

function Perfil({ p, f }: { p: PerfilFinanceiro | Ausente | null; f: FaturamentoUnidade }) {
  const origem: LinhaDeOrigem[] = [
    { rotulo: "Fonte", texto: "Marcas do CNES da unidade e regra contratual e complementos dos arquivos do SIA e do SIH" },
    { rotulo: "Conta", texto: "Valor produzido sob cada regra registrada; \"sem regra\" é o código vazio ou 0000" },
    { rotulo: "Não prova", texto: p && !ehAusente(p) ? p.aviso : "" },
  ];
  let corpo: ReactNode;
  if (p && ehAusente(p)) corpo = <AvisoDeAusente bloco="Perfil financeiro" ausente={p} />;
  else if (!p) corpo = <p className="un__vazio">{temSia(f) || temSih(f) ? "Nada a mostrar para esta unidade no período" : SEM_SIA}</p>;
  else {
    const tipos = Object.keys(TIPO_DE_MARCA).filter((t) => p.marcas.some((m) => m.tipo === t));
    const haSemRegra = p.regras.some((r) => semRegra(r.codigo));
    corpo = (
      <>
        <AvisoDeLimite>Regra de não geração de crédito não indica erro: parte da produção não gera crédito para o gestor.</AvisoDeLimite>
        {tipos.length > 0 && (
          <dl className="pr__marcas">
            {tipos.map((t) => (
              <div key={t} className="pr__marca">
                <dt>{TIPO_DE_MARCA[t]}</dt>
                <dd>{p.marcas.filter((m) => m.tipo === t).map((m) => <span key={m.codigo} className="pr__ficha"><span className="un__codigo-fraco">{m.codigo}</span> <span>{m.descricao ?? SEM_DADO}</span></span>)}</dd>
              </div>
            ))}
          </dl>
        )}
        {p.regras.length > 0 && (
          <Tabela rotulo="Valor sob cada regra contratual">
            <thead>
              <tr><th scope="col">Sistema</th><th scope="col">Regra</th><th scope="col" className="un__direita">Quantidade</th><th scope="col" className="un__direita">Valor aprovado</th></tr>
            </thead>
            <tbody>
              {p.regras.map((r) => (
                <tr key={`${r.origem}-${r.codigo}`}>
                  <td>{r.origem}</td>
                  <td>{semRegra(r.codigo) ? <span className="un__forte">Sem regra</span> : <><span className="un__codigo-fraco">{r.codigo}</span> <span className={r.descricao ? "un__forte" : "un__apagado"}>{r.descricao ?? SEM_DADO}</span></>}</td>
                  <td className="un__direita num">{inteiro(r.quantidade)}</td><td className="un__direita num">{reais(r.valor_centavos)}</td>
                </tr>
              ))}
            </tbody>
          </Tabela>
        )}
        {haSemRegra && <p className="un__sub">Sem regra: o arquivo traz o código vazio ou 0000.</p>}
        {p.complementos.length > 0 && (
          <Tabela rotulo="Complementos de valor">
            <thead><tr><th scope="col">Complemento</th><th scope="col">Sistema</th><th scope="col" className="un__direita">Valor aprovado</th></tr></thead>
            <tbody>
              {p.complementos.map((x) => (
                <tr key={`${x.origem}-${x.campo}`}>
                  <td>{COMPLEMENTO[x.campo] ? <><span className="un__forte">{COMPLEMENTO[x.campo]}</span> <span className="un__codigo-fraco">{x.campo}</span></> : x.campo}</td>
                  <td>{x.origem}</td><td className="un__direita num">{reais(x.valor_centavos)}</td>
                </tr>
              ))}
            </tbody>
          </Tabela>
        )}
      </>
    );
  }
  return <Bloco titulo="Perfil financeiro" origem={origem}>{corpo}</Bloco>;
}

function ReapresentacaoDoMes({ r, f }: { r: Reapresentacao | Ausente | null; f: FaturamentoUnidade }) {
  const origem: LinhaDeOrigem[] = [
    { rotulo: "Fonte", texto: "SIA da unidade: competência do atendimento (PA_CMP) contra a do arquivo (PA_MVM)" },
    { rotulo: "Conta", texto: "Valor apresentado de meses anteriores ÷ valor apresentado total, na unidade e na UF" },
    { rotulo: "Não prova", texto: r && !ehAusente(r) ? r.aviso : "" },
  ];
  let corpo: ReactNode;
  if (r && ehAusente(r)) corpo = <AvisoDeAusente bloco="Reapresentação" ausente={r} />;
  else if (!r) corpo = <p className="un__vazio">{temSia(f) ? "Nada a mostrar para esta unidade no período" : SEM_SIA}</p>;
  else {
    const propria = parteDe(r.anteriores_centavos, r.total_centavos);
    const uf = parteDe(r.uf_anteriores_centavos, r.uf_total_centavos);
    corpo = r.total_centavos === 0 ? <p className="un__vazio">Nada apresentado nos meses carregados</p> : (
      <>
        <p className="pr__destaque num">{parteEmTexto(propria)} do apresentado vem de meses anteriores (UF {parteEmTexto(uf)})</p>
        <Tabela rotulo="Apresentado por mês de origem">
          <thead>
            <tr>
              <th scope="col">Mês</th><th scope="col" className="un__direita">Do mês</th><th scope="col" className="un__direita">De meses anteriores</th>
              <th scope="col" className="un__direita">Parte anterior</th><th scope="col" className="un__direita">Parte anterior na UF</th>
            </tr>
          </thead>
          <tbody>
            {r.meses.map((m) => (
              <tr key={m.competencia}>
                <td className="num">{rotuloCompetencia(m.competencia)}</td>
                <td className="un__direita num">{reais(m.do_mes_centavos)}</td><td className="un__direita num">{reais(m.anteriores_centavos)}</td>
                <td className="un__direita num">{parteEmTexto(parteDe(m.anteriores_centavos, m.do_mes_centavos + m.anteriores_centavos))}</td>
                <td className="un__direita num">{parteEmTexto(parteDe(m.uf_anteriores_centavos, m.uf_do_mes_centavos + m.uf_anteriores_centavos))}</td>
              </tr>
            ))}
          </tbody>
        </Tabela>
        {r.origem_dos_atrasos.length > 0 && (
          <Tabela rotulo="Origem dos atrasos">
            <thead><tr><th scope="col">Mês de origem do atraso</th><th scope="col" className="un__direita">Valor apresentado depois</th></tr></thead>
            <tbody>
              {r.origem_dos_atrasos.map((a) => (
                <tr key={a.competencia}><td className="num">{rotuloCompetencia(a.competencia)}</td><td className="un__direita num">{reais(a.valor_centavos)}</td></tr>
              ))}
            </tbody>
          </Tabela>
        )}
      </>
    );
  }
  return <Bloco titulo="Reapresentação" origem={origem}>{corpo}</Bloco>;
}

function Leitos({ l, f }: { l: LeitosEOcupacao | null; f: FaturamentoUnidade }) {
  const origem: LinhaDeOrigem[] = [
    { rotulo: "Fonte", texto: "Leitos do CNES da unidade e AIH aprovadas no SIH" },
    { rotulo: "Conta", texto: "AIH ÷ leitos SUS; ocupação = dias de permanência ÷ (leitos SUS × dias do mês)" },
    { rotulo: "Não prova", texto: l?.aviso ?? "" },
  ];
  let corpo: ReactNode;
  if (!l) {
    const destino = { tela: "cadastro", aba: "leitos", q: "" } as const;
    corpo = temSih(f)
      ? <p className="un__vazio">Sem leitos no CNES desta unidade. <a className="un__ver" href={hrefUnidade(destino)} onClick={(e) => { e.preventDefault(); ir("painel", ...caminhoUnidade(destino)); }}>Abrir o Cadastro <span aria-hidden="true">›</span></a></p>
      : <p className="un__vazio">{SEM_SIH}</p>;
  } else {
    const comOcupacao = l.por_mes.some((m) => m.ocupacao_percentual !== null);
    corpo = (
      <>
        <AvisoDeLimite>Aproximado: usa os leitos SUS do cadastro do CNES; não é o censo hospitalar.</AvisoDeLimite>
        <p className="pr__destaque num">{inteiro(l.leitos_sus)} leitos SUS de {inteiro(l.leitos_existentes)} existentes</p>
        <Tabela rotulo="AIH por leito, mês a mês">
          <thead>
            <tr>
              <th scope="col">Mês</th><th scope="col" className="un__direita">AIH</th><th scope="col" className="un__direita">AIH por leito SUS</th>
              {comOcupacao && <th scope="col" className="un__direita">Ocupação aproximada</th>}
            </tr>
          </thead>
          <tbody>
            {l.por_mes.map((m) => (
              <tr key={m.competencia}>
                <td className="num">{rotuloCompetencia(m.competencia)}</td><td className="un__direita num">{inteiro(m.aih)}</td>
                <td className="un__direita num">{m.aih_por_leito_sus === null ? SEM_DADO : decimal1.format(m.aih_por_leito_sus)}</td>
                {comOcupacao && <td className="un__direita num">{m.ocupacao_percentual === null ? SEM_DADO : `${inteiro(Math.round(m.ocupacao_percentual))}%`}</td>}
              </tr>
            ))}
          </tbody>
        </Tabela>
      </>
    );
  }
  return <Bloco titulo="Leitos e ocupação" origem={origem}>{corpo}</Bloco>;
}

function LinhaDePares({ g, rotulo, f, poucasAih }: { g: ComparacaoComPares & { criterio?: string }; rotulo: string; f: FaturamentoUnidade; poucasAih: boolean }) {
  const ensino = g.criterio === "tipo_e_ensino";
  const abaixo = (p: number | null) => (p === null ? SEM_DADO : `acima de ${percentil.format(p)}% dos pares`);
  return (
    <tr>
      <td><span className="un__forte">{rotulo}</span>{ensino && <> <SeloDeConfianca estado="nao-confirmada" texto="Regra não confirmada" /></>}</td>
      <td className="un__direita num">{inteiro(g.pares_com_producao)}</td>
      {temSia(f) && <td>{abaixo(g.valor_sia_percentil)}</td>}
      {temSih(f) && <td>{abaixo(g.valor_sih_percentil)}</td>}
      {temSih(f) && (
        <td className="num">
          {g.taxa_da_unidade === null ? SEM_DADO : decimal2.format(g.taxa_da_unidade)}
          {poucasAih ? <span className="pr__ref pr__linha">poucas AIH para comparar</span> : g.taxa_mediana_dos_pares !== null && <span className="pr__ref pr__linha">mediana {decimal2.format(g.taxa_mediana_dos_pares)}</span>}
        </td>
      )}
    </tr>
  );
}

function ComPares({ p, f }: { p: Pares | null; f: FaturamentoUnidade }) {
  const origem: LinhaDeOrigem[] = [
    { rotulo: "Fonte", texto: "Estabelecimentos do mesmo tipo (CNES) na UF que produziram no período" },
    { rotulo: "Conta", texto: "Percentil = % dos pares com valor menor; a mediana da taxa só aparece com AIH suficientes" },
    { rotulo: "Não prova", texto: p?.aviso ?? "" },
  ];
  let corpo: ReactNode;
  if (!p) corpo = <p className="un__vazio">Sem pares para comparar nesta unidade</p>;
  else {
    const poucasAih = f.rejeicoes.janela_aih < p.minimo_aih_para_taxa;
    corpo = (
      <Tabela rotulo="Comparação com os pares">
        <thead>
          <tr>
            <th scope="col">Grupo de pares</th><th scope="col" className="un__direita">Estabelecimentos</th>
            {temSia(f) && <th scope="col">Valor do SIA</th>}{temSih(f) && <th scope="col">Valor do SIH</th>}
            {temSih(f) && <th scope="col">Rejeições por 100 AIH</th>}
          </tr>
        </thead>
        <tbody>
          <LinhaDePares g={p} rotulo={`Mesmo tipo: ${p.nome_tipo ?? p.tipo}`} f={f} poucasAih={poucasAih} />
          {p.grupos.map((g) => <LinhaDePares key={g.criterio} g={g} rotulo={g.rotulo} f={f} poucasAih={poucasAih} />)}
        </tbody>
      </Tabela>
    );
  }
  return <Bloco titulo="Pares" origem={origem}>{corpo}</Bloco>;
}

/** De onde vem o valor da unidade e como ele se compara: financiamento, composição da AIH, perfil, reapresentação, leitos e pares. */
export function OrigemDoValor({ f }: { f: FaturamentoUnidade }) {
  return (
    <div className="pr">
      <Bloco titulo="Financiamento" origem={[
        { rotulo: "Fonte", texto: "SIA e SIH da unidade, valor aprovado por origem do dinheiro (financiamento)" },
        { rotulo: "Conta", texto: "Soma do valor aprovado de cada origem; a parte é cada valor ÷ o total do sistema" },
        { rotulo: "Não prova", texto: "Quanto a unidade deveria receber: o repasse depende do contrato e do teto do gestor" },
      ]}>
        <div className="pr__lados">
          <TabelaDeFinanciamento sistema="SIA" itens={f.financiamento.sia} />
          <TabelaDeFinanciamento sistema="SIH" itens={f.financiamento.sih} />
        </div>
      </Bloco>
      <div className="pr__pares">
        <Composicao c={f.composicao_aih} f={f} />
        <Perfil p={f.perfil} f={f} />
      </div>
      <div className="pr__pares">
        <ReapresentacaoDoMes r={f.reapresentacao} f={f} />
        <Leitos l={f.leitos} f={f} />
      </div>
      <ComPares p={f.pares} f={f} />
    </div>
  );
}
