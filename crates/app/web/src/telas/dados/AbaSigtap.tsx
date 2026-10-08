import { useRef, useState } from "react";
import { apagarZips, baixar, importar } from "../../api/comandos";
import type { EscopoSigtap } from "../../api/tipos";
import { Botao } from "../../componentes/base/Botao";
import { Selecao } from "../../componentes/base/Selecao";
import { TabelaDeDados, type Coluna } from "../../componentes/base/TabelaDeDados";
import { EstadoErro } from "../../componentes/dominio/Estados";
import { PainelDeTarefa } from "../../componentes/dominio/PainelDeTarefa";
import { useAcaoDeTarefa, type Tarefa } from "../../dados/acaoDeTarefa";
import { useOfertas, useSituacao } from "../../dados/consultas";
import { mensagemOcupado } from "../../dados/tarefas";
import { rotuloCompetencia, tamanho } from "../../util/formatos";
import { ConfirmarApagar } from "./ConfirmarApagar";

const ESCOPOS = [
  { id: "vigente", rotulo: "Só a vigente" },
  { id: "6", rotulo: "Últimas 6" },
  { id: "12", rotulo: "Últimas 12" },
  { id: "24", rotulo: "Últimas 24" },
  { id: "tudo", rotulo: "Todas" },
];

type EstadoCompetencia = "carregada" | "guardada" | "servidor";
interface Linha { id: string; rotulo: string; publicada: string; bytes: number | null; estado: EstadoCompetencia }

const SELOS: Record<EstadoCompetencia, { classe: string; marca: string; texto: string }> = {
  carregada: { classe: "selo--confirmada", marca: "✓", texto: "Carregada" },
  guardada: { classe: "selo--informativo", marca: "▪", texto: "Guardada" },
  servidor: { classe: "selo--nao-confirmada", marca: "○", texto: "Só no servidor" },
};

const COLUNAS: Coluna<Linha>[] = [
  { id: "competencia", largura: "12%", larguraMinima: 110, rotulo: "Competência", celula: (l) => <strong>{l.rotulo}</strong> },
  { id: "publicada", largura: "22%", larguraMinima: 170, rotulo: "Publicada em", celula: (l) => <span className="num">{l.publicada}</span> },
  { id: "tamanho", largura: "12%", larguraMinima: 100, rotulo: "Tamanho", numerica: true, celula: (l) => (l.bytes === null ? "—" : tamanho(l.bytes)) },
  { id: "estado", largura: "54%", larguraMinima: 150, rotulo: "Estado", celula: (l) => {
    const s = SELOS[l.estado];
    return <span className={`selo ${s.classe}`}><span aria-hidden="true">{s.marca}</span> {s.texto}</span>;
  } },
];

export function AbaSigtap({ tarefa }: { tarefa: Tarefa }) {
  const situacao = useSituacao().data;
  const ofertas = useOfertas();
  const { erro, escolhendo, executar, daPasta, falhou } = useAcaoDeTarefa(tarefa);
  const [escopo, setEscopo] = useState<EscopoSigtap>("12");
  const [confirmando, setConfirmando] = useState(false);
  const ultima = useRef<() => void>(() => {});

  const ocupado = tarefa.ativa;
  const rodar = (fazer: () => Promise<unknown>) => { ultima.current = () => void executar(fazer); ultima.current(); };
  const baixarEscopo = () => rodar(() => baixar({ sigtap: escopo, territorio: situacao?.territorio === null }));

  const linhas = montarLinhas(situacao?.competencias ?? [], ofertas.data?.competencias ?? []);
  const apagaveis = situacao?.zips?.bytes_apagaveis ?? 0;

  return (
    <div className="dados__aba">
      {ocupado && <PainelDeTarefa tarefa={tarefa} aoCancelar={() => void tarefa.cancelar()} />}
      {!ocupado && falhou && <PainelDeTarefa tarefa={tarefa} aoCancelar={() => void tarefa.cancelar()} aoTentarDeNovo={() => ultima.current()} />}
      {!ocupado && erro && <EstadoErro mensagem={erro} aoTentar={() => ultima.current()} />}

      <div className="dados__barra">
        <div className="dados__escopo">
          <Selecao rotulo="Quantas competências baixar" itens={ESCOPOS} selectedKey={escopo} isDisabled={ocupado} onSelectionChange={(k) => setEscopo(String(k) as EscopoSigtap)} />
        </div>
        <Botao variante="primario" isDisabled={ocupado} onPress={baixarEscopo}>Baixar</Botao>
        <Botao isDisabled={ocupado || escolhendo} onPress={() => void daPasta(importar)}>Importar de pasta</Botao>
        <Botao isDisabled={ocupado} onPress={() => setConfirmando(true)}>Apagar ZIPs já carregados</Botao>
        {ocupado && <span className="dados__ocupado">{mensagemOcupado("sigtap")}</span>}
      </div>

      {ofertas.isError && !ofertas.data ? (
        <>
          <EstadoErro mensagem={(ofertas.error as Error).message} aoTentar={() => void ofertas.refetch()} />
          <p className="dados__nota">Importar de pasta continua disponível.</p>
        </>
      ) : linhas.length > 0 ? (
        <TabelaDeDados rotulo="Competências do SIGTAP" colunas={COLUNAS} linhas={linhas} altura={Math.min(420, 36 * (linhas.length + 1) + 2)} />
      ) : null}

      <section className="dados__territorio">
        <h2>Territórios (IBGE)</h2>
        <p>{situacao?.territorio ? "Carregados." : "Ainda não carregados."}</p>
      </section>

      <ConfirmarApagar
        aberto={confirmando} titulo="Apagar os ZIPs já carregados?"
        detalhe="Os dados continuam no programa. Só os arquivos ZIP guardados são apagados, e um novo download precisa deles de novo."
        bytes={apagaveis}
        aoCancelar={() => setConfirmando(false)}
        aoConfirmar={() => { setConfirmando(false); rodar(() => apagarZips()); }}
      />
    </div>
  );
}

function montarLinhas(carregadas: { competencia: string; publicado_em: string | null }[], ofertas: { competencia: string; tamanho: number; guardado: boolean; carregado: boolean }[]): Linha[] {
  const porCompetencia = new Map<string, Linha>();
  for (const o of ofertas) {
    const publicada = carregadas.find((c) => c.competencia === o.competencia)?.publicado_em ?? "—";
    const estado: EstadoCompetencia = o.carregado ? "carregada" : o.guardado ? "guardada" : "servidor";
    porCompetencia.set(o.competencia, { id: o.competencia, rotulo: rotuloCompetencia(o.competencia), publicada, bytes: o.tamanho, estado });
  }
  for (const c of carregadas) {
    if (!porCompetencia.has(c.competencia)) porCompetencia.set(c.competencia, { id: c.competencia, rotulo: rotuloCompetencia(c.competencia), publicada: c.publicado_em ?? "—", bytes: null, estado: "carregada" });
  }
  return [...porCompetencia.values()].sort((a, b) => b.id.localeCompare(a.id)); // a mais recente primeiro
}
