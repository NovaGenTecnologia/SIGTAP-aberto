import { useEffect, useId, useMemo, useRef, useState } from "react";
import type { Apresentado, FaturamentoUnidade, MotivoDeRejeicao, Planilha, UnidadeCompleta } from "../../../api/tipos";
import { ehAusente } from "../../../api/tipos";
import { CampoBusca } from "../../../componentes/base/CampoBusca";
import { SerieMensal } from "../../../componentes/dominio/SerieMensal";
import { caminhoUnidade, hrefUnidade, ir, substituir, type TelaDaUnidade } from "../../../shell/rotas";
import { comSinal, inteiro, rotuloCompetencia } from "../../../util/formatos";
import { DeOndeVem } from "../../painel/DeOndeVem";
import { Exportar } from "../../consultar/Exportar";
import { NoCabecalho } from "./AcoesDaProducao";
import { MiniSerie } from "./MiniSerie";
import { destinoDoMotivo } from "./motivosDeCadastro";
import { useBuscaNaRota } from "./useBuscaNaRota";
import { temSia, valorCompacto } from "./util";

type Rota = Extract<TelaDaUnidade, { tela: "producao" }>;
const decimal2 = new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const SEM_DESCRICAO = "Sem descrição na tabela oficial";
const PRIMEIROS = 6;
/** Letras do `PA_FLQT` em que a diferença é teto (físico ou financeiro) ou falta de orçamento: limite do gestor, não erro. */
const LIMITE_DO_GESTOR = "MONLTP";

const parteDe = (m: MotivoDeRejeicao, total: number) => (total > 0 ? (m.total * 100) / total : 0);
const percentualDaParte = (p: number) => (p > 0 && p < 1 ? "<1%" : `${Math.round(p)}%`);
const situacaoDe = (m: MotivoDeRejeicao) => [m.bloqueio ? "Bloqueio" : null, m.encerrado ? "Encerrado" : null].filter((x): x is string => x !== null);

function planilhaDe(motivos: MotivoDeRejeicao[], total: number): Planilha {
  return {
    titulo: "Produção da unidade: motivos de rejeição",
    abas: [{
      nome: "Motivos", colunas: ["Código", "Motivo", "Total", "Parte", "Situação"],
      linhas: motivos.map((m) => [m.motivo, m.descricao ?? SEM_DESCRICAO, m.total, `${Math.round(parteDe(m, total))}%`, situacaoDe(m).join(", ")]),
    }],
  };
}

function CartaoDaTaxa({ f }: { f: FaturamentoUnidade }) {
  const id = useId();
  const { por_100_aih: taxa, janela_aih: aih, janela_rejeicoes: rejeicoes, por_mes: meses } = f.rejeicoes;
  const minimo = f.pares?.minimo_aih_para_taxa ?? 50;
  const mediana = aih >= minimo ? f.pares?.taxa_mediana_dos_pares ?? null : null;
  const acima = taxa !== null && mediana !== null && taxa > mediana, abaixo = taxa !== null && mediana !== null && taxa < mediana;
  const grupo = f.pares && (f.pares.nome_tipo ? `tipo ${f.pares.nome_tipo}` : `tipo ${f.pares.tipo}`);
  return (
    <section className="pr__taxa un__cartao" aria-labelledby={id}>
      <div className="pr__taxa-texto">
        <h3 className="pr__rotulo" id={id}>Rejeições por 100 AIH</h3>
        <p className="pr__valor num">{taxa === null ? "—" : decimal2.format(taxa)}</p>
        {mediana !== null && <p className={`pr__sentido pr__sentido--${acima ? "atencao" : abaixo ? "ok" : "neutro"}`}>{acima ? "▲ acima" : abaixo ? "▼ abaixo" : "● igual"} {acima || abaixo ? "da" : "à"} mediana dos pares ({decimal2.format(mediana)})</p>}
        {taxa !== null && aih < minimo && <p className="pr__ref">poucas AIH para comparar</p>}
        <p className="pr__ref">{inteiro(rejeicoes)} rejeições em {inteiro(aih)} AIH aprovadas</p>
        {f.janela.sih[0] && <p className="pr__ref">{rotuloCompetencia(f.janela.sih[0])} a {rotuloCompetencia(f.janela.sih[f.janela.sih.length - 1] ?? f.janela.sih[0])}</p>}
        {grupo && mediana !== null && <p className="pr__ref">Pares: {grupo}</p>}
      </div>
      <SerieMensal rotulo="Rejeições por 100 AIH, mês a mês" altura={80}
        pontos={meses.map((x) => ({ competencia: x.competencia, valor: x.por_100_aih ?? 0, completo: x.completo }))}
        formatar={(v) => decimal2.format(v)}
        referencia={mediana === null ? undefined : { valor: mediana, rotulo: `mediana dos pares, ${decimal2.format(mediana)}` }} />
    </section>
  );
}

function ApresentadoEAprovado({ a }: { a: Apresentado | null }) {
  const id = useId();
  if (!a) {
    return <p className="un__sub">O apresentado do SIA não veio nos meses carregados. Baixe de novo para ver.</p>;
  }
  const diferenca = a.valor_apresentado_centavos - a.valor_aprovado_centavos;
  const motivos = ehAusente(a.motivos) ? [] : a.motivos;
  const dos = (cs: (c: string) => boolean) => motivos.filter((x) => cs(x.codigo) && x.codigo !== "K").reduce((s, x) => s + x.valor_apresentado_centavos - x.valor_aprovado_centavos, 0);
  return (
    <section className="pr__apresentado un__cartao" aria-labelledby={id}>
      <div className="pr__apresentado-topo">
        <h3 className="pr__rotulo" id={id}>SIA: apresentado × aprovado</h3>
        <DeOndeVem titulo="Apresentado × aprovado" linhas={[
          { rotulo: "Fonte", texto: "SIA da unidade, nos meses que trazem o valor apresentado" },
          { rotulo: "Conta", texto: "Valor apresentado menos valor aprovado" },
          { rotulo: "Não prova", texto: a.aviso },
        ]} />
      </div>
      <p className="pr__apresentado-valores num">
        Apresentado {valorCompacto(a.valor_apresentado_centavos, 2)} · Aprovado {valorCompacto(a.valor_aprovado_centavos, 2)} · Diferença {comSinal(diferenca)}
      </p>
      {motivos.length === 0 ? (
        <p className="un__sub">O motivo oficial da diferença não veio nos meses carregados. Baixe de novo para separar o limite do gestor do que vale conferir.</p>
      ) : (
        <ul className="pr__lista">
          <li><strong>Limite do gestor</strong> (teto ou falta de orçamento): <span className="num">{comSinal(dos((c) => LIMITE_DO_GESTOR.includes(c)))}</span></li>
          <li><strong>A conferir</strong> no retorno do seu sistema: <span className="num">{comSinal(dos((c) => !LIMITE_DO_GESTOR.includes(c)))}</span></li>
        </ul>
      )}
    </section>
  );
}

/** Rejeições do SIH: a taxa, todos os motivos com a descrição oficial e a evolução, e o apresentado × aprovado do SIA. */
export function Rejeicoes({ f, unidade, rota }: { f: FaturamentoUnidade; unidade: UnidadeCompleta; rota: Rota }) {
  const [todos, setTodos] = useState(false);
  const recolher = useRef<HTMLButtonElement>(null);
  const moveu = useRef(false);
  useEffect(() => { if (todos && moveu.current) recolher.current?.focus(); }, [todos]);
  const gravar = (motivo: string) => substituir("painel", ...caminhoUnidade({ ...rota, aba: "rejeicoes", motivo }));
  const [digitado, setDigitado] = useBuscaNaRota(rota.motivo, gravar);
  const { motivos: lista } = f.rejeicoes;
  const comSih = f.meses.some((m) => m.sih_aih > 0 || m.sih_valor_centavos > 0);
  const total = useMemo(() => lista.reduce((s, m) => s + m.total, 0), [lista]);
  const agulha = rota.motivo.trim().toLowerCase();
  const filtrados = useMemo(
    () => (agulha ? lista.filter((m) => m.motivo.includes(agulha) || (m.descricao ?? SEM_DESCRICAO).toLowerCase().includes(agulha)) : lista),
    [lista, agulha],
  );
  const mostrados = agulha || todos ? filtrados : filtrados.slice(0, PRIMEIROS);
  const resto = filtrados.length - mostrados.length;
  const meses = f.rejeicoes.por_mes.map((x) => x.competencia);
  const temPessoas = unidade.tem_arquivo_de_profissionais && unidade.profissionais !== null;

  return (
    <div className="pr">
      <NoCabecalho>
        <Exportar montar={() => planilhaDe(filtrados, total)} nome="producao-rejeicoes"
          mensagemOk={(p) => `${inteiro(p.abas[0]?.linhas.length ?? 0)} motivos exportados.`} />
      </NoCabecalho>
      {!comSih ? (
        <p className="un__sub">Esta unidade não tem internações (SIH): não há rejeições de AIH para mostrar.</p>
      ) : (
        <>
          {f.rejeicoes.por_100_aih !== null && <CartaoDaTaxa f={f} />}
          {lista.length === 0 ? (
            <p className="un__vazio">Sem rejeições no período</p>
          ) : (
            <div className="un__bloco">
              <div className="un__barra">
                <CampoBusca rotulo="Filtrar motivos por código ou texto" value={digitado} onChange={setDigitado} />
                <span className="un__contagem">{agulha ? `${inteiro(filtrados.length)} de ${inteiro(lista.length)} motivos` : `${inteiro(lista.length)} motivos · ${inteiro(total)} rejeições`}</span>
              </div>
              {filtrados.length === 0 ? (
                <p className="un__vazio">Nenhum motivo para «{rota.motivo.trim()}»</p>
              ) : (
                <div className="un__cartao un__rolagem">
                  <table className="un__tabela" aria-label="Motivos de rejeição">
                    <thead>
                      <tr>
                        <th scope="col">Código</th><th scope="col">Motivo (descrição oficial)</th>
                        <th scope="col" className="un__direita">Total</th><th scope="col">Parte</th><th scope="col">Evolução</th><th scope="col">Situação</th><th scope="col"><span className="so-leitor">Cadastro</span></th>
                      </tr>
                    </thead>
                    <tbody>
                      {mostrados.map((m) => {
                        const parte = parteDe(m, total);
                        const destino = destinoDoMotivo(m.motivo);
                        const liga = destino && !(destino.tela.tela === "cadastro" && destino.tela.aba === "profissionais" && !temPessoas) ? destino : null;
                        const porMes = new Map(m.por_mes);
                        return (
                          <tr key={m.motivo}>
                            <td><span className="un__codigo">{m.motivo}</span></td>
                            <td className={m.descricao ? "un__forte" : "un__apagado"}>{m.descricao ?? SEM_DESCRICAO}</td>
                            <td className="un__direita num">{inteiro(m.total)}</td>
                            <td><span className="pr__parte"><span className="pr__parte-barra" style={{ width: `${Math.max(2, Math.round(parte * 0.9))}px` }} aria-hidden="true" /><span className="num">{percentualDaParte(parte)}</span></span></td>
                            <td><MiniSerie rotulo={`Evolução do motivo ${m.motivo}`} pontos={meses.map((c) => ({ competencia: c, valor: porMes.get(c) ?? 0 }))} /></td>
                            <td>{situacaoDe(m).map((s) => <span key={s} className="un__selo un__selo--neutro">{s}</span>)}</td>
                            <td>{liga && <a className="un__ver" href={hrefUnidade(liga.tela)} onClick={(e) => { e.preventDefault(); ir("painel", ...caminhoUnidade(liga.tela)); }}>{liga.rotulo} <span aria-hidden="true">›</span></a>}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
              {resto > 0 && <button type="button" className="un__mais" onClick={() => { moveu.current = true; setTodos(true); }}>Ver mais {inteiro(resto)} {resto === 1 ? "motivo" : "motivos"}</button>}
              {!agulha && todos && filtrados.length > PRIMEIROS && <button type="button" className="un__mais" ref={recolher} onClick={() => setTodos(false)}>Mostrar só os {PRIMEIROS} maiores</button>}
            </div>
          )}
        </>
      )}
      {temSia(f) && <ApresentadoEAprovado a={f.apresentado} />}
    </div>
  );
}
