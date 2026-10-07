import { useQuery } from "@tanstack/react-query";
import { infoPrograma } from "../api/comandos";
import { Dialogo } from "../componentes/base/Dialogo";

export function Sobre({ aberto, aoFechar }: { aberto: boolean; aoFechar: () => void }) {
  const info = useQuery({ queryKey: ["info_programa"], queryFn: infoPrograma, enabled: aberto });
  return (
    <Dialogo titulo="Sobre" aberto={aberto} aoFechar={aoFechar}>
      <p><strong>SIGTAP Aberto</strong>{info.data?.versao ? ` ${info.data.versao}` : ""}</p>
      <p>Ferramenta não oficial. Sem vínculo com o Ministério da Saúde, o DATASUS ou a ANS. Confira no SIGTAP oficial antes de faturar.</p>
    </Dialogo>
  );
}
