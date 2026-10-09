import { useState, type ReactNode } from "react";
import type { FaturamentoUnidade, UnidadeCompleta } from "../../../api/tipos";
import { ehAusente } from "../../../api/tipos";
import { Abas } from "../../../componentes/base/Abas";
import { Botao } from "../../../componentes/base/Botao";
import { Carregando, EstadoErro, EstadoVazio } from "../../../componentes/dominio/Estados";
import { useFaturamentoUnidade } from "../../../dados/producao";
import { ABAS_DE_PRODUCAO, caminhoUnidade, ir, type AbaDeProducao, type TelaDaUnidade } from "../../../shell/rotas";
import { inteiro } from "../../../util/formatos";
import { CabecalhoDaUnidade } from "../CabecalhoDaUnidade";
import { LugarDasAcoes } from "./AcoesDaProducao";
import { ForaDoPadrao } from "./ForaDoPadrao";
import { OrigemDoValor } from "./OrigemDoValor";
import { Procedimentos } from "./Procedimentos";
import { Rejeicoes } from "./Rejeicoes";
import { VisaoGeral } from "./VisaoGeral";
import "./producao.css";

const texto = (e: unknown) => (typeof e === "string" ? e : e instanceof Error ? e.message : "Não foi possível ler a produção.");
type Rota = Extract<TelaDaUnidade, { tela: "producao" }>;

const ROTULO: Record<AbaDeProducao, string> = {
  "visao-geral": "Visão geral", rejeicoes: "Rejeições", procedimentos: "Procedimentos", "fora-do-padrao": "Fora do padrão", "origem-do-valor": "Origem do valor",
};


/** O que cada aba mostra ao lado do nome, ou nada enquanto o fechamento não chegou. */
function contagemDe(aba: AbaDeProducao, f: FaturamentoUnidade | null): string | null {
  if (!f) return null;
  if (aba === "procedimentos") return inteiro(f.abc.sia.total_procedimentos + f.abc.sih.total_procedimentos);
  if (aba === "fora-do-padrao") {
    const permanencia = f.permanencia && !ehAusente(f.permanencia) ? f.permanencia.fora_do_previsto : 0;
    return inteiro((f.apresentado?.atipicas.length ?? 0) + permanencia);
  }
  return null;
}

/** Produção da unidade em cinco abas, uma por pergunta do faturista; a aba, o filtro e o sistema moram na rota. */
export function Producao({ unidade, rota, competencia }: { unidade: UnidadeCompleta; rota: Rota; competencia?: string }) {
  const fechamento = useFaturamentoUnidade(competencia, `${unidade.uf}:${unidade.cnes}`);
  const [lugar, setLugar] = useState<HTMLElement | null>(null);
  const cabeca = <CabecalhoDaUnidade tela="producao" unidade={unidade} acoes={<div ref={setLugar} className="pr__acoes" />} />;
  if (fechamento.isError) return <div className="un">{cabeca}<EstadoErro mensagem={texto(fechamento.error)} aoTentar={() => void fechamento.refetch()} /></div>;
  if (fechamento.data && !fechamento.data.disponivel) {
    return (
      <div className="un">
        {cabeca}
        <p className="un__aviso" role="note">
          <span>Sem produção carregada para {fechamento.data.uf}</span>
          <Botao onPress={() => ir("dados")}>Baixar produção</Botao>
        </p>
      </div>
    );
  }
  const dados = fechamento.data?.disponivel ? fechamento.data : null;
  if (dados && !dados.meses.some((m) => m.sia_valor_centavos > 0 || m.sia_quantidade > 0 || m.sih_valor_centavos > 0 || m.sih_aih > 0)) {
    return (
      <div className="un">
        {cabeca}
        <div className="un__cartao">
          <EstadoVazio titulo="Nenhuma produção desta unidade nos meses carregados" descricao="Confira o CNES da unidade ou baixe mais meses de produção."
            acao={{ rotulo: "Abrir em Dados", aoAcionar: () => ir("dados") }} />
        </div>
      </div>
    );
  }
  const aba = ABAS_DE_PRODUCAO.find((a) => a === rota.aba) ?? "visao-geral";
  const espera = <Carregando rotulo="Lendo a produção da unidade" />;
  const pronto: Record<AbaDeProducao, ReactNode> = {
    "visao-geral": dados && <VisaoGeral f={dados} competencia={competencia} />, rejeicoes: dados && <Rejeicoes f={dados} unidade={unidade} rota={rota} />, procedimentos: dados && <Procedimentos unidade={unidade} rota={rota} competencia={competencia} />, "fora-do-padrao": dados && <ForaDoPadrao f={dados} rota={rota} />, "origem-do-valor": dados && <OrigemDoValor f={dados} />,
  };
  const abas = ABAS_DE_PRODUCAO.map((id) => {
    const n = contagemDe(id, dados);
    return { id, rotulo: n ? `${ROTULO[id]} ${n}` : ROTULO[id], conteudo: dados ? pronto[id] : espera };
  });
  return (
    <LugarDasAcoes value={lugar}>
    <div className="un">
      {cabeca}
      <Abas rotulo="Produção" abas={abas} selectedKey={aba}
        onSelectionChange={(k) => ir("painel", ...caminhoUnidade({ ...rota, aba: String(k) as AbaDeProducao }))} />
    </div>
    </LugarDasAcoes>
  );
}
