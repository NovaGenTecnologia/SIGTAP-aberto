import { Dialog, Heading, Modal, ModalOverlay } from "react-aria-components";
import { tamanho } from "../../util/formatos";
import { Botao } from "../base/Botao";
import "../base/superficie.css";
import "./dominio.css";

export interface ConfirmarAcaoProps {
  aberto: boolean;
  titulo: string;
  detalhe: string;
  tamanhoBytes?: number;
  aviso?: string;
  rotuloConfirmar: string;
  rotuloCancelar?: string;
  perigo?: boolean;
  aoConfirmar: () => void;
  aoCancelar: () => void;
}

// O foco começa em "Cancelar": confirmar exige um gesto deliberado.
export function ConfirmarAcao(p: ConfirmarAcaoProps) {
  return (
    <ModalOverlay isOpen={p.aberto} onOpenChange={(a) => { if (!a) p.aoCancelar(); }} isDismissable className="dialogo__fundo">
      <Modal className="dialogo">
        <Dialog role="alertdialog" className="dialogo__corpo">
          <Heading slot="title" className="dialogo__titulo">{p.titulo}</Heading>
          <div className="dialogo__conteudo">
            <p>{p.detalhe}</p>
            {p.tamanhoBytes !== undefined && <p className="num">{tamanho(p.tamanhoBytes)}</p>}
            {p.aviso && <p>{p.aviso}</p>}
          </div>
          <div className="dialogo__acoes">
            <Botao autoFocus onPress={p.aoCancelar}>{p.rotuloCancelar ?? "Cancelar"}</Botao>
            <Botao variante={p.perigo ? "perigo" : "primario"} onPress={p.aoConfirmar}>{p.rotuloConfirmar}</Botao>
          </div>
        </Dialog>
      </Modal>
    </ModalOverlay>
  );
}
