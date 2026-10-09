import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import type { Apresentado, Ausente, FaturamentoUnidade, Instrumentos, Permanencia, Planilha, Servicos } from "../../../api/tipos";
import { ehAusente } from "../../../api/tipos";
import { AvisoDeLimite } from "../../../componentes/dominio/AvisoDeLimite";
import { caminhoUnidade, hrefUnidade, ir, type TelaDaUnidade } from "../../../shell/rotas";
import { inteiro, reais, rotuloCompetencia } from "../../../util/formatos";
import { DeOndeVem, type LinhaDeOrigem } from "../../painel/DeOndeVem";
import { Exportar } from "../../consultar/Exportar";
import { NoCabecalho } from "./AcoesDaProducao";
import { AvisoDeAusente } from "./AvisoDeAusente";
import { SEM_SIA, SEM_SIH, temSia, temSih } from "./util";

type Rota = Extract<TelaDaUnidade, { tela: "producao" }>;
type IdDoBloco = "quantidade" | "permanencia" | "servicos" | "instrumentos";
const decimal1 = new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const SEM_NOME = "Sem descrição na tabela oficial";

const linkDoProcedimento = (cod: string) => (
  <a className="un__codigo" href={`#/consultar/${cod}`} onClick={(e) => { e.preventDefault(); ir("consultar", cod); }}>{cod}</a>
);
const nomeOu = (n: string | null) => <span className={n ? "un__forte" : "un__apagado"}>{n ?? SEM_NOME}</span>;

const SITUACAO: Record<string, string> = {
  fora_do_cadastro: "Fora do cadastro",
  cadastrado_sem_ambulatorial_sus: "Cadastrado sem a marca ambulatorial SUS",
};
const serviceQ = (codigo: string) => codigo.replace(/\D/g, "").slice(0, 3);

/** Um bloco "a conferir": título, a frase do que indica e não prova, e o conteúdo. Recolhível quando `recolhido` é dado. */
function Secao({ id, titulo, origem, limite, resumo, recolhido, children, alvo }: {
  id: IdDoBloco; titulo: string; origem: LinhaDeOrigem[]; limite: string; resumo?: string; children: ReactNode;
  recolhido?: { aberto: boolean; aoAlternar: () => void }; alvo: boolean;
}) {
  const idTitulo = useId();
  const idConteudo = useId();
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    if (!alvo) return;
    ref.current?.scrollIntoView?.({ block: "start" });
    ref.current?.focus({ preventScroll: true });
  }, [alvo]);
  return (
    <section ref={ref} id={`bloco-${id}`} className="bloco pr__secao" aria-labelledby={idTitulo} tabIndex={-1}>
      <header className="bloco__topo">
        <h2 id={idTitulo} className="bloco__titulo">
          {recolhido ? (
            <button type="button" className="pr__alternar" aria-expanded={recolhido.aberto} aria-controls={idConteudo} onClick={recolhido.aoAlternar}>
              {titulo}
            </button>
          ) : titulo}
        </h2>
        <div className="bloco__acoes">
          {resumo && <span className="pr__ref num">{resumo}</span>}
          <DeOndeVem titulo={titulo} linhas={origem} />
        </div>
      </header>
      <AvisoDeLimite>{limite}</AvisoDeLimite>
      <div id={idConteudo} hidden={recolhido ? !recolhido.aberto : false} className="pr__conteudo">{recolhido && !recolhido.aberto ? null : children}</div>
    </section>
  );
}

function Quantidade({ f, alvo }: { f: FaturamentoUnidade; alvo: boolean }) {
  const a: Apresentado | null = f.apresentado;
  const meses = f.sem_campos_novos;
  const sem: Ausente | null = a || !temSia(f) ? null : meses.length > 0 ? { ausente: true, motivo: "sem_campo", campo: "PA_QTDPRO", meses } : null;
  const origem: LinhaDeOrigem[] = [
    { rotulo: "Fonte", texto: "SIA da unidade: quantidade apresentada por procedimento e mês" },
    { rotulo: "Conta", texto: a ? `Mês com quantidade pelo menos ${inteiro(a.limiares_atipica.razao)} vezes a mediana dos ${inteiro(a.limiares_atipica.meses_base)} meses anteriores da própria unidade e da UF, com excesso mínimo de ${inteiro(a.limiares_atipica.excesso_minimo)}` : "" },
    { rotulo: "Não prova", texto: a?.aviso ?? "" },
  ];
  let corpo: ReactNode;
  if (sem) corpo = <AvisoDeAusente bloco="Quantidade atípica" ausente={sem} />;
  else if (!a) corpo = <p className="un__vazio">{SEM_SIA}</p>;
  else if (a.atipicas.length === 0) corpo = <p className="un__vazio">Nenhuma quantidade atípica nos meses completos</p>;
  else {
    const comUf = a.atipicas.some((x) => x.mediana_uf !== null);
    corpo = (
      <div className="un__cartao un__rolagem">
        <table className="un__tabela" aria-label="Quantidades atípicas">
          <thead>
            <tr>
              <th scope="col">Procedimento</th><th scope="col">Mês</th>
              <th scope="col" className="un__direita">Apresentado</th><th scope="col" className="un__direita">Mediana própria</th>
              {comUf && <th scope="col" className="un__direita">Mediana da UF</th>}
              <th scope="col" className="un__direita">Múltiplo</th>
            </tr>
          </thead>
          <tbody>
            {a.atipicas.map((x) => (
              <tr key={`${x.procedimento}-${x.competencia}`}>
                <td>{linkDoProcedimento(x.procedimento)}{nomeOu(x.nome)}</td>
                <td className="num">{rotuloCompetencia(x.competencia)}</td>
                <td className="un__direita num">{inteiro(x.quantidade_apresentada)}</td>
                <td className="un__direita num">{inteiro(Math.round(x.mediana_propria))}</td>
                {comUf && <td className="un__direita num">{x.mediana_uf === null ? "—" : inteiro(Math.round(x.mediana_uf))}</td>}
                <td className="un__direita num">×{decimal1.format(x.quantidade_apresentada / x.mediana_propria)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }
  return (
    <Secao id="quantidade" titulo="Quantidade atípica" origem={origem} alvo={alvo}
      limite="Indica um mês muito acima da série da própria unidade e do que as outras unidades da UF produzem; não prova erro: campanha ou mutirão também explicam.">
      {corpo}
    </Secao>
  );
}

function Permanencia({ p, f, alvo }: { p: Permanencia | Ausente | null; f: FaturamentoUnidade; alvo: boolean }) {
  const origem: LinhaDeOrigem[] = [
    { rotulo: "Fonte", texto: "SIH da unidade: dias de permanência das AIH aprovadas" },
    { rotulo: "Conta", texto: p && !ehAusente(p) ? `Dias ÷ AIH por procedimento, com pelo menos ${inteiro(p.limiares.min_aih)} AIH; aparece quando foge ${decimal1.format(p.limiares.razao)} vez do previsto e ${decimal1.format(p.limiares.razao_uf)} vez da média da UF` : "" },
    { rotulo: "Não prova", texto: p && !ehAusente(p) ? p.aviso : "" },
  ];
  let corpo: ReactNode;
  if (p && ehAusente(p)) corpo = <AvisoDeAusente bloco="Permanência" ausente={p} />;
  else if (!p) corpo = <p className="un__vazio">{temSih(f) ? "Nenhuma permanência para mostrar nos meses carregados" : SEM_SIH}</p>;
  else if (p.itens.length === 0) corpo = <p className="un__vazio">Nenhum procedimento fora do previsto</p>;
  else {
    corpo = (
      <>
        <p className="un__contagem num">
          <span>{inteiro(p.fora_do_previsto)} de {inteiro(p.analisados)} analisados</span>
          {p.itens.length < p.fora_do_previsto && <span> · os {inteiro(p.itens.length)} mais distantes</span>}
        </p>
        <div className="un__cartao un__rolagem">
          <table className="un__tabela" aria-label="Permanência fora do previsto">
            <thead>
              <tr>
                <th scope="col">Procedimento</th><th scope="col" className="un__direita">AIH</th>
                <th scope="col" className="un__direita">Média real (dias)</th><th scope="col" className="un__direita">Previsto (dias)</th>
                <th scope="col" className="un__direita">Média da UF (dias)</th><th scope="col" className="un__direita">Razão</th>
              </tr>
            </thead>
            <tbody>
              {p.itens.map((x) => (
                <tr key={x.procedimento}>
                  <td>{linkDoProcedimento(x.procedimento)}{nomeOu(x.nome)}</td>
                  <td className="un__direita num">{inteiro(x.aih)}</td>
                  <td className="un__direita num">{decimal1.format(x.media_real)}</td>
                  <td className="un__direita num">{decimal1.format(x.previsto)}</td>
                  <td className="un__direita num">{decimal1.format(x.media_uf)}</td>
                  <td className="un__direita num">×{decimal1.format(x.razao)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </>
    );
  }
  return (
    <Secao id="permanencia" titulo="Permanência" origem={origem} alvo={alvo}
      limite="Indica internação mais longa ou mais curta que o previsto no SIGTAP; não prova erro: o previsto não é uma média, e a conferência é no prontuário.">
      {corpo}
    </Secao>
  );
}

function ServicosExecutados({ s, f, alvo }: { s: Servicos | Ausente | null; f: FaturamentoUnidade; alvo: boolean }) {
  const origem: LinhaDeOrigem[] = [
    { rotulo: "Fonte", texto: "Serviço e classificação do registro do SIA, confrontados com os serviços do CNES da unidade" },
    { rotulo: "Conta", texto: "Valor aprovado dos registros cujo serviço não consta no cadastro ou não tem a marca ambulatorial SUS" },
    { rotulo: "Não prova", texto: s && !ehAusente(s) ? s.aviso : "" },
  ];
  let corpo: ReactNode;
  if (s && ehAusente(s)) corpo = <AvisoDeAusente bloco="Serviços executados × cadastrados" ausente={s} />;
  else if (!s) corpo = <p className="un__vazio">{temSia(f) ? "Nenhum serviço para confrontar nos meses carregados" : SEM_SIA}</p>;
  else {
    const itens = s.itens.filter((x) => x.situacao in SITUACAO);
    corpo = itens.length === 0 ? (
      <p className="un__vazio">Todos os serviços executados estão no cadastro com a marca ambulatorial SUS</p>
    ) : (
      <>
        <p className="un__contagem num">
          Fora do cadastro {reais(s.fora_do_cadastro_centavos)} · Sem a marca ambulatorial SUS {reais(s.sem_marca_sus_centavos)}
          {s.sem_servico_centavos > 0 ? ` · Sem serviço informado ${reais(s.sem_servico_centavos)}` : ""}
        </p>
        <div className="un__cartao un__rolagem">
          <table className="un__tabela" aria-label="Serviços executados fora do cadastro">
            <thead>
              <tr>
                <th scope="col">Serviço/classificação</th><th scope="col">Situação</th>
                <th scope="col" className="un__direita">Quantidade</th><th scope="col" className="un__direita">Valor aprovado</th>
                <th scope="col"><span className="so-leitor">Cadastro</span></th>
              </tr>
            </thead>
            <tbody>
              {itens.map((x) => {
                const destino: TelaDaUnidade = { tela: "cadastro", aba: "servicos", q: serviceQ(x.codigo) };
                return (
                  <tr key={x.codigo}>
                    <td><span className="un__codigo">{x.codigo}</span>{nomeOu(x.nome)}</td>
                    <td>{SITUACAO[x.situacao]}</td>
                    <td className="un__direita num">{inteiro(x.quantidade)}</td>
                    <td className="un__direita num">{reais(x.valor_centavos)}</td>
                    <td><a className="un__ver" href={hrefUnidade(destino)} onClick={(e) => { e.preventDefault(); ir("painel", ...caminhoUnidade(destino)); }}>Cadastro <span aria-hidden="true">›</span></a></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </>
    );
  }
  return (
    <Secao id="servicos" titulo="Serviços executados × cadastrados" origem={origem} alvo={alvo}
      limite="Indica cadastro desatualizado ou código errado no registro; não prova erro: confira antes de corrigir.">
      {corpo}
    </Secao>
  );
}

function InstrumentoDivergente({ i, f, alvo }: { i: Instrumentos | Ausente | null; f: FaturamentoUnidade; alvo: boolean }) {
  const [aberto, setAberto] = useState(alvo);
  useEffect(() => { if (alvo) setAberto(true); }, [alvo]);
  const origem: LinhaDeOrigem[] = [
    { rotulo: "Fonte", texto: "Instrumento de registro do SIA (BPA consolidado, BPA individualizado, APAC, RAAS) em toda a UF" },
    { rotulo: "Conta", texto: "Produção da UF em instrumento que o SIGTAP não lista para o procedimento" },
    { rotulo: "Não prova", texto: i && !ehAusente(i) ? i.aviso : "" },
  ];
  const d = i && !ehAusente(i) ? i.divergencias_da_uf : null;
  let corpo: ReactNode;
  if (i && ehAusente(i)) corpo = <AvisoDeAusente bloco="Instrumento divergente na UF" ausente={i} />;
  else if (!i) corpo = <p className="un__vazio">{temSia(f) ? "Nenhum instrumento para mostrar nos meses carregados" : SEM_SIA}</p>;
  else if (!d || d.itens.length === 0) corpo = <p className="un__vazio">Nenhum instrumento fora do previsto na UF</p>;
  else {
    corpo = (
      <>
        <div className="un__cartao un__rolagem">
          <table className="un__tabela" aria-label="Valor da unidade por instrumento">
            <thead><tr><th scope="col">Instrumento da unidade</th><th scope="col" className="un__direita">Quantidade</th><th scope="col" className="un__direita">Valor aprovado</th></tr></thead>
            <tbody>
              {i.da_unidade.map((x) => (
                <tr key={x.codigo}><td>{x.descricao ?? x.codigo}</td><td className="un__direita num">{inteiro(x.quantidade)}</td><td className="un__direita num">{reais(x.valor_centavos)}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="un__cartao un__rolagem">
          <table className="un__tabela" aria-label="Procedimentos da UF em instrumento fora do previsto">
            <thead>
              <tr>
                <th scope="col">Procedimento</th><th scope="col">Instrumento usado</th><th scope="col">Registros no SIGTAP</th>
                <th scope="col" className="un__direita">Quantidade</th><th scope="col" className="un__direita">Valor aprovado</th>
              </tr>
            </thead>
            <tbody>
              {d.itens.map((x) => (
                <tr key={`${x.procedimento}-${x.instrumento}`}>
                  <td>{linkDoProcedimento(x.procedimento)}{nomeOu(x.nome)}</td>
                  <td>{x.instrumento}</td>
                  <td>{x.registros_do_sigtap?.join(", ") || "—"}</td>
                  <td className="un__direita num">{inteiro(x.quantidade)}</td>
                  <td className="un__direita num">{reais(x.valor_centavos)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </>
    );
  }
  const resumo = d && d.procedimentos > 0 ? `${inteiro(d.procedimentos)} ${d.procedimentos === 1 ? "procedimento" : "procedimentos"} · ${reais(d.valor_centavos)}` : undefined;
  return (
    <Secao id="instrumentos" titulo="Instrumento divergente na UF" origem={origem} alvo={alvo} resumo={resumo}
      recolhido={d && d.itens.length > 0 ? { aberto, aoAlternar: () => setAberto((x) => !x) } : undefined}
      limite="Indica registro fora do previsto no SIGTAP, na UF inteira; não prova erro da unidade.">
      {corpo}
    </Secao>
  );
}

function planilhaDe(f: FaturamentoUnidade): Planilha {
  const abas: Planilha["abas"] = [];
  const a = f.apresentado;
  if (a && a.atipicas.length > 0) {
    abas.push({
      nome: "Quantidade atípica", colunas: ["Procedimento", "Nome", "Mês", "Apresentado", "Mediana própria", "Mediana da UF", "Múltiplo"],
      linhas: a.atipicas.map((x) => [x.procedimento, x.nome ?? SEM_NOME, rotuloCompetencia(x.competencia), x.quantidade_apresentada, Math.round(x.mediana_propria), x.mediana_uf === null ? null : Math.round(x.mediana_uf), Math.round((x.quantidade_apresentada / x.mediana_propria) * 10) / 10]),
    });
  }
  const p = f.permanencia;
  if (p && !ehAusente(p) && p.itens.length > 0) {
    abas.push({
      nome: "Permanência", colunas: ["Procedimento", "Nome", "AIH", "Média real (dias)", "Previsto (dias)", "Média da UF (dias)", "Razão"],
      linhas: p.itens.map((x) => [x.procedimento, x.nome ?? SEM_NOME, x.aih, x.media_real, x.previsto, x.media_uf, x.razao]),
    });
  }
  const s = f.servicos;
  const divergentes = s && !ehAusente(s) ? s.itens.filter((x) => x.situacao in SITUACAO) : [];
  if (divergentes.length > 0) {
    abas.push({
      nome: "Serviços", colunas: ["Serviço/classificação", "Nome", "Situação", "Quantidade", "Valor aprovado"],
      linhas: divergentes.map((x) => [x.codigo, x.nome ?? SEM_NOME, SITUACAO[x.situacao] ?? x.situacao, x.quantidade, reais(x.valor_centavos)]),
    });
  }
  const i = f.instrumentos;
  if (i && !ehAusente(i) && i.divergencias_da_uf.itens.length > 0) {
    abas.push({
      nome: "Instrumentos", colunas: ["Procedimento", "Nome", "Instrumento usado", "Registros no SIGTAP", "Quantidade", "Valor aprovado"],
      linhas: i.divergencias_da_uf.itens.map((x) => [x.procedimento, x.nome ?? SEM_NOME, x.instrumento, x.registros_do_sigtap?.join(", ") ?? "", x.quantidade, reais(x.valor_centavos)]),
    });
  }
  return { titulo: "Produção da unidade: fora do padrão", abas };
}

/** O que foge do padrão na produção: quantidade, permanência, serviço e instrumento, cada um com o limite do que prova. */
export function ForaDoPadrao({ f, rota }: { f: FaturamentoUnidade; rota: Rota }) {
  const alvo = (id: IdDoBloco) => rota.bloco === id;
  return (
    <div className="pr">
      <NoCabecalho>
        <Exportar montar={() => planilhaDe(f)} nome="producao-fora-do-padrao"
          mensagemOk={(p) => (p.abas.length === 0 ? "Nada fora do padrão para exportar." : `${inteiro(p.abas.length)} ${p.abas.length === 1 ? "bloco exportado" : "blocos exportados"}.`)} />
      </NoCabecalho>
      <Quantidade f={f} alvo={alvo("quantidade")} />
      <Permanencia p={f.permanencia} f={f} alvo={alvo("permanencia")} />
      <ServicosExecutados s={f.servicos} f={f} alvo={alvo("servicos")} />
      <InstrumentoDivergente i={f.instrumentos} f={f} alvo={alvo("instrumentos")} />
    </div>
  );
}
