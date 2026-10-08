import { ConfirmarAcao } from "../../componentes/dominio/ConfirmarAcao";

export interface ConfirmarApagarProps {
  aberto: boolean;
  titulo: string;
  detalhe: string;
  bytes?: number;
  aoConfirmar: () => void;
  aoCancelar: () => void;
}

// Apagar arquivos nunca tem volta: o foco começa em Cancelar (ConfirmarAcao) e o botão de confirmar é o de perigo.
export function ConfirmarApagar({ aberto, titulo, detalhe, bytes, aoConfirmar, aoCancelar }: ConfirmarApagarProps) {
  return <ConfirmarAcao aberto={aberto} titulo={titulo} detalhe={detalhe} tamanhoBytes={bytes} rotuloConfirmar="Apagar" perigo aoConfirmar={aoConfirmar} aoCancelar={aoCancelar} />;
}
