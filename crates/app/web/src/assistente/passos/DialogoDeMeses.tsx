import { useRef, useState } from "react";
import { Dialog, Heading, Label, Modal, ModalOverlay, Radio, RadioGroup } from "react-aria-components";
import { Botao } from "../../componentes/base/Botao";
import { Selecao } from "../../componentes/base/Selecao";
import "../../componentes/base/superficie.css";

export type MesesAnteriores = "6" | "12" | "24" | "tudo";
const OPCOES = [
  { id: "6", rotulo: "Últimos 6 meses" },
  { id: "12", rotulo: "Últimos 12 meses" },
  { id: "24", rotulo: "Últimos 24 meses" },
  { id: "tudo", rotulo: "Todos os meses" },
];

export interface DialogoDeMesesProps {
  aberto: boolean;
  /** `null`: só o último mês. */
  aoEscolher: (meses: MesesAnteriores | null) => void;
  aoCancelar: () => void;
}

export function DialogoDeMeses({ aberto, aoEscolher, aoCancelar }: DialogoDeMesesProps) {
  const [modo, setModo] = useState<"ultimo" | "mais">("ultimo");
  const [meses, setMeses] = useState<MesesAnteriores>("12");
  const enviado = useRef(false);
  const continuar = () => {
    if (enviado.current) return;
    enviado.current = true;
    aoEscolher(modo === "mais" ? meses : null);
  };
  return (
    <ModalOverlay isOpen={aberto} onOpenChange={(a) => { if (!a) aoCancelar(); }} isDismissable className="dialogo__fundo">
      <Modal className="dialogo">
        <Dialog className="dialogo__corpo">
          <Heading slot="title" className="dialogo__titulo">Baixar também os meses anteriores?</Heading>
          <div className="dialogo__conteudo">
            <p>O último mês baixa agora; os outros seguem em segundo plano.</p>
            <RadioGroup value={modo} onChange={(v) => setModo(v as "ultimo" | "mais")} className="grupo">
              <Label className="sr-only">Meses a baixar</Label>
              <Radio value="ultimo" className="opcao"><span className="opcao__bolinha" aria-hidden="true" />Só o último mês</Radio>
              <Radio value="mais" className="opcao"><span className="opcao__bolinha" aria-hidden="true" />Baixar mais meses</Radio>
            </RadioGroup>
            {modo === "mais" && <Selecao rotulo="Período" itens={OPCOES} selectedKey={meses} onSelectionChange={(k) => setMeses(String(k) as MesesAnteriores)} />}
          </div>
          <div className="dialogo__acoes">
            <Botao variante="primario" onPress={continuar}>Continuar</Botao>
          </div>
        </Dialog>
      </Modal>
    </ModalOverlay>
  );
}
