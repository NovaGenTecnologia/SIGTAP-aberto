import { useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { cnesApagar, cnesBaixar, cnesImportar, cnesVerificar } from "../../api/comandos";
import type { UfCnes } from "../../api/tipos";
import { useAvisos } from "../../componentes/base/Avisos";
import { Botao } from "../../componentes/base/Botao";
import { Selecao } from "../../componentes/base/Selecao";
import { TabelaDeDados, type Coluna } from "../../componentes/base/TabelaDeDados";
import { EstadoErro, EstadoVazio } from "../../componentes/dominio/Estados";
import { PainelDeTarefa } from "../../componentes/dominio/PainelDeTarefa";
import { useAcaoDeTarefa, type Tarefa } from "../../dados/acaoDeTarefa";
import { useUnidades } from "../../dados/consultas";
import { mensagemOcupado } from "../../dados/tarefas";
import { rotuloCompetencia, tamanho } from "../../util/formatos";
import { UFS } from "../../util/ufs";
import { ConfirmarApagar } from "./ConfirmarApagar";

interface Linha { id: string; uf: string; competencia: string; bytes: number | null; erro: string | null; daUnidade: boolean }

const ultimaCompetencia = (u: UfCnes) => (u.resumo?.arquivos ?? []).map((a) => a.competencia).sort().at(-1) ?? "";

export function AbaCnes({ tarefa }: { tarefa: Tarefa }) {
  const cliente = useQueryClient();
  const { avisar } = useAvisos();
  const { data: cnes, isError, error, refetch } = useUnidades();
  const { erro, escolhendo, executar, daPasta, falhou } = useAcaoDeTarefa(tarefa);
  const [ufEscolhida, setUfEscolhida] = useState<string | null>(null);
  const [apagando, setApagando] = useState<string | null>(null);
  const ultima = useRef<() => void>(() => {});

  const ocupado = tarefa.ativa;
  const uf = ufEscolhida ?? cnes?.minha?.uf ?? "SP";
  const baixar = (alvo: string) => { ultima.current = () => void executar(() => cnesBaixar(alvo)); ultima.current(); };

  async function verificar() {
    try {
      const r = (await cnesVerificar()) as { novas?: { uf: string; nova: string }[]; erro?: string | null };
      if (r.erro) avisar(`Não foi possível verificar: ${r.erro}`, "erro");
      else if (r.novas?.length) avisar(`CNES mais novo no servidor: ${r.novas.map((n) => `${n.uf} (${rotuloCompetencia(n.nova)})`).join(", ")}.`, "info");
      else avisar("O CNES carregado está em dia.", "ok");
    } catch (e) { avisar(e instanceof Error ? e.message : String(e), "erro"); }
  }

  async function apagar(alvo: string) {
    setApagando(null);
    try { await cnesApagar(alvo); await cliente.invalidateQueries(); }
    catch (e) { avisar(e instanceof Error ? e.message : String(e), "erro"); }
  }

  const linhas: Linha[] = (cnes?.ufs ?? []).map((u) => ({
    id: u.uf, uf: u.uf, competencia: ultimaCompetencia(u), bytes: u.bytes ?? null, erro: u.erro ?? null, daUnidade: cnes?.minha?.uf === u.uf,
  }));

  const colunas: Coluna<Linha>[] = [
    { id: "uf", largura: "18%", larguraMinima: 180, rotulo: "Estado", celula: (l) => <span className="dados__estado"><strong>{l.uf}</strong>{l.daUnidade && <span className="selo selo--informativo"><span aria-hidden="true">▪</span> Sua unidade</span>}</span> },
    { id: "competencia", largura: "12%", larguraMinima: 120, rotulo: "Competência", celula: (l) => (l.competencia ? rotuloCompetencia(l.competencia) : "—") },
    { id: "tamanho", largura: "10%", larguraMinima: 100, rotulo: "Tamanho", numerica: true, celula: (l) => (l.bytes === null ? "—" : tamanho(l.bytes)) },
    { id: "situacao", largura: "35%", larguraMinima: 200, rotulo: "Situação", celula: (l) => l.erro
      ? <span className="selo selo--estimativa" title={l.erro}><span aria-hidden="true">!</span> {l.erro}</span>
      : <span className="selo selo--confirmada"><span aria-hidden="true">✓</span> Carregada</span> },
    { id: "acoes", largura: "25%", larguraMinima: 250, rotulo: "Ações", celula: (l) => (
      <span className="dados__linha-acoes">
        {l.erro
          ? <Botao isDisabled={ocupado} aria-label={`Baixar de novo o CNES de ${l.uf}`} onPress={() => baixar(l.uf)}>Baixar de novo</Botao>
          : <Botao isDisabled={ocupado} aria-label={`Atualizar o CNES de ${l.uf}`} onPress={() => baixar(l.uf)}>Atualizar</Botao>}
        <Botao variante="perigo" isDisabled={ocupado} aria-label={`Apagar o CNES de ${l.uf}`} onPress={() => setApagando(l.uf)}>Apagar</Botao>
      </span>
    ) },
  ];

  const daAtiva = apagando !== null && cnes?.minha?.uf === apagando;
  const bytesApagando = cnes?.ufs.find((u) => u.uf === apagando)?.bytes;
  return (
    <div className="dados__aba">
      {ocupado && <PainelDeTarefa tarefa={tarefa} aoCancelar={() => void tarefa.cancelar()} />}
      {!ocupado && falhou && <PainelDeTarefa tarefa={tarefa} aoCancelar={() => void tarefa.cancelar()} aoTentarDeNovo={() => ultima.current()} />}
      {!ocupado && erro && <EstadoErro mensagem={erro} aoTentar={() => ultima.current()} />}

      <div className="dados__barra">
        <div className="dados__escopo"><Selecao rotulo="Estado" itens={UFS} selectedKey={uf} isDisabled={ocupado} onSelectionChange={(k) => setUfEscolhida(String(k))} /></div>
        <Botao variante="primario" isDisabled={ocupado} onPress={() => baixar(uf)}>Baixar CNES</Botao>
        <Botao isDisabled={ocupado || escolhendo} onPress={() => void daPasta((pasta) => cnesImportar(pasta, uf))}>Importar de pasta</Botao>
        <Botao onPress={() => void verificar()}>Verificar atualizações</Botao>
        {ocupado && <span className="dados__ocupado">{mensagemOcupado("cnes")}</span>}
      </div>

      {isError ? <EstadoErro mensagem={(error as Error).message} aoTentar={() => void refetch()} />
        : linhas.length > 0 ? <TabelaDeDados rotulo="CNES carregado por estado" colunas={colunas} linhas={linhas} altura={Math.min(420, 36 * (linhas.length + 1) + 2)} />
        : cnes ? <EstadoVazio titulo="Nenhum estado carregado" descricao="Escolha o estado e baixe o CNES." /> : null}

      <ConfirmarApagar
        aberto={apagando !== null} titulo={`Apagar o CNES de ${apagando ?? ""}?`}
        detalhe={daAtiva
          ? `O Painel de ${cnes?.minha?.nome ?? "sua unidade"} deixa de ter dados até o CNES de ${apagando} ser baixado de novo.`
          : "Os dados deste estado saem do computador. Você pode baixá-los de novo quando quiser."}
        bytes={bytesApagando}
        aoCancelar={() => setApagando(null)} aoConfirmar={() => apagando && void apagar(apagando)}
      />
    </div>
  );
}
