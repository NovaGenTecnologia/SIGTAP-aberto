import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { manterBrutosDefinir } from "../../api/comandos";
import { useAvisos } from "../../componentes/base/Avisos";
import { Interruptor } from "../../componentes/base/Interruptor";
import { useProducao } from "../../dados/consultas";

/** Um interruptor para todas as fontes: desligado (padrão), os arquivos baixados saem depois de carregados. */
export function ManterArquivos({ desabilitado }: { desabilitado?: boolean }) {
  const cliente = useQueryClient();
  const { avisar } = useAvisos();
  const { data } = useProducao();
  const [otimista, setOtimista] = useState<boolean | null>(null);

  async function mudar(ligada: boolean) {
    setOtimista(ligada);
    try { await manterBrutosDefinir(ligada); await cliente.invalidateQueries({ queryKey: ["producao_situacao"] }); }
    catch (e) { setOtimista(null); avisar(e instanceof Error ? e.message : String(e), "erro"); }
  }

  return (
    <Interruptor isSelected={otimista ?? data?.manter_brutos ?? false} isDisabled={desabilitado} onChange={(v) => void mudar(v)}>Manter arquivos baixados</Interruptor>
  );
}
