import type { ReactNode } from "react";
import { Dialog, Heading, Modal, ModalOverlay } from "react-aria-components";
import { Botao } from "./Botao";
import "./superficie.css";

export interface DialogoProps {
  titulo: string;
  aberto: boolean;
  aoFechar: () => void;
  children: ReactNode;
}

export function Dialogo({ titulo, aberto, aoFechar, children }: DialogoProps) {
  return (
    <ModalOverlay isOpen={aberto} onOpenChange={(a) => { if (!a) aoFechar(); }} isDismissable className="dialogo__fundo">
      <Modal className="dialogo">
        <Dialog className="dialogo__corpo">
          <Heading slot="title" className="dialogo__titulo">{titulo}</Heading>
          <div className="dialogo__conteudo">{children}</div>
          <div className="dialogo__acoes"><Botao onPress={aoFechar}>Fechar</Botao></div>
        </Dialog>
      </Modal>
    </ModalOverlay>
  );
}
