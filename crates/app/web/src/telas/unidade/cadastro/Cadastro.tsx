import type { UnidadeCompleta } from "../../../api/tipos";
import { Abas } from "../../../componentes/base/Abas";
import { useUnidades } from "../../../dados/consultas";
import { useAptidaoResumo } from "../../../dados/unidade";
import { caminhoUnidade, ir, substituir, type AbaDeCadastro, type TelaDaUnidade } from "../../../shell/rotas";
import { inteiro } from "../../../util/formatos";
import { CabecalhoDaUnidade } from "../CabecalhoDaUnidade";
import { Equipamentos } from "./Equipamentos";
import { Habilitacoes } from "./Habilitacoes";
import { Leitos } from "./Leitos";
import { Profissionais } from "./Profissionais";
import { Servicos } from "./Servicos";
import { Terceiros } from "./Terceiros";

/** Cadastro da unidade em abas com contagem; a aba e o filtro moram na rota. */
export function Cadastro({ unidade, rota, competencia }: { unidade: UnidadeCompleta; rota: Extract<TelaDaUnidade, { tela: "cadastro" }>; competencia?: string }) {
  const terceiros = useUnidades().data?.terceiros ?? [];
  const aptidao = useAptidaoResumo(competencia, `${unidade.uf}:${unidade.cnes}`);
  const temPessoas = unidade.tem_arquivo_de_profissionais && unidade.profissionais !== null;
  const aba: AbaDeCadastro = rota.aba === "profissionais" && !temPessoas ? "habilitacoes" : rota.aba;
  const buscar = (q: string) => substituir("painel", ...caminhoUnidade({ tela: "cadastro", aba, q }));
  const rotulo = (nome: string, n: number | null) => (n === null ? nome : `${nome} ${inteiro(n)}`);

  const abas = [
    { id: "habilitacoes", rotulo: rotulo("Habilitações", unidade.habilitacoes.length),
      conteudo: <Habilitacoes unidade={unidade} aptidao={aptidao.data} carregandoProducao={aptidao.isPending} busca={rota.q} aoBuscar={buscar} /> },
    { id: "servicos", rotulo: rotulo("Serviços", unidade.servicos.length), conteudo: <Servicos servicos={unidade.servicos} busca={rota.q} aoBuscar={buscar} /> },
    { id: "leitos", rotulo: rotulo("Leitos", unidade.leitos.length), conteudo: <Leitos leitos={unidade.leitos} busca={rota.q} aoBuscar={buscar} /> },
    { id: "equipamentos", rotulo: rotulo("Equipamentos", unidade.equipamentos.length), conteudo: <Equipamentos equipamentos={unidade.equipamentos} busca={rota.q} aoBuscar={buscar} /> },
    ...(temPessoas ? [{ id: "profissionais", rotulo: rotulo("Profissionais", unidade.profissionais?.length ?? 0),
      conteudo: <Profissionais profissionais={unidade.profissionais ?? []} busca={rota.q} aoBuscar={buscar} /> }] : []),
    { id: "terceiros", rotulo: rotulo("Terceiros", terceiros.length), conteudo: <Terceiros uf={unidade.uf} cnes={unidade.cnes} terceiros={terceiros} /> },
  ];

  return (
    <div className="un">
      <CabecalhoDaUnidade tela="cadastro" unidade={unidade} />
      <Abas rotulo="Cadastro" abas={abas} selectedKey={aba}
        onSelectionChange={(k) => ir("painel", ...caminhoUnidade({ tela: "cadastro", aba: String(k) as AbaDeCadastro, q: "" }))} />
    </div>
  );
}
