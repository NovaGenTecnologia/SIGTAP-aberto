import { useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { producaoApagar, producaoApagarGuardados, producaoBaixar, producaoImportar, producaoPlano, producaoReconstruir } from "../../api/comandos";
import type { PlanoProducao, UfProducao } from "../../api/tipos";
import { useAvisos } from "../../componentes/base/Avisos";
import { Botao } from "../../componentes/base/Botao";
import { Selecao } from "../../componentes/base/Selecao";
import { TabelaDeDados, type Coluna } from "../../componentes/base/TabelaDeDados";
import { ConfirmarAcao } from "../../componentes/dominio/ConfirmarAcao";
import { EstadoErro, EstadoVazio } from "../../componentes/dominio/Estados";
import { PainelDeTarefa } from "../../componentes/dominio/PainelDeTarefa";
import { useAcaoDeTarefa, type Tarefa } from "../../dados/acaoDeTarefa";
import { useProducao } from "../../dados/consultas";
import { mensagemOcupado } from "../../dados/tarefas";
import { rotuloCompetencia, tamanho } from "../../util/formatos";
import { UFS } from "../../util/ufs";

const MESES = [1, 2, 3, 6, 12, 24].map((n) => ({ id: String(n), rotulo: n === 1 ? "1 mês" : `${n} meses` }));

type Pendente = { tipo: "reconstruir" | "guardados" | "apagar"; uf: string } | null;
interface Linha { id: string; dados: UfProducao }

const ATE = (competencia: string | null | undefined, incompleto: string | null | undefined, sistema: string) => (
  <span className="dados__ate">
    {competencia ? rotuloCompetencia(competencia) : "—"}
    {incompleto && <span className="selo selo--estimativa"><span aria-hidden="true">!</span> {sistema} incompleto</span>}
  </span>
);

export function AbaProducao({ tarefa }: { tarefa: Tarefa }) {
  const cliente = useQueryClient();
  const { avisar } = useAvisos();
  const { data, isError, error, refetch } = useProducao();
  const { erro, escolhendo, executar, daPasta, falhou } = useAcaoDeTarefa(tarefa);
  const [uf, setUf] = useState("SP");
  const [meses, setMeses] = useState(12);
  const [plano, setPlano] = useState<PlanoProducao | null>(null);
  const [calculando, setCalculando] = useState(false);
  const [pendente, setPendente] = useState<Pendente>(null);
  const ultima = useRef<() => void>(() => {});

  const ocupado = tarefa.ativa;
  const rodar = (fazer: () => Promise<unknown>) => { ultima.current = () => void executar(fazer); ultima.current(); };
  const falhar = (e: unknown) => avisar(e instanceof Error ? e.message : String(e), "erro");

  async function verPlano() {
    setCalculando(true);
    try { setPlano(await producaoPlano(uf, meses)); }
    catch (e) { falhar(e); }
    finally { setCalculando(false); }
  }

  async function confirmar() {
    const p = pendente;
    setPendente(null);
    if (!p) return;
    try {
      if (p.tipo === "reconstruir") { rodar(() => producaoReconstruir(p.uf)); return; }
      await (p.tipo === "guardados" ? producaoApagarGuardados(p.uf) : producaoApagar(p.uf));
      await cliente.invalidateQueries({ queryKey: ["producao_situacao"] });
    } catch (e) { falhar(e); }
  }

  const colunas: Coluna<Linha>[] = [
    { id: "uf", largura: "7%", larguraMinima: 60, rotulo: "Estado", celula: (l) => <strong>{l.dados.uf}</strong> },
    { id: "sia", largura: "20%", larguraMinima: 200, rotulo: "SIA até", celula: (l) => ATE(l.dados.defasagem?.sia_ate, l.dados.defasagem?.sia_incompleto, "SIA") },
    { id: "sih", largura: "14%", larguraMinima: 110, rotulo: "SIH até", celula: (l) => ATE(l.dados.defasagem?.sih_ate, l.dados.defasagem?.sih_incompleto, "SIH") },
    { id: "banco", largura: "10%", larguraMinima: 90, rotulo: "Banco", numerica: true, celula: (l) => (l.dados.bytes_banco ? tamanho(l.dados.bytes_banco) : "—") },
    { id: "guardados", largura: "14%", larguraMinima: 150, rotulo: "Guardados", numerica: true, celula: (l) => (l.dados.guardados?.bytes ? tamanho(l.dados.guardados.bytes) : "—") },
    { id: "acoes", largura: "35%", larguraMinima: 360, rotulo: "Ações", celula: (l) => (
      <span className="dados__linha-acoes">
        <Botao isDisabled={ocupado} aria-label={`Reconstruir a produção de ${l.dados.uf}`} onPress={() => setPendente({ tipo: "reconstruir", uf: l.dados.uf })}>Reconstruir</Botao>
        <Botao variante="perigo" isDisabled={ocupado || !l.dados.guardados?.bytes} aria-label={`Apagar arquivos guardados de ${l.dados.uf}`} onPress={() => setPendente({ tipo: "guardados", uf: l.dados.uf })}>Apagar guardados</Botao>
        <Botao variante="perigo" isDisabled={ocupado} aria-label={`Apagar a produção de ${l.dados.uf}`} onPress={() => setPendente({ tipo: "apagar", uf: l.dados.uf })}>Apagar</Botao>
      </span>
    ) },
  ];
  const linhas: Linha[] = (data?.ufs ?? []).filter((u) => !u.erro).map((u) => ({ id: u.uf, dados: u }));
  const comErro = (data?.ufs ?? []).filter((u) => u.erro);

  const textoConfirmacao = pendente && {
    reconstruir: { titulo: `Reconstruir a produção de ${pendente.uf}?`, detalhe: "O banco é refeito a partir dos arquivos guardados. Pode levar um tempo.", rotulo: "Reconstruir", perigo: false },
    guardados: { titulo: `Apagar os arquivos guardados de ${pendente.uf}?`, detalhe: "O banco continua como está. Para reconstruí-lo depois, será preciso baixar os arquivos de novo.", rotulo: "Apagar", perigo: true },
    apagar: { titulo: `Apagar a produção de ${pendente.uf}?`, detalhe: "O banco e os dados de produção deste estado saem do computador.", rotulo: "Apagar", perigo: true },
  }[pendente.tipo];

  return (
    <div className="dados__aba">
      {ocupado && <PainelDeTarefa tarefa={tarefa} aoCancelar={() => void tarefa.cancelar()} />}
      {!ocupado && falhou && <PainelDeTarefa tarefa={tarefa} aoCancelar={() => void tarefa.cancelar()} aoTentarDeNovo={() => ultima.current()} />}
      {!ocupado && erro && <EstadoErro mensagem={erro} aoTentar={() => ultima.current()} />}

      <div className="dados__barra">
        <div className="dados__escopo dados__escopo--curto"><Selecao rotulo="Estado" itens={UFS} selectedKey={uf} isDisabled={ocupado} onSelectionChange={(k) => setUf(String(k))} /></div>
        <div className="dados__escopo"><Selecao rotulo="Período" itens={MESES} selectedKey={String(meses)} isDisabled={ocupado} onSelectionChange={(k) => setMeses(Number(k))} /></div>
        <Botao variante="primario" isDisabled={ocupado} carregando={calculando} onPress={() => void verPlano()}>Ver o que será baixado</Botao>
        <Botao isDisabled={ocupado || escolhendo} onPress={() => void daPasta((pasta) => producaoImportar(pasta, uf))}>Importar de pasta</Botao>
        {ocupado && <span className="dados__ocupado">{mensagemOcupado("producao")}</span>}
      </div>

      {isError ? <EstadoErro mensagem={(error as Error).message} aoTentar={() => void refetch()} />
        : linhas.length > 0 ? <TabelaDeDados rotulo="Produção carregada por estado" colunas={colunas} linhas={linhas} altura={Math.min(420, 36 * (linhas.length + 1) + 2)} />
        : data && comErro.length === 0 ? <EstadoVazio titulo="Nenhuma produção carregada" descricao="Escolha o estado e o período, veja o que será baixado e baixe." /> : null}
      {comErro.map((u) => <p key={u.uf} className="dados__nota" role="alert">Produção de {u.uf}: {u.erro}</p>)}

      {plano && (
        <ConfirmarAcao
          aberto titulo={`Baixar a produção de ${plano.uf}?`}
          detalhe={`${plano.itens.length} ${plano.itens.length === 1 ? "arquivo" : "arquivos"} · últimos ${meses} ${meses === 1 ? "mês" : "meses"}`}
          tamanhoBytes={plano.total_bytes} aviso="O download pode demorar." rotuloConfirmar="Baixar"
          aoCancelar={() => setPlano(null)}
          aoConfirmar={() => { const p = plano; setPlano(null); rodar(() => producaoBaixar({ uf: p.uf, meses, confirmado: true })); }}
        />
      )}
      {textoConfirmacao && (
        <ConfirmarAcao aberto titulo={textoConfirmacao.titulo} detalhe={textoConfirmacao.detalhe} rotuloConfirmar={textoConfirmacao.rotulo}
          perigo={textoConfirmacao.perigo} aoCancelar={() => setPendente(null)} aoConfirmar={() => void confirmar()} />
      )}
    </div>
  );
}
