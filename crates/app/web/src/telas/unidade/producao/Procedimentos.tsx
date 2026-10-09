import { useEffect, useId, useMemo, useState } from "react";
import type { ItemDeProducao, Planilha, UnidadeCompleta } from "../../../api/tipos";
import { CampoBusca } from "../../../componentes/base/CampoBusca";
import { Selecao } from "../../../componentes/base/Selecao";
import { Carregando, EstadoErro } from "../../../componentes/dominio/Estados";
import { useProducaoProcedimentos } from "../../../dados/producao";
import { useAptidao } from "../../../dados/unidade";
import { caminhoUnidade, hrefUnidade, ir, substituir, type TelaDaUnidade } from "../../../shell/rotas";
import { inteiro, reais } from "../../../util/formatos";
import { Exportar } from "../../consultar/Exportar";
import { NoCabecalho } from "./AcoesDaProducao";
import { BarraDeProporcao } from "./BarraDeProporcao";
import { useBuscaNaRota } from "./useBuscaNaRota";
import { valorCompacto } from "./util";

type Rota = Extract<TelaDaUnidade, { tela: "producao" }>;
const CLASSES = ["A", "B", "C"] as const;
const ORDENS = [{ id: "valor", rotulo: "Valor aprovado" }, { id: "quantidade", rotulo: "Quantidade" }];
const PAGINAS_DE_RISCO = 10;
const SEM_NOME = "Sem descrição na tabela oficial";
const decimal1 = new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 });

const percentualDe = (p: number) => (p > 0 && p < 1 ? "<1%" : `${Math.round(p)}%`);
const texto = (e: unknown) => (typeof e === "string" ? e : e instanceof Error ? e.message : "Não foi possível ler os procedimentos.");

function planilhaDe(itens: ItemDeProducao[], origem: "sia" | "sih"): Planilha {
  return {
    titulo: `Produção da unidade: procedimentos do ${origem.toUpperCase()}`,
    abas: [{
      nome: "Procedimentos", colunas: ["Código", "Procedimento", "Classe", "Quantidade", "Valor aprovado", "Parte", "Acumulado"],
      linhas: itens.map((i) => [i.procedimento, i.nome ?? SEM_NOME, i.classe, i.quantidade, reais(i.valor_centavos), percentualDe(i.percentual), percentualDe(i.acumulado)]),
    }],
  };
}

/** Códigos que a Aptidão marca em risco, buscando as páginas do grupo até o teto. */
function useEmRisco(chave: string) {
  const risco = useAptidao("risco", { unidade: chave });
  const { hasNextPage, isFetchingNextPage, fetchNextPage, data } = risco;
  const paginas = data?.pages.length ?? 0;
  useEffect(() => {
    if (hasNextPage && !isFetchingNextPage && paginas > 0 && paginas < PAGINAS_DE_RISCO) void fetchNextPage();
  }, [hasNextPage, isFetchingNextPage, paginas, fetchNextPage]);
  return useMemo(() => new Set(data?.pages.flatMap((p) => p.grupo?.itens.map((i) => i.codigo) ?? []) ?? []), [data]);
}

/** Os procedimentos que a unidade produziu, do SIA ou do SIH, por valor aprovado, com a curva ABC. */
export function Procedimentos({ unidade, rota, competencia }: { unidade: UnidadeCompleta; rota: Rota; competencia?: string }) {
  const chave = `${unidade.uf}:${unidade.cnes}`;
  const rotuloDaClasse = useId();
  const [ordem, setOrdem] = useState<"valor" | "quantidade">("valor");
  const para = (mudanca: Partial<Rota>) => caminhoUnidade({ ...rota, aba: "procedimentos", ...mudanca });
  const [digitado, setDigitado] = useBuscaNaRota(rota.q, (q) => substituir("painel", ...para({ q })));
  const lista = useProducaoProcedimentos(rota.origem, { q: rota.q.trim(), classe: rota.classe, ordem, competencia, unidade: chave });
  const emRisco = useEmRisco(chave);
  const paginas = useMemo(() => lista.data?.pages.flatMap((p) => (p.disponivel ? [p] : [])) ?? [], [lista.data]);
  const ultima = paginas[paginas.length - 1];
  const itens = useMemo(() => paginas.flatMap((p) => p.itens), [paginas]);
  const sistema = rota.origem.toUpperCase();

  const seletor = (
    <nav aria-label="Sistema" className="un__irmaos">
      {(["sia", "sih"] as const).map((o) => (
        <a key={o} className="un__irmao" href={hrefUnidade({ ...rota, aba: "procedimentos", origem: o })}
          aria-current={o === rota.origem ? "page" : undefined}
          onClick={(e) => { e.preventDefault(); ir("painel", ...para({ origem: o })); }}>{o.toUpperCase()}</a>
      ))}
    </nav>
  );

  let corpo;
  if (lista.isError) corpo = <EstadoErro mensagem={texto(lista.error)} aoTentar={() => void lista.refetch()} />;
  else if (!ultima) corpo = <Carregando rotulo="Lendo os procedimentos" />;
  else if (ultima.total_geral === 0) corpo = <p className="un__vazio">Esta unidade não tem produção do {sistema} nos meses carregados.</p>;
  else {
    const { resumo, valor_total_centavos: total } = ultima;
    const fazem80 = resumo.A.procedimentos;
    const parteA = total > 0 ? (resumo.A.valor_centavos * 100) / total : 0;
    const restantes = ultima.itens_omitidos;
    const porQuantidade = ordem === "quantidade";
    corpo = (
      <>
        <section className="pr__abc" aria-label="Curva ABC">
          <div className="pr__cartoes">
            <div className="pr__cartao un__cartao">
              <h3 className="pr__rotulo">Procedimentos</h3>
              <p className="pr__valor num">{inteiro(ultima.total_geral)}</p>
              <p className="pr__ref num">{valorCompacto(total, 2)} aprovados</p>
            </div>
            {CLASSES.map((c) => (
              <div key={c} className="pr__cartao un__cartao">
                <h3 className="pr__rotulo">Classe {c}</h3>
                <p className="pr__valor num">{inteiro(resumo[c].procedimentos)}</p>
                <p className="pr__ref num">{valorCompacto(resumo[c].valor_centavos, 2)} · {total > 0 ? decimal1.format((resumo[c].valor_centavos * 100) / total) : "0,0"}%</p>
              </div>
            ))}
          </div>
          <BarraDeProporcao resumo={resumo} total={total} />
          <p className="pr__ref">{inteiro(fazem80)} {fazem80 === 1 ? "procedimento faz" : "procedimentos fazem"} {decimal1.format(parteA)}% do valor aprovado.</p>
        </section>
        <div className="un__bloco">
          <div className="un__barra">
            <CampoBusca rotulo="Buscar por código ou nome" value={digitado} onChange={setDigitado} />
            <div className="pr__campo" role="group" aria-labelledby={rotuloDaClasse}>
              <span className="campo__rotulo" id={rotuloDaClasse}>Classe</span>
              <span className="pr__classes">
                {CLASSES.map((c) => (
                  <button key={c} type="button" className="pr__classe" aria-label={`Classe ${c}`} aria-pressed={rota.classe === c}
                    onClick={() => ir("painel", ...para({ classe: rota.classe === c ? null : c }))}>{c}</button>
                ))}
              </span>
            </div>
            <Selecao rotulo="Ordenar por" itens={ORDENS} selectedKey={ordem} onSelectionChange={(k) => setOrdem(k === "quantidade" ? "quantidade" : "valor")} />
            <span className="un__contagem">{inteiro(itens.length)} de {inteiro(ultima.total)} procedimentos</span>
          </div>
          {ultima.total === 0 ? (
            <p className="un__vazio">{rota.q.trim() ? `Nenhum procedimento para «${rota.q.trim()}»` : `Nenhum procedimento na classe ${rota.classe ?? ""}`}</p>
          ) : (
            <div className={`un__cartao un__rolagem pr__lista-viva${lista.isPlaceholderData ? " pr__lista-viva--esmaecida" : ""}`} aria-busy={lista.isPlaceholderData}>
              <table className="un__tabela" aria-label={`Procedimentos por ${porQuantidade ? "quantidade" : "valor"}`}>
                <thead>
                  <tr>
                    <th scope="col">Código</th><th scope="col">Procedimento</th>
                    <th scope="col" className="un__direita">Quantidade<span className="pr__unidade"> ({ultima.unidade_quantidade})</span></th>
                    <th scope="col" className="un__direita">Valor aprovado</th><th scope="col">Parte</th><th scope="col">Acumulado</th><th scope="col">Classe</th>
                    <th scope="col"><span className="so-leitor">Situação</span></th>
                  </tr>
                </thead>
                <tbody>
                  {itens.map((i) => (
                    <tr key={i.procedimento}>
                      <td><a className="un__codigo" href={`#/consultar/${i.procedimento}`} onClick={(e) => { e.preventDefault(); ir("consultar", i.procedimento); }}>{i.procedimento}</a></td>
                      <td className={i.nome ? "un__forte" : "un__apagado"}>{i.nome ?? SEM_NOME}</td>
                      <td className="un__direita num">{inteiro(i.quantidade)}</td>
                      <td className="un__direita num">{reais(i.valor_centavos)}</td>
                      <td><span className="pr__parte"><span className="pr__parte-barra" style={{ width: `${Math.max(2, Math.round(i.percentual * 0.9))}px` }} aria-hidden="true" /><span className="num">{percentualDe(i.percentual)}</span></span></td>
                      <td className="num pr__acumulado">{percentualDe(i.acumulado)}</td>
                      <td><span className={`un__selo un__selo--${i.classe === "A" ? "ok" : "neutro"}`}>{i.classe}</span></td>
                      <td>{emRisco.has(i.procedimento) && (
                        <a className="un__ver" href={hrefUnidade({ tela: "aptidao", grupo: "risco", q: i.procedimento, hab: null })}
                          onClick={(e) => { e.preventDefault(); ir("painel", ...caminhoUnidade({ tela: "aptidao", grupo: "risco", q: i.procedimento, hab: null })); }}>Em risco</a>
                      )}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {restantes > 0 && (
            <button type="button" className="un__mais" aria-disabled={lista.isFetchingNextPage || undefined} onClick={() => { if (!lista.isFetchingNextPage) void lista.fetchNextPage(); }}>
              {lista.isFetchingNextPage ? "Carregando…" : `Ver mais (${inteiro(restantes)} restantes)`}
            </button>
          )}
        </div>
      </>
    );
  }

  return (
    <div className="pr">
      <NoCabecalho>
        <Exportar montar={() => planilhaDe(itens, rota.origem)} nome={`producao-procedimentos-${rota.origem}`}
          mensagemOk={(p) => {
            const n = p.abas[0]?.linhas.length ?? 0;
            const de = ultima?.total ?? n;
            return n < de ? `${inteiro(n)} de ${inteiro(de)} linhas exportadas; use Ver mais para incluir as outras.` : `${inteiro(n)} linhas exportadas.`;
          }} />
      </NoCabecalho>
      {seletor}
      {corpo}
    </div>
  );
}
