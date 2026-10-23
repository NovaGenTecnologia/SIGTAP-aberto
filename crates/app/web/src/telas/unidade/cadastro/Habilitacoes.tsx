import { useState } from "react";
import type { AptidaoUnidade, HabilitacaoCadastrada, Planilha, UnidadeCompleta } from "../../../api/tipos";
import { ir } from "../../../shell/rotas";
import { inteiro, reais, rotuloCompetencia } from "../../../util/formatos";
import { citamENaoProduzem } from "./citam";
import { CodigoENome, TabelaDoCadastro, type ColunaDoCadastro } from "../TabelaDoCadastro";

interface Linha extends HabilitacaoCadastrada {
  id: string;
  programa38: boolean;
  citam: number | null; produzidos: number | null; valor: number | null;
}

const vigencia = (h: HabilitacaoCadastrada) =>
  h.vigente ? `desde ${rotuloCompetencia(h.inicio)}` : `${rotuloCompetencia(h.inicio)} a ${rotuloCompetencia(h.fim)}`;

const plural = (n: number, um: string, varios: string) => `${inteiro(n)} ${n === 1 ? um : varios}`;

/** Habilitações da unidade, as vigentes primeiro; cada linha leva à Aptidão dos procedimentos que ela destrava. */
export function Habilitacoes({ unidade, aptidao, carregandoProducao = false, busca, aoBuscar }: {
  unidade: UnidadeCompleta; aptidao: AptidaoUnidade | undefined; carregandoProducao?: boolean; busca: string; aoBuscar: (t: string) => void;
}) {
  const [soCitam, setSoCitam] = useState(false);
  const producao = aptidao && !aptidao.sem_producao ? new Map((aptidao.habilitacoes ?? []).map((h) => [h.codigo, h])) : null;
  const linhas: Linha[] = [...unidade.habilitacoes]
    .sort((a, b) => Number(b.vigente) - Number(a.vigente) || a.codigo.localeCompare(b.codigo))
    .map((h) => {
      const p = producao?.get(h.codigo);
      return {
        ...h, id: `${h.codigo}:${h.inicio}`, programa38: h.codigo.startsWith("38"),
        citam: p?.procedimentos_que_citam ?? null, produzidos: p?.procedimentos_produzidos ?? null, valor: p?.valor_centavos ?? null,
      };
    });
  const citam = new Set((citamENaoProduzem(aptidao) ?? []).map((h) => h.codigo));
  const exibidas = soCitam ? linhas.filter((l) => citam.has(l.codigo)) : linhas;
  const abrir = (l: { codigo: string }) => ir("painel", "aptidao", `oportunidade?hab=${encodeURIComponent(l.codigo)}`);

  const colunas: ColunaDoCadastro<Linha>[] = [
    { id: "hab", rotulo: "Habilitação", celula: (l) => <CodigoENome codigo={l.codigo} nome={l.nome} extra={l.programa38 ? <span className="un__selo">programa 38.xx</span> : null} /> },
    { id: "vig", rotulo: "Vigência", celula: (l) => <span className="un__nowrap">{vigencia(l)}{!l.vigente && <span className="un__selo un__selo--neutro">Encerrada</span>}</span> },
    { id: "port", rotulo: "Portaria", celula: (l) => l.portaria },
    // Enquanto a produção carrega, as colunas já ocupam o lugar (sem salto de layout).
    ...(producao || carregandoProducao
      ? [
          { id: "cita", rotulo: "Cita", numerica: true, celula: (l: Linha) => (l.citam === null ? <span className="un__apagado">{carregandoProducao ? "…" : "—"}</span> : inteiro(l.citam)) },
          { id: "prod", rotulo: "Produzidos", numerica: true, celula: (l: Linha) => (l.produzidos === null ? <span className="un__apagado">{carregandoProducao ? "…" : "—"}</span> : l.produzidos === 0 && l.vigente && (l.citam ?? 0) > 0 ? <span className="un__atencao">0 · não produz</span> : <span className={l.produzidos > 0 ? "un__forte" : "un__apagado"}>{inteiro(l.produzidos)}</span>) },
          { id: "valor", rotulo: "Valor produzido", numerica: true, celula: (l: Linha) => (l.valor === null ? <span className="un__apagado">{carregandoProducao ? "…" : "—"}</span> : reais(l.valor)) },
        ]
      : []),
    { id: "ver", rotulo: "Procedimentos", celula: (l) => (
      <a className="un__ver" href={`#/painel/aptidao/oportunidade?hab=${encodeURIComponent(l.codigo)}`}
        aria-label={`Ver procedimentos da habilitação ${l.codigo}`} onClick={(e) => { e.preventDefault(); e.stopPropagation(); abrir(l); }}>Ver ›</a>
    ) },
  ];
  const planilha = (ls: Linha[]): Planilha => ({
    titulo: "Habilitações da unidade",
    abas: [{
      nome: "Habilitações",
      colunas: ["Código", "Nome", "Vigente", "Início", "Fim", "Portaria", ...(producao ? ["Procedimentos que citam", "Produzidos", "Valor produzido (R$)"] : [])],
      linhas: ls.map((l) => [l.codigo, l.nome, l.vigente ? "sim" : "não", l.inicio, l.fim, l.portaria, ...(producao ? [l.citam, l.produzidos, l.valor === null ? null : l.valor / 100] : [])]),
    }],
  });
  return (
    <TabelaDoCadastro rotulo="Habilitações" colunas={colunas} linhas={exibidas} busca={busca} aoBuscar={aoBuscar} aoAbrir={abrir}
      texto={(l) => `${l.codigo} ${l.nome ?? ""} ${l.portaria}`} planilha={planilha} nomeDoArquivo="habilitacoes"
      extras={citam.size > 0 && (
        <button type="button" className="painel__filtro un__filtro-chip" aria-pressed={soCitam} onClick={() => setSoCitam((v) => !v)}>Citam e não produzem {citam.size}</button>
      )}
      legenda={citam.size > 0 && "Produzidos “0 · não produz”: a habilitação vigente cita procedimentos e não produziu nos meses carregados."}
      contagem={(ls) => `${plural(ls.length, "habilitação", "habilitações")} · ${plural(ls.filter((l) => l.vigente).length, "vigente", "vigentes")}`} />
  );
}
