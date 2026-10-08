import { useQueryClient } from "@tanstack/react-query";
import { unidadeDefinir } from "../api/comandos";
import type { UnidadeRef } from "../api/tipos";
import { Menu } from "../componentes/base/Menu";
import { useAvisos } from "../componentes/base/Avisos";
import { useUnidades } from "../dados/consultas";
import { ir } from "./rotas";

const ADICIONAR = "adicionar";

const nomeDe = (u: UnidadeRef) => (u.nome.trim() ? u.nome : `CNES ${u.cnes}`);

export function TrocaDeUnidade({ desativado }: { desativado: boolean }) {
  const { data } = useUnidades();
  const cliente = useQueryClient();
  const { avisar } = useAvisos();
  const ativa = data?.minha ?? null;
  // A unidade ativa entra sempre na lista, mesmo que a troca rápida ainda não a guarde.
  const todas = [...(ativa ? [ativa] : []), ...(data?.unidades ?? []).filter((u) => !ativa || u.uf !== ativa.uf || u.cnes !== ativa.cnes)];
  const itens = [
    ...todas.map((u) => ({ id: `${u.uf}:${u.cnes}`, rotulo: `${nomeDe(u)} (${u.uf})`, separado: false })),
    { id: ADICIONAR, rotulo: "Adicionar unidade…", separado: todas.length > 0 },
  ];

  async function escolher(id: string) {
    if (id === ADICIONAR) { ir("dados"); return; }
    const [uf, cnes] = id.split(":");
    try {
      await unidadeDefinir(uf!, cnes!);
      await cliente.invalidateQueries({ queryKey: ["cnes_situacao"] });
    } catch (e) {
      avisar((e as Error).message, "erro");
    }
  }

  if (desativado) return <span className="topo__unidade topo__unidade--vazia">Unidade</span>;
  if (todas.length === 0) return <a className="topo__unidade topo__unidade--vazia" href="#/dados">Escolher unidade</a>;
  return (
    <Menu rotulo={`Trocar unidade. Atual: ${ativa ? nomeDe(ativa) : "nenhuma"}`} itens={itens} aoEscolher={escolher}>
      <span className="topo__unidade-nome">{ativa ? nomeDe(ativa) : "Escolher unidade"}</span>
    </Menu>
  );
}
